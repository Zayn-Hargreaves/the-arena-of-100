import { describe, it, expect } from "vitest";
import {
  DAILY_QUESTION_COUNT,
  MAX_RESPONSE_TIME_MS,
  dailyLeaderboardQuerySchema,
  dailySubmitSchema,
  dateKeySchema,
  publicQuestionSchema,
  storedDailyQuestionsSchema,
} from "./index";

describe("daily DTO schemas", () => {
  describe("dateKeySchema", () => {
    it("accepts a YYYY-MM-DD key", () => {
      expect(dateKeySchema.parse("2026-08-09")).toBe("2026-08-09");
    });

    it.each(["2026-8-9", "09-08-2026", "2026/08/09", "today", ""])(
      "rejects %s",
      (value) => {
        expect(dateKeySchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe("storedDailyQuestionsSchema", () => {
    const question = {
      content: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      difficulty: "EASY",
      category: "SCIENCE",
    };

    it(`requires exactly ${DAILY_QUESTION_COUNT} questions`, () => {
      const five = Array.from({ length: DAILY_QUESTION_COUNT }, () => question);
      expect(storedDailyQuestionsSchema.safeParse(five).success).toBe(true);

      expect(
        storedDailyQuestionsSchema.safeParse(five.slice(0, 4)).success,
      ).toBe(false);
      expect(
        storedDailyQuestionsSchema.safeParse([...five, question]).success,
      ).toBe(false);
    });

    it("rejects a question with fewer than two options", () => {
      const broken = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        ...question,
        options: ["only-one"],
      }));

      expect(storedDailyQuestionsSchema.safeParse(broken).success).toBe(false);
    });

    it("rejects an unknown difficulty", () => {
      const broken = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        ...question,
        difficulty: "IMPOSSIBLE",
      }));

      expect(storedDailyQuestionsSchema.safeParse(broken).success).toBe(false);
    });
  });

  describe("publicQuestionSchema", () => {
    it("drops correctAnswer and explanation", () => {
      const parsed = publicQuestionSchema.parse({
        content: "Q",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "EASY",
        category: "SCIENCE",
        explanation: "secret",
      });

      expect(parsed).not.toHaveProperty("correctAnswer");
      expect(parsed).not.toHaveProperty("explanation");
    });
  });

  describe("dailySubmitSchema", () => {
    const answer = { answer: "A", responseTimeMs: 1000 };

    it(`requires exactly ${DAILY_QUESTION_COUNT} answers`, () => {
      const answers = Array.from(
        { length: DAILY_QUESTION_COUNT },
        () => answer,
      );
      expect(dailySubmitSchema.safeParse({ answers }).success).toBe(true);
      expect(
        dailySubmitSchema.safeParse({ answers: answers.slice(0, 3) }).success,
      ).toBe(false);
    });

    it("accepts an empty answer as a deliberate skip", () => {
      const answers = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        answer: "",
        responseTimeMs: 0,
      }));

      expect(dailySubmitSchema.safeParse({ answers }).success).toBe(true);
    });

    it("rejects a negative or over-long responseTimeMs", () => {
      const withTime = (responseTimeMs: number) => ({
        answers: Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
          answer: "A",
          responseTimeMs,
        })),
      });

      expect(dailySubmitSchema.safeParse(withTime(-1)).success).toBe(false);
      expect(
        dailySubmitSchema.safeParse(withTime(MAX_RESPONSE_TIME_MS + 1)).success,
      ).toBe(false);
      expect(
        dailySubmitSchema.safeParse(withTime(MAX_RESPONSE_TIME_MS)).success,
      ).toBe(true);
    });

    it("rejects an answer longer than the option cap", () => {
      const answers = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        answer: "x".repeat(501),
        responseTimeMs: 0,
      }));

      expect(dailySubmitSchema.safeParse({ answers }).success).toBe(false);
    });
  });

  describe("dailyLeaderboardQuerySchema", () => {
    it("defaults limit to 50 and leaves dateKey optional", () => {
      expect(dailyLeaderboardQuerySchema.parse({})).toEqual({ limit: 50 });
    });

    it("coerces a numeric string limit", () => {
      expect(dailyLeaderboardQuerySchema.parse({ limit: "25" }).limit).toBe(25);
    });

    it("rejects a limit outside 1..100", () => {
      expect(dailyLeaderboardQuerySchema.safeParse({ limit: 0 }).success).toBe(
        false,
      );
      expect(
        dailyLeaderboardQuerySchema.safeParse({ limit: 101 }).success,
      ).toBe(false);
    });

    it("rejects a malformed dateKey", () => {
      expect(
        dailyLeaderboardQuerySchema.safeParse({ dateKey: "2026-8-9" }).success,
      ).toBe(false);
    });
  });
});
