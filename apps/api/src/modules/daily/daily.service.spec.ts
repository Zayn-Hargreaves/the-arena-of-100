import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DailyService,
  DAILY_SCORE_BASE_CORRECT,
  DAILY_SPEED_BONUS_DIVISOR,
  DAILY_SPEED_BONUS_WINDOW_MS,
  DAILY_STREAK_BONUS_CAP,
  DAILY_STREAK_BONUS_PER_DAY,
} from "./daily.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

const QUESTIONS = [
  {
    content: "Q1",
    options: ["A", "B"],
    correctAnswer: "A",
    difficulty: "EASY" as const,
    category: "SCIENCE",
    explanation: "because A",
  },
  {
    content: "Q2",
    options: ["A", "B"],
    correctAnswer: "B",
    difficulty: "EASY" as const,
    category: "SCIENCE",
  },
  {
    content: "Q3",
    options: ["A", "B"],
    correctAnswer: "A",
    difficulty: "MEDIUM" as const,
    category: "HISTORY",
  },
  {
    content: "Q4",
    options: ["A", "B"],
    correctAnswer: "B",
    difficulty: "MEDIUM" as const,
    category: "HISTORY",
  },
  {
    content: "Q5",
    options: ["A", "B"],
    correctAnswer: "A",
    difficulty: "HARD" as const,
    category: "LOGIC",
  },
];

