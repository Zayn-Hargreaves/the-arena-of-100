import {
  getQuestionsSchema,
  GetQuestionsDto,
  QuestionDifficulty,
} from "./get-questions.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("GetQuestionsDto & Schema", () => {
  describe("getQuestionsSchema", () => {
    it("should validate default page and limit values when empty", () => {
      const parsed = getQuestionsSchema.parse({});
      expect(parsed).toEqual({
        page: 1,
        limit: 20,
        difficulty: undefined,
        search: undefined,
        active: undefined,
      });
    });

    it("should coerce string numbers for page and limit", () => {
      const parsed = getQuestionsSchema.parse({ page: "3", limit: "50" });
      expect(parsed.page).toBe(3);
      expect(parsed.limit).toBe(50);
    });

    it("should throw if page is less than 1 or greater than 1000", () => {
      expect(() => getQuestionsSchema.parse({ page: 0 })).toThrow(ZodError);
      expect(() => getQuestionsSchema.parse({ page: 1001 })).toThrow(ZodError);
    });

    it("should throw if limit is less than 1 or greater than 100", () => {
      expect(() => getQuestionsSchema.parse({ limit: 0 })).toThrow(ZodError);
      expect(() => getQuestionsSchema.parse({ limit: 101 })).toThrow(ZodError);
    });

    it("should validate correct difficulty and search values", () => {
      const input = {
        difficulty: QuestionDifficulty.MEDIUM,
        search: "capital",
      };
      const parsed = getQuestionsSchema.parse(input);
      expect(parsed.difficulty).toBe(QuestionDifficulty.MEDIUM);
      expect(parsed.search).toBe("capital");
    });

    it("should throw if search exceeds 256 characters", () => {
      const input = { search: "a".repeat(257) };
      expect(() => getQuestionsSchema.parse(input)).toThrow(ZodError);
    });

    describe("active status preprocessing", () => {
      it("should coerce 'true' and true to true", () => {
        expect(getQuestionsSchema.parse({ active: "true" }).active).toBe(true);
        expect(getQuestionsSchema.parse({ active: true }).active).toBe(true);
      });

      it("should coerce 'false' and false to false", () => {
        expect(getQuestionsSchema.parse({ active: "false" }).active).toBe(
          false,
        );
        expect(getQuestionsSchema.parse({ active: false }).active).toBe(false);
      });

      it("should ignore empty, null, or undefined values", () => {
        expect(getQuestionsSchema.parse({ active: "" }).active).toBeUndefined();
        expect(
          getQuestionsSchema.parse({ active: null }).active,
        ).toBeUndefined();
        expect(
          getQuestionsSchema.parse({ active: undefined }).active,
        ).toBeUndefined();
      });

      it("should throw error on invalid boolean string", () => {
        expect(() => getQuestionsSchema.parse({ active: "invalid" })).toThrow(
          "Invalid boolean value for active",
        );
      });
    });
  });

  describe("GetQuestionsDto class", () => {
    it("should instantiate correctly and preserve properties", () => {
      const dto = new GetQuestionsDto();
      dto.page = 2;
      dto.limit = 10;
      dto.difficulty = QuestionDifficulty.EASY;
      dto.search = "query";
      dto.active = true;

      expect(dto.page).toBe(2);
      expect(dto.limit).toBe(10);
      expect(dto.difficulty).toBe(QuestionDifficulty.EASY);
      expect(dto.search).toBe("query");
      expect(dto.active).toBe(true);
    });
  });
});
