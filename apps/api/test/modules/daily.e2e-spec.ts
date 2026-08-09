// ============================================================
// E2E: /daily — question delivery, submission and scoring
//
// Exercises the real Nest app: Zod validation, the JwtAuthGuard
// (kept real by the test factory) and the Redis-pinned session
// clock. The centrepiece is the reissue regression: re-fetching
// the questions must NOT reset the speed-bonus clock.
//
// `Date` is faked for the whole suite (real Postgres/Redis, real
// timers) so the UTC day cannot shift mid-run and elapsed times
// are exact rather than jitter-tolerant. See installFakeClock.
//
// Note the factory signs access tokens WITHOUT a `typ` claim, so
// these tests also cover the legacy-token tolerance in
// AuthService.verifyToken.
// ============================================================

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createTestApp, type TestApp } from "./../helpers/test-app.factory";
import { disconnectPrisma, getPrisma } from "./../helpers/db-helpers";
import { disconnectRedis, flushTestRedis } from "./../helpers/redis-helpers";
import { cleanupE2ETestEnv, prepareE2ETestEnv } from "./../setup-e2e";
import { pathToFileURL } from "node:url";

// `__filename` is always defined in CommonJS modules. Converting it
// to a file:// URL is what setup-e2e's `fileURLToPath` / `stateByFile`
// keying actually expects — and it sidesteps TS1343, since the
// base tsconfig pins `"module": "commonjs"` and forbids `import.meta`.
// (Same workaround as `room.service.integration.spec.ts`.)
const currentFileUrl = pathToFileURL(__filename).href;
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
 * Simulated gap between the two GETs in the reissue test.
 *
 * Over one second on purpose: `iat` has second granularity, so a shorter gap
 * mints a byte-identical token and the reissue this test exists to cover would
 * never actually happen.
 */
const SESSION_GAP_MS = 1_200;

/**
 * The UTC day the whole suite operates on, and the instant the fake clock is
 * anchored to.
 *
 * Capturing the key alone is not enough: DailyService derives its OWN dateKey
 * from the clock on every request (toDateKey), so a run that crossed UTC
 * midnight would still seed one day and then be served another. Midday leaves
 * ~12h of headroom on either side, so the anchor cannot drift across a
 * boundary no matter how long the suite runs.
 */
const DATE_KEY = new Date().toISOString().slice(0, 10);
const CLOCK_ANCHOR = new Date(`${DATE_KEY}T12:00:00.000Z`);

/**
 * Only `Date` is faked. This suite drives real Postgres and Redis, whose
 * drivers rely on timers and immediates internally — freezing those would
 * deadlock the very I/O under test. Faking `Date` alone is enough, because
 * every clock the service reads (toDateKey, the session pin, jwt `iat`) goes
 * through it.
 */
function installFakeClock() {
  vi.useFakeTimers({ toFake: ["Date"], now: CLOCK_ANCHOR });
}

/** Moves the simulated clock forward without blocking on real time. */
function advanceClock(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
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
    await prepareE2ETestEnv(currentFileUrl);
    testApp = await createTestApp();
    await flushTestRedis();

    // Installed before the seed so the row, every endpoint call and every
    // assertion agree on the day — the service re-derives its dateKey from
    // this clock on each request.
    installFakeClock();

    const prisma = getPrisma();
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, username: USERNAME, role: "GUEST" },
    });

    const created = await prisma.dailyQuestion.upsert({
      where: { dateKey_version: { dateKey: DATE_KEY, version: 1 } },
      update: { questions: questionSet("e2e"), active: true },
      create: {
        dateKey: DATE_KEY,
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
    // Tests advance the clock; rewind so the next one starts from the anchor
    // rather than inheriting a drifted (eventually midnight-crossing) one.
    vi.setSystemTime(CLOCK_ANCHOR);
  });

  afterAll(async () => {
    // Real time restored before teardown so cleanup and the pg/redis clients
    // shut down against the same clock they connected with.
    vi.useRealTimers();

    const prisma = getPrisma();
    await prisma.dailyAttempt.deleteMany({ where: { userId: USER_ID } });
    await prisma.dailyQuestion.deleteMany({ where: { dateKey: DATE_KEY } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await testApp.close();
    await disconnectPrisma();
    await disconnectRedis();
    await cleanupE2ETestEnv(currentFileUrl);
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

      expect(data.dateKey).toBe(DATE_KEY);
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
        where: { dateKey_userId: { dateKey: DATE_KEY, userId: USER_ID } },
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
      // First fetch pins the session start.
      const first = await fetchToday();

      // Advance the simulated clock, then re-fetch. A NEW token is minted,
      // but it must carry the SAME pinned start.
      advanceClock(SESSION_GAP_MS);
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

      // Exact, not a tolerance band: with the clock controlled there is no
      // scheduler jitter to absorb. An `iat`-derived clock would report ~0
      // here, since the second token was minted after the gap.
      expect(data.elapsedMs).toBe(SESSION_GAP_MS);
    });

    it("ignores forged client responseTimeMs", async () => {
      const { sessionToken } = await fetchToday();

      // A deliberate, sizeable gap is what gives this test teeth: it makes the
      // server's measurement differ sharply from the zeros the client claims,
      // so the two cannot produce the same score by coincidence. Under the
      // previous real clock the difference was a few milliseconds — and once
      // the clock is controlled it would be exactly zero, leaving nothing to
      // distinguish.
      const SERVER_MEASURED_MS = 20_000;
      advanceClock(SERVER_MEASURED_MS);

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
      // measurement to score against — its own, not the client's.
      expect(data.elapsedMs).toBe(SERVER_MEASURED_MS);

      // Scoring must derive from that server measurement. The forged zeros
      // would have paid the FULL window bonus; this expectation is strictly
      // lower, so a leak of client timing into scoring fails here.
      const expectedBonus = Math.floor(
        (DAILY_SPEED_BONUS_WINDOW_MS - SERVER_MEASURED_MS) /
          DAILY_SPEED_BONUS_DIVISOR,
      );
      const forgedBonus = Math.floor(
        DAILY_SPEED_BONUS_WINDOW_MS / DAILY_SPEED_BONUS_DIVISOR,
      );
      expect(expectedBonus).toBeLessThan(forgedBonus);

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
