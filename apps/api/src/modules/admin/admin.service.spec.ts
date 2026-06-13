import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { RoomService } from "../room/room.service";
import { MatchService } from "../match/match.service";
import { GameLoopService } from "../match/game-loop.service";
import { ErrorCode, RoomError } from "@arena/shared";
import { Role } from "@prisma/client";
import type { Question } from "../../prisma-seeds/questions";

vi.mock("../../prisma-seeds/questions", async () => {
  const actual = await vi.importActual<
    typeof import("../../prisma-seeds/questions")
  >("../../prisma-seeds/questions");
  return {
    ...actual,
    questionSeeds: [
      {
        content: "Mocked question 1",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "EASY",
        category: "GENERAL",
        tags: ["Tag One", "tag two"],
        explanation: "Explanation 1",
      },
      {
        content: "Mocked question 2 (no tags)",
        options: ["Yes", "No"],
        correctAnswer: "Yes",
        difficulty: "MEDIUM",
        category: "SCIENCE",
      },
    ] as Question[],
  };
});

type ServiceInternals = {
  logger: Logger;
};

describe("AdminService", () => {
  let service: AdminService;
  let prisma: {
    questionTag: {
      deleteMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      createMany: ReturnType<typeof vi.fn>;
    };
    question: {
      deleteMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    tag: {
      deleteMany: ReturnType<typeof vi.fn>;
      createMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    user: { upsert: ReturnType<typeof vi.fn> };
    eventLog: { deleteMany: ReturnType<typeof vi.fn> };
    answer: { deleteMany: ReturnType<typeof vi.fn> };
    matchRound: { deleteMany: ReturnType<typeof vi.fn> };
    matchPlayer: { deleteMany: ReturnType<typeof vi.fn> };
    match: { deleteMany: ReturnType<typeof vi.fn> };
    roomPlayer: { deleteMany: ReturnType<typeof vi.fn> };
    room: { deleteMany: ReturnType<typeof vi.fn> };
  };
  let redis: { getClient: ReturnType<typeof vi.fn> };
  let redisClient: {
    scan: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    srem: ReturnType<typeof vi.fn>;
  };
  let roomService: {
    getRoom: ReturnType<typeof vi.fn>;
    disbandRoom: ReturnType<typeof vi.fn>;
  };
  let matchService: {
    finishMatch: ReturnType<typeof vi.fn>;
  };
  let gameLoopService: {
    stopRoomRuntime: ReturnType<typeof vi.fn>;
    emitRoomTerminated: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      questionTag: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      question: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "q-new", ...data }),
          ),
        update: vi
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
      },
      tag: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      user: {
        upsert: vi.fn().mockResolvedValue({
          id: "u-admin",
          username: "admin",
          role: Role.ADMIN,
        }),
      },
      eventLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      answer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      matchRound: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      matchPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      match: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      roomPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      room: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };

    redisClient = {
      scan: vi.fn().mockResolvedValue(["0", []]),
      del: vi.fn().mockResolvedValue(0),
      srem: vi.fn().mockResolvedValue(0),
    };
    redis = {
      getClient: vi.fn().mockReturnValue(redisClient),
    };

    roomService = {
      getRoom: vi.fn(),
      disbandRoom: vi.fn().mockResolvedValue(undefined),
    };
    matchService = {
      finishMatch: vi.fn().mockResolvedValue({}),
    };
    gameLoopService = {
      stopRoomRuntime: vi.fn().mockResolvedValue(undefined),
      emitRoomTerminated: vi.fn(),
    };

    service = new AdminService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      roomService as unknown as RoomService,
      matchService as unknown as MatchService,
      gameLoopService as unknown as GameLoopService,
    );
    // Silence logger output during tests
    (service as unknown as ServiceInternals).logger = new Logger(
      AdminService.name,
      false,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("syncQuestions", () => {
    it("clears existing questions/tags when clearExisting=true (default)", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);

      const result = await service.syncQuestions();

      expect(prisma.questionTag.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.question.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.tag.deleteMany).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.questionsCount).toBe(2);
    });

    it("does NOT clear when clearExisting=false", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);

      await service.syncQuestions(false);

      expect(prisma.questionTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
      expect(prisma.tag.deleteMany).not.toHaveBeenCalled();
    });

    it("skips tag createMany when there are no tags to seed", async () => {
      // Override mocked seeds by re-mocking module with tags-less seeds
      vi.resetModules();
      vi.doMock("../../prisma-seeds/questions", async () => {
        const actual = await vi.importActual<
          typeof import("../../prisma-seeds/questions")
        >("../../prisma-seeds/questions");
        return {
          ...actual,
          questionSeeds: [
            {
              content: "No tags question 1",
              options: ["A", "B", "C", "D"],
              correctAnswer: "A",
              difficulty: "EASY",
              category: "GENERAL",
            },
            {
              content: "No tags question 2",
              options: ["Yes", "No"],
              correctAnswer: "Yes",
              difficulty: "MEDIUM",
              category: "SCIENCE",
            },
          ] as Question[],
        };
      });
      try {
        const { AdminService: FreshAdminService } =
          await import("./admin.service");
        prisma.tag.findMany.mockResolvedValueOnce([]);
        const fresh = new FreshAdminService(
          prisma as unknown as PrismaService,
          redis as unknown as RedisService,
          roomService as unknown as RoomService,
          matchService as unknown as MatchService,
          gameLoopService as unknown as GameLoopService,
        );

        const result = await fresh.syncQuestions(false);

        expect(prisma.tag.createMany).not.toHaveBeenCalled();
        expect(result.tagsCount).toBe(0);
      } finally {
        vi.doUnmock("../../prisma-seeds/questions");
      }
    });

    it("creates a new question when none exists", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      // For questionTag.findMany (existing question tags) - none
      prisma.questionTag.findMany.mockResolvedValue([]);

      const result = await service.syncQuestions(false);

      expect(prisma.question.create).toHaveBeenCalledTimes(2);
      expect(prisma.question.update).not.toHaveBeenCalled();
      expect(result.questionsCount).toBe(2);
    });

    it("updates an existing question when matched by content", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      // First question already exists
      prisma.question.findFirst.mockResolvedValueOnce({
        id: "q-existing",
        content: "Mocked question 1",
      });
      prisma.question.findFirst.mockResolvedValueOnce(null);
      prisma.questionTag.findMany.mockResolvedValue([]);

      await service.syncQuestions(false);

      expect(prisma.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "q-existing" },
          data: expect.objectContaining({ active: true }),
        }),
      );
      expect(prisma.question.create).toHaveBeenCalledTimes(1);
    });

    it("creates new questionTag links only for tags not already linked", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      // For the first new question: t1 already linked, t2 not
      prisma.questionTag.findMany.mockResolvedValueOnce([
        { questionId: "q-new", tagId: "t1" },
      ]);

      const result = await service.syncQuestions(false);

      expect(prisma.questionTag.createMany).toHaveBeenCalledWith({
        data: [{ questionId: "q-new", tagId: "t2" }],
        skipDuplicates: true,
      });
      expect(result.relationshipsCount).toBe(1);
    });

    it("skips createMany when all tags are already linked", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      prisma.question.findFirst.mockResolvedValueOnce(null);
      // Both tags already linked
      prisma.questionTag.findMany.mockResolvedValueOnce([
        { questionId: "q-new", tagId: "t1" },
        { questionId: "q-new", tagId: "t2" },
      ]);

      const result = await service.syncQuestions(false);

      expect(prisma.questionTag.createMany).not.toHaveBeenCalled();
      expect(result.relationshipsCount).toBe(0);
    });

    it("upserts the admin user after seeding", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([]);

      await service.syncQuestions(false);

      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { username: "admin" },
        update: { role: Role.ADMIN },
        create: { username: "admin", role: Role.ADMIN },
      });
    });
  });

  describe("resetSystem", () => {
    it("purges all dependent Prisma tables in correct order", async () => {
      await service.resetSystem();

      expect(prisma.eventLog.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.answer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.matchRound.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.matchPlayer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.match.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.room.deleteMany).toHaveBeenCalledTimes(1);

      // Enforce the deletion order: eventLog → answer → matchRound →
      // matchPlayer → match → roomPlayer → room. A reordering would
      // risk violating FK constraints on dependent tables.
      const order = [
        prisma.eventLog.deleteMany.mock.invocationCallOrder[0],
        prisma.answer.deleteMany.mock.invocationCallOrder[0],
        prisma.matchRound.deleteMany.mock.invocationCallOrder[0],
        prisma.matchPlayer.deleteMany.mock.invocationCallOrder[0],
        prisma.match.deleteMany.mock.invocationCallOrder[0],
        prisma.roomPlayer.deleteMany.mock.invocationCallOrder[0],
        prisma.room.deleteMany.mock.invocationCallOrder[0],
      ];
      const sorted = [...order].sort((a, b) => a - b);
      expect(order).toEqual(sorted);
      // And each step must strictly follow the previous one.
      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }
    });

    it("scans and deletes matching room:* and match:* keys", async () => {
      redisClient.scan
        .mockResolvedValueOnce(["5", ["room:abc", "room:def"]])
        .mockResolvedValueOnce(["0", []])
        .mockResolvedValueOnce(["0", ["match:xyz"]]);
      redisClient.del
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      const result = await service.resetSystem();

      expect(redisClient.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "room:*",
        "COUNT",
        1000,
      );
      expect(redisClient.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "match:*",
        "COUNT",
        1000,
      );
      expect(redisClient.del).toHaveBeenCalledWith("room:abc", "room:def");
      expect(redisClient.del).toHaveBeenCalledWith("match:xyz");
      expect(result.success).toBe(true);
    });

    it("returns success message when no Redis keys are present", async () => {
      redisClient.scan.mockResolvedValue(["0", []]);

      const result = await service.resetSystem();

      expect(redisClient.del).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toContain("System reset complete");
    });
  });

  describe("terminateRoom", () => {
    it("throws ROOM_NOT_FOUND when room does not exist", async () => {
      roomService.getRoom.mockRejectedValueOnce(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );

      await expect(service.terminateRoom("r-missing")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });

      // No cleanup should have run on a missing room
      expect(matchService.finishMatch).not.toHaveBeenCalled();
      expect(gameLoopService.stopRoomRuntime).not.toHaveBeenCalled();
      expect(gameLoopService.emitRoomTerminated).not.toHaveBeenCalled();
      expect(roomService.disbandRoom).not.toHaveBeenCalled();
    });

    it("terminates a room with no active match", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r1",
        currentMatchId: null,
      });

      const result = await service.terminateRoom("r1", "abandoned by host");

      expect(result.success).toBe(true);
      expect(result.roomId).toBe("r1");
      expect(result.matchId).toBeNull();
      expect(result.message).toBe("Room terminated by admin");
      expect(typeof result.terminatedAt).toBe("number");

      // No match to finish
      expect(matchService.finishMatch).not.toHaveBeenCalled();
      // But room runtime still stopped (no match, no countdown expected)
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r1", null);
      // Emit still fires
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r1", {
        matchId: null,
        message: "abandoned by host",
      });
      // Room disbanded
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r1");
    });

    it("terminates a room with an active match (passes null winner)", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r2",
        currentMatchId: "m2",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m2" } as any);

      const result = await service.terminateRoom("r2");

      expect(result.success).toBe(true);
      expect(result.matchId).toBe("m2");

      // finishMatch called with null winner (admin termination)
      expect(matchService.finishMatch).toHaveBeenCalledWith("m2", null);
      // stopRoomRuntime called with the active matchId
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r2", "m2");
      // Emit carries the matchId
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r2", {
        matchId: "m2",
        message: undefined,
      });
    });

    it("continues cleanup when match finish throws (non-fatal)", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r3",
        currentMatchId: "m3",
      });
      matchService.finishMatch.mockRejectedValueOnce(
        new Error("DB transaction failed"),
      );

      // Should NOT throw — match finish failure is logged but non-fatal
      const result = await service.terminateRoom("r3");

      expect(result.success).toBe(true);
      expect(result.matchId).toBe("m3");
      // Runtime + emit + disband still run
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r3", "m3");
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalled();
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r3");
    });

    it("cleans explicit Redis keys including SCAN'd presence keys", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r4",
        currentMatchId: "m4",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m4" } as any);
      // SCAN returns 2 presence keys, then terminates
      redisClient.scan.mockResolvedValueOnce([
        "0",
        ["room:presence:r4:u1", "room:presence:r4:u2"],
      ]);

      await service.terminateRoom("r4");

      expect(redisClient.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "room:presence:r4:*",
        "COUNT",
        1000,
      );
      // DEL is called once with the full key set spread as separate args
      expect(redisClient.del).toHaveBeenCalledTimes(1);
      const delCallArgs = vi.mocked(redisClient.del).mock.calls[0];
      expect(delCallArgs).toEqual(
        expect.arrayContaining([
          "room:r4",
          "room:r4:players",
          "room:r4:playerCount",
          "room:countdown:r4",
          "room:presence:r4:u1",
          "room:presence:r4:u2",
          "match:state:m4",
        ]),
      );
      // Lobby countdowns index SREM runs unconditionally
      expect(redisClient.srem).toHaveBeenCalledWith("room:countdowns", "r4");
    });

    it("skips DEL when no keys to remove but still SREMs the index", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r5",
        currentMatchId: null,
      });
      // No presence keys, no match keys
      redisClient.scan.mockResolvedValueOnce(["0", []]);

      await service.terminateRoom("r5");

      // Presence SCAN was called
      expect(redisClient.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "room:presence:r5:*",
        "COUNT",
        1000,
      );
      // The base keys ARE still deleted (room:r5, room:r5:players, etc.)
      expect(redisClient.del).toHaveBeenCalledTimes(1);
      // SREM still runs
      expect(redisClient.srem).toHaveBeenCalledWith("room:countdowns", "r5");
    });

    it("returns partial result when disbandRoom throws (DB cleanup failed)", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r6",
        currentMatchId: null,
      });
      // Disband fails — represents a DB inconsistency: room channel already
      // notified, timers stopped, Redis cleaned, but DB record remains.
      roomService.disbandRoom.mockRejectedValueOnce(
        new Error("FK constraint violation"),
      );

      // Must NOT throw — caller still needs the partial result.
      const result = await service.terminateRoom("r6");

      // Partial-success signaling
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.roomId).toBe("r6");
      expect(result.message).toContain("partial");
      expect(result.cleanupError).toBe("FK constraint violation");
      expect(typeof result.terminatedAt).toBe("number");

      // Cleanup steps still ran (they run BEFORE disband in the orchestrator)
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r6", null);
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r6", {
        matchId: null,
        message: undefined,
      });
    });

    it("still calls disbandRoom when cleanupRoomRedisKeys throws (Redis unreachable)", async () => {
      // Reproduces the orchestrator pattern gap: if Redis is down at step 5,
      // a non-defensive call would skip the DB disband at step 6 and leave
      // the admin UI without the { partial } signal. PR #47 review.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r7",
        currentMatchId: null,
      });
      // Make SCAN throw — represents Redis being unreachable mid-termination.
      redisClient.scan.mockImplementationOnce(() => {
        throw new Error("Redis connection lost");
      });

      // Must NOT throw — the kill-switch is best-effort per step.
      const result = await service.terminateRoom("r7");

      // DB disband MUST still run (the whole point of the defensive wrap).
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r7");
      // Steps 3 & 4 still ran before the Redis failure.
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r7", null);
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r7", {
        matchId: null,
        message: undefined,
      });
      // Disband succeeded, so the response is a clean success.
      expect(result.success).toBe(true);
      expect(result.partial).toBe(false);
      expect(result.cleanupError).toBeUndefined();
    });
  });
});
