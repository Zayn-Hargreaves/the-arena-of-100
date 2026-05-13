import { QuestionController } from "./question.controller";
import { QuestionService } from "./question.service";
import { CreateQuestionDto } from "./dto/create-question.dto";
import { UpdateQuestionDto } from "./dto/update-question.dto";
import { GetQuestionsDto, QuestionDifficulty } from "./dto/get-questions.dto";
import { Question } from "./entities/question.entity";
import { NotFoundException, BadRequestException } from "@nestjs/common";

describe("QuestionController", () => {
  let controller: QuestionController;
  let service: QuestionService;

  // Mock data
  const mockQuestion: Question = {
    id: "1",
    content: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    correctAnswer: "Paris",
    difficulty: QuestionDifficulty.EASY,
    active: true,
    createdAt: new Date(),
  };

  const mockQuestions = [
    mockQuestion,
    {
      id: "2",
      content: "What is 2+2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: "4",
      difficulty: QuestionDifficulty.EASY,
      active: true,
      createdAt: new Date(),
    },
  ];

  const mockQuestionResponse = {
    data: mockQuestions,
    meta: {
      total: 2,
      page: 1,
      limit: 20,
    },
  };

  beforeEach(() => {
    const mockQuestionService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
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
      service.create.mockResolvedValue(mockQuestion);

      const result = await controller.create(createQuestionDto);

      expect(service.create).toHaveBeenCalledWith(createQuestionDto);
      expect(result).toEqual(mockQuestion);
    });

    it("should handle service errors", async () => {
      const error = new BadRequestException("Validation failed");
      service.create.mockRejectedValue(error);

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
      service.findAll.mockResolvedValue(mockQuestionResponse);

      const result = await controller.findAll(getQuestionsDto);

      expect(service.findAll).toHaveBeenCalledWith(getQuestionsDto);
      expect(result).toEqual(mockQuestionResponse);
    });

    it("should handle service errors", async () => {
      const error = new BadRequestException("Invalid query parameters");
      service.findAll.mockRejectedValue(error);

      await expect(controller.findAll(getQuestionsDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.findAll).toHaveBeenCalledWith(getQuestionsDto);
    });

    it("should work with minimal query parameters", async () => {
      const minimalQuery: GetQuestionsDto = {};
      service.findAll.mockResolvedValue(mockQuestionResponse);

      const result = await controller.findAll(minimalQuery);

      expect(service.findAll).toHaveBeenCalledWith(minimalQuery);
      expect(result).toEqual(mockQuestionResponse);
    });
  });

  describe("findOne", () => {
    const questionId = "1";

    it("should return a question by ID successfully", async () => {
      service.findOne.mockResolvedValue(mockQuestion);

      const result = await controller.findOne(questionId);

      expect(service.findOne).toHaveBeenCalledWith(questionId);
      expect(result).toEqual(mockQuestion);
    });

    it("should handle service errors when question not found", async () => {
      const error = new NotFoundException(
        `Question with ID ${questionId} not found`,
      );
      service.findOne.mockRejectedValue(error);

      await expect(controller.findOne(questionId)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.findOne).toHaveBeenCalledWith(questionId);
    });

    it("should handle invalid UUID errors", async () => {
      const invalidId = "invalid-uuid";
      const error = new BadRequestException("Invalid UUID");
      service.findOne.mockRejectedValue(error);

      await expect(controller.findOne(invalidId)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.findOne).toHaveBeenCalledWith(invalidId);
    });
  });

  describe("update", () => {
    const questionId = "1";
    const updateQuestionDto: UpdateQuestionDto = {
      content: "Updated question content",
      difficulty: QuestionDifficulty.MEDIUM,
    };

    it("should update a question successfully", async () => {
      const updatedQuestion = { ...mockQuestion, ...updateQuestionDto };
      service.update.mockResolvedValue(updatedQuestion);

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
      service.update.mockRejectedValue(error);

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
      service.update.mockRejectedValue(error);

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
    const questionId = "1";

    it("should delete a question successfully", async () => {
      service.remove.mockResolvedValue(undefined);

      const result = await controller.remove(questionId);

      expect(service.remove).toHaveBeenCalledWith(questionId);
      expect(result).toBeUndefined();
    });

    it("should handle service errors when question not found", async () => {
      const error = new NotFoundException(
        `Question with ID ${questionId} not found`,
      );
      service.remove.mockRejectedValue(error);

      await expect(controller.remove(questionId)).rejects.toThrow(
        NotFoundException,
      );
      expect(service.remove).toHaveBeenCalledWith(questionId);
    });

    it("should handle invalid UUID errors", async () => {
      const invalidId = "invalid-uuid";
      const error = new BadRequestException("Invalid UUID");
      service.remove.mockRejectedValue(error);

      await expect(controller.remove(invalidId)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.remove).toHaveBeenCalledWith(invalidId);
    });
  });
});
