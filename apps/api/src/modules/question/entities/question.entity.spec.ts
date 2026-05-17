import { Question } from "./question.entity";
import { QuestionDifficulty } from "../dto/get-questions.dto";
import { describe, it, expect } from "vitest";

describe("Question Entity", () => {
  it("should instantiate correctly and preserve properties", () => {
    const question = new Question();
    const now = new Date();

    question.id = "clx123abc";
    question.content = "What is the capital of France?";
    question.options = ["Paris", "London", "Berlin", "Madrid"];
    question.correctAnswer = "Paris";
    question.difficulty = QuestionDifficulty.EASY;
    question.active = true;
    question.createdAt = now;
    question.updatedAt = now;

    expect(question.id).toBe("clx123abc");
    expect(question.content).toBe("What is the capital of France?");
    expect(question.options).toEqual(["Paris", "London", "Berlin", "Madrid"]);
    expect(question.correctAnswer).toBe("Paris");
    expect(question.difficulty).toBe(QuestionDifficulty.EASY);
    expect(question.active).toBe(true);
    expect(question.createdAt).toBe(now);
    expect(question.updatedAt).toBe(now);
  });
});
