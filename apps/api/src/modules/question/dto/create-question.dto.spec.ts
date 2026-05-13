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

  it("should not validate correctAnswer when options is not an array", async () => {
    const dto = new CreateQuestionDto();
    dto.content = "What is the capital of France?";
    dto.options = "Paris" as any; // Invalid type
    dto.correctAnswer = "Paris";
    dto.difficulty = QuestionDifficulty.EASY;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
