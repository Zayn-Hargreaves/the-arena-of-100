import { updateQuestionSchema, UpdateQuestionDto } from "./update-question.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("UpdateQuestionDto & Schema", () => {
  describe("updateQuestionSchema", () => {
    it("should validate when both options and correctAnswer are provided, and correctAnswer is in options", () => {
      const input = {
        options: ["Paris", "London", "Berlin", "Madrid"],
        correctAnswer: "Paris",
      };
      const parsed = updateQuestionSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should throw if both options and correctAnswer are provided, but correctAnswer is not in options", () => {
      const input = {
        options: ["Paris", "London", "Berlin", "Madrid"],
        correctAnswer: "Rome",
      };
      expect(() => updateQuestionSchema.parse(input)).toThrow(ZodError);
    });

    it("should validate when only options are provided", () => {
      const input = {
        options: ["Paris", "London"],
      };
      const parsed = updateQuestionSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should validate when only correctAnswer is provided", () => {
      const input = {
        correctAnswer: "Paris",
      };
      const parsed = updateQuestionSchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should validate when neither is provided (empty update)", () => {
      const parsed = updateQuestionSchema.parse({});
      expect(parsed).toEqual({});
    });
  });

  describe("UpdateQuestionDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new UpdateQuestionDto();
      dto.content = "What is the capital of Germany?";
      expect(dto.content).toBe("What is the capital of Germany?");
    });
  });
});
