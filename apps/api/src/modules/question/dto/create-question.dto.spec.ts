import { createQuestionSchema } from "./create-question.dto";
import { QuestionDifficulty, QuestionCategory } from "./get-questions.dto";

describe("CreateQuestionDto", () => {
  it("should validate correctAnswer when it is in options", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(true);
  });

  it("should not validate correctAnswer when it is not in options", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Rome",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("correctAnswer");
    }
  });

  it("should not validate when options is not an array", () => {
    const dto = {
      content: "What is the capital of France?",
      options: "Paris" as unknown as string[],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("options");
    }
  });

  it("should not validate when content is missing", () => {
    const dto = {
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("content");
    }
  });

  it("should not validate when options is missing", () => {
    const dto = {
      content: "What is the capital of France?",
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("options");
    }
  });

  it("should not validate when correctAnswer is missing", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("correctAnswer");
    }
  });

  it("should not validate when difficulty is missing", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("difficulty");
    }
  });

  it("should not validate when options is an empty array", () => {
    const dto = {
      content: "What is the capital of France?",
      options: [],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("options");
    }
  });

  it("should not validate when correctAnswer is an empty string", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("correctAnswer");
    }
  });

  it("should not validate when options contains duplicate values", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Paris", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("options");
    }
  });

  it("should not validate when content is shorter than 10 characters", () => {
    const dto = {
      content: "Short",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
      category: QuestionCategory.GEOGRAPHY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("content");
    }
  });

  it("should not validate when category is missing", () => {
    const dto = {
      content: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris",
      difficulty: QuestionDifficulty.EASY,
    };

    const result = createQuestionSchema.safeParse(dto);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toContain("category");
    }
  });
});
