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
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    tag: {
      deleteMany: ReturnType<typeof vi.fn>;
      createMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    user: { upsert: ReturnType<typeof vi.fn> };
    eventLog: {
      deleteMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    answer: { deleteMany: ReturnType<typeof vi.fn> };
    matchRound: { deleteMany: ReturnType<typeof vi.fn> };
    matchPlayer: { deleteMany: ReturnType<typeof vi.fn> };
    match: { deleteMany: ReturnType<typeof vi.fn> };
    roomPlayer: { deleteMany: ReturnType<typeof vi.fn> };
    room: { deleteMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
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
    isMatchFinishing: ReturnType<typeof vi.fn>;
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
        findMany: vi.fn().mockResolvedValue([]),
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
      eventLog: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "evt-new", ...data }),
          ),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      answer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      matchRound: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      matchPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      match: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      roomPlayer: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      room: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      // $transaction supports two forms:
      //   1. Array form (legacy) — used by resetSystem; resolves every
      //      op and returns the resolved values in order, mirroring
      //      Prisma's real behavior so the existing
      //      `invocationCallOrder` assertions on deleteMany still pass.
      //   2. Function form (interactive) — used by syncQuestions for the
      //      atomic clear-and-reseed workflow. Invoked with the same
      //      `prisma` mock as `tx` so `tx.question.findMany` etc.
      //      resolve through the same vi.fn() instances already
      //      configured in this setup.
      $transaction: vi.fn((arg) =>
        typeof arg === "function" ? arg(prisma) : Promise.all(arg),
      ),
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
      isMatchFinishing: vi.fn().mockReturnValue(false),
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
      { timestamp: false },
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

      const result = await service.syncQuestions(true, "u-admin");

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

      await service.syncQuestions(false, "u-admin");

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

        const result = await fresh.syncQuestions(false, "u-admin");

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
      // No existing questions match the seed content (bulk preload).
      prisma.question.findMany.mockResolvedValueOnce([]);

      const result = await service.syncQuestions(false, "u-admin");

      expect(prisma.question.create).toHaveBeenCalledTimes(2);
      expect(prisma.question.update).not.toHaveBeenCalled();
      expect(result.questionsCount).toBe(2);
    });

    it("updates an existing question when matched by content", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      // First seed question already exists (bulk preload finds it).
      prisma.question.findMany.mockResolvedValueOnce([
        { id: "q-existing", content: "Mocked question 1" },
      ]);
      prisma.questionTag.findMany.mockResolvedValue([]);

      await service.syncQuestions(false, "u-admin");

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
      // "Mocked question 1" (the only seed with tags) already exists,
      // so the preloaded questionTag links apply to it.
      prisma.question.findMany.mockResolvedValueOnce([
        { id: "q-existing", content: "Mocked question 1" },
      ]);
      // Preloaded existing links: t1 already linked, t2 not.
      prisma.questionTag.findMany.mockResolvedValueOnce([
        { questionId: "q-existing", tagId: "t1" },
      ]);

      const result = await service.syncQuestions(false, "u-admin");

      expect(prisma.questionTag.createMany).toHaveBeenCalledWith({
        data: [{ questionId: "q-existing", tagId: "t2" }],
        skipDuplicates: true,
      });
      expect(result.relationshipsCount).toBe(1);
    });

    it("skips createMany when all tags are already linked", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);
      prisma.question.findMany.mockResolvedValueOnce([
        { id: "q-existing", content: "Mocked question 1" },
      ]);
      // Both tags already linked
      prisma.questionTag.findMany.mockResolvedValueOnce([
        { questionId: "q-existing", tagId: "t1" },
        { questionId: "q-existing", tagId: "t2" },
      ]);

      const result = await service.syncQuestions(false, "u-admin");

      expect(prisma.questionTag.createMany).not.toHaveBeenCalled();
      expect(result.relationshipsCount).toBe(0);
    });

    it("upserts the admin user after seeding", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([]);

      await service.syncQuestions(false, "u-admin");

      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { username: "admin" },
        update: { role: Role.ADMIN },
        create: { username: "admin", role: Role.ADMIN },
      });
    });

    it("throws when adminUserId is empty", async () => {
      await expect(service.syncQuestions(false, "")).rejects.toThrow(
        "adminUserId is required",
      );
    });

    it("throws when adminUserId is only whitespace", async () => {
      await expect(service.syncQuestions(false, "   ")).rejects.toThrow(
        "adminUserId is required",
      );
    });

    it("writes a failure audit row when the seed work throws, then re-throws", async () => {
      // Simulate a mid-seed DB error after the clearExisting branch
      // has already wiped the question bank. The original code
      // threw without writing an audit row, leaving the bank empty
      // with no forensic record. The try/catch/finally fix must
      // still write the audit row (success: false) before
      // propagating the error.
      prisma.questionTag.deleteMany.mockResolvedValueOnce({ count: 7 });
      prisma.question.deleteMany.mockResolvedValueOnce({ count: 5 });
      prisma.tag.deleteMany.mockRejectedValueOnce(new Error("DB lost"));

      await expect(service.syncQuestions(true, "u-fail-admin")).rejects.toThrow(
        "syncQuestions failed",
      );

      // Audit row still written exactly once, with success: false
      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminUserId: "u-fail-admin",
            eventType: "ADMIN_SYNC_QUESTIONS",
            payload: expect.objectContaining({
              success: false,
              clearExisting: true,
              error: "DB lost",
            }),
          }),
        }),
      );
    });
  });

  describe("resetSystem", () => {
    it("purges all dependent Prisma tables in correct order", async () => {
      await service.resetSystem("u-admin");

      expect(prisma.answer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.matchRound.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.matchPlayer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.match.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.room.deleteMany).toHaveBeenCalledTimes(1);

      // Enforce the deletion order: answer → matchRound →
      // matchPlayer → match → roomPlayer → room. A reordering would
      // risk violating FK constraints on dependent tables.
      const order = [
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

      const result = await service.resetSystem("u-admin");

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

      const result = await service.resetSystem("u-admin");

      expect(redisClient.del).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toContain("System reset complete");
    });

    it("throws when adminUserId is empty", async () => {
      await expect(service.resetSystem("")).rejects.toThrow(
        "adminUserId is required",
      );
    });

    it("throws when adminUserId is only whitespace", async () => {
      await expect(service.resetSystem("   ")).rejects.toThrow(
        "adminUserId is required",
      );
    });

    it("writes a failure audit row when the $transaction throws, then re-throws", async () => {
      // The atomic $transaction rejects. The original code would
      // throw without writing an audit row, so the operator would
      // not know who tried to reset the system and why it failed.
      // The try/catch/finally fix must still write the audit row
      // (success: false, zero counts) before propagating.
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error("FK violation: matches.questions"),
      );

      await expect(service.resetSystem("u-fail-admin")).rejects.toThrow(
        "resetSystem failed",
      );

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminUserId: "u-fail-admin",
            eventType: "ADMIN_RESET_SYSTEM",
            payload: expect.objectContaining({
              success: false,
              dbDeleted: {
                answers: 0,
                matchRounds: 0,
                matchPlayers: 0,
                matches: 0,
                roomPlayers: 0,
                rooms: 0,
              },
              redisKeysDeleted: { room: 0, match: 0, total: 0 },
              error: "FK violation: matches.questions",
            }),
          }),
        }),
      );
    });
  });

  describe("terminateRoom", () => {
    it("throws when adminUserId is empty", async () => {
      await expect(service.terminateRoom("r-1", "", undefined)).rejects.toThrow(
        "adminUserId is required",
      );
    });

    it("throws when adminUserId is only whitespace", async () => {
      await expect(
        service.terminateRoom("r-1", "   ", undefined),
      ).rejects.toThrow("adminUserId is required");
    });

    it("throws ROOM_NOT_FOUND when room does not exist", async () => {
      roomService.getRoom.mockRejectedValueOnce(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );

      await expect(
        service.terminateRoom("r-missing", "u-admin", undefined),
      ).rejects.toMatchObject({
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

      const result = await service.terminateRoom(
        "r1",
        "u-admin",
        "abandoned by host",
      );

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

      const result = await service.terminateRoom("r2", "u-admin", undefined);

      expect(result.success).toBe(true);
      expect(result.matchId).toBe("m2");

      // finishMatch called with null winner (admin termination) and
      // the resolved room's id (NOT a hardcoded test value) — the
      // H2 + M4 refactor moved the roomId into the finishMatch
      // signature so the transaction can update both the match and
      // the room atomically.
      expect(matchService.finishMatch).toHaveBeenCalledWith(
        "m2",
        null,
        "r2",
        true,
      );
      // stopRoomRuntime called with the active matchId
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r2", "m2");
      // Emit carries the matchId
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r2", {
        matchId: "m2",
        message: undefined,
      });
    });

    // B1 fix: race between natural finish (`GameLoopService.finishMatchLoop`
    // driven by `checkMatchEnd`) and admin kill-switch. If a natural
    // finish is in flight for this matchId, the admin path must abort
    // the whole kill-switch with `ALREADY_FINISHING` so it does not
    // write the same Match row twice or double-broadcast.
    it("B1: aborts the kill-switch with ALREADY_FINISHING when a natural finish is in flight", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r-finishing",
        currentMatchId: "m-finishing",
      });
      // The natural finish is mid-execution — the guard is held.
      gameLoopService.isMatchFinishing.mockReturnValueOnce(true);

      const result = await service.terminateRoom(
        "r-finishing",
        "u-admin",
        "test",
      );

      // The kill-switch must NOT call finishMatch, must NOT stop
      // room runtime, must NOT emit ROOM_TERMINATED, must NOT
      // disband the room. The whole orchestrator must return
      // early with a typed reason.
      expect(result.success).toBe(false);
      expect(result.partial).toBe(false);
      expect(result.reason).toBe("ALREADY_FINISHING");
      expect(result.matchId).toBe("m-finishing");
      expect(result.roomId).toBe("r-finishing");
      expect(result.terminatedAt).toEqual(expect.any(Number));

      expect(matchService.finishMatch).not.toHaveBeenCalled();
      expect(gameLoopService.stopRoomRuntime).not.toHaveBeenCalled();
      expect(gameLoopService.emitRoomTerminated).not.toHaveBeenCalled();
      expect(roomService.disbandRoom).not.toHaveBeenCalled();
    });

    it("B1: passes the guard through to a normal termination when no natural finish is in flight", async () => {
      // Sanity check on the new mock default: when isMatchFinishing
      // returns false, the existing termination flow runs as before.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r-normal",
        currentMatchId: "m-normal",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m-normal" } as any);
      // Default mock returns false; explicitly document that here.
      gameLoopService.isMatchFinishing.mockReturnValueOnce(false);

      const result = await service.terminateRoom(
        "r-normal",
        "u-admin",
        undefined,
      );

      expect(result.success).toBe(true);
      expect(matchService.finishMatch).toHaveBeenCalledWith(
        "m-normal",
        null,
        "r-normal",
        true,
      );
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
      const result = await service.terminateRoom("r3", "u-admin", undefined);

      // finishMatch failure is now recorded as partial so the admin UI
      // can trigger a follow-up sweep.
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.matchId).toBe("m3");
      // Runtime + emit + disband still run
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r3", "m3");
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalled();
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r3");
    });

    it("logs string rejections when match finish throws", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r3b",
        currentMatchId: "m3b",
      });
      matchService.finishMatch.mockRejectedValueOnce("finish boom (string)");

      await service.terminateRoom("r3b", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to finish match m3b during admin termination of room r3b:",
        ),
        undefined,
      );
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

      await service.terminateRoom("r4", "u-admin", undefined);

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

      await service.terminateRoom("r5", "u-admin", undefined);

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
      const result = await service.terminateRoom("r6", "u-admin", undefined);

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

    it("returns partial result when cleanupRoomRedisKeys throws (Redis unreachable)", async () => {
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
      const result = await service.terminateRoom("r7", "u-admin", undefined);

      // DB disband MUST still run (the whole point of the defensive wrap).
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r7");
      // Steps 3 & 4 still ran before the Redis failure.
      expect(gameLoopService.stopRoomRuntime).toHaveBeenCalledWith("r7", null);
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r7", {
        matchId: null,
        message: undefined,
      });
      // Disband succeeded, but Redis cleanup failed → the response is
      // still a partial result. The admin UI needs this signal so it
      // can flag the kill-switch as needing a follow-up sweep.
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.cleanupError).toBe("Redis connection lost");
      expect(result.message).toContain("partial");
    });

    it("returns partial result when only disbandRoom throws (Redis cleanup OK)", async () => {
      // DB disband fails but Redis cleanup ran fine — partial must still
      // be true (the DB record is stale and the admin UI needs to know).
      roomService.getRoom.mockResolvedValueOnce({
        id: "r8",
        currentMatchId: "m8",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m8" } as any);
      // Disband fails — DB record remains
      roomService.disbandRoom.mockRejectedValueOnce(
        new Error("FK constraint violation"),
      );
      // Redis cleanup succeeds (default mocks)

      const result = await service.terminateRoom("r8", "u-admin", undefined);

      expect(result.partial).toBe(true);
      expect(result.cleanupError).toBe("FK constraint violation");
    });

    it("merges both Redis and DB failures into a single partial result (first-error wins)", async () => {
      // Both cleanupRoomRedisKeys AND disbandRoom fail. The first error
      // encountered should populate cleanupError so the caller can act
      // on a stable field; both are logged.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r9",
        currentMatchId: "m9",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m9" } as any);
      redisClient.scan.mockImplementationOnce(() => {
        throw new Error("Redis connection lost");
      });
      roomService.disbandRoom.mockRejectedValueOnce(
        new Error("FK constraint violation"),
      );

      const result = await service.terminateRoom("r9", "u-admin", undefined);

      expect(result.partial).toBe(true);
      // First error encountered (Redis) wins — see `if (!cleanupError)`
      // guard in disbandRoom catch block.
      expect(result.cleanupError).toBe("Redis connection lost");
      expect(result.success).toBe(false);
    });

    it("continues cleanup when emitRoomTerminated itself throws (defensive step 4)", async () => {
      // Step 4 wraps emitRoomTerminated in try/catch. The helper itself
      // already guards `!this.server` (warn + return) but a misbehaving
      // socket.io adapter could still throw on the actual emit. The
      // orchestrator must log the error and keep going.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r10",
        currentMatchId: null,
      });
      gameLoopService.emitRoomTerminated.mockImplementationOnce(() => {
        throw { code: "ADAPTER_DOWN" };
      });

      // Must NOT throw — the kill-switch is best-effort per step.
      const result = await service.terminateRoom("r10", "u-admin", undefined);

      // Steps 5 and 6 must still run.
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r10");
      // Disband succeeded but emitRoomTerminated failed → response is partial.
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.cleanupError).toBe("[object Object]");
    });

    it("logs Error stacks when emitRoomTerminated throws an Error", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r10b",
        currentMatchId: null,
      });
      gameLoopService.emitRoomTerminated.mockImplementationOnce(() => {
        throw new Error("adapter down");
      });

      await service.terminateRoom("r10b", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "emitRoomTerminated failed during admin termination of room r10b",
        ),
        expect.any(String),
      );
    });

    it("logs Error stacks for stopRoomRuntime without a matchId", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r12c",
        currentMatchId: null,
      });
      gameLoopService.stopRoomRuntime.mockRejectedValueOnce(
        new Error("runtime stop boom"),
      );

      await service.terminateRoom("r12c", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "stopRoomRuntime failed during admin termination of room r12c:",
        ),
        expect.any(String),
      );
    });

    it("logs Error stacks for emitRoomTerminated without a matchId", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r10c",
        currentMatchId: null,
      });
      gameLoopService.emitRoomTerminated.mockImplementationOnce(() => {
        throw new Error("adapter down");
      });

      await service.terminateRoom("r10c", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "emitRoomTerminated failed during admin termination of room r10c:",
        ),
        expect.any(String),
      );
    });

    it("logs Error stacks for emitRoomTerminated with a matchId", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r10d",
        currentMatchId: "m10d",
      });
      gameLoopService.emitRoomTerminated.mockImplementationOnce(() => {
        throw new Error("adapter down");
      });

      await service.terminateRoom("r10d", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "emitRoomTerminated failed during admin termination of room r10d (match m10d):",
        ),
        expect.any(String),
      );
    });

    it("continues cleanup when Redis srem for the lobby-countdowns index throws (best-effort)", async () => {
      // `cleanupRoomRedisKeys` wraps the `srem` of the lobby-countdowns
      // index in try/catch. If SREM itself rejects (e.g. transient Redis
      // hiccup), the rest of the kill-switch (DB disband, partial signal)
      // must not be affected — the warning is logged but the operation
      // continues.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r11",
        currentMatchId: "m11",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m11" } as any);
      // SREM for the lobby-countdowns index rejects — represents a
      // transient Redis hiccup on the best-effort SREM path.
      redisClient.srem.mockImplementationOnce(() => {
        throw new Error("transient srem error");
      });

      // Must NOT throw — srem is best-effort, not aborting.
      const result = await service.terminateRoom("r11", "u-admin", undefined);

      // DB disband still ran.
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r11");
      // No SREM error reached the response — srem is a best-effort
      // index cleanup, not part of the partial-success contract.
      expect(result.partial).toBe(false);
      expect(result.success).toBe(true);
    });

    it("continues cleanup when stopRoomRuntime itself throws (defensive step 3)", async () => {
      // Step 3 wraps stopRoomRuntime in try/catch. If the runtime stop
      // itself throws (e.g. the Redis call inside clearPersistedCountdown
      // rejects in a way the helper does not handle), the orchestrator
      // must log the error and proceed to steps 4–6.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r12",
        currentMatchId: "m12",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m12" } as any);
      // Throwing a string (not an Error) to also cover the
      // `error instanceof Error ? ... : String(error)` else branch at
      // admin.service.ts:279. The orchestrator must not assume the
      // rejected value is an Error instance.
      gameLoopService.stopRoomRuntime.mockRejectedValueOnce(
        "runtime stop boom (string)",
      );

      // Must NOT throw — the kill-switch is best-effort per step.
      const result = await service.terminateRoom("r12", "u-admin", undefined);

      // Steps 4-6 must still run.
      expect(gameLoopService.emitRoomTerminated).toHaveBeenCalledWith("r12", {
        matchId: "m12",
        message: undefined,
      });
      expect(roomService.disbandRoom).toHaveBeenCalledWith("r12");
      // Disband succeeded but stopRoomRuntime failed → response is partial.
      expect(result.success).toBe(false);
      expect(result.partial).toBe(true);
      expect(result.cleanupError).toBe("runtime stop boom (string)");
    });

    it("logs Error stacks when stopRoomRuntime throws an Error", async () => {
      const loggerErrorSpy = vi.spyOn((service as any).logger, "error");
      roomService.getRoom.mockResolvedValueOnce({
        id: "r12b",
        currentMatchId: "m12b",
      });
      gameLoopService.stopRoomRuntime.mockRejectedValueOnce(
        new Error("runtime stop boom"),
      );

      await service.terminateRoom("r12b", "u-admin", undefined);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "stopRoomRuntime failed during admin termination of room r12b (match m12b)",
        ),
        expect.any(String),
      );
    });

    it("coerces non-Error throws from cleanupRoomRedisKeys into cleanupError (string rejection)", async () => {
      // Branch coverage for `error instanceof Error ? ... : String(error)`.
      // Throwing a non-Error (here: a plain string) exercises the
      // `String(error)` fallback at admin.service.ts:321 and proves the
      // orchestrator does not assume rejected values are Error instances.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r13",
        currentMatchId: null,
      });
      redisClient.scan.mockImplementationOnce(() => {
        throw "Redis connection lost (string)";
      });

      const result = await service.terminateRoom("r13", "u-admin", undefined);

      expect(result.partial).toBe(true);
      // String(error) fallback produces the raw string message
      expect(result.cleanupError).toBe("Redis connection lost (string)");
    });

    it("coerces non-Error throws from disbandRoom into cleanupError (object rejection)", async () => {
      // Branch coverage for the disbandRoom catch at admin.service.ts:336-337.
      // Throwing a non-Error (here: a plain object with a `message` field)
      // exercises the `String(error)` fallback.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r14",
        currentMatchId: null,
      });
      roomService.disbandRoom.mockImplementationOnce(() => {
        throw { message: "non-error rejection" };
      });

      const result = await service.terminateRoom("r14", "u-admin", undefined);

      expect(result.partial).toBe(true);
      // String(error) on a plain object = "[object Object]"
      expect(result.cleanupError).toBe("[object Object]");
    });

    it("coerces non-Error throws from Redis srem into the warn log (object rejection)", async () => {
      // Branch coverage for the srem catch at admin.service.ts:409.
      // Throwing a non-Error (here: a plain object) exercises the
      // `String(error)` fallback in the warn formatter.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r15",
        currentMatchId: "m15",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m15" } as any);
      redisClient.srem.mockImplementationOnce(() => {
        throw { code: "TRANSIENT" };
      });

      const result = await service.terminateRoom("r15", "u-admin", undefined);

      // srem failure is best-effort — must not abort the kill-switch.
      expect(result.success).toBe(true);
      expect(result.partial).toBe(false);
    });
  });

  // ============================================================
  // PR 3: Admin Audit Event tests
  // ============================================================
  describe("admin audit (PR 3)", () => {
    it("terminateRoom appends an ADMIN_TERMINATE_ROOM audit row with the captured adminUserId", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r-audit",
        currentMatchId: "m-audit",
      });
      matchService.finishMatch.mockResolvedValueOnce({ id: "m-audit" } as any);

      await service.terminateRoom("r-audit", "u-test-admin", "abandoned");

      // eventLog.create called once with the audit row
      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomId: "r-audit",
            matchId: "m-audit",
            adminUserId: "u-test-admin",
            eventType: "ADMIN_TERMINATE_ROOM",
            payload: expect.objectContaining({
              success: true,
              partial: false,
              reason: "KILL_SWITCH",
            }),
          }),
        }),
      );
    });

    it("terminateRoom appends an audit row with reason=ALREADY_FINISHING when the B1 guard aborts", async () => {
      roomService.getRoom.mockResolvedValueOnce({
        id: "r-finishing",
        currentMatchId: "m-finishing",
      });
      gameLoopService.isMatchFinishing.mockReturnValueOnce(true);

      await service.terminateRoom("r-finishing", "u-test-admin", "test");

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomId: "r-finishing",
            matchId: "m-finishing",
            adminUserId: "u-test-admin",
            eventType: "ADMIN_TERMINATE_ROOM",
            payload: expect.objectContaining({
              success: false,
              partial: false,
              reason: "ALREADY_FINISHING",
            }),
          }),
        }),
      );
    });

    it("appendAudit failure does not block the kill-switch result (best-effort)", async () => {
      // Simulate the DB rejecting the audit insert. The kill-switch
      // must still return a normal TerminateRoomResult to the caller.
      roomService.getRoom.mockResolvedValueOnce({
        id: "r-audit-fail",
        currentMatchId: null,
      });
      prisma.eventLog.create.mockRejectedValueOnce(
        new Error("DB write failed"),
      );

      const result = await service.terminateRoom(
        "r-audit-fail",
        "u-test-admin",
        undefined,
      );

      // Kill-switch returned a normal result (not partial, not thrown)
      expect(result.success).toBe(true);
      expect(result.partial).toBe(false);
      expect(result.roomId).toBe("r-audit-fail");
      // Audit insert was attempted
      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
    });

    it("resetSystem writes a completed audit row with delete counts", async () => {
      // Each deleteMany returns a non-zero count to verify the
      // completed-row payload surfaces the actual numbers.
      prisma.answer.deleteMany.mockResolvedValueOnce({ count: 50 });
      prisma.matchRound.deleteMany.mockResolvedValueOnce({ count: 12 });
      prisma.matchPlayer.deleteMany.mockResolvedValueOnce({ count: 5 });
      prisma.match.deleteMany.mockResolvedValueOnce({ count: 2 });
      prisma.roomPlayer.deleteMany.mockResolvedValueOnce({ count: 10 });
      prisma.room.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.resetSystem("u-test-admin");

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminUserId: "u-test-admin",
            eventType: "ADMIN_RESET_SYSTEM",
            payload: expect.objectContaining({
              dbDeleted: expect.objectContaining({
                answers: 50,
                matchRounds: 12,
                matchPlayers: 5,
                matches: 2,
                roomPlayers: 10,
                rooms: 1,
              }),
            }),
          }),
        }),
      );
    });

    it("resetSystem still writes the audit row even if the audit insert fails (best-effort)", async () => {
      prisma.eventLog.create.mockRejectedValueOnce(
        new Error("audit write failed"),
      );

      await expect(service.resetSystem("u-test-admin")).resolves.toEqual(
        expect.objectContaining({
          success: true,
        }),
      );

      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
    });

    it("syncQuestions appends an ADMIN_SYNC_QUESTIONS audit row with the seed stats", async () => {
      prisma.tag.findMany.mockResolvedValueOnce([
        { id: "t1", name: "tag one" },
        { id: "t2", name: "tag two" },
      ]);

      const result = await service.syncQuestions(true, "u-test-admin");

      // Existing return shape intact
      expect(result.success).toBe(true);
      // Audit row written
      expect(prisma.eventLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.eventLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminUserId: "u-test-admin",
            eventType: "ADMIN_SYNC_QUESTIONS",
            payload: expect.objectContaining({
              clearExisting: true,
              questionsCount: 2,
              tagsCount: 2,
              relationshipsCount: 2,
            }),
          }),
        }),
      );
    });

    it("getAuditEvents forwards filter params to findMany + count", async () => {
      const fakeEvents = [
        { id: "evt-1", eventType: "ADMIN_TERMINATE_ROOM" },
        { id: "evt-2", eventType: "ADMIN_TERMINATE_ROOM" },
      ];
      prisma.eventLog.findMany.mockResolvedValueOnce(fakeEvents);
      prisma.eventLog.count.mockResolvedValueOnce(7);

      const result = await service.getAuditEvents({
        limit: 50,
        offset: 10,
        roomId: "r-filter",
        eventType: "ADMIN_TERMINATE_ROOM",
      });

      expect(result.events).toEqual(fakeEvents);
      expect(result.total).toBe(7);
      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          roomId: "r-filter",
          eventType: "ADMIN_TERMINATE_ROOM",
        },
        orderBy: { createdAt: "desc" },
        skip: 10,
        take: 50,
      });
      expect(prisma.eventLog.count).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          roomId: "r-filter",
          eventType: "ADMIN_TERMINATE_ROOM",
        },
      });
    });

    it("getAuditEvents omits absent filters from the where clause", async () => {
      prisma.eventLog.findMany.mockResolvedValueOnce([]);
      prisma.eventLog.count.mockResolvedValueOnce(0);

      await service.getAuditEvents({ limit: 25, offset: 0 });

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: { adminUserId: { not: null } },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 25,
      });
    });

    it("getAuditEvents forwards createdAt range filters", async () => {
      prisma.eventLog.findMany.mockResolvedValueOnce([]);
      prisma.eventLog.count.mockResolvedValueOnce(0);
      const createdAfter = new Date("2026-07-01T00:00:00.000Z");
      const createdBefore = new Date("2026-07-14T23:59:59.999Z");

      await service.getAuditEvents({
        limit: 25,
        offset: 0,
        createdAfter,
        createdBefore,
      });

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { gte: createdAfter, lte: createdBefore },
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 25,
      });
      expect(prisma.eventLog.count).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { gte: createdAfter, lte: createdBefore },
        },
      });
    });

    it("getAuditEvents forwards only createdAfter as gte bound", async () => {
      prisma.eventLog.findMany.mockResolvedValueOnce([]);
      prisma.eventLog.count.mockResolvedValueOnce(3);
      const createdAfter = new Date("2026-07-01T00:00:00.000Z");

      const result = await service.getAuditEvents({
        limit: 10,
        offset: 0,
        createdAfter,
      });

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { gte: createdAfter },
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      });
      expect(prisma.eventLog.count).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { gte: createdAfter },
        },
      });
      expect(result.total).toBe(3);
    });

    it("getAuditEvents forwards only createdBefore as lte bound", async () => {
      prisma.eventLog.findMany.mockResolvedValueOnce([]);
      prisma.eventLog.count.mockResolvedValueOnce(5);
      const createdBefore = new Date("2026-07-14T23:59:59.999Z");

      const result = await service.getAuditEvents({
        limit: 10,
        offset: 0,
        createdBefore,
      });

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { lte: createdBefore },
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      });
      expect(prisma.eventLog.count).toHaveBeenCalledWith({
        where: {
          adminUserId: { not: null },
          createdAt: { lte: createdBefore },
        },
      });
      expect(result.total).toBe(5);
    });
  });
});
