import {
  MatchService,
  matchCacheKey,
  matchGenerationKey,
  INCR_MATCH_GENERATION_SCRIPT,
  MATCH_CACHE_TTL_SEC,
} from "./match.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { NotFoundException } from "@nestjs/common";
import {
  MatchStatus,
  PlayerStatus,
  ErrorCode,
  MatchEventType,
  type ClassAssignedEvent,
  type CardEffect,
  type CardId,
} from "@arena/shared";
import { MatchStateMachine } from "@arena/game-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: "u1", elo: 1200 },
          { id: "u2", elo: 1200 },
        ]),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
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
      mget: vi
        .fn()
        .mockImplementation(
          async (...keys: string[]): Promise<(string | null)[]> => {
            return keys.map(() => null);
          },
        ),
      del: vi.fn(),
      incr: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(1),
      fencedStateSet: vi.fn().mockResolvedValue("APPLIED"),
      fencedStateDelete: vi.fn().mockResolvedValue(true),
      setIfGenMatches: vi.fn().mockResolvedValue(true),
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
    it("returns match when found from DB and caches it in Redis", async () => {
      vi.mocked(redis.mget).mockResolvedValue([null, null]);
      vi.mocked(prisma.match.findUnique).mockResolvedValue({ id: "m1" } as any);
      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).toHaveBeenCalledWith({
        where: { id: "m1" },
        include: {
          players: {
            include: { user: { select: { id: true, username: true } } },
          },
          rounds: true,
        },
      });
      expect(redis.setIfGenMatches).toHaveBeenCalledWith(
        "match:gen:m1",
        matchCacheKey("m1"),
        "0",
        JSON.stringify({ gen: "0", data: { id: "m1" } }),
        5,
      );
    });

    it("returns cached match from Redis on cache hit without calling Prisma", async () => {
      const startedAt = new Date("2026-08-14T09:50:00.000Z");
      const endedAt = new Date("2026-08-14T10:00:00.000Z");
      const cachedMatch = {
        id: "m1",
        roomId: "r1",
        status: "FINISHED",
        winnerId: "u1",
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        players: [],
        rounds: [
          {
            id: "mr1",
            matchId: "m1",
            roundNo: 1,
            questionId: "q1",
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
          },
        ],
      };
      vi.mocked(redis.mget).mockResolvedValue([
        JSON.stringify({ gen: "0", data: cachedMatch }),
        "0",
      ]);
      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(result.status).toBe("FINISHED");
      expect(result.startedAt).toEqual(startedAt);
      expect(result.endedAt).toEqual(endedAt);
      expect(result.rounds[0]?.startedAt).toEqual(startedAt);
      expect(result.rounds[0]?.endedAt).toEqual(endedAt);
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).not.toHaveBeenCalled();
    });

    it("treats cached payload with generation mismatch as cache miss", async () => {
      vi.mocked(redis.mget).mockResolvedValue([
        JSON.stringify({
          gen: "0",
          data: { id: "m1", status: "STALE" },
        }),
        "1",
      ]);
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        status: "FINISHED",
        players: [],
        rounds: [],
      } as any);

      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(result.status).toBe("FINISHED");
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).toHaveBeenCalled();
    });

    it("does not overwrite Redis cache if match generation changed after captured generation read", async () => {
      let currentGen = "0";
      let cacheValue: string | null = null;

      vi.mocked(redis.mget).mockImplementation(async () => [
        cacheValue,
        currentGen,
      ]);

      (prisma.match.findUnique as any).mockImplementation(async () => {
        // Generation changes before setIfGenMatches is invoked
        currentGen = "1";
        return {
          id: "m1",
          status: "ROUND_ACTIVE",
          players: [],
          rounds: [],
        };
      });

      vi.mocked(redis.setIfGenMatches).mockImplementation(
        async (_genKey, _cacheKey, expectedGen, value) => {
          if (currentGen === expectedGen) {
            cacheValue = value;
            return true;
          }
          return false;
        },
      );

      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setIfGenMatches).toHaveBeenCalledWith(
        "match:gen:m1",
        matchCacheKey("m1"),
        "0",
        expect.any(String),
        expect.any(Number),
      );
      expect(cacheValue).toBeNull();
      expect(redis.set).not.toHaveBeenCalledWith(
        matchCacheKey("m1"),
        expect.anything(),
        expect.anything(),
      );
    });

    it("throws NotFoundException when not found", async () => {
      vi.mocked(redis.mget).mockResolvedValue([null, null]);
      vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
      await expect(service.getMatch("m1")).rejects.toThrow(NotFoundException);
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
    });

    it("skips writing to Redis cache if reading match generation from Redis threw an error", async () => {
      vi.mocked(redis.mget).mockRejectedValue(
        new Error("Redis connection dropped"),
      );
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        status: "FINISHED",
        players: [],
        rounds: [],
      } as any);

      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenCalledWith(
        matchCacheKey("m1"),
        matchGenerationKey("m1"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).toHaveBeenCalled();
      expect(redis.setIfGenMatches).not.toHaveBeenCalled();
    });

    it("bypasses reading cache and skips writing to cache when pending generation invalidation exists for match", async () => {
      (service as any).pendingGenerationInvalidations.add("m1");
      vi.mocked(redis.mget).mockResolvedValue([
        JSON.stringify({
          gen: "0",
          data: { id: "m1", status: "STALE_IN_PROGRESS" },
        }),
        "0",
      ]);
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m1",
        status: "FINISHED",
        players: [],
        rounds: [],
      } as any);

      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
      expect(result.status).toBe("FINISHED");
      expect(redis.mget).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).toHaveBeenCalled();
      expect(redis.setIfGenMatches).not.toHaveBeenCalled();
    });
  });

  describe("getRoomIdByMatchId", () => {
    // L3-style: a hot match lives in `stateMachines` (set by createMatch);
    // the auth-gate caller in match.handler.ts MUST hit the cache to avoid
    // a Prisma round-trip on every answer snapshot request. Falls back to
    // Redis cache, then Prisma only on cache miss (e.g. before the SM is constructed, or
    // after eviction on finishMatch).
    it("returns roomId from the cached state machine without calling Redis or Prisma", async () => {
      const internalMap = (
        service as unknown as {
          stateMachines: Map<string, { getState: () => { roomId: string } }>;
        }
      ).stateMachines;
      internalMap.set("m1", { getState: () => ({ roomId: "r1" }) } as never);

      const roomId = await service.getRoomIdByMatchId("m1");

      expect(roomId).toBe("r1");
      expect(redis.get).not.toHaveBeenCalled();
      expect(prisma.match.findUnique).not.toHaveBeenCalled();
    });

    it("returns roomId from Redis cache on state machine miss without calling Prisma", async () => {
      vi.mocked(redis.get).mockResolvedValue("r-redis");

      const roomId = await service.getRoomIdByMatchId("m-redis");

      expect(roomId).toBe("r-redis");
      expect(prisma.match.findUnique).not.toHaveBeenCalled();
    });

    it("falls back to Prisma on cache miss, caches it in Redis and returns the roomId", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
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
      expect(redis.set).toHaveBeenCalledWith(
        "cache:match:room:m-cold",
        "r-fallback",
        5,
      );
    });

    it("returns undefined when both cache and Prisma miss", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
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
      expect(redis.del).toHaveBeenCalledWith(matchCacheKey("m1"));
      expect(redis.del).toHaveBeenCalledWith("cache:match:room:m1");
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

    it("is idempotent across concurrent finishMatch calls (winner vs loser state machine)", async () => {
      // Two callers race to finish the same matchId with different
      // winnerIds / state machines. The two-phase claim guards the
      // invariant: the FIRST caller's pre-check `match.updateMany`
      // returns count: 1 (claim succeeded), and the second caller's
      // pre-check returns count: 0 (already FINISHED), so the second
      // caller short-circuits to the canonical row without re-running
      // score persistence or Redis cleanup.
      //
      // Expected `match.updateMany` call count: 3 — pre-check #1
      // (claim winner), pre-check #2 (claim loser → count: 0 →
      // short-circuit), then the in-transaction re-claim inside the
      // winner's transaction (returns count: 0 — the row is now
      // FINISHED so the filter rejects it).
      //
      // To force a true race — both calls reaching the transaction
      // step before either resolves — we wrap $transaction in a
      // barrier. Both finishMatch promises are created, then the
      // barrier is released; whichever finishes `$transaction` first
      // wins, the other observes the canonical match row.
      const room = {
        id: "r_concurrent",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m_concurrent",
        roomId: "r_concurrent",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r_concurrent");

      const canonicalMatch = {
        id: "m_concurrent",
        roomId: "r_concurrent",
        status: MatchStatus.FINISHED,
        winnerId: "u1",
        endedAt: new Date(),
      };
      vi.mocked(prisma.match.findUnique).mockResolvedValue(
        canonicalMatch as any,
      );

      // Both updateMany calls are mocked up front. The order in which
      // they fire depends on whichever promise reaches $transaction
      // first — the test does not assume which one wins. The third
      // mock covers the in-transaction re-claim inside the winner's
      // transaction, which returns count: 0 because the pre-claim
      // already set the row to FINISHED (the `status: { not:
      // FINISHED }` filter rejects it). Sorted counts must be
      // {0, 0, 1} — one winner pre-claim, one loser pre-claim, one
      // safety-net re-claim all returning the expected count.
      vi.mocked(prisma.match.updateMany)
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });

      // Synchronization barrier — $transaction awaits it before
      // resolving, so both finishMatch promises queue at the
      // transaction step and overlap on the status-transition /
      // score-write phase.
      let releaseBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      vi.mocked(prisma.$transaction).mockImplementation(async (ops) => {
        await barrier;
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops(prisma);
      });

      const matchPlayerUpdateManyBefore = vi.mocked(
        prisma.matchPlayer.updateMany,
      ).mock.calls.length;
      const redisDelBefore = vi.mocked(redis.del).mock.calls.length;

      // Kick off both finishMatch calls BEFORE awaiting either.
      const firstPromise = service.finishMatch(
        "m_concurrent",
        "u1",
        "r_concurrent",
      );
      const secondPromise = service.finishMatch(
        "m_concurrent",
        "u2",
        "r_concurrent",
      );

      // Release the barrier so both transactions resolve.
      releaseBarrier();

      const [firstResult, secondResult] = await Promise.all([
        firstPromise,
        secondPromise,
      ]);

      const matchPlayerUpdateManyAfter = vi.mocked(
        prisma.matchPlayer.updateMany,
      ).mock.calls.length;
      const redisDelAfter = vi.mocked(redis.del).mock.calls.length;

      // Both calls return the canonical match row.
      expect(firstResult).toEqual(canonicalMatch);
      expect(secondResult).toEqual(canonicalMatch);

      // Three match.updateMany calls total. The pre-check runs for
      // BOTH finishMatch callers (each awaits its own `updateMany`
      // before short-circuiting). The explicit mocks cover those two
      // pre-checks (count: 1 for the winner, count: 0 for the loser);
      // the third call is the in-transaction re-claim inside the
      // winner's transaction, which is mocked to return count: 0 —
      // the row is already FINISHED by the pre-claim, so the
      // `status: { not: FINISHED }` filter rejects it and Prisma
      // reports count: 0 (this is the EXPECTED outcome; no warning
      // is emitted by `finishMatch`). The exact order depends on
      // which promise resolved first; the SORTED counts are always
      // {0, 0, 1}.
      expect(prisma.match.updateMany).toHaveBeenCalledTimes(3);
      const updateResults = vi
        .mocked(prisma.match.updateMany)
        .mock.results.slice(0, 3)
        .map((r) => r.value as Promise<{ count: number }>);
      const counts = await Promise.all(updateResults).then((rows) =>
        rows.map((r) => r.count).sort(),
      );
      expect(counts).toEqual([0, 0, 1]);

      // The in-transaction re-claim returning count: 0 is the
      // expected successful outcome — it must NOT block the
      // winner's path through to Redis cleanup. Verify the
      // winner-side Redis ops ran (see lines further down for the
      // full Redis-cleanup assertion block).

      // Phase 3 — data-field assertions for the two
      // `matchPlayer.updateMany` calls. The two-phase claim ensures
      // ONLY the successful claimant runs `buildScoreUpdateOps` and
      // submits the score writes — the loser's pre-check returns
      // count: 0 and short-circuits before any score work is done.
      // Both finishMatch calls share the in-memory state machine
      // (the test only calls `createMatch` once, so the event log is
      // empty here). `cardsPlayed`/`classId` fall back to `0` / `null`
      // for each player from the empty event log.
      const playerUpdateCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls;
      expect(playerUpdateCalls.length).toBe(2);

      const seenData = playerUpdateCalls.map(
        (call) => call[0]?.data as Record<string, unknown>,
      );
      // Every data payload has the expected keys + types.
      for (const data of seenData) {
        expect(data).toMatchObject({
          score: expect.any(Number) as unknown,
          cardsPlayed: 0,
          classId: null,
        });
      }
      // Each (matchId, userId) pair was written exactly once — only
      // the winner ran scoreUpdateOps, so no per-player duplicate
      // writes occur.
      const wherePairs = new Set(
        playerUpdateCalls
          .map(
            (call) =>
              (call[0]?.where as { matchId: string; userId: string }) ?? null,
          )
          .filter((p): p is { matchId: string; userId: string } => p !== null)
          .map((p) => `${p.matchId}::${p.userId}`),
      );
      expect(wherePairs.has("m_concurrent::u1")).toBe(true);
      expect(wherePairs.has("m_concurrent::u2")).toBe(true);

      // Score persistence runs ONLY in the winner's path — the two-
      // phase claim short-circuits the loser before any score work.
      // The winner's `buildScoreUpdateOps` produces one
      // matchPlayer.updateMany per player (2 here).
      expect(matchPlayerUpdateManyAfter - matchPlayerUpdateManyBefore).toBe(2);

      // Redis cleanup ran only on the winner's path — the winner reaches
      // the post-transaction block which deletes stateKey + revisionKey
      // + 2 short-lived cache keys (4 calls total). The loser returns early on `count: 0` before
      // touching Redis, so the total delta is exactly the winner's 4
      // calls (no doubling).
      expect(redisDelAfter - redisDelBefore).toBe(4);
      expect(redis.del).toHaveBeenCalledWith("match:state:m_concurrent");
      expect(redis.del).toHaveBeenCalledWith(
        "match:state-revision:m_concurrent",
      );
      expect(redis.del).toHaveBeenCalledWith(matchCacheKey("m_concurrent"));
      expect(redis.del).toHaveBeenCalledWith("cache:match:room:m_concurrent");

      // In-memory state-machine eviction. The WINNER's path reaches the
      // post-transaction block and runs `stateMachines.delete(matchId)`
      // — the only call site that touches the map. The loser's path
      // is a pure early-return (sees `count: 0`); it does NOT also
      // delete the entry, so the winner's `delete` is what makes the
      // map end up empty after both calls resolve.
      const internalMap = (service as any).stateMachines as Map<
        string,
        unknown
      >;
      // After both calls resolve, the state machine map MUST be empty.
      // The loser's branch doesn't re-evict; the winner's branch does.
      expect(internalMap.has("m_concurrent")).toBe(false);
    });
  });

  describe("finishMatch generation invalidation & persistent retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      service.onModuleDestroy();
      vi.useRealTimers();
    });

    it("persists generation invalidation retry when redis.eval fails initially, recovering on timer tick", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m_retry",
        roomId: "r_retry",
      } as any);

      // Fail initial redis.eval
      vi.mocked(redis.eval).mockRejectedValueOnce(
        new Error("Redis transient error"),
      );

      await service.finishMatch("m_retry", "u1", "r_retry");

      expect(redis.eval).toHaveBeenCalledWith(
        INCR_MATCH_GENERATION_SCRIPT,
        [matchGenerationKey("m_retry")],
        [String(MATCH_CACHE_TTL_SEC)],
      );

      // Verify pending invalidation flag is set
      expect(service.hasPendingGenerationInvalidation("m_retry")).toBe(true);

      // While invalidation is pending, getMatch should not write to cache
      vi.mocked(redis.mget).mockResolvedValue([null, null]);
      await service.getMatch("m_retry");
      expect(redis.mget).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setIfGenMatches).not.toHaveBeenCalled();

      // Fast-forward timer to trigger retry (attempt 2 delay: 100ms)
      vi.mocked(redis.eval).mockResolvedValue(2 as any);
      vi.mocked(redis.del).mockClear();
      await vi.advanceTimersByTimeAsync(100);

      // Verify retry succeeded, flag is cleared, cache was cleared
      expect(service.hasPendingGenerationInvalidation("m_retry")).toBe(false);
      expect(redis.del).toHaveBeenCalledWith(matchCacheKey("m_retry"));
      expect(redis.del).toHaveBeenCalledWith("cache:match:room:m_retry");

      // Now subsequent getMatch is free to cache
      await service.getMatch("m_retry");
      expect(redis.mget).toHaveBeenCalledTimes(1);
      expect(redis.mget).toHaveBeenNthCalledWith(
        1,
        matchCacheKey("m_retry"),
        matchGenerationKey("m_retry"),
      );
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.setIfGenMatches).toHaveBeenCalled();
    });

    it("retries with exponential backoff on multiple redis.eval failures until recovery", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m_backoff",
        roomId: "r_backoff",
      } as any);

      // Fail attempts 1, 2, 3
      vi.mocked(redis.eval)
        .mockRejectedValueOnce(new Error("Redis error 1"))
        .mockRejectedValueOnce(new Error("Redis error 2"))
        .mockRejectedValueOnce(new Error("Redis error 3"))
        .mockResolvedValue(4 as any);

      await service.finishMatch("m_backoff", "u1", "r_backoff");
      expect(service.hasPendingGenerationInvalidation("m_backoff")).toBe(true);

      // Attempt 2 fires at +100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(service.hasPendingGenerationInvalidation("m_backoff")).toBe(true);

      // Attempt 3 fires at +200ms
      await vi.advanceTimersByTimeAsync(200);
      expect(service.hasPendingGenerationInvalidation("m_backoff")).toBe(true);

      // Attempt 4 fires at +400ms and succeeds
      await vi.advanceTimersByTimeAsync(400);
      expect(service.hasPendingGenerationInvalidation("m_backoff")).toBe(false);
    });

    it("stops retrying and clears pending invalidation when retry attempts exceed maximum limit", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m_max_retries",
        roomId: "r_max_retries",
      } as any);

      // Always fail redis.eval
      vi.mocked(redis.eval).mockRejectedValue(
        new Error("Redis persistent failure"),
      );

      await service.finishMatch("m_max_retries", "u1", "r_max_retries");
      expect(service.hasPendingGenerationInvalidation("m_max_retries")).toBe(
        true,
      );

      // Attempt 1 failed in finishMatch.
      // Attempt 2 fires at +100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(service.hasPendingGenerationInvalidation("m_max_retries")).toBe(
        true,
      );

      // Attempt 3 fires at +200ms
      await vi.advanceTimersByTimeAsync(200);
      expect(service.hasPendingGenerationInvalidation("m_max_retries")).toBe(
        true,
      );

      // Attempt 4 fires at +400ms
      await vi.advanceTimersByTimeAsync(400);
      expect(service.hasPendingGenerationInvalidation("m_max_retries")).toBe(
        true,
      );

      // Attempt 5 fires at +800ms (reaches MAX_GENERATION_INVALIDATION_ATTEMPTS = 5)
      await vi.advanceTimersByTimeAsync(800);
      expect(service.hasPendingGenerationInvalidation("m_max_retries")).toBe(
        false,
      );

      // Advance time further to confirm no further retries occur
      await vi.advanceTimersByTimeAsync(2000);
      expect(redis.eval).toHaveBeenCalledTimes(5);
    });

    it("handles two overlapping invalidations on the same matchId without orphan timers or premature state clearing", async () => {
      let resolveFirstIncr!: (val: number) => void;
      const firstIncrPromise = new Promise<number>((resolve) => {
        resolveFirstIncr = resolve;
      });

      // First invalidation starts but remains pending on redis.eval
      vi.mocked(redis.eval).mockImplementationOnce(() => firstIncrPromise);
      void service.invalidateMatchGeneration("m_overlap");
      await vi.advanceTimersByTimeAsync(0);
      expect(service.hasPendingGenerationInvalidation("m_overlap")).toBe(true);

      // Second invalidation is triggered while first is still pending, but fails attempt 1
      vi.mocked(redis.eval).mockRejectedValueOnce(new Error("Redis error 2"));
      void service.invalidateMatchGeneration("m_overlap");
      await vi.advanceTimersByTimeAsync(0);
      expect(service.hasPendingGenerationInvalidation("m_overlap")).toBe(true);

      // Resolve the first invalidation's redis.eval call
      resolveFirstIncr(1);
      await vi.advanceTimersByTimeAsync(0);

      // Assert the older epoch cannot clear the newer pending state
      expect(service.hasPendingGenerationInvalidation("m_overlap")).toBe(true);

      // Second invalidation's retry attempt 2 succeeds at +100ms
      vi.mocked(redis.eval).mockResolvedValueOnce(2);
      await vi.advanceTimersByTimeAsync(100);

      expect(service.hasPendingGenerationInvalidation("m_overlap")).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect((service as any).invalidationTimers.has("m_overlap")).toBe(false);

      // Advance time further to confirm no further retries occur
      await vi.advanceTimersByTimeAsync(2000);
      expect(redis.eval).toHaveBeenCalledTimes(3);
      expect(service.hasPendingGenerationInvalidation("m_overlap")).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cleans up all pending invalidation timers onModuleDestroy", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({
        id: "m_destroy",
        roomId: "r_destroy",
      } as any);
      vi.mocked(redis.eval).mockRejectedValueOnce(new Error("Redis error"));

      await service.finishMatch("m_destroy", "u1", "r_destroy");
      expect(service.hasPendingGenerationInvalidation("m_destroy")).toBe(true);

      service.onModuleDestroy();

      // Advance timers — no further retry should run
      await vi.advanceTimersByTimeAsync(5000);
      // Redis.eval only called once for the initial attempt
      expect(redis.eval).toHaveBeenCalledTimes(1);
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
      // 2 matchPlayer.updateMany ops + 2 user.update ELO ops + match.updateMany + room.update
      // (6 total).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(6);

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

      // Inspect each updateMany call's args to verify scores and ELO
      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u1Call).toBeDefined();
      expect(u2Call).toBeDefined();
      // u1: rt=200 → (10000-200)/200 = 49 → total=149
      expect(u1Call![0].where.matchId).toBe("m1");
      expect(u1Call![0].data.score).toBe(149);
      expect(u1Call![0].data.eloBefore).toBe(1200);
      expect(u1Call![0].data.eloAfter).toBe(1216);
      expect(u1Call![0].data.eloDelta).toBe(16);

      // u2: rt=8000 → (10000-8000)/200 = 10 → total=110
      expect(u2Call![0].data.score).toBe(110);
      expect(u2Call![0].data.eloBefore).toBe(1200);
      expect(u2Call![0].data.eloAfter).toBe(1184);
      expect(u2Call![0].data.eloDelta).toBe(-16);

      // Inspect user.updateMany ELO delta updates
      const userUpdateManyCalls = vi.mocked(prisma.user.updateMany).mock
        .calls as any[][];
      const u1UserCall = userUpdateManyCalls.find((c) =>
        c[0].where.id.in.includes("u1"),
      );
      const u2UserCall = userUpdateManyCalls.find((c) =>
        c[0].where.id.in.includes("u2"),
      );
      expect(u1UserCall).toBeDefined();
      expect(u2UserCall).toBeDefined();
      expect(u1UserCall![0].data.elo).toEqual({ increment: 16 });
      expect(u2UserCall![0].data.elo).toEqual({ increment: -16 });
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

    it("counts CARD_RESOLVED events per player as cardsPlayed", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Assign classes so playCard is allowed
      const sm = await service.getStateMachine("m1");
      sm!.classAssignment(["u1", "u2"], "seed-1");

      // Play one round normally to get scores
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "A", isCorrect: true, responseTimeMs: 8000 },
      ]);

      // Manually inject CARD_RESOLVED events via playCard.
      // `playCard` takes a `CardId` (string) and a `CardEffect` keyed
      // by `kind`; the legacy `attackCard` object + `{ type, power,
      // targets }` payload predates the v1 card catalog and is
      // rejected by the runtime guard.
      const cardId = "CB-1" as CardId;
      const effect: CardEffect = {
        kind: "TIMER_MODIFY",
        deltaMs: -5000,
        targetCount: 1,
      };
      const result = sm!.playCard("u1", cardId, 1, effect, ["u2"], 1000);
      // TIMER_MODIFY is a MUTATION effect — must NOT carry an
      // expiresAtServer stamp on either the return value or the
      // persisted event payload.
      expect(result.expiresAtServer).toBeNull();
      expect(result.remainingMs).toBeNull();
      // The persisted CARD_RESOLVED event payload must also carry
      // no expiry stamp (otherwise reconnect/rehydrate would
      // resurrect a MUTATION effect's "ghost" timer).
      const resolved = sm!
        .getEventLog()
        .find((e) => e.type === "CARD_RESOLVED");
      expect(resolved).toBeDefined();
      const payload = resolved!.payload as Record<string, unknown>;
      expect(payload.expiresAtServer ?? null).toBeNull();
      expect(payload.remainingMs ?? null).toBeNull();

      await service.finishMatch("m1", "u1", "r1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u1Call![0].data.cardsPlayed).toBe(1);
      expect(u2Call![0].data.cardsPlayed).toBe(0);
    });

    it("sets classId from CLASS_ASSIGNED event", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      const sm = await service.getStateMachine("m1");
      sm!.classAssignment(["u1", "u2"], "seed-2");

      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "A", isCorrect: true, responseTimeMs: 8000 },
      ]);

      await service.finishMatch("m1", "u1", "r1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      const classLog = sm!
        .getEventLog()
        .find((e) => e.type === MatchEventType.CLASS_ASSIGNED)!
        .payload as ClassAssignedEvent;
      const expectedById = new Map(
        classLog.assignments.map((a) => [a.playerId, a.classId]),
      );
      expect(u1Call![0].data.classId).toBe(expectedById.get("u1"));
      expect(u2Call![0].data.classId).toBe(expectedById.get("u2"));
    });

    it("defaults cardsPlayed to 0 and classId to null when no events exist", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Don't assign classes or play cards — just answer
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "A", isCorrect: true, responseTimeMs: 8000 },
      ]);

      await service.finishMatch("m1", "u1", "r1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      expect(u1Call![0].data.cardsPlayed).toBe(0);
      expect(u1Call![0].data.classId).toBeNull();
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
