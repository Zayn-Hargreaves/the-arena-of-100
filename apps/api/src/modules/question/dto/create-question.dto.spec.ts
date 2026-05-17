import { validate } from "class-validator";
import { CreateQuestionDto } from "./create-question.dto";
import { QuestionDifficulty } from "./get-questions.dto";

describe("CreateQuestionDto", () => {
  it("should validate correctAnswer when it is in options", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it("should not validate correctAnswer when it is not in options", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "Rome";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("correctAnswer");
  });

  it("should not validate when options is not an array", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = "Paris" as unknown as string[]; // Invalid type
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const optionsError = errors.find((error) => error.property === "options");
    expect(optionsError).toBeDefined();
    expect(Object.keys(optionsError!.constraints || {}).length).toBeGreaterThan(
      0,
    );
  });

  it("should not validate when content is missing", async () => {
    const dto = new CreateQuestionDto();
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("content");
  });

  it("should not validate when options is missing", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("options");
  });

  it("should not validate when correctAnswer is missing", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("correctAnswer");
  });

  it("should not validate when difficulty is missing", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "Paris";

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("difficulty");
  });

  it("should not validate when options is an empty array", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = [];
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("options");
  });

  it("should not validate when correctAnswer is an empty string", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("correctAnswer");
  });

  it("should not validate when options contains duplicate values", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = ["Paris", "London", "Paris", "Madrid"];
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("options");
  });

  it("should not validate when content is shorter than 10 characters", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "Short";
    dto.options = ["Paris", "London", "Berlin", "Madrid"];
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((error) => error.property === "content");
    expect(contentError).toBeDefined();
    expect(contentError?.constraints?.minLength).toBeDefined();
  });
});
