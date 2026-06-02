import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
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
        upsert: vi
          .fn()
          .mockResolvedValue({
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
    };
    redis = {
      getClient: vi.fn().mockReturnValue(redisClient),
    };

    service = new AdminService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
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
      const { AdminService: FreshAdminService } =
        await import("./admin.service");
      prisma.tag.findMany.mockResolvedValueOnce([]);
      const fresh = new FreshAdminService(
        prisma as unknown as PrismaService,
        redis as unknown as RedisService,
      );

      const result = await fresh.syncQuestions(false);

      expect(prisma.tag.createMany).not.toHaveBeenCalled();
      expect(result.tagsCount).toBe(0);
      vi.doUnmock("../../prisma-seeds/questions");
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
});
