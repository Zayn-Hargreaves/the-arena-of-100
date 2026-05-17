import { randomQuerySchema, RandomQueryDto } from "./random-query.dto";
import { QuestionDifficulty } from "./get-questions.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("RandomQueryDto & Schema", () => {
  describe("randomQuerySchema", () => {
    it("should validate an empty query", () => {
      const parsed = randomQuerySchema.parse({});
      expect(parsed).toEqual({});
    });

    it("should validate a correct difficulty", () => {
      const input = { difficulty: QuestionDifficulty.EASY };
      const parsed = randomQuerySchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should preprocess and validate excludeIds string array", () => {
      const input = { excludeIds: ["id1", "id2"] };
      const parsed = randomQuerySchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it("should preprocess and validate comma-separated excludeIds string", () => {
      const input = { excludeIds: "id1, id2,  , id3" };
      const parsed = randomQuerySchema.parse(input);
      expect(parsed.excludeIds).toEqual(["id1", "id2", "id3"]);
    });

    it("should handle empty or falsy excludeIds", () => {
      expect(randomQuerySchema.parse({ excludeIds: "" })).toEqual({});
      expect(randomQuerySchema.parse({ excludeIds: null })).toEqual({});
      expect(randomQuerySchema.parse({ excludeIds: undefined })).toEqual({});
    });

    it("should preprocess invalid excludeIds types to undefined", () => {
      expect(randomQuerySchema.parse({ excludeIds: 123 })).toEqual({});
      expect(randomQuerySchema.parse({ excludeIds: {} })).toEqual({});
    });

    it("should throw if difficulty is invalid", () => {
      const input = { difficulty: "INVALID" };
      expect(() => randomQuerySchema.parse(input)).toThrow(ZodError);
    });
  });

  describe("RandomQueryDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new RandomQueryDto();
      dto.difficulty = QuestionDifficulty.HARD;
      dto.excludeIds = ["id1", "id2"];
      expect(dto.difficulty).toBe(QuestionDifficulty.HARD);
      expect(dto.excludeIds).toEqual(["id1", "id2"]);
    });
  });
});
