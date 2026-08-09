import { describe, it, expect } from "vitest";
import {
  DAILY_LEADERBOARD_DEFAULT_LIMIT,
  DAILY_QUESTION_COUNT,
  MAX_RESPONSE_TIME_MS,
  DailyAnswerInputDto,
  DailyAnswerResultDto,
  DailyLeaderboardItemDto,
  DailyLeaderboardQueryDto,
  DailyLeaderboardResponseDto,
  DailySubmitDto,
  DailySubmitResponseDto,
  DailyTodayResponseDto,
  PublicDailyQuestionDto,
  dailyAnswerInputSchema,
  dailyAnswerResultSchema,
  dailyLeaderboardItemSchema,
  dailyLeaderboardQuerySchema,
  dailyLeaderboardResponseSchema,
  dailySubmitResponseSchema,
  dailySubmitSchema,
  dailyTodayResponseSchema,
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

  // The response schemas are what the controller advertises and what any
  // consumer decodes against. Parsing a representative payload here pins the
  // contract, so a field rename or a loosened constraint fails a test instead
  // of silently reshaping the API.
  describe("response schemas", () => {
    const publicQuestion = {
      content: "Which planet is closest to the Sun?",
      options: ["Mercury", "Venus"],
      difficulty: "EASY" as const,
      category: "SCIENCE",
    };

    it("dailyTodayResponseSchema accepts a full today payload", () => {
      const parsed = dailyTodayResponseSchema.parse({
        dateKey: "2026-08-09",
        version: 1,
        questions: Array.from(
          { length: DAILY_QUESTION_COUNT },
          () => publicQuestion,
        ),
        sessionToken: "tok",
        serverTime: "2026-08-09T10:15:00.000Z",
        nextResetAt: "2026-08-10T00:00:00.000Z",
        alreadyAttempted: false,
      });

      expect(parsed.questions).toHaveLength(DAILY_QUESTION_COUNT);
      expect(parsed.questions[0]).not.toHaveProperty("correctAnswer");
    });

    it("dailyTodayResponseSchema rejects a non-positive version", () => {
      expect(
        dailyTodayResponseSchema.safeParse({
          dateKey: "2026-08-09",
          version: 0,
          questions: [],
          sessionToken: "tok",
          serverTime: "2026-08-09T10:15:00.000Z",
          nextResetAt: "2026-08-10T00:00:00.000Z",
          alreadyAttempted: false,
        }).success,
      ).toBe(false);
    });

    it("dailyAnswerInputSchema coerces a numeric string responseTimeMs", () => {
      expect(
        dailyAnswerInputSchema.parse({ answer: "A", responseTimeMs: "1500" })
          .responseTimeMs,
      ).toBe(1500);
    });

    it("dailyAnswerResultSchema treats explanation as optional", () => {
      const base = {
        answer: "Mercury",
        isCorrect: true,
        correctAnswer: "Mercury",
        responseTimeMs: 4200,
      };

      expect(dailyAnswerResultSchema.parse(base).explanation).toBeUndefined();
      expect(
        dailyAnswerResultSchema.parse({ ...base, explanation: "why" })
          .explanation,
      ).toBe("why");
    });

    // elapsedMs is nullable on purpose: an unpinned session scores with no
    // speed bonus rather than trusting a client-reported duration.
    it("dailySubmitResponseSchema accepts a null elapsedMs", () => {
      const payload = {
        dateKey: "2026-08-09",
        version: 1,
        score: 850,
        correctCount: 4,
        totalQuestions: DAILY_QUESTION_COUNT,
        elapsedMs: null,
        streakBefore: 3,
        streakAfter: 0,
        results: [],
        completedAt: "2026-08-09T10:15:00.000Z",
      };

      expect(dailySubmitResponseSchema.parse(payload).elapsedMs).toBeNull();
      expect(
        dailySubmitResponseSchema.parse({ ...payload, elapsedMs: 42_000 })
          .elapsedMs,
      ).toBe(42_000);
    });

    it("dailySubmitResponseSchema rejects a negative elapsedMs", () => {
      expect(
        dailySubmitResponseSchema.safeParse({
          dateKey: "2026-08-09",
          version: 1,
          score: 0,
          correctCount: 0,
          totalQuestions: DAILY_QUESTION_COUNT,
          elapsedMs: -1,
          streakBefore: 0,
          streakAfter: 0,
          results: [],
          completedAt: "2026-08-09T10:15:00.000Z",
        }).success,
      ).toBe(false);
    });

    it("dailyLeaderboardItemSchema requires a 1-based rank", () => {
      const item = {
        rank: 1,
        userId: "u1",
        username: "Zero_Cool",
        avatar: "jellyfrog",
        score: 1000,
        correctCount: 5,
        streakAfter: 7,
        completedAt: "2026-08-09T10:15:00.000Z",
      };

      expect(dailyLeaderboardItemSchema.safeParse(item).success).toBe(true);
      expect(
        dailyLeaderboardItemSchema.safeParse({ ...item, rank: 0 }).success,
      ).toBe(false);
    });

    it("dailyLeaderboardResponseSchema accepts an empty board", () => {
      const parsed = dailyLeaderboardResponseSchema.parse({
        dateKey: "2026-08-09",
        generatedAt: "2026-08-09T10:16:00.000Z",
        cached: true,
        items: [],
      });

      expect(parsed.cached).toBe(true);
      expect(parsed.items).toEqual([]);
    });
  });

  // The Swagger DTO classes are the OpenAPI surface: they carry no logic, so
  // the only thing worth asserting is that they instantiate and hold the
  // shape their schema counterpart validates.
  describe("DTO classes", () => {
    it("PublicDailyQuestionDto holds a question without the answer", () => {
      const dto = new PublicDailyQuestionDto();
      dto.content = "Which planet is closest to the Sun?";
      dto.options = ["Mercury", "Venus", "Earth", "Mars"];
      dto.difficulty = "EASY";
      dto.category = "SCIENCE";

      expect(dto.content).toBe("Which planet is closest to the Sun?");
      expect(dto.options).toHaveLength(4);
      expect(dto.difficulty).toBe("EASY");
      expect(dto.category).toBe("SCIENCE");
      expect(dto).not.toHaveProperty("correctAnswer");
    });

    it("DailyTodayResponseDto holds the today payload", () => {
      const question = new PublicDailyQuestionDto();
      question.content = "Q";
      question.options = ["A", "B"];
      question.difficulty = "MEDIUM";
      question.category = "HISTORY";

      const dto = new DailyTodayResponseDto();
      dto.dateKey = "2026-08-09";
      dto.version = 2;
      dto.questions = [question];
      dto.sessionToken = "tok";
      dto.serverTime = "2026-08-09T10:15:00.000Z";
      dto.nextResetAt = "2026-08-10T00:00:00.000Z";
      dto.alreadyAttempted = false;

      expect(dto.dateKey).toBe("2026-08-09");
      expect(dto.version).toBe(2);
      expect(dto.questions[0].content).toBe("Q");
      expect(dto.sessionToken).toBe("tok");
      expect(dto.serverTime).toBe("2026-08-09T10:15:00.000Z");
      expect(dto.nextResetAt).toBe("2026-08-10T00:00:00.000Z");
      expect(dto.alreadyAttempted).toBe(false);

      dto.alreadyAttempted = true;
      expect(dto.alreadyAttempted).toBe(true);
    });

    it("DailyAnswerInputDto holds a submitted answer", () => {
      const dto = new DailyAnswerInputDto();
      dto.answer = "Mercury";
      dto.responseTimeMs = 4200;

      expect(dto.answer).toBe("Mercury");
      expect(dto.responseTimeMs).toBe(4200);
    });

    it("DailySubmitDto holds the token and the answer list", () => {
      const answer = new DailyAnswerInputDto();
      answer.answer = "Mercury";
      answer.responseTimeMs = 4200;

      const dto = new DailySubmitDto();
      dto.sessionToken = "tok";
      dto.answers = [answer];

      expect(dto.sessionToken).toBe("tok");
      expect(dto.answers).toEqual([answer]);
    });

    it("DailyAnswerResultDto holds a graded answer", () => {
      const dto = new DailyAnswerResultDto();
      dto.answer = "Mercury";
      dto.isCorrect = true;
      dto.correctAnswer = "Mercury";
      dto.explanation = "Mercury orbits closest.";
      dto.responseTimeMs = 4200;

      expect(dto.answer).toBe("Mercury");
      expect(dto.isCorrect).toBe(true);
      expect(dto.correctAnswer).toBe("Mercury");
      expect(dto.explanation).toBe("Mercury orbits closest.");
      expect(dto.responseTimeMs).toBe(4200);

      dto.explanation = undefined;
      dto.isCorrect = false;
      expect(dto.explanation).toBeUndefined();
      expect(dto.isCorrect).toBe(false);
    });

    it("DailySubmitResponseDto holds the graded payload", () => {
      const result = new DailyAnswerResultDto();
      result.answer = "Mercury";
      result.isCorrect = true;
      result.correctAnswer = "Mercury";
      result.responseTimeMs = 4200;

      const dto = new DailySubmitResponseDto();
      dto.dateKey = "2026-08-09";
      dto.version = 1;
      dto.score = 850;
      dto.correctCount = 4;
      dto.totalQuestions = DAILY_QUESTION_COUNT;
      dto.elapsedMs = 42_000;
      dto.streakBefore = 3;
      dto.streakAfter = 0;
      dto.results = [result];
      dto.completedAt = "2026-08-09T10:15:00.000Z";

      expect(dto.dateKey).toBe("2026-08-09");
      expect(dto.version).toBe(1);
      expect(dto.score).toBe(850);
      expect(dto.correctCount).toBe(4);
      expect(dto.totalQuestions).toBe(DAILY_QUESTION_COUNT);
      expect(dto.elapsedMs).toBe(42_000);
      expect(dto.streakBefore).toBe(3);
      expect(dto.streakAfter).toBe(0);
      expect(dto.results[0].isCorrect).toBe(true);
      expect(dto.completedAt).toBe("2026-08-09T10:15:00.000Z");

      // An unpinned session reports no duration at all.
      dto.elapsedMs = null;
      expect(dto.elapsedMs).toBeNull();
    });

    it("DailyLeaderboardQueryDto holds the query params", () => {
      const dto = new DailyLeaderboardQueryDto();
      dto.limit = DAILY_LEADERBOARD_DEFAULT_LIMIT;

      expect(dto.dateKey).toBeUndefined();
      expect(dto.limit).toBe(DAILY_LEADERBOARD_DEFAULT_LIMIT);

      dto.dateKey = "2026-08-09";
      dto.limit = 10;
      expect(dto.dateKey).toBe("2026-08-09");
      expect(dto.limit).toBe(10);
    });

    it("DailyLeaderboardItemDto holds a ranked row", () => {
      const dto = new DailyLeaderboardItemDto();
      dto.rank = 1;
      dto.userId = "u1";
      dto.username = "Zero_Cool";
      dto.avatar = "jellyfrog";
      dto.score = 1000;
      dto.correctCount = 5;
      dto.streakAfter = 7;
      dto.completedAt = "2026-08-09T10:15:00.000Z";

      expect(dto.rank).toBe(1);
      expect(dto.userId).toBe("u1");
      expect(dto.username).toBe("Zero_Cool");
      expect(dto.avatar).toBe("jellyfrog");
      expect(dto.score).toBe(1000);
      expect(dto.correctCount).toBe(5);
      expect(dto.streakAfter).toBe(7);
      expect(dto.completedAt).toBe("2026-08-09T10:15:00.000Z");
    });

    it("DailyLeaderboardResponseDto holds the board envelope", () => {
      const item = new DailyLeaderboardItemDto();
      item.rank = 1;

      const dto = new DailyLeaderboardResponseDto();
      dto.dateKey = "2026-08-09";
      dto.generatedAt = "2026-08-09T10:16:00.000Z";
      dto.cached = false;
      dto.items = [item];

      expect(dto.dateKey).toBe("2026-08-09");
      expect(dto.generatedAt).toBe("2026-08-09T10:16:00.000Z");
      expect(dto.cached).toBe(false);
      expect(dto.items).toEqual([item]);

      dto.cached = true;
      dto.items = [];
      expect(dto.cached).toBe(true);
      expect(dto.items).toEqual([]);
    });
  });
});
