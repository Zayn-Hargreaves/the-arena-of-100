import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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
import { AuthService } from "../auth/auth.service";

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

/** Answers that grade to a perfect 5/5. Client times are ignored by scoring. */
const ALL_CORRECT = [
  { answer: "A", responseTimeMs: 1000 },
  { answer: "B", responseTimeMs: 1000 },
  { answer: "A", responseTimeMs: 1000 },
  { answer: "B", responseTimeMs: 1000 },
  { answer: "A", responseTimeMs: 1000 },
];

const NOW_ISO = "2026-08-09T10:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const QUESTION_SET_ID = "dq-v1";

/** Builds a submit payload; `sessionToken` is stubbed by the AuthService mock. */
function submitInput(
  answers: Array<{ answer: string; responseTimeMs: number }> = ALL_CORRECT,
) {
  return { sessionToken: "valid-token", answers };
}

describe("DailyService", () => {
  let service: DailyService;
  let prisma: {
    dailyQuestion: { findFirst: any; findUnique: any };
    dailyAttempt: { count: any; create: any; findUnique: any };
    userCardVariant: { findMany: any; upsert: any };
    pendingCardVariantUnlock: {
      create: any;
      findMany: any;
      update: any;
    };
    $queryRaw: any;
    // Phase 3 — the cosmetic unlock + drain now run AFTER the
    // attempt-create transaction commits, so they invoke the same
    // top-level `prisma` methods the tests mock. The `$transaction`
    // mock only needs to wrap `dailyAttempt.create`; passing it
    // through means every assertion (`expect(prisma.userCardVariant
    // .upsert)…`, `prisma.pendingCardVariantUnlock.create…`,
    // `prisma.pendingCardVariantUnlock.update…`) still observes the
    // call without per-test rewrites.
    $transaction: any;
  };
  let redis: {
    getJSON: any;
    setJSON: any;
    del: any;
    setIfAbsent: any;
    get: any;
  };
  let auth: { signDailySession: any; verifyDailySession: any };

  /** Points the session token at a pinned start (drives elapsedMs). */
  function startedAt(
    msSinceEpoch: number | null,
    overrides: Record<string, any> = {},
  ) {
    auth.verifyDailySession.mockReturnValue({
      sub: "user-1",
      dateKey: "2026-08-09",
      dailyQuestionId: QUESTION_SET_ID,
      startedAtMs: msSinceEpoch,
      iat: Math.floor(NOW_MS / 1000),
      ...overrides,
    });
  }

  beforeEach(() => {
    prisma = {
      dailyQuestion: { findFirst: vi.fn(), findUnique: vi.fn() },
      dailyAttempt: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
      userCardVariant: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      pendingCardVariantUnlock: {
        create: vi.fn().mockResolvedValue({}),
        // Default: no pending rows. Tests that exercise the drainer
        // override this with a pre-seeded row.
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn(),
      $transaction: vi
        .fn()
        .mockImplementation(async (cb: any) =>
          typeof cb === "function" ? cb(prisma) : Promise.all(cb),
        ),
    };
    redis = {
      getJSON: vi.fn(),
      setJSON: vi.fn(),
      del: vi.fn(),
      // Default: this fetch is the first of the day, so it wins the pin.
      setIfAbsent: vi.fn().mockResolvedValue(true),
      get: vi.fn(),
    };
    auth = {
      signDailySession: vi.fn().mockReturnValue("signed-session-token"),
      verifyDailySession: vi.fn(),
    };
    service = new DailyService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      auth as unknown as AuthService,
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
      // Pin the clock: the served dateKey (and therefore the token claims)
      // must be deterministic, not whatever day the suite happens to run on.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));
      prisma.dailyQuestion.findFirst.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
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

    it("serves the newest version and issues a bound session token", async () => {
      prisma.dailyAttempt.count.mockResolvedValue(0);

      const result = await service.getToday("user-1");

      expect(result.version).toBe(1);
      expect(result.sessionToken).toBe("signed-session-token");
      // The token must pin the exact version served, or grading could drift.
      expect(auth.signDailySession).toHaveBeenCalledWith({
        sub: "user-1",
        dateKey: "2026-08-09",
        dailyQuestionId: QUESTION_SET_ID,
        startedAtMs: NOW_MS,
      });
      // Newest-first: a later version must win.
      expect(prisma.dailyQuestion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { version: "desc" } }),
      );
    });

    // ---- session-start pinning (anti-reissue) ----
    describe("session start pinning", () => {
      it("pins the start atomically on the first fetch of the day", async () => {
        prisma.dailyAttempt.count.mockResolvedValue(0);

        await service.getToday("user-1");

        // SET NX, so two concurrent fetches cannot both claim a start.
        expect(redis.setIfAbsent).toHaveBeenCalledWith(
          "daily:session:user-1:2026-08-09",
          String(NOW_MS),
          expect.any(Number),
        );
      });

      it("reuses the original start when the questions are re-fetched", async () => {
        prisma.dailyAttempt.count.mockResolvedValue(0);
        const originalStart = NOW_MS - 60_000;
        // Pin already exists -> SET NX loses, we read the earlier value back.
        redis.setIfAbsent.mockResolvedValue(false);
        redis.get.mockResolvedValue(String(originalStart));

        await service.getToday("user-1");

        // Crucially NOT NOW_MS: re-fetching must not reset the clock.
        expect(auth.signDailySession).toHaveBeenCalledWith(
          expect.objectContaining({ startedAtMs: originalStart }),
        );
      });

      it("does not pin for anonymous callers", async () => {
        await service.getToday(undefined);

        expect(redis.setIfAbsent).not.toHaveBeenCalled();
        expect(auth.signDailySession).toHaveBeenCalledWith(
          expect.objectContaining({ sub: "anon", startedAtMs: null }),
        );
      });

      it("fails closed when the session store is unavailable", async () => {
        prisma.dailyAttempt.count.mockResolvedValue(0);
        redis.setIfAbsent.mockRejectedValue(new Error("redis down"));

        await service.getToday("user-1");

        // null start -> no speed bonus, rather than a resettable fallback.
        expect(auth.signDailySession).toHaveBeenCalledWith(
          expect.objectContaining({ startedAtMs: null }),
        );
      });

      // ioredis can reject with a non-Error value; the handler must still
      // produce a log line instead of throwing on `.message` of a string.
      it("fails closed when the session store rejects with a non-Error", async () => {
        prisma.dailyAttempt.count.mockResolvedValue(0);
        redis.setIfAbsent.mockRejectedValue("connection reset");

        await service.getToday("user-1");

        expect(auth.signDailySession).toHaveBeenCalledWith(
          expect.objectContaining({ startedAtMs: null }),
        );
      });

      it("fails closed when the stored pin is unreadable", async () => {
        prisma.dailyAttempt.count.mockResolvedValue(0);
        redis.setIfAbsent.mockResolvedValue(false);
        redis.get.mockResolvedValue("not-a-number");

        await service.getToday("user-1");

        expect(auth.signDailySession).toHaveBeenCalledWith(
          expect.objectContaining({ startedAtMs: null }),
        );
      });
    });

    it("issues an anon-scoped token when unauthenticated", async () => {
      await service.getToday(undefined);

      expect(auth.signDailySession).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "anon" }),
      );
    });

    it("reports alreadyAttempted=true when the user has submitted", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 4 });

      const result = await service.getToday("user-1");

      expect(prisma.dailyAttempt.findUnique).toHaveBeenCalledWith({
        where: {
          dateKey_userId: {
            dateKey: "2026-08-09",
            userId: "user-1",
          },
        },
        select: { streakAfter: true },
      });
      expect(result.alreadyAttempted).toBe(true);
      expect(result.currentStreak).toBe(4);
    });

    it("skips the attempt lookup entirely for anonymous callers", async () => {
      const result = await service.getToday(undefined);

      expect(result.alreadyAttempted).toBe(false);
      expect(prisma.dailyAttempt.findUnique).not.toHaveBeenCalled();
    });

    it("throws 404 when no set is configured for today", async () => {
      prisma.dailyQuestion.findFirst.mockResolvedValue(null);

      await expect(service.getToday("user-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("throws 404 rather than leaking a malformed stored set", async () => {
      prisma.dailyQuestion.findFirst.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
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
      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));
      // Default: token issued exactly at "now" -> elapsedMs 0, full bonus.
      startedAt(NOW_MS);
    });

    it("grades every answer and reveals the correct answer", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit(
        "user-1",
        submitInput([
          { answer: "A", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 }, // wrong
          { answer: "A", responseTimeMs: 1000 },
          { answer: "B", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
        ]),
      );

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

      const result = await service.submit(
        "user-1",
        submitInput([
          { answer: "  a  ", responseTimeMs: 1000 },
          { answer: "b", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
          { answer: "B", responseTimeMs: 1000 },
          { answer: "A", responseTimeMs: 1000 },
        ]),
      );

      expect(result.correctCount).toBe(5);
    });

    // ---- server-authoritative timing (anti-cheat) ----
    describe("scoring uses server-measured time only", () => {
      const fullBonus = Math.floor(
        DAILY_SPEED_BONUS_WINDOW_MS / DAILY_SPEED_BONUS_DIVISOR,
      );

      it("ignores forged client responseTimeMs entirely", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        // Session actually took the full window -> zero speed bonus...
        startedAt(NOW_MS - DAILY_SPEED_BONUS_WINDOW_MS);

        // ...while the client claims every answer was instant.
        const cheated = await service.submit(
          "user-1",
          submitInput(ALL_CORRECT.map((a) => ({ ...a, responseTimeMs: 0 }))),
        );

        // Base + streak only. The forged zeros buy nothing.
        expect(cheated.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      it("produces the same score regardless of client-reported times", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS - 10_000);

        const honest = await service.submit(
          "user-1",
          submitInput(
            ALL_CORRECT.map((a) => ({ ...a, responseTimeMs: 9_000 })),
          ),
        );
        const forged = await service.submit(
          "user-1",
          submitInput(ALL_CORRECT.map((a) => ({ ...a, responseTimeMs: 0 }))),
        );

        expect(forged.score).toBe(honest.score);
      });

      it("awards the full speed bonus for an instant session", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS);

        const result = await service.submit("user-1", submitInput());

        expect(result.elapsedMs).toBe(0);
        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + fullBonus + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      it("grants no speed bonus once the session window is exceeded", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS - DAILY_SPEED_BONUS_WINDOW_MS * 2);

        const result = await service.submit("user-1", submitInput());

        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      it("clamps a backwards clock step to zero elapsed", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        // Token issued "in the future" (NTP correction mid-session).
        startedAt(NOW_MS + 60_000);

        const result = await service.submit("user-1", submitInput());

        expect(result.elapsedMs).toBe(0);
      });

      it("gives no speed bonus when nothing was answered correctly", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS);

        const result = await service.submit(
          "user-1",
          submitInput(
            Array.from({ length: 5 }, () => ({
              answer: "wrong",
              responseTimeMs: 0,
            })),
          ),
        );

        expect(result.correctCount).toBe(0);
        expect(result.score).toBe(0);
      });

      it("persists the server-measured elapsedMs", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS - 12_000);

        await service.submit("user-1", submitInput());

        expect(prisma.dailyAttempt.create.mock.calls[0][0].data.elapsedMs).toBe(
          12_000,
        );
      });

      it("awards no speed bonus when the session was never pinned", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(null);

        const result = await service.submit("user-1", submitInput());

        // Base + streak only — no speed component.
        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
        expect(result.elapsedMs).toBeNull();
      });

      it("awards no speed bonus for a token carrying no start claim", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        // AuthService rejects such a token at the boundary, but the service
        // must fail closed on its own too: an absent claim is not a pin, and
        // must never be read as one.
        startedAt(NOW_MS, { startedAtMs: undefined });

        const result = await service.submit("user-1", submitInput());

        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
        expect(result.elapsedMs).toBeNull();
      });
    });

    // ---- the reissue exploit this design exists to close ----
    describe("token reissuance (regression)", () => {
      /**
       * Drives the real getToday -> submit flow with a signDailySession stub
       * that behaves like the real one: it echoes whatever startedAtMs the
       * service pinned. Every GET mints a NEW token, so if elapsedMs were
       * derived from the token's own issue time, re-fetching just before
       * submitting would reset it to ~0 and hand over the full speed bonus.
       *
       * The pin fake honours the TTL the service asks for, and expiry is what
       * makes this a real test: a pin that outlived its key would let the
       * clock-reset tests below pass even against a too-short TTL.
       */
      function wireRealTokenRoundTrip() {
        let pinned: number | null = null;
        let expiresAtMs = Number.POSITIVE_INFINITY;

        const isExpired = () => Date.now() >= expiresAtMs;

        // Emulate SET NX with expiry: the first call claims the start, and a
        // lapsed key is indistinguishable from an absent one, so a later
        // fetch would claim a FRESH start — the delayed clock reset.
        redis.setIfAbsent.mockImplementation(
          async (_key: string, value: string, ttlSeconds?: number) => {
            if (pinned === null || isExpired()) {
              pinned = Number(value);
              expiresAtMs =
                ttlSeconds != null
                  ? Date.now() + ttlSeconds * 1000
                  : Number.POSITIVE_INFINITY;
              return true;
            }
            return false;
          },
        );
        redis.get.mockImplementation(async () =>
          pinned === null || isExpired() ? null : String(pinned),
        );

        auth.signDailySession.mockImplementation((claims: any) => {
          auth.verifyDailySession.mockReturnValue({
            ...claims,
            iat: Math.floor(Date.now() / 1000),
          });
          return "token";
        });
      }

      beforeEach(() => {
        prisma.dailyQuestion.findFirst.mockResolvedValue({
          id: QUESTION_SET_ID,
          dateKey: "2026-08-09",
          version: 1,
          questions: QUESTIONS,
          active: true,
        });
        prisma.dailyAttempt.count.mockResolvedValue(0);
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        wireRealTokenRoundTrip();
      });

      it("measures from the FIRST fetch even when the token is reissued", async () => {
        // First fetch pins the start.
        await service.getToday("user-1");

        // Player takes the whole speed window to answer.
        vi.setSystemTime(new Date(NOW_MS + DAILY_SPEED_BONUS_WINDOW_MS));

        // Then re-fetches, hoping to reset the clock, and submits with the
        // fresh token.
        await service.getToday("user-1");
        const result = await service.submit("user-1", submitInput());

        // Elapsed reflects the original fetch, so the window is exhausted.
        expect(result.elapsedMs).toBe(DAILY_SPEED_BONUS_WINDOW_MS);
        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      it("still rewards a genuinely fast session", async () => {
        await service.getToday("user-1");
        vi.setSystemTime(new Date(NOW_MS + 1_000));

        const result = await service.submit("user-1", submitInput());

        const bonus = Math.floor(
          (DAILY_SPEED_BONUS_WINDOW_MS - 1_000) / DAILY_SPEED_BONUS_DIVISOR,
        );
        expect(result.elapsedMs).toBe(1_000);
        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + bonus + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      /**
       * The same reset, merely delayed: a pin that expired on the token's TTL
       * would be re-claimable after 30 minutes, so waiting out the key bought
       * back the full speed bonus. The pin therefore lives until the UTC day
       * ends — past which the attempt itself is no longer available.
       *
       * Stays inside 2026-08-09 on purpose: crossing midnight changes the
       * dateKey and the token would be rejected for a different reason,
       * proving nothing about the pin.
       */
      it("does not re-pin after the token TTL has lapsed", async () => {
        await service.getToday("user-1");

        // Well past the 30-minute token TTL, still the same UTC day.
        const lateMs = NOW_MS + 31 * 60_000;
        vi.setSystemTime(new Date(lateMs));

        await service.getToday("user-1");
        const result = await service.submit("user-1", submitInput());

        // Measured from the original fetch, so the window is long gone.
        expect(result.elapsedMs).toBe(lateMs - NOW_MS);
        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_PER_DAY,
        );
      });

      it("pins for the remainder of the UTC day, not the token lifetime", async () => {
        await service.getToday("user-1");

        // 10:00Z -> 14h left. Asserted as a duration rather than a literal so
        // the intent survives a change to NOW_MS.
        const secondsLeftInDay = (Date.UTC(2026, 7, 10) - NOW_MS) / 1000;
        expect(redis.setIfAbsent).toHaveBeenCalledWith(
          "daily:session:user-1:2026-08-09",
          String(NOW_MS),
          secondsLeftInDay,
        );
      });
    });

    // ---- session token binding ----
    describe("session token", () => {
      it("rejects a token issued for a different day", async () => {
        startedAt(NOW_MS, { dateKey: "2026-08-08" });

        await expect(
          service.submit("user-1", submitInput()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.dailyAttempt.create).not.toHaveBeenCalled();
      });

      it("rejects a token minted for a different signed-in user", async () => {
        startedAt(NOW_MS, { sub: "someone-else" });

        await expect(
          service.submit("user-1", submitInput()),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("accepts an anon-issued token completed while signed in", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);
        startedAt(NOW_MS, { sub: "anon" });

        await expect(
          service.submit("user-1", submitInput()),
        ).resolves.toMatchObject({ correctCount: 5 });
      });

      it("rejects an expired or tampered token with 400", async () => {
        auth.verifyDailySession.mockImplementation(() => {
          throw new Error("jwt expired");
        });

        await expect(
          service.submit("user-1", submitInput()),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("rejects a token missing required claims", async () => {
        auth.verifyDailySession.mockReturnValue({ sub: "user-1" });

        await expect(
          service.submit("user-1", submitInput()),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("rejects a token pointing at an unknown question set", async () => {
        prisma.dailyQuestion.findUnique.mockResolvedValue(null);

        await expect(
          service.submit("user-1", submitInput()),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    // ---- versioning ----
    describe("question-set version", () => {
      it("grades against the version the token pins, not the newest", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        const result = await service.submit("user-1", submitInput());

        expect(prisma.dailyQuestion.findUnique).toHaveBeenCalledWith({
          where: { id: QUESTION_SET_ID },
        });
        // findFirst (newest-active) must NOT be used on the submit path.
        expect(prisma.dailyQuestion.findFirst).not.toHaveBeenCalled();
        expect(result.version).toBe(1);
      });

      it("pins the graded version on the stored attempt", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        await service.submit("user-1", submitInput());

        expect(
          prisma.dailyAttempt.create.mock.calls[0][0].data.dailyQuestionId,
        ).toBe(QUESTION_SET_ID);
      });
    });

    describe("streak", () => {
      it("starts at 1 on a first perfect run", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        const result = await service.submit("user-1", submitInput());

        expect(result.streakBefore).toBe(0);
        expect(result.streakAfter).toBe(1);
      });

      it("continues from yesterday's streak", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 4 });

        const result = await service.submit("user-1", submitInput());

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

        const result = await service.submit(
          "user-1",
          submitInput([
            { answer: "A", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 }, // wrong
            { answer: "A", responseTimeMs: 1000 },
            { answer: "B", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 },
          ]),
        );

        expect(result.streakBefore).toBe(9);
        expect(result.streakAfter).toBe(0);
      });

      it("treats a gap day as a broken streak", async () => {
        // No attempt row for yesterday -> nothing to continue from.
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        const result = await service.submit("user-1", submitInput());

        expect(result.streakBefore).toBe(0);
      });

      it("caps the streak bonus", async () => {
        const hugeStreak =
          DAILY_STREAK_BONUS_CAP / DAILY_STREAK_BONUS_PER_DAY + 10;
        prisma.dailyAttempt.findUnique.mockResolvedValue({
          streakAfter: hugeStreak,
        });
        startedAt(NOW_MS - DAILY_SPEED_BONUS_WINDOW_MS); // isolate: no speed bonus

        const result = await service.submit("user-1", submitInput());

        expect(result.score).toBe(
          DAILY_SCORE_BASE_CORRECT * 5 + DAILY_STREAK_BONUS_CAP,
        );
      });

      it("applies no streak bonus on an imperfect run", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });
        startedAt(NOW_MS - DAILY_SPEED_BONUS_WINDOW_MS); // isolate: no speed bonus

        const result = await service.submit(
          "user-1",
          submitInput([
            { answer: "A", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 }, // wrong
            { answer: "A", responseTimeMs: 1000 },
            { answer: "B", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 },
          ]),
        );

        expect(result.score).toBe(DAILY_SCORE_BASE_CORRECT * 4);
      });
    });

    // Phase 3 — card variant cosmetic unlock on streak milestones.
    describe("card variant unlock (Phase 3)", () => {
      it("does NOT unlock when streakAfter is below 7", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 5 });

        const result = await service.submit("user-1", submitInput());

        expect(result.streakAfter).toBe(6);
        expect(result.unlockedVariant).toBeUndefined();
        expect(prisma.userCardVariant.upsert).not.toHaveBeenCalled();
      });

      it("does NOT unlock when streakAfter === 0 (streak reset)", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 0 });

        const result = await service.submit(
          "user-1",
          submitInput([
            { answer: "A", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 }, // wrong
            { answer: "A", responseTimeMs: 1000 },
            { answer: "B", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 },
          ]),
        );

        expect(result.streakAfter).toBe(0);
        expect(result.unlockedVariant).toBeUndefined();
        expect(prisma.userCardVariant.upsert).not.toHaveBeenCalled();
      });

      it("unlocks NEON when streakAfter hits 7 (first milestone)", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });
        // user owns only DEFAULT — nextCardVariant returns NEON.
        prisma.userCardVariant.findMany.mockResolvedValue([]);
        prisma.userCardVariant.upsert.mockResolvedValue({});

        const result = await service.submit("user-1", submitInput());

        expect(result.streakAfter).toBe(7);
        expect(result.unlockedVariant).toEqual(
          expect.objectContaining({ variantKey: "NEON" }),
        );
        expect(prisma.userCardVariant.upsert).toHaveBeenCalledTimes(1);
      });

      it("unlocks GOLD when streakAfter hits 14 (second milestone, NEON already owned)", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 13 });
        prisma.userCardVariant.findMany.mockResolvedValue([
          { variantKey: "DEFAULT" },
          { variantKey: "NEON" },
        ]);
        prisma.userCardVariant.upsert.mockResolvedValue({});

        const result = await service.submit("user-1", submitInput());

        expect(result.streakAfter).toBe(14);
        expect(result.unlockedVariant).toEqual(
          expect.objectContaining({ variantKey: "GOLD" }),
        );
      });

      it("returns NO unlockedVariant when user already owns every variant (cap)", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 20 });
        prisma.userCardVariant.findMany.mockResolvedValue([
          { variantKey: "DEFAULT" },
          { variantKey: "NEON" },
          { variantKey: "GOLD" },
        ]);

        const result = await service.submit("user-1", submitInput());

        expect(result.streakAfter).toBe(21);
        expect(result.unlockedVariant).toBeUndefined();
        expect(prisma.userCardVariant.upsert).not.toHaveBeenCalled();
      });

      it("submit still succeeds when the unlock path throws (DB error)", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });
        prisma.userCardVariant.findMany.mockRejectedValue(new Error("DB down"));

        // The submit MUST NOT fail — the unlock is best-effort.
        const result = await service.submit("user-1", submitInput());

        expect(result.streakAfter).toBe(7);
        expect(result.unlockedVariant).toBeUndefined();
        // The pending-grant row IS written in the same transaction as
        // dailyAttempt.create — that is the durable recovery signal.
        expect(prisma.pendingCardVariantUnlock.create).toHaveBeenCalledWith({
          data: { userId: "user-1", dateKey: "2026-08-09", streakAfter: 7 },
        });
      });

      it("retries the unlock on a subsequent submit by draining the pending grant (3 distinct users)", async () => {
        // Three distinct users — each crosses the streakAfter === 7
        // threshold on its own submit, then hits a transient DB
        // error on the cosmetic unlock. Each user gets a pending
        // grant row written in the same transaction as
        // `dailyAttempt.create`. The drainer, which runs on every
        // submit (regardless of `shouldAttemptUnlock`), picks the
        // pending row up and re-attempts the upsert — except in
        // this test we have `userCardVariant.findMany` still
        // throwing, so the drain logs and the row stays pending.
        //
        // Using distinct users (not "user-1" three times) is
        // defensive against a future mock setup that enforces
        // the `@@unique([dateKey, userId])` constraint on
        // `daily_attempts` — a retried submit for the same user on
        // the same dateKey would throw P2002 and surface as a 409,
        // not a real "retry the unlock" scenario.
        //
        // The session-token mock must mirror the userId for each
        // call (otherwise `claims.sub !== userId` would 400 the
        // submit before the unlock branch ever runs).
        const users = ["user-1", "user-2", "user-3"];
        prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });
        prisma.userCardVariant.findMany.mockRejectedValue(new Error("DB down"));
        auth.verifyDailySession.mockImplementation((token: string) => ({
          sub: token, // token carries the userId in this test
          dateKey: "2026-08-09",
          dailyQuestionId: QUESTION_SET_ID,
          startedAtMs: NOW_MS,
          iat: Math.floor(NOW_MS / 1000),
        }));
        const warnSpy = vi.spyOn(Logger.prototype, "warn");

        for (const user of users) {
          await service.submit(user, { ...submitInput(), sessionToken: user });
        }

        // All three submissions succeeded — the submit MUST NOT
        // surface the unlock failure. (The `await` above would
        // throw if any submit 400'd, so reaching this line is
        // itself the assertion.)

        // One pending-grant row written per user. The `streakAfter`
        // for each user is 7 (threshold crossing).
        expect(prisma.pendingCardVariantUnlock.create).toHaveBeenCalledTimes(3);
        const createdCalls = vi.mocked(prisma.pendingCardVariantUnlock.create)
          .mock.calls;
        const createdUserIds = createdCalls.map(
          (entry: unknown[]) =>
            (entry[0] as { data: { userId: string } }).data.userId,
        );
        expect(createdUserIds.sort()).toEqual(["user-1", "user-2", "user-3"]);

        // WARN logs emitted per user — three "persisting pending
        // grant intent" warnings (the drainer also runs and hits
        // the same DB error, but its WARN is "Pending card-variant
        // unlock drain failed", which is intentionally a distinct
        // message so operators can tell the trigger-side failure
        // apart from the drain-side failure).
        const pendingIntentWarns = warnSpy.mock.calls
          .map((call) => call[0])
          .filter(
            (msg): msg is string =>
              typeof msg === "string" &&
              msg.includes("persisting pending grant intent"),
          );
        expect(pendingIntentWarns).toHaveLength(3);
      });

      // The drain runs on EVERY submit (regardless of
      // `shouldAttemptUnlock`) so a streak reset zeroes
      // `streakAfter`, so a user who tripped the unlock once and
      // then missed a day must still recover the row. These three
      // tests pin the drain contract:
      //   1. a fresh pending row on the next submit gets the
      //      idempotent upsert + `processedAt` mark;
      //   2. a streak reset (streakAfter = 0, NOT a milestone)
      //      does not strand the pending row;
      //   3. a re-drain on the same submit finds `processedAt !=
      //      null` and skips the upsert (idempotency).
      it("drains a pending grant on a fresh submit (post-failure recovery)", async () => {
        // Pre-seed one unprocessed pending row for user-1.
        prisma.pendingCardVariantUnlock.findMany.mockResolvedValue([
          {
            id: "pending-1",
            userId: "user-1",
            dateKey: "2026-08-09",
            streakAfter: 7,
            createdAt: new Date(),
            processedAt: null,
          },
        ]);
        // owned variants = empty, so nextCardVariant = NEON.
        prisma.userCardVariant.findMany.mockResolvedValue([]);
        prisma.userCardVariant.upsert.mockResolvedValue({});
        // The drain's in-transaction `SELECT ... FOR UPDATE` lock
        // query must return the row (no concurrent drainer already
        // processed it).
        prisma.$queryRaw.mockResolvedValue([{ id: "pending-1" }]);

        const result = await service.submit("user-1", submitInput());

        // The drain attempted the idempotent upsert via
        // `maybeUnlockCardVariantInTx`.
        expect(prisma.userCardVariant.upsert).toHaveBeenCalled();
        // The pending row was marked processed.
        expect(prisma.pendingCardVariantUnlock.update).toHaveBeenCalledWith({
          where: { id: "pending-1" },
          data: { processedAt: expect.any(Date) as unknown },
        });
        // The submit still returns an `unlockedVariant` for THIS
        // attempt (NEON) because the drain ran as part of the
        // same transaction — a fresh submit on streakAfter = 6
        // does NOT cross the threshold (6 % 7 !== 0), so the
        // user-facing response shape's `unlockedVariant` is the
        // drain's grant, not the threshold trigger.
        expect(result.unlockedVariant).toEqual(
          expect.objectContaining({ variantKey: "NEON" }),
        );
      });

      it("drains a pending grant on a streak reset (not a milestone submit)", async () => {
        // Pre-seed one unprocessed pending row.
        prisma.pendingCardVariantUnlock.findMany.mockResolvedValue([
          {
            id: "pending-1",
            userId: "user-1",
            dateKey: "2026-08-09",
            streakAfter: 7,
            createdAt: new Date(),
            processedAt: null,
          },
        ]);
        prisma.userCardVariant.findMany.mockResolvedValue([]);
        prisma.userCardVariant.upsert.mockResolvedValue({});
        // Lock query inside the drain transaction returns the row.
        prisma.$queryRaw.mockResolvedValue([{ id: "pending-1" }]);

        // streakBefore = 6 → streakAfter = 0 (because the user
        // got an answer wrong, even though they submitted). The
        // submit's `shouldAttemptUnlock` is FALSE (0 % 7 === 0
        // but 0 is not > 0). The drain MUST still fire.
        const result = await service.submit(
          "user-1",
          submitInput([
            { answer: "A", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 }, // wrong
            { answer: "A", responseTimeMs: 1000 },
            { answer: "B", responseTimeMs: 1000 },
            { answer: "A", responseTimeMs: 1000 },
          ]),
        );

        expect(result.streakAfter).toBe(0);
        // The drain STILL ran — pending grants must survive streak
        // resets so a user who tripped the unlock once and then
        // missed a day still recovers the row.
        expect(prisma.userCardVariant.upsert).toHaveBeenCalled();
        expect(prisma.pendingCardVariantUnlock.update).toHaveBeenCalledWith({
          where: { id: "pending-1" },
          data: { processedAt: expect.any(Date) as unknown },
        });
      });

      it("filters out already-processed pending rows at the DB level (processedAt IS NULL)", async () => {
        // The drainer delegates the "skip processed" decision to the
        // database itself by issuing
        // `findMany({ where: { processedAt: null } })`. We mock the
        // result as an empty list to model "no unprocessed rows
        // returned", and assert both the query's WHERE clause (the
        // DB-level filter contract) and the absence of any
        // cosmetic-side writes. A future regression that drops
        // `processedAt: null` from the WHERE, or moves the drain
        // out of its own transaction, would be caught here.
        prisma.pendingCardVariantUnlock.findMany.mockResolvedValue([]);

        await service.submit("user-1", submitInput());

        expect(prisma.pendingCardVariantUnlock.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ processedAt: null }),
          }),
        );
        expect(prisma.userCardVariant.upsert).not.toHaveBeenCalled();
        expect(prisma.pendingCardVariantUnlock.update).not.toHaveBeenCalled();
      });
    });

    describe("answer-count mismatch", () => {
      // The DTO pins the array length, but the stored set is the real source
      // of truth. A shorter array used to index past the end and surface as a
      // TypeError (500); it must be a controlled 400 instead.
      it("rejects fewer answers than questions with 400, not a TypeError", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        await expect(
          service.submit("user-1", submitInput(ALL_CORRECT.slice(0, 3))),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.dailyAttempt.create).not.toHaveBeenCalled();
      });

      it("rejects more answers than questions with 400", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        await expect(
          service.submit(
            "user-1",
            submitInput([...ALL_CORRECT, { answer: "A", responseTimeMs: 0 }]),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.dailyAttempt.create).not.toHaveBeenCalled();
      });

      it("still accepts an exactly-matching answer array", async () => {
        prisma.dailyAttempt.findUnique.mockResolvedValue(null);

        await expect(
          service.submit("user-1", submitInput()),
        ).resolves.toMatchObject({ correctCount: 5 });
      });
    });

    it("grades case-insensitively without depending on the ambient locale", async () => {
      // toLocaleLowerCase would map "I" to "ı" under a Turkish locale and mark
      // a correct answer wrong. Grading must not vary by where the server runs.
      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS.map((q) => ({
          ...q,
          options: ["III", "BBB"],
          correctAnswer: "III",
        })),
        active: true,
      });
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      const result = await service.submit(
        "user-1",
        submitInput(
          Array.from({ length: 5 }, () => ({
            answer: "iii",
            responseTimeMs: 1000,
          })),
        ),
      );

      expect(result.correctCount).toBe(5);
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
        service.submit("user-1", submitInput()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("propagates non-unique Prisma errors untouched", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);
      const failure = new Prisma.PrismaClientKnownRequestError("boom", {
        code: "P2003",
        clientVersion: "7.8.0",
      });
      prisma.dailyAttempt.create.mockRejectedValue(failure);

      await expect(service.submit("user-1", submitInput())).rejects.toBe(
        failure,
      );
    });

    it("persists answers without leaking the correct answer into storage", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      await service.submit("user-1", submitInput());

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
        service.submit("user-1", submitInput()),
      ).resolves.toMatchObject({ correctCount: 5 });
    });

    it("still succeeds when cache eviction rejects with a non-Error", async () => {
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);
      redis.del.mockRejectedValue("connection reset");

      await expect(
        service.submit("user-1", submitInput()),
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

    it("falls back to the DB when the cache read rejects with a non-Error", async () => {
      redis.getJSON.mockRejectedValue("connection reset");
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

    it("still returns data when the cache write rejects with a non-Error", async () => {
      redis.getJSON.mockResolvedValue(null);
      redis.setJSON.mockRejectedValue("connection reset");
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.getLeaderboard({ dateKey: "2026-08-09", limit: 50 }),
      ).resolves.toMatchObject({ cached: false });
    });

    it("includes cardsPlayedThisWeek from the lateral join", async () => {
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
          cards_played_this_week: BigInt(14),
        },
      ]);

      const result = await service.getLeaderboard({
        dateKey: "2026-08-09",
        limit: 50,
      });

      expect(result.items[0].cardsPlayedThisWeek).toBe(14);
    });
  });

  // ---------------------------------------------------------
  // Pending unlock drain edge cases
  // ---------------------------------------------------------

  describe("pending unlock drain edge cases", () => {
    it("logs warning and continues when pending create throws non-P2002", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      // Previous day's attempt with streakAfter=6 → streakBefore=6
      prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });

      // Force the unlock path to throw
      prisma.userCardVariant.findMany.mockRejectedValue(
        new Error("unlock db error"),
      );
      // Make pending create throw with a NON-P2002 error
      prisma.pendingCardVariantUnlock.create.mockRejectedValue(
        new Error("pending write failed"),
      );

      const result = await service.submit("user-1", submitInput());

      // The submit should still succeed despite unlock + pending failures
      expect(result).toHaveProperty("dateKey");
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("unlock is now lost"),
      );
    });

    it("treats P2002 on pending create as a silent no-op", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      // Previous day's attempt with streakAfter=6 → streakBefore=6
      prisma.dailyAttempt.findUnique.mockResolvedValue({ streakAfter: 6 });

      // Force the unlock path to throw
      prisma.userCardVariant.findMany.mockRejectedValue(
        new Error("unlock db error"),
      );
      // Make pending create throw with P2002 (unique constraint)
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        "Unique constraint",
        { code: "P2002", clientVersion: "0.0.0", meta: {} },
      );
      prisma.pendingCardVariantUnlock.create.mockRejectedValue(p2002Error);

      const result = await service.submit("user-1", submitInput());

      expect(result).toHaveProperty("dateKey");
      // P2002 should NOT trigger the "unlock is now lost" warning
      expect(Logger.prototype.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("unlock is now lost"),
      );
    });

    it("returns null and logs warning when pending drain read fails", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      // Make the drain read fail
      prisma.pendingCardVariantUnlock.findMany.mockRejectedValue(
        new Error("drain read failed"),
      );

      const result = await service.submit("user-1", submitInput());

      expect(result).toHaveProperty("dateKey");
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Pending card-variant unlock drain read failed",
        ),
      );
    });

    it("leaves row unprocessed when individual drain fails", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      // Return one pending row for drain
      prisma.pendingCardVariantUnlock.findMany.mockResolvedValue([
        {
          id: "pending-1",
          userId: "user-1",
          streakAfter: 7,
          createdAt: new Date(),
        },
      ]);
      // The drain's `SELECT ... FOR UPDATE` lock query returns the
      // row so the helper proceeds to the unlock + processedAt mark.
      // We then force the unlock path to throw so the drainer logs
      // its catch-block warning; the row is left unprocessed and
      // `pendingCardVariantUnlock.update` MUST NOT be called.
      prisma.$queryRaw.mockResolvedValue([{ id: "pending-1" }]);
      prisma.userCardVariant.findMany.mockRejectedValue(
        new Error("drain failed"),
      );
      // Pending update should NOT be called when the drain fails
      prisma.pendingCardVariantUnlock.update.mockRejectedValue(
        new Error("should not be called"),
      );

      const result = await service.submit("user-1", submitInput());

      expect(result).toHaveProperty("dateKey");
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Pending card-variant unlock drain failed for pending row",
        ),
      );
      // The row should NOT be marked as processed
      expect(prisma.pendingCardVariantUnlock.update).not.toHaveBeenCalled();
    });

    it("handles drain read failure with a non-Error thrown value (String fallback)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      // Throw a string (not an Error instance) so the drainer's
      // `drainReadErr instanceof Error` check falls through to
      // `String(drainReadErr)`. The submit must still succeed and
      // the logger must stringify the thrown value.
      prisma.pendingCardVariantUnlock.findMany.mockRejectedValue(
        "string-not-error" as unknown,
      );

      const result = await service.submit("user-1", submitInput());

      expect(result).toHaveProperty("dateKey");
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("string-not-error"),
      );
    });

    it("skips a pending row when a concurrent drainer already processed it", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_ISO));

      startedAt(NOW_MS - 5000);
      redis.setIfAbsent.mockResolvedValue(true);

      prisma.dailyQuestion.findUnique.mockResolvedValue({
        id: QUESTION_SET_ID,
        dateKey: "2026-08-09",
        version: 1,
        questions: QUESTIONS,
        active: true,
      });
      prisma.dailyAttempt.create.mockImplementation(({ data }: any) => ({
        ...data,
        completedAt: new Date(NOW_ISO),
      }));
      prisma.dailyAttempt.findUnique.mockResolvedValue(null);

      // Pre-seed one unprocessed pending row. The drain's
      // `SELECT ... FOR UPDATE` lock query returns [] because a
      // concurrent drainer already marked the row processed. The
      // drainer MUST skip silently without calling
      // `userCardVariant.upsert` or `pendingCardVariantUnlock.update`.
      prisma.pendingCardVariantUnlock.findMany.mockResolvedValue([
        {
          id: "pending-1",
          userId: "user-1",
          streakAfter: 7,
          createdAt: new Date(),
          processedAt: null,
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.userCardVariant.upsert.mockResolvedValue({});

      const result = await service.submit("user-1", submitInput());

      expect(result).toHaveProperty("dateKey");
      expect(prisma.userCardVariant.upsert).not.toHaveBeenCalled();
      expect(prisma.pendingCardVariantUnlock.update).not.toHaveBeenCalled();
    });
  });
});
