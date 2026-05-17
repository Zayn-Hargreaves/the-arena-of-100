import { QuestionController } from "./question.controller";
import { QuestionService } from "./question.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { UpdateQuestionDto } from "./dto/update-question.dto";
import { GetQuestionsDto, QuestionDifficulty } from "./dto/get-questions.dto";
import { Question } from "./entities/question.entity";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { BulkImportDto } from "./dto/bulk-import.dto";

describe("QuestionController", () => {
  let controller: QuestionController;
  let service: QuestionService;

  // Mock data
  const mockQuestion: Question = {
    id: "cjld2cjxh0000qzrmn831i7rn",
    content: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    correctAnswer: "Paris",
    difficulty: QuestionDifficulty.EASY,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQuestions: Question[] = [
    mockQuestion,
    {
      id: "cjld2cjxh0001qzrmn831i7rn",
      content: "What is 2+2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: "4",
      difficulty: QuestionDifficulty.EASY,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockQuestionResponse = {
    data: mockQuestions,
    meta: {
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
  };

  beforeEach(() => {
    const mockQuestionService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      bulkImport: vi.fn(),
      getRandom: vi.fn(),
      getStats: vi.fn(),
    };
    service = mockQuestionService as unknown as QuestionService;
    controller = new QuestionController(service);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("create", () => {
    const createQuestionDto: CreateQuestionDto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      active: true,
    };

    it("should create a question successfully", async () => {
      vi.mocked(service.create).mockResolvedValue(mockQuestion);

      const result = await controller.create(createQuestionDto);

      expect(service.create).toHaveBeenCalledWith(createQuestionDto);
      expect(result).toEqual(mockQuestion);
    });

    it("should handle service errors", async () => {
      const error = new BadRequestException("Validation failed");
      vi.mocked(service.create).mockRejectedValue(error);

      await expect(controller.create(createQuestionDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.create).toHaveBeenCalledWith(createQuestionDto);
    });
  });

  describe("findAll", () => {
    const getQuestionsDto: GetQuestionsDto = {
      page: 1,
      limit: 20,
      difficulty: QuestionDifficulty.EASY,
    };

    it("should return paginated questions successfully", async () => {
      vi.mocked(service.findAll).mockResolvedValue(mockQuestionResponse);

      const result = await controller.findAll(getQuestionsDto);

      expect(service.findAll).toHaveBeenCalledWith(getQuestionsDto);
      expect(result).toEqual(mockQuestionResponse);
    });

    it("should handle service errors", async () => {
      const error = new BadRequestException("Invalid query parameters");
      vi.mocked(service.findAll).mockRejectedValue(error);

      await expect(controller.findAll(getQuestionsDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.findAll).toHaveBeenCalledWith(getQuestionsDto);
    });

    it("should work with minimal query parameters", async () => {
      const minimalQuery: GetQuestionsDto = {};
      vi.mocked(service.findAll).mockResolvedValue(mockQuestionResponse);

      const result = await controller.findAll(minimalQuery);

      expect(service.findAll).toHaveBeenCalledWith(minimalQuery);
      expect(result).toEqual(mockQuestionResponse);
    });
  });

  describe("findOne", () => {
    const questionId = "cjld2cjxh0000qzrmn831i7rn";

    it("should return a question by ID successfully", async () => {
      vi.mocked(service.findOne).mockResolvedValue(mockQuestion);

      const result = await controller.findOne(questionId);

      expect(service.findOne).toHaveBeenCalledWith(questionId);
      expect(result).toEqual(mockQuestion);
    });

    it("should handle service errors when question not found", async () => {
      const error = new NotFoundException(
        `Question with ID ${questionId} not found`,
      );
      vi.mocked(service.findOne).mockRejectedValue(error);

      await expect(controller.findOne(questionId)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.findOne).toHaveBeenCalledWith(questionId);
    });

    it("should handle invalid CUID errors", async () => {
      const invalidId = "invalid-cuid";
      const error = new BadRequestException("Invalid ID format");
      vi.mocked(service.findOne).mockRejectedValue(error);

      await expect(controller.findOne(invalidId)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.findOne).toHaveBeenCalledWith(invalidId);
    });
  });

  describe("update", () => {
    const questionId = "cjld2cjxh0000qzrmn831i7rn";
    const updateQuestionDto: UpdateQuestionDto = {
      content: "Updated question content",
      difficulty: QuestionDifficulty.MEDIUM,
    };

    it("should update a question successfully", async () => {
      const updatedQuestion = { ...mockQuestion, ...updateQuestionDto };
      vi.mocked(service.update).mockResolvedValue(updatedQuestion);

      const result = await controller.update(questionId, updateQuestionDto);

      expect(service.update).toHaveBeenCalledWith(
        questionId,
        updateQuestionDto,
      );
      expect(result).toEqual(updatedQuestion);
    });

    it("should handle service errors when question not found", async () => {
      const error = new NotFoundException(
        `Question with ID ${questionId} not found`,
      );
      vi.mocked(service.update).mockRejectedValue(error);

      await expect(
        controller.update(questionId, updateQuestionDto),
      ).rejects.toThrow(NotFoundException);
      expect(service.update).toHaveBeenCalledWith(
        questionId,
        updateQuestionDto,
      );
    });

    it("should handle validation errors", async () => {
      const error = new BadRequestException("Bad Request");
      vi.mocked(service.update).mockRejectedValue(error);

      await expect(
        controller.update(questionId, updateQuestionDto),
      ).rejects.toThrow(BadRequestException);
      expect(service.update).toHaveBeenCalledWith(
        questionId,
        updateQuestionDto,
      );
    });
  });

  describe("remove", () => {
    const questionId = "cjld2cjxh0000qzrmn831i7rn";

    it("should delete a question successfully", async () => {
      vi.mocked(service.remove).mockResolvedValue(undefined);

      const result = await controller.remove(questionId);

      expect(service.remove).toHaveBeenCalledWith(questionId);
      expect(result).toBeUndefined();
    });

    it("should handle service errors when question not found", async () => {
      const error = new NotFoundException(
        `Question with ID ${questionId} not found`,
      );
      vi.mocked(service.remove).mockRejectedValue(error);

      await expect(controller.remove(questionId)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.remove).toHaveBeenCalledWith(questionId);
    });

    it("should handle invalid CUID errors", async () => {
      const invalidId = "invalid-cuid";
      const error = new BadRequestException("Invalid ID format");
      vi.mocked(service.remove).mockRejectedValue(error);

      await expect(controller.remove(invalidId)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.remove).toHaveBeenCalledWith(invalidId);
    });
  });

  describe("bulkImport", () => {
    const bulkImportDto: BulkImportDto = {
      questions: [
        {
          content: "What is the capital of France?",
          options: ["Paris", "London", "Berlin", "Madrid"],
          correctAnswer: "Paris",
          difficulty: QuestionDifficulty.EASY,
          active: true,
        },
      ],
    };

    it("should import questions in bulk successfully", async () => {
      const expectedResponse = {
        count: 1,
        message: "Successfully imported 1 questions",
      };
      vi.mocked(service.bulkImport).mockResolvedValue(expectedResponse);

      const result = await controller.bulkImport(bulkImportDto);

      expect(service.bulkImport).toHaveBeenCalledWith(bulkImportDto);
      expect(result).toEqual(expectedResponse);
    });

    it("should handle validation or service errors", async () => {
      const error = new BadRequestException("Invalid data payload");
      vi.mocked(service.bulkImport).mockRejectedValue(error);

      await expect(controller.bulkImport(bulkImportDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.bulkImport).toHaveBeenCalledWith(bulkImportDto);
    });
  });

  describe("getRandom", () => {
    it("should return a random question successfully", async () => {
      vi.mocked(service.getRandom).mockResolvedValue(mockQuestion);

      const result = await controller.getRandom({
        difficulty: QuestionDifficulty.EASY,
        excludeIds: ["q-1"],
      });

      expect(service.getRandom).toHaveBeenCalledWith(QuestionDifficulty.EASY, [
        "q-1",
      ]);
      expect(result).toEqual(mockQuestion);
    });

    it("should handle not found errors", async () => {
      const error = new NotFoundException("No questions found");
      vi.mocked(service.getRandom).mockRejectedValue(error);

      await expect(controller.getRandom({})).rejects.toThrow(NotFoundException);
      expect(service.getRandom).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe("getStats", () => {
    const questionId = "cjld2cjxh0000qzrmn831i7rn";

    it("should return question stats successfully", async () => {
      const mockStats = {
        questionId,
        totalAppearances: 10,
        correctAnswers: 8,
        incorrectAnswers: 2,
        averageResponseTimeMs: 1200,
        actualDifficultyScore: 0.8,
      };
      vi.mocked(service.getStats).mockResolvedValue(mockStats);

      const result = await controller.getStats(questionId);

      expect(service.getStats).toHaveBeenCalledWith(questionId);
      expect(result).toEqual(mockStats);
    });

    it("should handle not found errors", async () => {
      const error = new NotFoundException("Question not found");
      vi.mocked(service.getStats).mockRejectedValue(error);

      await expect(controller.getStats(questionId)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.getStats).toHaveBeenCalledWith(questionId);
    });
  });
});
