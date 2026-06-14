import { MatchService } from "./match.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { NotFoundException } from "@nestjs/common";
import { MatchStatus, PlayerStatus, ErrorCode } from "@arena/shared";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("MatchService", () => {
  let service: MatchService;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: vi.fn(), update: vi.fn() },
      match: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matchPlayer: {
        createMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matchRound: { create: vi.fn(), findUnique: vi.fn() },
      answer: { create: vi.fn(), createMany: vi.fn() },
      question: { findUnique: vi.fn() },
      $transaction: vi.fn(async (ops) => {
        // Execute all operations sequentially for test fidelity
        if (Array.isArray(ops)) {
          return Promise.all(ops);
        }
        return ops(prisma);
      }),
    } as unknown as PrismaService;
    redis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    } as unknown as RedisService;
    service = new MatchService(prisma, redis);
  });

  describe("createMatch", () => {
    it("creates match with state machine", async () => {
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "Alice" } },
          { user: { id: "u2", username: "Bob" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);

      const result = await service.createMatch("r1");

      expect(result.id).toBe("m1");
      expect(prisma.matchPlayer.createMany).toHaveBeenCalled();
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { currentMatchId: "m1", status: "STARTING" },
      });
      expect(redis.set).toHaveBeenCalled(); // persistStateMachine
    });

    it("throws NotFoundException when room not found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.createMatch("r1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("succeeds even when Redis persist fails", async () => {
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "Alice" } },
          { user: { id: "u2", username: "Bob" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(redis.set).mockRejectedValue(new Error("Redis down"));

      const result = await service.createMatch("r1");

      expect(result.id).toBe("m1");
    });

    it("throws RoomError when less than 2 players", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        players: [{ user: { id: "u1", username: "Alice" } }],
      } as any);
      await expect(service.createMatch("r1")).rejects.toMatchObject({
        code: ErrorCode.NOT_ENOUGH_PLAYERS,
      });
    });
  });

  describe("getStateMachine", () => {
    it("returns cached state machine", async () => {
      // First create a match to populate the cache
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      const sm = await service.getStateMachine("m1");
      expect(sm).toBeDefined();
      expect(sm!.getState().id).toBe("m1");
    });

    it("restores from Redis when not in memory", async () => {
      // Manually craft a valid serialized state machine JSON
      const serialized = JSON.stringify({
        state: {
          id: "m2",
          roomId: "r2",
          status: MatchStatus.CREATED,
          currentRoundNo: 0,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
            [
              "u2",
              {
                id: "u2",
                name: "B",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1", "u2"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: null,
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);

      const sm = await service.getStateMachine("m2");
      expect(sm).toBeDefined();
      expect(sm!.getState().id).toBe("m2");
    });

    it("returns undefined when not in memory or Redis", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const sm = await service.getStateMachine("nonexistent");
      expect(sm).toBeUndefined();
    });

    it("returns undefined and cleans up on corrupted Redis data", async () => {
      vi.mocked(redis.get).mockResolvedValue("invalid json{{{");
      const sm = await service.getStateMachine("bad");
      expect(sm).toBeUndefined();
      expect(redis.del).toHaveBeenCalledWith("match:state:bad");
    });

    // L3 coverage: rehydrateCorrectAnswer runs when getStateMachine
    // restores from Redis. The restored state machine's current round
    // has the safe shape (no correctAnswer in the Redis JSON) and
    // must re-attach the answer from the DB so grading works.
    it("rehydrates the correct answer from the DB for an in-flight ACTIVE round", async () => {
      // Build a serialized state with currentRound in ACTIVE status
      // so rehydrateCorrectAnswer actually runs the prisma lookup.
      const serialized = JSON.stringify({
        state: {
          id: "m-rehydrate",
          roomId: "r-rehydrate",
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 1,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
            [
              "u2",
              {
                id: "u2",
                name: "B",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1", "u2"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: {
          roundNo: 1,
          question: {
            id: "q-rehydrate",
            content: "Q?",
            options: ["A", "B"],
            difficulty: "MEDIUM",
          },
          startedAt: 1000,
          endsAt: 2000,
          status: "ACTIVE",
          answers: [],
        },
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);
      vi.mocked(prisma.question.findUnique).mockResolvedValue({
        correctAnswer: "A",
      } as any);

      const sm = await service.getStateMachine("m-rehydrate");
      expect(sm).toBeDefined();
      // The DB lookup must have run with the question id from
      // the in-flight round.
      expect(prisma.question.findUnique).toHaveBeenCalledWith({
        where: { id: "q-rehydrate" },
        select: { correctAnswer: true },
      });
      // The restored state machine's round now has the correct
      // answer attached (L3 re-attach).
      const restoredRound = sm!.getCurrentRound();
      expect(restoredRound).not.toBeNull();
      // The `correctAnswer` field is internal on the round
      // shape; verify it via the typed access.
      const internalAnswer = (
        restoredRound as unknown as {
          correctAnswer: string;
        }
      ).correctAnswer;
      expect(internalAnswer).toBe("A");
    });

    it("does not call the DB when the restored round is not ACTIVE", async () => {
      // Build a serialized state with currentRound in COMPLETED
      // status. rehydrateCorrectAnswer must short-circuit and
      // not run the prisma lookup.
      const serialized = JSON.stringify({
        state: {
          id: "m-skip",
          roomId: "r-skip",
          status: MatchStatus.ROUND_RESULT,
          currentRoundNo: 1,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: {
          roundNo: 1,
          question: {
            id: "q-skip",
            content: "Q?",
            options: ["A", "B"],
            difficulty: "MEDIUM",
          },
          startedAt: 1000,
          endsAt: 2000,
          status: "COMPLETED",
          answers: [],
        },
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);

      const sm = await service.getStateMachine("m-skip");
      expect(sm).toBeDefined();
      expect(prisma.question.findUnique).not.toHaveBeenCalled();
    });

    // L3 coverage: rehydrateCorrectAnswer's other early-returns
    // and failure paths. The "happy" and "round not ACTIVE"
    // tests above cover the common branches. The cases below
    // pin the structural behavior of the rehydrate path so a
    // future refactor can't accidentally regress them.
    it("does not call the DB when the restored state has no current round", async () => {
      // currentRound: null → rehydrateCorrectAnswer's first
      // guard (`if (!round) return;`) short-circuits before any
      // prisma lookup. This covers line 145.
      const serialized = JSON.stringify({
        state: {
          id: "m-noround",
          roomId: "r-noround",
          status: MatchStatus.ROUND_RESULT,
          currentRoundNo: 0,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: null,
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);

      const sm = await service.getStateMachine("m-noround");
      expect(sm).toBeDefined();
      expect(prisma.question.findUnique).not.toHaveBeenCalled();
    });

    // NOTE: the `if (!questionId) return;` guard inside
    // rehydrateCorrectAnswer (line 148) is unreachable through
    // normal Redis deserialization. The deserializer
    // (`MatchStateMachine.deserialize` at
    // `packages/game-core/src/match-state-machine.ts:665-670`)
    // validates that the question is a non-null object with id,
    // content, and options before constructing the state machine.
    // If the question is missing, deserialize throws and
    // `getStateMachine` catches the error + returns undefined
    // (lines 117-125) before rehydrateCorrectAnswer runs. The
    // `!questionId` guard remains as defense-in-depth for any
    // future code path that constructs a state machine without
    // going through the deserializer, but we don't exercise it
    // here to avoid crafting a state shape the deserializer
    // would reject.

    it("logs an error and degrades gracefully when the question is not found in the DB for an ACTIVE round", async () => {
      // 2c fix (option A): the questionId is in the state machine, but
      // the DB row was deleted (e.g. an admin ran
      // `prisma.question.delete` while the match was in flight).
      // getStateMachine MUST NOT throw — a throw here propagates
      // through every hot path and makes the match permanently
      // unrecoverable. Instead it logs an error and returns a usable
      // state machine with no attached correct answer; the round will
      // grade everyone as wrong and the match still completes.
      const serialized = JSON.stringify({
        state: {
          id: "m-orphan-q",
          roomId: "r-orphan-q",
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 1,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: {
          roundNo: 1,
          question: {
            id: "q-orphan",
            content: "Q?",
            options: ["A", "B"],
            difficulty: "MEDIUM",
          },
          startedAt: 1000,
          endsAt: 2000,
          status: "ACTIVE",
          answers: [],
        },
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);
      // DB returns null (question row missing).
      vi.mocked(prisma.question.findUnique).mockResolvedValue(null);
      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});

      const sm = await service.getStateMachine("m-orphan-q");

      // The state machine is returned and usable (no throw).
      expect(sm).toBeDefined();
      // No correct answer was attached (the round will grade everyone
      // as wrong, but the match stays recoverable).
      const round = sm!.getCurrentRound();
      expect(
        (round as { correctAnswer?: string } | null)?.correctAnswer,
      ).toBeUndefined();

      // The error message must include the question id and the
      // round no so an operator can correlate.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("q-orphan"),
      );
    });

    it("logs an error and degrades gracefully when the prisma.question lookup itself throws for an ACTIVE round", async () => {
      // 2c fix (option A): the DB lookup for the question row throws
      // (e.g. a transient Prisma error during rehydrate). getStateMachine
      // MUST NOT throw — it logs and degrades so the match stays
      // recoverable; a later getStateMachine call may succeed.
      const serialized = JSON.stringify({
        state: {
          id: "m-db-boom",
          roomId: "r-db-boom",
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: 1,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: {
          roundNo: 1,
          question: {
            id: "q-boom",
            content: "Q?",
            options: ["A", "B"],
            difficulty: "MEDIUM",
          },
          startedAt: 1000,
          endsAt: 2000,
          status: "ACTIVE",
          answers: [],
        },
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);
      vi.mocked(prisma.question.findUnique).mockRejectedValueOnce(
        new Error("Prisma: connection lost"),
      );
      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});

      const sm = await service.getStateMachine("m-db-boom");

      // The state machine is returned and usable (no throw).
      expect(sm).toBeDefined();
      const round = sm!.getCurrentRound();
      expect(
        (round as { correctAnswer?: string } | null)?.correctAnswer,
      ).toBeUndefined();

      // The error log must include the question id so the
      // operator can find the bad row.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("q-boom"),
        expect.any(Error),
      );
    });
  });

  describe("persistStateMachine", () => {
    it("does nothing when machine not found", async () => {
      await service.persistStateMachine("nonexistent");
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe("getMatch", () => {
    it("returns match when found", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({ id: "m1" } as any);
      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
    });

    it("throws NotFoundException when not found", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
      await expect(service.getMatch("m1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("finishMatch", () => {
    it("updates match, room, cleans up state machine and Redis", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);

      await service.finishMatch("m1", "u1", "r1");

      // 1f/2a fix: the finish write is now idempotent — match.updateMany
      // with a `status != FINISHED` filter instead of match.update.
      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: { id: "m1", status: { not: MatchStatus.FINISHED } },
        data: {
          status: MatchStatus.FINISHED,
          winnerId: "u1",
          endedAt: expect.any(Date),
        },
      });
      expect(redis.del).toHaveBeenCalledWith("match:state:m1");
    });

    it("records null winner for admin termination and skips score persistence", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);

      // Admin termination path: winnerId === null, isAdminTermination === true
      await service.finishMatch("m1", null, "r1", true);

      // Match update records null winner (idempotent updateMany)
      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: { id: "m1", status: { not: MatchStatus.FINISHED } },
        data: {
          status: MatchStatus.FINISHED,
          winnerId: null,
          endedAt: expect.any(Date),
        },
      });
      // Room status still updated
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { status: "FINISHED" },
      });
      // Redis state cleaned
      expect(redis.del).toHaveBeenCalledWith("match:state:m1");
      // H2 fix: the match+room update is wrapped in $transaction.
      // The transaction array contains no score updateMany ops
      // (isAdminTermination is true) but DOES contain match.update +
      // room.update.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(2);
      expect(prisma.matchPlayer.updateMany).not.toHaveBeenCalled();
    });

    it("persists scores for a natural match ending with no winner (isAdminTermination = false)", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);

      // Natural match ending with no winner: winnerId === null, isAdminTermination === false
      await service.finishMatch("m1", null, "r1", false);

      // Match update records null winner (idempotent updateMany)
      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: { id: "m1", status: { not: MatchStatus.FINISHED } },
        data: {
          status: MatchStatus.FINISHED,
          winnerId: null,
          endedAt: expect.any(Date),
        },
      });
      // Room status still updated
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { status: "FINISHED" },
      });
      // Since it ended naturally, buildScoreUpdateOps runs and calls updateMany for players
      expect(prisma.matchPlayer.updateMany).toHaveBeenCalled();
    });

    it("swallows non-Error Redis delete failures when finishing a match", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r2",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m2",
        roomId: "r2",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r2");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m2",
        roomId: "r2",
      } as any);
      // Non-Error rejection to cover `String(error)` in the warning path.
      vi.mocked(redis.del).mockRejectedValueOnce("redis del boom (string)");

      await service.finishMatch("m2", "u1", "r2");

      expect(redis.del).toHaveBeenCalledWith("match:state:m2");
      expect(prisma.match.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "m2", status: { not: MatchStatus.FINISHED } },
          data: expect.objectContaining({ winnerId: "u1" }),
        }),
      );
    });

    it("swallows Error Redis delete failures when finishing a match", async () => {
      const loggerWarnSpy = vi.spyOn((service as any).logger, "warn");

      const room = {
        id: "r2b",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m2b",
        roomId: "r2b",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r2b");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m2b",
        roomId: "r2b",
      } as any);
      vi.mocked(redis.del).mockRejectedValueOnce(new Error("redis del boom"));

      await service.finishMatch("m2b", "u1", "r2b");

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to delete Redis state for match m2b"),
      );
    });

    it("swallows score persistence failures before finishing a match", async () => {
      const room = {
        id: "r3",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m3",
        roomId: "r3",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r3");

      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m3",
        roomId: "r3",
      } as any);
      // Throw a string to cover the non-Error branch in the score
      // persistence catch.
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        "score tx boom (string)",
      );

      // H2 fix: the $transaction failure now propagates. The
      // function does not silently swallow the error; instead, the
      // operator sees a clear failure and the in-memory state
      // stays intact (no half-cleanup).
      await expect(service.finishMatch("m3", "u1", "r3")).rejects.toThrow(
        "score tx boom (string)",
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      // In-memory state was NOT cleaned up on failure.
      const internalMap = (service as any).stateMachines as Map<
        string,
        unknown
      >;
      expect(internalMap.has("m3")).toBe(true);
    });
  });

  describe("saveRound", () => {
    it("creates match round record", async () => {
      vi.mocked(prisma.matchRound.create).mockResolvedValue({
        id: "round1",
      } as any);
      await service.saveRound("m1", 1, "q1");
      expect(prisma.matchRound.create).toHaveBeenCalledWith({
        data: { matchId: "m1", roundNo: 1, questionId: "q1" },
      });
    });
  });

  describe("saveAnswer", () => {
    it("creates answer record", async () => {
      vi.mocked(prisma.answer.create).mockResolvedValue({ id: "a1" } as any);
      await service.saveAnswer("m1", "round1", "u1", "A", true, 500);
      expect(prisma.answer.create).toHaveBeenCalledWith({
        data: {
          matchId: "m1",
          roundId: "round1",
          userId: "u1",
          answer: "A",
          isCorrect: true,
          responseTimeMs: 500,
        },
      });
    });
  });

  describe("saveAnswers", () => {
    it("creates multiple answer records in a batch", async () => {
      vi.mocked(prisma.answer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      const answers = [
        {
          matchId: "m1",
          roundId: "round1",
          userId: "u1",
          answer: "A",
          isCorrect: true,
          responseTimeMs: 500,
        },
        {
          matchId: "m1",
          roundId: "round1",
          userId: "u2",
          answer: "B",
          isCorrect: false,
          responseTimeMs: 800,
        },
      ];
      const result = await service.saveAnswers(answers);
      expect(result.count).toBe(2);
      expect(prisma.answer.createMany).toHaveBeenCalledWith({
        data: answers,
      });
    });

    it("returns count 0 and does not call prisma when answers is empty", async () => {
      const result = await service.saveAnswers([]);
      expect(result.count).toBe(0);
      expect(prisma.answer.createMany).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Atomic round+answers persistence (endRound H2-style fix)
  // ============================================================
  describe("saveRoundAndAnswers", () => {
    it("creates the round row and the batched answers in a single $transaction", async () => {
      vi.mocked(prisma.matchRound.create).mockResolvedValue({
        id: "round-1",
      } as any);
      vi.mocked(prisma.answer.createMany).mockResolvedValue({
        count: 2,
      } as any);

      const answers = [
        {
          userId: "u1",
          answer: "A",
          isCorrect: true,
          responseTimeMs: 500,
        },
        {
          userId: "u2",
          answer: "B",
          isCorrect: false,
          responseTimeMs: 800,
        },
      ];

      const round = await service.saveRoundAndAnswers("m1", 1, "q1", answers);

      expect(round).toEqual({ id: "round-1" });
      // The single $transaction callback is the only thing that
      // touches the DB; the order inside is round first, then
      // answers, so the foreign-key roundId is established before
      // any answer row references it.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.matchRound.create).toHaveBeenCalledWith({
        data: { matchId: "m1", roundNo: 1, questionId: "q1" },
      });
      expect(prisma.answer.createMany).toHaveBeenCalledWith({
        data: [
          {
            matchId: "m1",
            roundId: "round-1",
            userId: "u1",
            answer: "A",
            isCorrect: true,
            responseTimeMs: 500,
          },
          {
            matchId: "m1",
            roundId: "round-1",
            userId: "u2",
            answer: "B",
            isCorrect: false,
            responseTimeMs: 800,
          },
        ],
      });
    });

    it("skips the answer batch but still creates the round row when answers is empty", async () => {
      // An all-timeout round (nobody answered) is a normal case.
      // The round row must still land so the round counter
      // advances; the answer batch is a no-op.
      vi.mocked(prisma.matchRound.create).mockResolvedValue({
        id: "round-empty",
      } as any);

      const round = await service.saveRoundAndAnswers("m1", 3, "q3", []);

      expect(round).toEqual({ id: "round-empty" });
      expect(prisma.matchRound.create).toHaveBeenCalledTimes(1);
      expect(prisma.answer.createMany).not.toHaveBeenCalled();
    });

    it("propagates a transaction rollback so partial writes are impossible", async () => {
      // Regression test: a failure on the answer batch (e.g.
      // transient Prisma error) MUST NOT leave a stray round row
      // behind. The two operations live in one $transaction; the
      // surrounding caller relies on this to avoid the
      // "ROUND_EVALUATING + P2002 on retry" stall.
      vi.mocked(prisma.matchRound.create).mockResolvedValue({
        id: "round-x",
      } as any);
      vi.mocked(prisma.answer.createMany).mockRejectedValue(
        new Error("write conflict"),
      );

      await expect(
        service.saveRoundAndAnswers("m1", 1, "q1", [
          { userId: "u1", answer: "A", isCorrect: true, responseTimeMs: 100 },
        ]),
      ).rejects.toThrow("write conflict");
    });
  });

  // ============================================================
  // B2: finishMatch persists accumulated scores to DB
  // ============================================================
  describe("finishMatch (B2 — score persistence)", () => {
    /**
     * Run a round where each player answers with the given correctness and responseTime.
     * Uses the public state machine API to actually accumulate scores.
     * `roundIndex` 0 = first round (transitions CREATED → COUNTDOWN → ROUND_ACTIVE).
     * Subsequent rounds transition ROUND_RESULT → ROUND_ACTIVE.
     */
    const playRound = async (
      matchId: string,
      answers: Array<{
        playerId: string;
        answer: string;
        isCorrect: boolean;
        responseTimeMs: number;
      }>,
      roundIndex = 0,
    ) => {
      const sm = await service.getStateMachine(matchId);
      if (!sm) throw new Error("State machine not found");

      if (roundIndex === 0) {
        sm.transition(MatchStatus.COUNTDOWN);
      }
      sm.transition(MatchStatus.ROUND_ACTIVE);
      const round = sm.startRound({
        id: `q-${matchId}-${roundIndex}`,
        content: "?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      for (const a of answers) {
        try {
          sm.submitAnswer(
            a.playerId,
            a.answer,
            round.startedAt + a.responseTimeMs,
          );
        } catch {
          // ignore - might already be eliminated
        }
      }
      sm.transition(MatchStatus.ROUND_EVALUATING);
      sm.evaluateRound();
      sm.transition(MatchStatus.ROUND_RESULT);
    };

    const setupMatch = async (
      matchId: string,
      roomId: string,
      playerIds: string[],
    ) => {
      const room = {
        id: roomId,
        players: playerIds.map((id, i) => ({
          user: { id, username: `User${i + 1}` },
        })),
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: matchId,
        roomId,
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: playerIds.length,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(prisma.match.update).mockResolvedValue({
        id: matchId,
        roomId,
      } as any);
      vi.mocked(prisma.match.updateMany).mockResolvedValue({
        count: 1,
      } as any);
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: matchId,
        roomId,
      } as any);

      await service.createMatch(roomId);
    };

    it("persists accumulated scores to match_players for all players", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct fast (200ms → 149pts), u2 correct slow (8000ms → 100pts)
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "A", isCorrect: true, responseTimeMs: 8000 },
      ]);

      // Capture the return value of the single, meaningful
      // `finishMatch` call. The previous version of this test
      // (code review 2026-06-14) called `finishMatch` a second
      // time to capture the return value, but by then the state
      // machine had already been evicted by the first call, so
      // `buildScoreUpdateOps` returned `[]`. That meant the
      // assertion only verified the empty-ops path, NOT the
      // actual `scoreUpdateOps.length > 0` path that the H2
      // index-lookup fix was written for. The fix: assert the
      // return value on the same call where `scoreUpdateOps`
      // contains the two score updates we're verifying below.
      const finishResult = await service.finishMatch("m1", "u1", "r1");

      // Verify $transaction was invoked with an array containing
      // 2 score updateMany operations + match.update + room.update
      // (4 total). The H2 fix unified score+match+room writes into
      // a single atomic $transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(4);

      // Regression for the H2 + scoreUpdateOps spread bug: the
      // returned match object must be the result of match.update
      // (at index `scoreUpdateOps.length` = 2), NOT the first
      // score-updateMany result. With the previous `[match]`
      // destructuring, this assertion would fail because the
      // destructured value was `{ count }` from updateMany.
      // The scoreUpdateOps here is `[u1Update, u2Update]`
      // (length 2), so the match.update result is at index 2.
      expect(finishResult).toEqual(
        expect.objectContaining({ id: "m1", roomId: "r1" }),
      );

      // Inspect each updateMany call's args to verify scores
      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u1Call).toBeDefined();
      expect(u2Call).toBeDefined();
      // u1: rt=200 → (10000-200)/200 = 49 → total=149
      expect(u1Call![0].where.matchId).toBe("m1");
      expect(u1Call![0].data.score).toBe(149);
      // u2: rt=8000 → (10000-8000)/200 = 10 → total=110
      expect(u2Call![0].data.score).toBe(110);
    });

    it("skips score persistence when state machine is no longer in memory", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Manually evict state machine (simulating failure scenario)
      const internalMap = (service as any).stateMachines as Map<
        string,
        unknown
      >;
      expect(internalMap.has("m1")).toBe(true);
      internalMap.delete("m1");

      await service.finishMatch("m1", "u1", "r1");

      // Should still update match+room via the atomic transaction
      // (H2 fix: the score update and the match/room updates all
      // run in the SAME $transaction).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      // Only the match.updateMany + room.update (no score updateMany
      // because the state machine was gone, so buildScoreUpdateOps
      // returned an empty array — and logs a warning, 2d fix).
      expect(txArg).toHaveLength(2);
      // 1f/2a fix: the finish write is the idempotent updateMany now.
      expect(prisma.match.updateMany).toHaveBeenCalled();
      expect(prisma.room.update).toHaveBeenCalled();
      // matchPlayer.updateMany should not have been called (no scores to update).
      expect(prisma.matchPlayer.updateMany).not.toHaveBeenCalled();
    });

    it("persists score 0 for players who never answered correctly", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct, u2 wrong
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "B", isCorrect: false, responseTimeMs: 500 },
      ]);

      await service.finishMatch("m1", "u1", "r1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u2Call).toBeDefined();
      expect(u2Call![0].data.score).toBe(0);
    });

    it("propagates the transaction error when the atomic write fails (H2)", async () => {
      // H2 fix follow-up: the previous behaviour was to swallow
      // the score-write error and continue with match+room updates.
      // That was the bug — a partial write left the DB inconsistent.
      // The new contract: $transaction is atomic, so ANY error
      // rolls back ALL writes and the function throws. Operators
      // see a clear failure rather than silent data corruption.
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Make $transaction fail
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error("DB transaction failed"),
      );

      // The error is propagated; the function does not swallow it.
      await expect(service.finishMatch("m1", "u1", "r1")).rejects.toThrow(
        "DB transaction failed",
      );

      // The in-memory stateMachines map should NOT have been
      // touched: cleanup happens only on success. (Otherwise a
      // failed transaction would leave a half-clean state where
      // a retry's getStateMachine would return undefined.)
      const internalMap = (service as any).stateMachines as Map<
        string,
        unknown
      >;
      expect(internalMap.has("m1")).toBe(true);
    });

    it("accumulates score across multiple rounds correctly", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct fast (200ms → 149pts), u2 correct slow (4000ms → 130pts)
      await playRound(
        "m1",
        [
          { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
          {
            playerId: "u2",
            answer: "A",
            isCorrect: true,
            responseTimeMs: 4000,
          },
        ],
        0,
      );
      // Round 2: u1 correct fast again (200ms → 149pts), u2 wrong (eliminated)
      await playRound(
        "m1",
        [
          { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
          // u2 already eliminated, can't submit
        ],
        1,
      );

      await service.finishMatch("m1", "u1", "r1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      // u1: 149 + 149 = 298
      expect(u1Call![0].data.score).toBe(298);
      // u2: only round 1 correct = 130
      expect(u2Call![0].data.score).toBe(130);
    });
  });
});
