// ============================================================
// E2E: /users/me/* — Profile stats, history, avatar
//
// Runs against the real test PostgreSQL populated by
// `prisma:seed:demo`. Assumes:
//   - At least one demo user exists (demo_player_01)
//   - The demo user MAY have zero or more FINISHED matches
//     (the history test permits an empty list; the stats test
//      only enforces non-zero counts when matches exist — see
//      per-test setup)
//   - Token signing uses default JWT_SECRET
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./../helpers/test-app.factory";
import {
  disconnectPrisma,
  getPrisma,
  requireDemoUser,
} from "./../helpers/db-helpers";
import { disconnectRedis } from "./../helpers/redis-helpers";
import { cleanupE2ETestEnv, prepareE2ETestEnv } from "./../setup-e2e";
import { AVATAR_SEEDS } from "@arena/shared";
import { pathToFileURL } from "node:url";

// `__filename` is always defined in CommonJS modules. Converting it
// to a file:// URL is what setup-e2e's `fileURLToPath` / `stateByFile`
// keying actually expects — and it sidesteps TS1343, since the
// base tsconfig pins `"module": "commonjs"` and forbids `import.meta`.
// (Same workaround as `room.service.integration.spec.ts`.)
const currentFileUrl = pathToFileURL(__filename).href;

