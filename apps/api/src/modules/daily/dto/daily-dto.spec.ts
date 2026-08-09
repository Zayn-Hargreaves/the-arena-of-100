import { describe, it, expect } from "vitest";
import {
  DAILY_LEADERBOARD_DEFAULT_LIMIT,
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

    // Well-shaped but impossible dates: Date.parse silently rolls these
    // forward (2026-02-30 -> Mar 2), so the regex alone is not enough.
    it.each([
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2025-02-29",
      "2026-01-32",
    ])("rejects the impossible date %s", (value) => {
      expect(dateKeySchema.safeParse(value).success).toBe(false);
    });

    it("accepts Feb 29 in a real leap year", () => {
      expect(dateKeySchema.safeParse("2028-02-29").success).toBe(true);
    });
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

    // A correctAnswer outside options makes the question unanswerable: every
    // player would be graded wrong no matter what they pick.
    it("rejects a correctAnswer that is not one of the options", () => {
      const broken = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        ...question,
        options: ["A", "B"],
        correctAnswer: "C",
      }));

      const result = storedDailyQuestionsSchema.safeParse(broken);
      expect(result.success).toBe(false);
    });

    it("rejects a correctAnswer differing from an option only by case", () => {
      const broken = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        ...question,
        options: ["Hà Nội", "Huế"],
        correctAnswer: "hà nội",
      }));

      expect(storedDailyQuestionsSchema.safeParse(broken).success).toBe(false);
    });

    it("accepts a correctAnswer present in options", () => {
      const valid = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        ...question,
        options: ["A", "B", "C"],
        correctAnswer: "C",
      }));

      expect(storedDailyQuestionsSchema.safeParse(valid).success).toBe(true);
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
    const wrapped = (answers: unknown) => ({ sessionToken: "tok", answers });

    it(`requires exactly ${DAILY_QUESTION_COUNT} answers`, () => {
      const answers = Array.from(
        { length: DAILY_QUESTION_COUNT },
        () => answer,
      );
      expect(dailySubmitSchema.safeParse(wrapped(answers)).success).toBe(true);
      expect(
        dailySubmitSchema.safeParse(wrapped(answers.slice(0, 3))).success,
      ).toBe(false);
    });

    it("requires a sessionToken", () => {
      const answers = Array.from(
        { length: DAILY_QUESTION_COUNT },
        () => answer,
      );
      expect(dailySubmitSchema.safeParse({ answers }).success).toBe(false);
      expect(
        dailySubmitSchema.safeParse({ sessionToken: "", answers }).success,
      ).toBe(false);
    });

    it("accepts an empty answer as a deliberate skip", () => {
      const answers = Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
        answer: "",
        responseTimeMs: 0,
      }));

      expect(dailySubmitSchema.safeParse(wrapped(answers)).success).toBe(true);
    });

    it("rejects a negative or over-long responseTimeMs", () => {
      const withTime = (responseTimeMs: number) =>
        wrapped(
          Array.from({ length: DAILY_QUESTION_COUNT }, () => ({
            answer: "A",
            responseTimeMs,
          })),
        );

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

      expect(dailySubmitSchema.safeParse(wrapped(answers)).success).toBe(false);
    });
  });

  describe("dailyLeaderboardQuerySchema", () => {
    it("defaults limit to the shared constant and leaves dateKey optional", () => {
      expect(dailyLeaderboardQuerySchema.parse({})).toEqual({
        limit: DAILY_LEADERBOARD_DEFAULT_LIMIT,
      });
    });

    // The service evicts exactly the key built from this default, so the two
    // must stay in lockstep — a literal in either place would silently drift.
    it("keeps the default in sync with the cache-invalidation constant", () => {
      expect(DAILY_LEADERBOARD_DEFAULT_LIMIT).toBe(50);
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

    // The leaderboard query reuses dateKeySchema, so calendar validation must
    // apply here too — not just to the stored question set.
    it("rejects an impossible dateKey", () => {
      expect(
        dailyLeaderboardQuerySchema.safeParse({ dateKey: "2026-02-30" })
          .success,
      ).toBe(false);
    });
  });
});
