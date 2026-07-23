import { MatchService } from "./match.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { NotFoundException } from "@nestjs/common";
import { MatchStatus, PlayerStatus, ErrorCode } from "@arena/shared";
import { MatchStateMachine } from "@arena/game-core";
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("MatchService", () => {
  let service: MatchService;
  let prisma: PrismaService;
  let redis: RedisService;
  let matchOwnership: MatchOwnershipService;

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
      fencedStateSet: vi.fn().mockResolvedValue("APPLIED"),
      fencedStateDelete: vi.fn().mockResolvedValue(true),
    } as unknown as RedisService;
    // B2c: default to "not owned by this node" so persistStateMachine takes the
    // BLIND (pre-B2c blind redis.set) path — matching the existing assertions.
    // Individual tests override getOwnershipSnapshot to exercise the fenced CAS.
    matchOwnership = {
      getOwnershipSnapshot: vi.fn().mockReturnValue(undefined),
    } as unknown as MatchOwnershipService;
    service = new MatchService(prisma, redis, matchOwnership);
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
        _stateVersion: 1,
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
        _stateVersion: 1,
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
        _stateVersion: 1,
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
        _stateVersion: 1,
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
        _stateVersion: 1,
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
        _stateVersion: 1,
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

  describe("getRoomIdByMatchId", () => {
    // L3-style: a hot match lives in `stateMachines` (set by createMatch);
    // the auth-gate caller in match.handler.ts MUST hit the cache to avoid
    // a Prisma round-trip on every answer snapshot request. Falls back to
    // Prisma only on cache miss (e.g. before the SM is constructed, or
    // after eviction on finishMatch).
    it("returns roomId from the cached state machine without calling Prisma", async () => {
      const internalMap = (
        service as unknown as {
          stateMachines: Map<string, { getState: () => { roomId: string } }>;
        }
      ).stateMachines;
      internalMap.set("m1", { getState: () => ({ roomId: "r1" }) } as never);

      const roomId = await service.getRoomIdByMatchId("m1");

      expect(roomId).toBe("r1");
      expect(prisma.match.findUnique).not.toHaveBeenCalled();
    });

    it("falls back to Prisma on cache miss and returns the roomId", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        roomId: "r-fallback",
      } as never);

      const roomId = await service.getRoomIdByMatchId("m-cold");

      expect(roomId).toBe("r-fallback");
      // The fallback MUST use `select: { roomId: true }` to avoid pulling
      // the full match row on every auth-gate lookup.
      expect(prisma.match.findUnique).toHaveBeenCalledWith({
        where: { id: "m-cold" },
        select: { roomId: true },
      });
    });

    it("returns undefined when both cache and Prisma miss", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue(null);

      const roomId = await service.getRoomIdByMatchId("m-ghost");

      expect(roomId).toBeUndefined();
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

    it("treats a concurrent P2002 unique-constraint violation as an idempotent no-op", async () => {
      // A second caller (e.g. the persist-retry loop in
      // `MatchRoundRunner.endRound`) committed the round between our
      // pre-check and create. The defensive catch in `saveRoundAndAnswers`
      // should resolve with the existing round row instead of throwing.
      const { Prisma } = await import("@prisma/client");
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`matchId`,`roundNo`)",
        { code: "P2002", clientVersion: "test" },
      );
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);
      vi.mocked(prisma.matchRound.findUnique).mockResolvedValue({
        id: "round-prior",
      } as any);

      const round = await service.saveRoundAndAnswers("m1", 1, "q1", [
        { userId: "u1", answer: "A", isCorrect: true, responseTimeMs: 100 },
      ]);

      expect(round).toEqual({ id: "round-prior" });
      expect(prisma.matchRound.findUnique).toHaveBeenCalledWith({
        where: { matchId_roundNo: { matchId: "m1", roundNo: 1 } },
      });
    });

    it("rethrows a P2002 unique-constraint violation when no prior round row is found", async () => {
      // Defensive: if Prisma reports P2002 but the follow-up
      // findUnique returns null (e.g. someone deleted the row between
      // the failed create and the recovery probe), we surface the
      // original error rather than silently succeeding.
      const { Prisma } = await import("@prisma/client");
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed on the fields: (`matchId`,`roundNo`)",
        { code: "P2002", clientVersion: "test" },
      );
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);
      vi.mocked(prisma.matchRound.findUnique).mockResolvedValue(null);

      await expect(
        service.saveRoundAndAnswers("m1", 1, "q1", [
          { userId: "u1", answer: "A", isCorrect: true, responseTimeMs: 100 },
        ]),
      ).rejects.toBe(p2002);
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

  describe("persistStateMachine fenced CAS (B2c)", () => {
    // Load a machine into the in-memory cache via getStateMachine, then persist.
    const loadMachine = async (matchId: string) => {
      const sm = new MatchStateMachine(matchId, "r1", [
        {
          id: "p1",
          name: "A",
          status: PlayerStatus.ACTIVE,
          score: 0,
          totalResponseTimeMs: 0,
          correctAnswers: 0,
          isOnline: true,
        },
      ]);
      vi.mocked(redis.get).mockResolvedValueOnce(sm.serialize());
      await service.getStateMachine(matchId);
    };

    it("routes an owned match through fencedStateSet and returns APPLIED", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 4,
        leaseValue: "node-a:4",
      });
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");

      await expect(service.persistStateMachine("m1")).resolves.toBe("APPLIED");

      expect(redis.fencedStateSet).toHaveBeenCalledWith(
        "match:owner:m1",
        "match:fence:m1",
        "match:state:m1",
        "match:state-revision:m1",
        expect.objectContaining({
          leaseValue: "node-a:4",
          expectedFence: 4,
          expectedRevision: 0, // bootstrap
          nextRevision: 1,
        }),
      );
      // Blind write must NOT be used on the owned path.
      expect(redis.set).not.toHaveBeenCalledWith(
        "match:state:m1",
        expect.anything(),
        expect.anything(),
      );
    });

    it("returns RETRY and does not advance the revision when the CAS rejects", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 4,
        leaseValue: "node-a:4",
      });
      vi.mocked(redis.fencedStateSet).mockResolvedValue("RETRY");

      await expect(service.persistStateMachine("m1")).resolves.toBe("RETRY");

      // Next persist still uses expectedRevision 0 (not advanced past RETRY).
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");
      await service.persistStateMachine("m1");
      const lastCall = vi.mocked(redis.fencedStateSet).mock.calls.at(-1)!;
      expect(lastCall[4]).toMatchObject({
        expectedRevision: 0,
        nextRevision: 1,
      });
    });

    it("hydrates expectedRevision from Redis for a recovered owner with no local revision", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 7,
        leaseValue: "node-a:7",
      });
      // A restored owner's local revisions map is empty, but the persisted
      // revision is well past INITIAL. It must be read so the fenced CAS lines
      // up with the live revision instead of RETRYing forever against 0.
      vi.mocked(redis.get).mockResolvedValueOnce("5");
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");

      await service.persistStateMachine("m1");

      const lastCall = vi.mocked(redis.fencedStateSet).mock.calls.at(-1)!;
      expect(lastCall[4]).toMatchObject({
        expectedRevision: 5,
        nextRevision: 6,
      });
    });

    it("refuses to blind-write canonical state when this node does not own the match (fail closed to RETRY)", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue(undefined);

      // F7: a non-owner must NOT clobber match:state with an unfenced write.
      await expect(service.persistStateMachine("m1")).resolves.toBe("RETRY");
      expect(redis.fencedStateSet).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalledWith(
        "match:state:m1",
        expect.anything(),
        expect.anything(),
      );
    });

    it("permits a blind bootstrap write only when explicitly requested", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue(undefined);

      await expect(
        service.persistStateMachine("m1", { allowBlindBootstrap: true }),
      ).resolves.toBe("BLIND");
      expect(redis.fencedStateSet).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        "match:state:m1",
        expect.any(String),
        86400,
      );
    });

    it("reloads the persisted revision when the ownership fence changes (new epoch)", async () => {
      await loadMachine("m1");
      // First persist under fence 4 → revision advances to 1, cached vs fence 4.
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 4,
        leaseValue: "node-a:4",
      });
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");
      await service.persistStateMachine("m1");
      expect(
        vi.mocked(redis.fencedStateSet).mock.calls.at(-1)![4],
      ).toMatchObject({
        expectedFence: 4,
        expectedRevision: 0,
        nextRevision: 1,
      });

      // Ownership moves to a NEW fence (takeover / handoff). The cached revision
      // is bound to fence 4 and must NOT be reused; the persisted revision (9) is
      // reloaded so the CAS lines up with the live revision instead of RETRYing.
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 8,
        leaseValue: "node-b:8",
      });
      vi.mocked(redis.get).mockResolvedValueOnce("9");
      await service.persistStateMachine("m1");
      expect(
        vi.mocked(redis.fencedStateSet).mock.calls.at(-1)![4],
      ).toMatchObject({
        expectedFence: 8,
        expectedRevision: 9,
        nextRevision: 10,
      });
    });

    it("serializes concurrent persists so the second observes the first's advanced revision", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 1,
        leaseValue: "node-a:1",
      });
      vi.mocked(redis.get).mockResolvedValue(null); // no persisted revision yet

      // A fenced CAS that enforces revision monotonicity, like the real Lua
      // script: APPLIED only when expectedRevision matches the live revision.
      let liveRevision = 0;
      vi.mocked(redis.fencedStateSet).mockImplementation(
        async (_o, _f, _s, _r, opts) => {
          if (opts.expectedRevision !== liveRevision) return "RETRY";
          liveRevision = opts.nextRevision;
          return "APPLIED";
        },
      );

      // Fire two persists concurrently. Without per-match serialization both
      // would read expectedRevision 0 and the loser's write would RETRY (drop).
      const [a, b] = await Promise.all([
        service.persistStateMachine("m1"),
        service.persistStateMachine("m1"),
      ]);

      expect(a).toBe("APPLIED");
      expect(b).toBe("APPLIED");
      expect(liveRevision).toBe(2);
    });

    it("returns BLIND when no state machine is loaded for the match", async () => {
      await expect(service.persistStateMachine("missing")).resolves.toBe(
        "BLIND",
      );
      expect(redis.fencedStateSet).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("defaults expectedRevision to 0 when the persisted revision is malformed", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 2,
        leaseValue: "node-a:2",
      });
      vi.mocked(redis.get).mockResolvedValueOnce("not-an-int");
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");

      await service.persistStateMachine("m1");

      expect(
        vi.mocked(redis.fencedStateSet).mock.calls.at(-1)![4],
      ).toMatchObject({
        expectedRevision: 0,
        nextRevision: 1,
      });
    });

    it("defaults expectedRevision to 0 when reading the revision throws", async () => {
      await loadMachine("m1");
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue({
        fence: 3,
        leaseValue: "node-a:3",
      });
      vi.mocked(redis.get).mockRejectedValueOnce(new Error("redis-down"));
      vi.mocked(redis.fencedStateSet).mockResolvedValue("APPLIED");

      await service.persistStateMachine("m1");

      expect(
        vi.mocked(redis.fencedStateSet).mock.calls.at(-1)![4],
      ).toMatchObject({
        expectedRevision: 0,
        nextRevision: 1,
      });
    });
  });

  describe("finishMatch fenced cleanup (B2c)", () => {
    const createAndOwn = async (
      snapshot: { fence: number; leaseValue: string } | undefined,
    ) => {
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
      vi.mocked(matchOwnership.getOwnershipSnapshot).mockReturnValue(snapshot);
    };

    it("fences the state cleanup when this node still owns the match", async () => {
      await createAndOwn({ fence: 5, leaseValue: "node-a:5" });

      await service.finishMatch("m1", "u1", "r1");

      expect(redis.fencedStateDelete).toHaveBeenCalledWith(
        "match:owner:m1",
        "match:fence:m1",
        "match:state:m1",
        "match:state-revision:m1",
        { leaseValue: "node-a:5", expectedFence: 5 },
      );
      // The unfenced blind delete must NOT be used on the owned path.
      expect(redis.del).not.toHaveBeenCalledWith("match:state:m1");
    });

    it("force-deletes unconditionally on the admin / non-owner path (no snapshot)", async () => {
      await createAndOwn(undefined);

      await service.finishMatch("m1", null, "r1", true);

      expect(redis.fencedStateDelete).not.toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith("match:state:m1");
      expect(redis.del).toHaveBeenCalledWith("match:state-revision:m1");
    });

    it("leaves canonical state intact when fencedStateDelete is a no-op (ownership moved)", async () => {
      await createAndOwn({ fence: 5, leaseValue: "node-a:5" });
      vi.mocked(redis.fencedStateDelete).mockResolvedValueOnce(false);

      await service.finishMatch("m1", "u1", "r1");

      expect(redis.fencedStateDelete).toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalledWith("match:state:m1");
      expect(redis.del).not.toHaveBeenCalledWith("match:state-revision:m1");
    });
  });

  // ============================================================
  // Coverage gap fill — evictStateMachine + idempotent finish +
  // saveRoundAndAnswers pre-check branch.
  // ============================================================
  describe("coverage gaps", () => {
    it("evictStateMachine removes the cached state machine (snapshot-restore safety)", () => {
      // Pre-seed the in-memory cache.
      const fakeSm = { id: "m1" } as unknown as MatchStateMachine;
      (
        service as unknown as { stateMachines: Map<string, MatchStateMachine> }
      ).stateMachines.set("m1", fakeSm);

      service.evictStateMachine("m1");

      expect(
        (
          service as unknown as {
            stateMachines: Map<string, MatchStateMachine>;
          }
        ).stateMachines.has("m1"),
      ).toBe(false);
    });

    it("finishMatch returns the canonical row when a prior finish already won the race (count === 0)", async () => {
      // Default mock: updateMany returns { count: 1 }. Force the idempotent
      // guard by making this finish see count: 0.
      vi.mocked(prisma.match.updateMany).mockResolvedValueOnce({ count: 0 });
      const canonical = { id: "m1", winnerId: "u1", endedAt: new Date() };
      vi.mocked(prisma.match.findUnique).mockResolvedValueOnce(
        canonical as any,
      );
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: { warn: typeof vi.fn } }).logger,
        "warn",
      );

      const result = await service.finishMatch("m1", "u1", "r1");

      expect(result).toEqual(canonical);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "finishMatch: match m1 was already FINISHED; treating this call as a no-op",
        ),
      );
    });

    it("saveRoundAndAnswers short-circuits when the pre-check finds the round already persisted", async () => {
      // The pre-check inside the transaction finds an existing round row,
      // so the function logs a warning and returns the existing row
      // without re-creating.
      vi.mocked(prisma.matchRound.findUnique).mockResolvedValueOnce({
        id: "round-existing",
      } as any);
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: { warn: typeof vi.fn } }).logger,
        "warn",
      );

      const round = await service.saveRoundAndAnswers("m1", 2, "q2", [
        { userId: "u1", answer: "A", isCorrect: true, responseTimeMs: 100 },
      ]);

      expect(round).toEqual({ id: "round-existing" });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "saveRoundAndAnswers: round 2 for match m1 already persisted; treating as no-op",
        ),
      );
      // We must NOT have called create on the existing round.
      expect(prisma.matchRound.create).not.toHaveBeenCalled();
    });
  });
});