/** Answers that grade to a perfect 5/5, with zero speed bonus. */
const ALL_CORRECT = [
  { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
  { answer: "B", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
  { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
  { answer: "B", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
  { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
];

describe("DailyService", () => {
  let service: DailyService;
  let prisma: {
    dailyQuestion: { findFirst: any };
    dailyAttempt: { count: any; create: any; findUnique: any };
    $queryRaw: any;
  };
  let redis: { getJSON: any; setJSON: any; del: any };

  beforeEach(() => {
    prisma = {
      dailyQuestion: { findFirst: vi.fn() },
      dailyAttempt: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
      $queryRaw: vi.fn(),
    };
    redis = { getJSON: vi.fn(), setJSON: vi.fn(), del: vi.fn() };
    service = new DailyService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );

    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------

  describe("date helpers", () => {
    it("derives the UTC dateKey", () => {
      expect(service.toDateKey(new Date("2026-08-09T23:59:59.999Z"))).toBe(
        "2026-08-09",
      );
    });

    it("uses the UTC day even when local time is a day ahead", () => {
      // 00:30 on the 10th in UTC+7 is still the 9th in UTC.
      expect(service.toDateKey(new Date("2026-08-09T17:30:00.000Z"))).toBe(
        "2026-08-09",
      );
    });

    it("returns the next UTC midnight as the reset boundary", () => {
      expect(
        service.nextResetAt(new Date("2026-08-09T10:00:00.000Z")).toISOString(),
      ).toBe("2026-08-10T00:00:00.000Z");
    });

    it("rolls the reset forward across a month boundary", () => {
      expect(
        service.nextResetAt(new Date("2026-08-31T23:00:00.000Z")).toISOString(),
      ).toBe("2026-09-01T00:00:00.000Z");
    });
  });

  // ---------------------------------------------------------
  // getToday
  // ---------------------------------------------------------

  describe("getToday", () => {
    beforeEach(() => {
      prisma.dailyQuestion.findFirst.mockResolvedValue({
        dateKey: "2026-08-09",
        questions: QUESTIONS,
        active: true,
      });
    });

    it("strips correctAnswer and explanation from every question", async () => {
      prisma.dailyAttempt.count.mockResolvedValue(0);

      const result = await service.getToday("user-1");

      expect(result.questions).toHaveLength(5);
      for (const question of result.questions) {
        expect(question).not.toHaveProperty("correctAnswer");
        expect(question).not.toHaveProperty("explanation");
        expect(question.options.length).toBeGreaterThan(0);
      }
    });

    it("reports alreadyAttempted=true when the user has submitted", async () => {
      prisma.dailyAttempt.count.mockResolvedValue(1);

      const result = await service.getToday("user-1");

      expect(result.alreadyAttempted).toBe(true);
    });

    it("skips the attempt lookup entirely for anonymous callers", async () => {
      const result = await service.getToday(undefined);

      expect(result.alreadyAttempted).toBe(false);
      expect(prisma.dailyAttempt.count).not.toHaveBeenCalled();
    });

    it("throws 404 when no set is configured for today", async () => {
      prisma.dailyQuestion.findFirst.mockResolvedValue(null);

      await expect(service.getToday("user-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws 404 rather than leaking a malformed stored set", async () => {
      prisma.dailyQuestion.findFirst.mockResolvedValue({
        dateKey: "2026-08-09",
        questions: [{ content: "broken" }],
        active: true,
      });

      await expect(service.getToday("user-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------
  // submit
  // ---------------------------------------------------------

  describe("submit", () => {
    beforeEach(() => {
      prisma.dailyQuestion.findFirst.mockResolvedValue({
        dateKey: "2026-08-09",
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date("2026-08-09T10:00:00.000Z"),
      }));
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    });

    it("grades every answer and reveals the correct answer", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit("user-1", {
        answers: [
          { answer: "A", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 }, // wrong
          { answer: "A", responseTimeMs: 1000 },
          { answer: "B", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
        ],
      });

      expect(result.correctCount).toBe(4);
      expect(result.totalQuestions).toBe(5);
      expect(result.results[1]).toMatchObject({
        answer: "A",
        isCorrect: false,
        correctAnswer: "B",
      });
      expect(result.results[0].explanation).toBe("because A");
    });

    it("accepts answers that differ only by case or padding", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit("user-1", {
        answers: [
          { answer: "  a  ", responseTimeMs: 1000 },
          { answer: "b", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
          { answer: "B", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
        ],
      });

      expect(result.correctCount).toBe(5);
    });

    it("awards base + speed bonus for each correct answer", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit("user-1", {
        answers: [
          { answer: "A", responseTimeMs: 0 }, // full speed bonus
          { answer: "A", responseTimeMs: 0 }, // wrong -> 0
          { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
          { answer: "A", responseTimeMs: 0 }, // wrong -> 0
          { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
        ],
      });

      const fullBonus = Math.floor(
        DAILY_SPEED_BONUS_WINDOW_MS / DAILY_SPEED_BONUS_DIVISOR,
      );
      // 3 correct: one at full bonus, two with the window exhausted.
      expect(result.correctCount).toBe(3);
      expect(result.score).toBe(DAILY_SCORE_BASE_CORRECT * 3 + fullBonus);
    });

    it("grants no speed bonus once the window is exceeded", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit("user-1", {
        answers: ALL_CORRECT.map((a) => ({
          ...a,
          responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS * 2,
        })),
      });

      // Perfect set with a first-ever streak of 1.
      expect(result.score).toBe(
        DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
      );
    });

    describe("streak", () => {
      it("starts at 1 on a first perfect run", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        const result = await service.submit("user-1", { answers: ALL_CORRECT });

        expect(result.streakBefore).toBe(0);
        expect(result.streakAfter).toBe(1);
      });

      it("continues from yesterday's streak", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 4 });

        const result = await service.submit("user-1", { answers: ALL_CORRECT });

        expect(result.streakBefore).toBe(4);
        expect(result.streakAfter).toBe(5);
        expect(prisma.dailyAttempt.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              dateKey_userId: { dateKey: "2026-08-08", userId: "user-1" },
            },
          }),
        );
      });

      it("resets to 0 on any wrong answer", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 9 });

        const result = await service.submit("user-1", {
          answers: [
            { answer: "A", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 }, // wrong
            { answer: "A", responseTimeMs: 1000 },
            { answer: "B", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 },
          ],
        });

        expect(result.streakBefore).toBe(9);
        expect(result.streakAfter).toBe(0);
      });

      it("treats a gap day as a broken streak", async () => {
        // No attempt row for yesterday -> nothing to continue from.
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        const result = await service.submit("user-1", { answers: ALL_CORRECT });

        expect(result.streakBefore).toBe(0);
      });

      it("caps the streak bonus", async () => {
        const hugeStreak =
          DAILY_STREAK_BONUS_CAP / DAILY_STREAK_BONUS_PER_DAY + 10;
        prisma.dailyAttempt.findUnique.mockResolvedValue({
          streakAfter: hugeStreak,
        });

        const result = await service.submit("user-1", { answers: ALL_CORRECT });

        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_CAP,
        );
      });

      it("applies no streak bonus on an imperfect run", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });

        const result = await service.submit("user-1", {
          answers: [
            { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
            { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS }, // wrong
            { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
            { answer: "B", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
            { answer: "A", responseTimeMs: DAILY_SPEED_BONUS_WINDOW_MS },
          ],
        });

        expect(result.score).toBe(DAILY_SCORE_BASE_CORRECT * 4);
      });
    });

    it("rejects a second attempt for the same day with 409", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);
      prisma.dailyAttempt.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "7.8.0",
        }),
      );

      await expect(
        service.submit("user-1", { answers: ALL_CORRECT }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("propagates non-unique Prisma errors untouched", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);
      const failure = new Prisma.PrismaClientKnownRequestError("boom", {
        code: "P2003",
        clientVersion: "7.8.0",
      });
      prisma.dailyAttempt.create.mockRejectedValue(failure);

      await expect(
        service.submit("user-1", { answers: ALL_CORRECT }),
      ).rejects.toBe(failure);
    });

    it("persists answers without leaking the correct answer into storage", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      await service.submit("user-1", { answers: ALL_CORRECT });

      const persisted = prisma.dailyAttempt.create.mock.calls[0][0].data;
      expect(persisted.answers).toHaveLength(5);
      for (const entry of persisted.answers) {
        expect(entry).not.toHaveProperty("correctAnswer");
        expect(entry).toHaveProperty("isCorrect");
      }
    });

    it("still succeeds when leaderboard cache eviction fails", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);
      redis.del.mockRejectedValue(new Error("redis down"));

      await expect(
        service.submit("user-1", { answers: ALL_CORRECT }),
      ).resolves.toMatchObject({ correctCount: 5 });
    });
  });

  // ---------------------------------------------------------
  // getLeaderboard
  // ---------------------------------------------------------

  describe("getLeaderboard", () => {
    it("returns the cached payload and skips the DB", async () => {
      const cached = {
        dateKey: "2026-08-09",
        generatedAt: "2026-08-09T10:00:00.000Z",
        items: [],
      };
      redis.getJSON.mockResolvedValue(cached);

      const result = await service.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 50,
      });

      expect(result).toEqual({ ...cached, cached: true });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(redis.getJSON).toHaveBeenCalledWith(
        "daily:leaderboard:2026-08-09:limit=50",
      );
    });

    it("computes ranks from the DB on a cache miss and writes through", async () => {
      redis.getJSON.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          score: 900,
          correct_count: 5,
          streak_after: 3,
          completed_at: new Date("2026-08-09T09:00:00.000Z"),
        },
        {
          user_id: "u2",
          username: "Bob",
          avatar: "otter",
          score: 700,
          correct_count: 4,
          streak_after: 0,
          completed_at: new Date("2026-08-09T09:30:00.000Z"),
        },
      ]);

      const result = await service.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 50,
      });

      expect(result.cached).toBe(false);
      expect(result.items.map((i) => i.rank)).toEqual([1, 2]);
      expect(result.items[0]).toMatchObject({ userId: "u1", score: 900 });
      expect(redis.setJSON).toHaveBeenCalledWith(
        "daily:leaderboard:2026-08-09:limit=50",
        expect.objectContaining({ dateKey: "2026-08-09" }),
        60,
      );
    });

    it("coerces bigint columns coming back from raw SQL", async () => {
      redis.getJSON.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          score: BigInt(900),
          correct_count: BigInt(5),
          streak_after: BigInt(3),
          completed_at: new Date("2026-08-09T09:00:00.000Z"),
        },
      ]);

      const result = await service.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 50,
      });

      expect(result.items[0].score).toBe(900);
      expect(typeof result.items[0].score).toBe("number");
    });

    it("defaults to today when no dateKey is supplied", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
      redis.getJSON.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getLeaderboard({ limit: 50 });

      expect(result.dateKey).toBe("2026-08-09");
    });

    it("falls back to the DB when the cache read throws", async () => {
      redis.getJSON.mockRejectedValue(new Error("redis down"));
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 50,
      });

      expect(result.cached).toBe(false);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("still returns data when the cache write throws", async () => {
      redis.getJSON.mockResolvedValue(null);
      redis.setJSON.mockRejectedValue(new Error("redis down"));
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.getLeaderboard({ dateKey: "2026-08-09", limit: 50 }),
      ).resolves.toMatchObject({ cached: false });
    });
  });
});
