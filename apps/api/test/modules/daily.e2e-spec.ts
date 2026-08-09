// ============================================================
// E2E: /daily — question delivery, submission and scoring
//
// Exercises the real Nest app: Zod validation, the JwtAuthGuard
// (kept real by the test factory) and the Redis-pinned session
// clock. The centrepiece is the reissue regression: re-fetching
// the questions must NOT reset the speed-bonus clock.
//
// Note the factory signs access tokens WITHOUT a `typ` claim, so
// these tests also cover the legacy-token tolerance in
// AuthService.verifyToken.
// ============================================================

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./../helpers/test-app.factory";
import { disconnectPrisma, getPrisma } from "./../helpers/db-helpers";
import { disconnectRedis, flushTestRedis } from "./../helpers/redis-helpers";
import { cleanupE2ETestEnv, prepareE2ETestEnv } from "./../setup-e2e";
import {
  DAILY_SCORE_BASE_CORRECT,
  DAILY_SPEED_BONUS_DIVISOR,
  DAILY_SPEED_BONUS_WINDOW_MS,
  DAILY_STREAK_BONUS_PER_DAY,
} from "../../src/modules/daily/daily.service";
import type {
  DailySubmitResponse,
  DailyTodayResponse,
} from "../../src/modules/daily/dto";

const USER_ID = "e2e-daily-user";
const USERNAME = "e2e_daily_user";

/**
 * Real time deliberately spent between the two GETs in the reissue test, so
 * elapsedMs has something non-trivial to prove it measured.
 *
 * Over one second on purpose: `iat` has second granularity, so a shorter gap
 * mints a byte-identical token and the reissue this test exists to cover would
 * never actually happen.
 */
const SESSION_GAP_MS = 1_200;

/** Tolerance for scheduler jitter — well under SESSION_GAP_MS, so the lower
 * bound it guards stays a real assertion rather than a formality. */
const CLOCK_SLACK_MS = 50;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Five well-formed questions; correctAnswer is always inside options. */
function questionSet(marker: string) {
  return Array.from({ length: 5 }, (_, i) => ({
    content: `${marker} question ${i + 1}`,
    options: ["right", "wrong"],
    correctAnswer: "right",
    difficulty: "EASY" as const,
    category: "GENERAL",
    explanation: `because ${marker}`,
  }));
}