describe("E2E /users", () => {
  let testApp: TestApp;
  let demoUserId: string;
  const demoUsername = "demo_player_01";

  beforeAll(async () => {
    await prepareE2ETestEnv(currentFileUrl);
    testApp = await createTestApp();
    const user = await requireDemoUser(demoUsername);
    demoUserId = user.id;
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectPrisma();
    await disconnectRedis();
    await cleanupE2ETestEnv(currentFileUrl);
  });

  describe("GET /api/v1/users/me/stats", () => {
    it("returns 401 when the Authorization header is missing", async () => {
      const res = await testApp.inject("GET", "/api/v1/users/me/stats");
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 when the token is malformed", async () => {
      const res = await testApp.inject("GET", "/api/v1/users/me/stats", {
        headers: { authorization: "Bearer not-a-real-jwt" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns aggregate stats for a demo user with FINISHED matches", async () => {
      const headers = testApp.authedHeaders(demoUserId, demoUsername);
      const res = await testApp.inject("GET", "/api/v1/users/me/stats", {
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        success: boolean;
        data: {
          user: { id: string; username: string; avatar: string; role: string };
          stats: {
            matchesPlayed: number;
            wins: number;
            totalScore: number;
            avgResponseMs: number;
            accuracy: number;
            winRate: number;
            survivalRate: number;
            totalCorrectAnswers: number;
          };
        };
      }>();

      expect(body.success).toBe(true);
      const { user, stats } = body.data;
      expect(user.id).toBe(demoUserId);
      expect(user.username).toBe(demoUsername);
      expect(AVATAR_SEEDS).toContain(user.avatar);
      expect(stats.matchesPlayed).toBeGreaterThan(0);
      expect(stats.totalScore).toBeGreaterThan(0);
      expect(stats.avgResponseMs).toBeGreaterThan(0);
      expect(stats.accuracy).toBeGreaterThanOrEqual(0);
      expect(stats.accuracy).toBeLessThanOrEqual(1);
      expect(stats.winRate).toBeGreaterThanOrEqual(0);
      expect(stats.winRate).toBeLessThanOrEqual(1);
    });
  });

  describe("GET /api/v1/users/me/history", () => {
    it("returns paginated history with cursor", async () => {
      const headers = testApp.authedHeaders(demoUserId, demoUsername);
      const res = await testApp.inject(
        "GET",
        "/api/v1/users/me/history?limit=2",
        { headers },
      );

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        success: boolean;
        data: {
          items: Array<{
            matchId: string;
            playedAt: string;
            roomCategory: string;
            playerCount: number;
            rank: number;
            score: number;
            status: "WON" | "ELIMINATED" | "ABANDONED";
            durationSec: number;
          }>;
          nextCursor: string | null;
          hasMore: boolean;
        };
      }>();

      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
      // demo_player_01 may or may not be in matches; allow empty list.
      for (const item of body.data.items) {
        expect(typeof item.matchId).toBe("string");
        expect(["WON", "ELIMINATED", "ABANDONED"]).toContain(item.status);
        expect(item.playerCount).toBeGreaterThan(0);
        expect(item.rank).toBeGreaterThan(0);
        expect(item.score).toBeGreaterThanOrEqual(0);
      }
    });

    it("rejects an invalid limit with 400", async () => {
      const headers = testApp.authedHeaders(demoUserId, demoUsername);
      const res = await testApp.inject(
        "GET",
        "/api/v1/users/me/history?limit=999",
        { headers },
      );
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/v1/users/me/avatar", () => {
    it("updates the avatar when a valid seed is supplied", async () => {
      // Capture the original avatar so the shared fixture can be
      // restored to its baseline state after the test mutates it.
      const original = await getPrisma().user.findUnique({
        where: { id: demoUserId },
        select: { avatar: true },
      });
      if (!original) {
        throw new Error("Demo user vanished mid-test");
      }
      const originalAvatar = original.avatar;

      const headers = await testApp.mutatingHeaders(demoUserId, demoUsername);
      const targetSeed = AVATAR_SEEDS[3]!; // deterministic pick
      try {
        const res = await testApp.inject("PATCH", "/api/v1/users/me/avatar", {
          headers,
          payload: { avatar: targetSeed },
        });

        // Surface the response body on failure for easier debugging.
        if (res.statusCode !== 200) {
          console.log("PATCH failed:", res.statusCode, res.body);
        }
        expect(res.statusCode).toBe(200);
        const body = res.json<{
          success: boolean;
          data: { id: string; avatar: string };
        }>();
        expect(body.success).toBe(true);
        expect(body.data.id).toBe(demoUserId);
        expect(body.data.avatar).toBe(targetSeed);
      } finally {
        // Restore the original avatar so subsequent specs see the
        // baseline fixture.
        await getPrisma().user.update({
          where: { id: demoUserId },
          data: { avatar: originalAvatar },
        });
      }
    });

    it("rejects an unknown avatar seed with 400", async () => {
      const headers = await testApp.mutatingHeaders(demoUserId, demoUsername);
      const res = await testApp.inject("PATCH", "/api/v1/users/me/avatar", {
        headers,
        payload: { avatar: "not-a-real-avatar" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/users/me/class-stats", () => {
    it("returns 401 when the Authorization header is missing", async () => {
      const res = await testApp.inject("GET", "/api/v1/users/me/class-stats");
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 when the token is malformed", async () => {
      const res = await testApp.inject("GET", "/api/v1/users/me/class-stats", {
        headers: { authorization: "Bearer not-a-real-jwt" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 when an authenticated userId has no user row", async () => {
      // Authenticated but unknown userId — UsersService.getClassStats
      // throws NotFoundException("USER_NOT_FOUND").
      const headers = testApp.authedHeaders(
        "ckldoesnotexist111222333",
        "GhostPlayer",
      );
      const res = await testApp.inject("GET", "/api/v1/users/me/class-stats", {
        headers,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 200 with classWinrate, currentStreak, and cardsPlayed for a persisted demo user", async () => {
      // The success case — UsersService.getClassStats returns the
      // ClassStatsResponse envelope for any known user. The demo
      // user MAY have zero matches; the response still carries the
      // three required keys (classWinrate defaults to {}, the other
      // two are 0), so the assertion is safe regardless of seed state.
      const headers = testApp.authedHeaders(demoUserId, demoUsername);
      const res = await testApp.inject("GET", "/api/v1/users/me/class-stats", {
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: {
          stats: {
            classWinrate: Record<string, unknown>;
            currentStreak: number;
            cardsPlayed: number;
          };
        };
      }>();
      expect(body.data.stats).toHaveProperty("classWinrate");
      expect(body.data.stats.classWinrate).toBeTypeOf("object");
      expect(typeof body.data.stats.currentStreak).toBe("number");
      expect(typeof body.data.stats.cardsPlayed).toBe("number");
    });
  });
});
