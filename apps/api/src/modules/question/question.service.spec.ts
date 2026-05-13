import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { QuestionService } from "./question.service";
import { PrismaService } from "../prisma/prisma.service";
import { GetQuestionsDto, QuestionDifficulty } from "./dto/get-questions.dto";

describe("QuestionService", () => {
  let service: QuestionService;

  const mockPrismaService = {
    question: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(() => {
    service = new QuestionService(
      mockPrismaService as unknown as PrismaService,
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("findAll", () => {
    const mockQuestions = [
      {
        id: "1",
        content: "Test question 1",
        options: [],
        correctAnswer: "0",
        difficulty: QuestionDifficulty.EASY,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "2",
        content: "Test question 2",
        options: [],
        correctAnswer: "0",
        difficulty: QuestionDifficulty.MEDIUM,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockCount = 2;

    beforeEach(() => {
      mockPrismaService.question.findMany.mockResolvedValue(mockQuestions);
      mockPrismaService.question.count.mockResolvedValue(mockCount);
    });

    it("should cap the limit at MAX_LIMIT", async () => {
      const query: GetQuestionsDto = { page: 1, limit: 150 }; // Exceeds MAX_LIMIT of 100


      mockPrismaService.question.findMany.mockImplementationOnce(() =>
        Promise.resolve(mockQuestions),
      );
      mockPrismaService.question.count.mockImplementationOnce(() =>
        Promise.resolve(mockCount),
      );

      const result = await service.findAll(query);

      // Should use capped limit of 100 instead of 150
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );

      // Skip calculation should use capped limit
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0, // (page - 1) * limit = (1 - 1) * 100 = 0
        }),
      );

      // Response should reflect the capped limit
      expect(result.meta.limit).toBe(100);
    });

    it("should use provided limit when below MAX_LIMIT", async () => {
      const query: GetQuestionsDto = { page: 1, limit: 50 }; // Below MAX_LIMIT of 100


      mockPrismaService.question.findMany.mockImplementationOnce(() =>
        Promise.resolve(mockQuestions),
      );
      mockPrismaService.question.count.mockImplementationOnce(() =>
        Promise.resolve(mockCount),
      );

      const result = await service.findAll(query);

      // Should use the provided limit of 50
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );

      // Skip calculation should use provided limit
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0, // (page - 1) * limit = (1 - 1) * 50 = 0
        }),
      );

      // Response should reflect the provided limit
      expect(result.meta.limit).toBe(50);
    });

    it("should use default limit when none provided", async () => {
      const query: GetQuestionsDto = { page: 1 }; // No limit provided, should default to 20


      mockPrismaService.question.findMany.mockImplementationOnce(() =>
        Promise.resolve(mockQuestions),
      );
      mockPrismaService.question.count.mockImplementationOnce(() =>
        Promise.resolve(mockCount),
      );

      const result = await service.findAll(query);

      // Should use the default limit of 20
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        }),
      );

      // Skip calculation should use default limit
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0, // (page - 1) * limit = (1 - 1) * 20 = 0
        }),
      );

      // Response should reflect the default limit
      expect(result.meta.limit).toBe(20);
    });

    it("should throw when dependency fails", async () => {
      const query: GetQuestionsDto = { page: 1, limit: 20 };
      const dbError = new Error("DB failed");

      mockPrismaService.question.findMany.mockRejectedValueOnce(dbError);
      mockPrismaService.question.count.mockResolvedValueOnce(0);

      await expect(service.findAll(query)).rejects.toThrow("DB failed");
      expect(mockPrismaService.question.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe("create", () => {
    const createDto = {
      content: "What is 2 + 2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: "4",
      difficulty: QuestionDifficulty.EASY,
    };

    it("should create and return question", async () => {
      const created = {
        id: "q-1",
        ...createDto,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.question.create.mockResolvedValueOnce(created);

      const result = await service.create(createDto);

      expect(mockPrismaService.question.create).toHaveBeenCalledWith({
        data: {
          ...createDto,
          active: true,
        },
      });
      expect(result).toEqual(created);
    });

    it("should throw when dependency fails", async () => {
      const dbError = new Error("Create failed");
      mockPrismaService.question.create.mockRejectedValueOnce(dbError);

      await expect(service.create(createDto)).rejects.toThrow("Create failed");
      expect(mockPrismaService.question.create).toHaveBeenCalledWith({
        data: {
          ...createDto,
          active: true,
        },
      });
    });
  });

  describe("findOne", () => {
    it("should return question when found", async () => {
      const id = "q-1";
      const question = {
        id,
        content: "Question",
        options: [],
        correctAnswer: 0,
        difficulty: QuestionDifficulty.EASY,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.question.findUnique.mockResolvedValueOnce(question);

      const result = await service.findOne(id);

      expect(mockPrismaService.question.findUnique).toHaveBeenCalledWith({
        where: { id },
      });
      expect(result).toEqual(question);
    });

    it("should throw NotFoundException when not found", async () => {
      const id = "q-404";
      mockPrismaService.question.findUnique.mockResolvedValueOnce(null);

      await expect(service.findOne(id)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.question.findUnique).toHaveBeenCalledWith({
        where: { id },
      });
    });
  });

  describe("update", () => {
    const id = "q-1";
    const updateDto = {
      content: "Updated question",
      active: false,
    };

    it("should update and return question", async () => {
      const updated = {
        id,
        content: "Updated question",
        options: [],
        correctAnswer: "0",
        difficulty: QuestionDifficulty.EASY,
        active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.question.update.mockResolvedValueOnce(updated);

      const result = await service.update(id, updateDto);

      expect(mockPrismaService.question.update).toHaveBeenCalledWith({
        where: { id },
        data: updateDto,
      });
      expect(result).toEqual(updated);
    });

    it("should throw NotFoundException on Prisma P2025", async () => {
      const prismaError = Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        { code: "P2025" },
      );

      mockPrismaService.question.update.mockRejectedValueOnce(prismaError);

      await expect(service.update(id, updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("should delete question successfully", async () => {
      const id = "q-1";
      mockPrismaService.question.delete.mockResolvedValueOnce({ id });

      await expect(service.remove(id)).resolves.toBeUndefined();
      expect(mockPrismaService.question.delete).toHaveBeenCalledWith({
        where: { id },
      });
    });

    it("should throw NotFoundException on Prisma P2025", async () => {
      const id = "q-404";
      const prismaError = Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        { code: "P2025" },
      );

      mockPrismaService.question.delete.mockRejectedValueOnce(prismaError);

      await expect(service.remove(id)).rejects.toThrow(NotFoundException);
    });
  });
});