describe("E2E /daily", () => {
  let testApp: TestApp;
  let dailyQuestionId: string;

  beforeAll(async () => {
    await prepareE2ETestEnv(import.meta.url);
    testApp = await createTestApp();
    await flushTestRedis();

    const prisma = getPrisma();
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, username: USERNAME, role: "GUEST" },
    });

    const created = await prisma.dailyQuestion.upsert({
      where: { dateKey_version: { dateKey: todayKey(), version: 1 } },
      update: { questions: questionSet("e2e"), active: true },
      create: {
        dateKey: todayKey(),
        version: 1,
        questions: questionSet("e2e"),
        active: true,
        publishedAt: new Date(),
      },
    });
    dailyQuestionId = created.id;
  });

  afterEach(async () => {
    // One attempt per user per day, so each test needs a clean slate — and a
    // fresh session pin, or the clock would carry across tests.
    const prisma = getPrisma();
    await prisma.dailyAttempt.deleteMany({ where: { userId: USER_ID } });
    await flushTestRedis();
  });

  afterAll(async () => {
    const prisma = getPrisma();
    await prisma.dailyAttempt.deleteMany({ where: { userId: USER_ID } });
    await prisma.dailyQuestion.deleteMany({ where: { dateKey: todayKey() } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await testApp.close();
    await disconnectPrisma();
    await disconnectRedis();
    await cleanupE2ETestEnv(import.meta.url);
  });

  async function fetchToday(authed = true): Promise<DailyTodayResponse> {
    const res = await testApp.inject("GET", "/api/v1/daily/today", {
      headers: authed ? testApp.authedHeaders(USER_ID, USERNAME) : {},
    });
    expect(res.statusCode).toBe(200);
    return res.json<{ data: DailyTodayResponse }>().data;
  }

  function allCorrect() {
    return Array.from({ length: 5 }, () => ({
      answer: "right",
      // Deliberately forged: the server must ignore this entirely.
      responseTimeMs: 0,
    }));
  }

  describe("GET /daily/today", () => {
    it("serves the set without leaking answers, and issues a session token", async () => {
      const data = await fetchToday();

      expect(data.dateKey).toBe(todayKey());
      expect(data.version).toBe(1);
      expect(data.questions).toHaveLength(5);
      expect(data.sessionToken.length).toBeGreaterThan(0);
      for (const question of data.questions) {
        expect(question).not.toHaveProperty("correctAnswer");
        expect(question).not.toHaveProperty("explanation");
      }
    });

    it("is reachable anonymously", async () => {
      const data = await fetchToday(false);
      expect(data.alreadyAttempted).toBe(false);
    });
  });

  describe("POST /daily/submit", () => {
    it("rejects an unauthenticated submit with 401", async () => {
      const { sessionToken } = await fetchToday();

      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        payload: { sessionToken, answers: allCorrect() },
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects a payload with no sessionToken with 400", async () => {
      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: { answers: allCorrect() },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects a wrong-length answers array with 400", async () => {
      const { sessionToken } = await fetchToday();

      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: { sessionToken, answers: allCorrect().slice(0, 3) },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects a garbage session token with 400", async () => {
      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: { sessionToken: "not-a-jwt", answers: allCorrect() },
      });

      expect(res.statusCode).toBe(400);
    });

    it("grades a valid submit and pins the question-set version", async () => {
      const { sessionToken } = await fetchToday();

      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: { sessionToken, answers: allCorrect() },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{ data: DailySubmitResponse }>().data;
      expect(data.correctCount).toBe(5);
      expect(data.version).toBe(1);
      expect(data.streakAfter).toBe(1);

      // The attempt records the exact version it was graded against.
      const attempt = await getPrisma().dailyAttempt.findUnique({
        where: { dateKey_userId: { dateKey: todayKey(), userId: USER_ID } },
      });
      expect(attempt?.dailyQuestionId).toBe(dailyQuestionId);
    });

    it("rejects a second attempt on the same day with 409", async () => {
      const first = await fetchToday();
      const headers = await testApp.mutatingHeaders(USER_ID, USERNAME);

      const ok = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers,
        payload: { sessionToken: first.sessionToken, answers: allCorrect() },
      });
      expect(ok.statusCode).toBe(200);

      const second = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers,
        payload: { sessionToken: first.sessionToken, answers: allCorrect() },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("session clock", () => {
    it("does not reset the clock when the questions are re-fetched", async () => {
      // Wall-clock bounds, measured around the real requests. Everything below
      // is asserted against elapsed time that actually passed, so a clock
      // derived from the token's own `iat` cannot satisfy it.
      const beforeFirstFetch = Date.now();

      // First fetch pins the session start.
      const first = await fetchToday();

      // Let a measurable amount of time pass, then re-fetch. A NEW token is
      // minted, but it must carry the SAME pinned start.
      await new Promise((resolve) => setTimeout(resolve, SESSION_GAP_MS));
      const second = await fetchToday();
      expect(second.sessionToken).not.toBe(first.sessionToken);

      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: {
          sessionToken: second.sessionToken,
          answers: allCorrect(),
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json<{ data: DailySubmitResponse }>().data;
      const afterSubmit = Date.now();

      // The lower bound is the assertion with teeth: it spans the gap between
      // the two fetches, so an `iat`-derived clock — which the second token
      // would reset to ~0 — falls short of it.
      expect(data.elapsedMs).not.toBeNull();
      expect(data.elapsedMs!).toBeGreaterThanOrEqual(
        SESSION_GAP_MS - CLOCK_SLACK_MS,
      );
      // Upper bound: elapsed cannot exceed the whole test's wall time, which
      // catches a start pinned earlier than the first fetch.
      expect(data.elapsedMs!).toBeLessThanOrEqual(
        afterSubmit - beforeFirstFetch + CLOCK_SLACK_MS,
      );
    });

    it("ignores forged client responseTimeMs", async () => {
      const { sessionToken } = await fetchToday();

      const res = await testApp.inject("POST", "/api/v1/daily/submit", {
        headers: await testApp.mutatingHeaders(USER_ID, USERNAME),
        payload: {
          sessionToken,
          // Claims every answer was instantaneous.
          answers: allCorrect(),
        },
      });

      const data = res.json<{ data: DailySubmitResponse }>().data;
      // The session was pinned (authenticated fetch), so the server has a real
      // measurement to score against.
      expect(data.elapsedMs).not.toBeNull();
      // Scoring must derive from that server measurement — never from the
      // zeros the client posted. Computing the expectation FROM elapsedMs is
      // what makes this meaningful: had the forged zeros leaked into scoring,
      // the score would have come out at the full-bonus maximum instead.
      const expectedBonus = Math.floor(
        Math.max(0, DAILY_SPEED_BONUS_WINDOW_MS - data.elapsedMs!) /
          DAILY_SPEED_BONUS_DIVISOR,
      );
      expect(data.score).toBe(
        DAILY_SCORE_BASE_CORRECT * 5 +
          expectedBonus +
          DAILY_STREAK_BONUS_PER_DAY,
      );
      // Every per-answer time is still stored verbatim, purely as a statistic.
      expect(data.results.every((r) => r.responseTimeMs === 0)).toBe(true);
    });
  });
});
