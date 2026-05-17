import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { QuestionService } from "./question.service";
import { PrismaService } from "../prisma/prisma.service";
import { GetQuestionsDto, QuestionDifficulty } from "./dto/get-questions.dto";
import { BulkImportDto } from "./dto/bulk-import.dto";

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
      createMany: vi.fn(),
      findFirst: vi.fn(),
    },
    answer: {
      findMany: vi.fn(),
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
        correctAnswer: "0",
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

    describe("partial update validation", () => {
      const existingQuestion = {
        id,
        content: "Original question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: QuestionDifficulty.EASY,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      it("should throw BadRequestException when correctAnswer is not in existing options", async () => {
        const updateDtoWithInvalidAnswer = {
          correctAnswer: "X", // Not in existing options
        };

        mockPrismaService.question.findUnique.mockResolvedValueOnce(
          existingQuestion,
        );

        await expect(
          service.update(id, updateDtoWithInvalidAnswer),
        ).rejects.toThrow(
          new BadRequestException(
            "correctAnswer must be one of the existing options",
          ),
        );

        // Should not call update since validation failed
        expect(mockPrismaService.question.update).not.toHaveBeenCalled();
      });

      it("should allow valid correctAnswer when it exists in options", async () => {
        const updateDtoWithValidAnswer = {
          correctAnswer: "B", // Exists in existing options
        };

        const updated = {
          ...existingQuestion,
          correctAnswer: "B",
          updatedAt: new Date(),
        };

        mockPrismaService.question.findUnique.mockResolvedValueOnce(
          existingQuestion,
        );
        mockPrismaService.question.update.mockResolvedValueOnce(updated);

        const result = await service.update(id, updateDtoWithValidAnswer);

        expect(mockPrismaService.question.findUnique).toHaveBeenCalledWith({
          where: { id },
        });
        expect(mockPrismaService.question.update).toHaveBeenCalledWith({
          where: { id },
          data: updateDtoWithValidAnswer,
        });
        expect(result).toEqual(updated);
      });

      it("should not validate correctAnswer against existing options when both options and correctAnswer are provided", async () => {
        const updateDtoWithBothFields = {
          options: ["X", "Y", "Z"],
          correctAnswer: "X", // Valid in new options, but not in existing ones
        };

        const updated = {
          ...existingQuestion,
          options: ["X", "Y", "Z"],
          correctAnswer: "X",
          updatedAt: new Date(),
        };

        // Should not call findUnique since we don't need to validate against existing options
        mockPrismaService.question.update.mockResolvedValueOnce(updated);

        const result = await service.update(id, updateDtoWithBothFields);

        expect(mockPrismaService.question.findUnique).not.toHaveBeenCalled();
        expect(mockPrismaService.question.update).toHaveBeenCalledWith({
          where: { id },
          data: updateDtoWithBothFields,
        });
        expect(result).toEqual(updated);
      });

      it("should throw NotFoundException when trying to update non-existent question", async () => {
        const updateDtoWithCorrectAnswer = {
          correctAnswer: "B",
        };

        mockPrismaService.question.findUnique.mockResolvedValueOnce(null);

        await expect(
          service.update(id, updateDtoWithCorrectAnswer),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe("remove", () => {
    it("should soft delete question successfully", async () => {
      const id = "q-1";
      mockPrismaService.question.update.mockResolvedValueOnce({
        id,
        active: false,
      });

      await expect(service.remove(id)).resolves.toBeUndefined();
      expect(mockPrismaService.question.update).toHaveBeenCalledWith({
        where: { id },
        data: { active: false },
      });
    });

    it("should throw NotFoundException on Prisma P2025", async () => {
      const id = "q-404";
      const prismaError = Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        { code: "P2025" },
      );

      mockPrismaService.question.update.mockRejectedValueOnce(prismaError);

      await expect(service.remove(id)).rejects.toThrow(NotFoundException);
    });
  });

  describe("bulkImport", () => {
    const bulkImportDto: BulkImportDto = {
      questions: [
        {
          content: "What is 2 + 2?",
          options: ["3", "4", "5", "6"],
          correctAnswer: "4",
          difficulty: QuestionDifficulty.EASY,
          active: true,
        },
        {
          content: "What is the capital of Spain?",
          options: ["Madrid", "Barcelona", "Seville", "Valencia"],
          correctAnswer: "Madrid",
          difficulty: QuestionDifficulty.MEDIUM,
        },
      ],
    };

    it("should import questions in bulk and return count summary", async () => {
      mockPrismaService.question.createMany.mockResolvedValueOnce({ count: 2 });

      const result = await service.bulkImport(bulkImportDto);

      expect(mockPrismaService.question.createMany).toHaveBeenCalledWith({
        data: [
          {
            content: "What is 2 + 2?",
            options: ["3", "4", "5", "6"],
            correctAnswer: "4",
            difficulty: QuestionDifficulty.EASY,
            active: true,
          },
          {
            content: "What is the capital of Spain?",
            options: ["Madrid", "Barcelona", "Seville", "Valencia"],
            correctAnswer: "Madrid",
            difficulty: QuestionDifficulty.MEDIUM,
            active: true,
          },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual({
        count: 2,
        message: "Successfully imported 2 questions",
      });
    });

    it("should throw when dependency fails", async () => {
      const dbError = new Error("Bulk insert failed");
      mockPrismaService.question.createMany.mockRejectedValueOnce(dbError);

      await expect(service.bulkImport(bulkImportDto)).rejects.toThrow(
        "Bulk insert failed",
      );
    });

    it("should handle Prisma unique constraint errors", async () => {
      const prismaError = Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        { code: "P2002" },
      );
      mockPrismaService.question.createMany.mockRejectedValueOnce(prismaError);

      await expect(service.bulkImport(bulkImportDto)).rejects.toThrow(
        new BadRequestException(
          "Failed to import questions due to unique constraint violation. Some questions may already exist.",
        ),
      );
    });
  });

  describe("getRandom", () => {
    const mockQuestion = {
      id: "q-random-1",
      content: "Random question?",
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty: QuestionDifficulty.EASY,
      active: true,
      createdAt: new Date(),
    };

    it("should return a random active question successfully", async () => {
      mockPrismaService.question.count.mockResolvedValueOnce(5);
      mockPrismaService.question.findFirst.mockResolvedValueOnce(mockQuestion);

      const result = await service.getRandom();

      expect(mockPrismaService.question.count).toHaveBeenCalledWith({
        where: { active: true },
      });
      expect(mockPrismaService.question.findFirst).toHaveBeenCalledWith({
        where: { active: true },
        skip: expect.any(Number),
      });
      expect(result).toEqual(mockQuestion);
    });

    it("should apply difficulty and excludeIds filters", async () => {
      mockPrismaService.question.count.mockResolvedValueOnce(1);
      mockPrismaService.question.findFirst.mockResolvedValueOnce(mockQuestion);

      const result = await service.getRandom(QuestionDifficulty.MEDIUM, [
        "q-old-1",
      ]);

      expect(mockPrismaService.question.count).toHaveBeenCalledWith({
        where: {
          active: true,
          difficulty: QuestionDifficulty.MEDIUM,
          id: { notIn: ["q-old-1"] },
        },
      });
      expect(mockPrismaService.question.findFirst).toHaveBeenCalledWith({
        where: {
          active: true,
          difficulty: QuestionDifficulty.MEDIUM,
          id: { notIn: ["q-old-1"] },
        },
        skip: 0,
      });
      expect(result).toEqual(mockQuestion);
    });

    it("should throw NotFoundException if count is 0", async () => {
      mockPrismaService.question.count.mockResolvedValueOnce(0);

      await expect(service.getRandom()).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException if findFirst returns null", async () => {
      mockPrismaService.question.count.mockResolvedValueOnce(2);
      mockPrismaService.question.findFirst.mockResolvedValueOnce(null);

      await expect(service.getRandom()).rejects.toThrow(NotFoundException);
    });
  });

  describe("getStats", () => {
    const questionId = "q-stats-1";
    const mockQuestion = { id: questionId, content: "Stats?" };

    it("should throw NotFoundException if question does not exist", async () => {
      mockPrismaService.question.findUnique.mockResolvedValueOnce(null);

      await expect(service.getStats(questionId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return zeroed statistics if question has never been played", async () => {
      mockPrismaService.question.findUnique.mockResolvedValueOnce(mockQuestion);
      mockPrismaService.answer.findMany.mockResolvedValueOnce([]);

      const result = await service.getStats(questionId);

      expect(mockPrismaService.answer.findMany).toHaveBeenCalledWith({
        where: { round: { questionId } },
        select: { isCorrect: true, responseTimeMs: true },
      });
      expect(result).toEqual({
        questionId,
        totalAppearances: 0,
        correctAnswers: 0,
        incorrectAnswers: 0,
        averageResponseTimeMs: 0,
        actualDifficultyScore: 0,
      });
    });

    it("should calculate correctRatio and averageResponseTimeMs from answers successfully", async () => {
      mockPrismaService.question.findUnique.mockResolvedValueOnce(mockQuestion);
      mockPrismaService.answer.findMany.mockResolvedValueOnce([
        { isCorrect: true, responseTimeMs: 1000 },
        { isCorrect: false, responseTimeMs: 2000 },
        { isCorrect: true, responseTimeMs: 1500 },
        { isCorrect: true, responseTimeMs: 1200 },
      ]);

      const result = await service.getStats(questionId);

      expect(result).toEqual({
        questionId,
        totalAppearances: 4,
        correctAnswers: 3,
        incorrectAnswers: 1,
        averageResponseTimeMs: 1425, // (1000+2000+1500+1200)/4 = 1425
        actualDifficultyScore: 0.75, // 3 / 4
      });
    });
  });
});
