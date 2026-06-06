// ============================================================
// E2E: /rankings/leaderboard — public cache-aside endpoint
//
// The endpoint is @Public(), so no auth header is required.
// Cache TTL is 60s, so we flush Redis between tests to assert
// the miss -> hit -> staleness flow deterministically.
// ============================================================

import "./../setup-e2e";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./../helpers/test-app.factory";
import { disconnectPrisma, getPrisma } from "./../helpers/db-helpers";
import { disconnectRedis, flushTestRedis } from "./../helpers/redis-helpers";
import type { LeaderboardResponse } from "../../src/modules/rankings/dto";

describe("E2E /rankings", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    await flushTestRedis();
  });

  afterAll(async () => {
    await testApp.close();
    await disconnectPrisma();
    await disconnectRedis();
  });

  it("returns all-time leaderboard sorted by wins desc, populated from the demo seed", async () => {
    const res = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=all&limit=10",
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<{ success: boolean; data: LeaderboardResponse }>();
    expect(body.success).toBe(true);
    const data = body.data;
    expect(data.period).toBe("all");
    expect(data.items.length).toBeGreaterThan(0);

    // Items are ranked 1..N in order.
    data.items.forEach((item, idx) => {
      expect(item.rank).toBe(idx + 1);
      expect(item.matchesPlayed).toBeGreaterThan(0);
    });

    // Wins are non-increasing across the list.
    for (let i = 1; i < data.items.length; i++) {
      expect(data.items[i - 1]!.wins).toBeGreaterThanOrEqual(
        data.items[i]!.wins,
      );
    }

    // First request after a flush is a cache miss.
    expect(data.cached).toBe(false);
  });

  it("returns the same items from cache on a subsequent call (cached=true)", async () => {
    await flushTestRedis();

    const res1 = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=all&limit=10",
    );
    const miss = res1.json<{ success: boolean; data: LeaderboardResponse }>()
      .data;
    expect(miss.cached).toBe(false);

    const res2 = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=all&limit=10",
    );
    const hit = res2.json<{ success: boolean; data: LeaderboardResponse }>()
      .data;
    expect(hit.cached).toBe(true);
    expect(hit.generatedAt).toBe(miss.generatedAt);
  });

  it("filters weekly period to matches within the last 7 days only", async () => {
    await flushTestRedis();

    const weekly = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=weekly&limit=50",
    );
    const all = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=all&limit=50",
    );

    const weeklyData = weekly.json<{
      success: boolean;
      data: LeaderboardResponse;
    }>().data;
    const allData = all.json<{ success: boolean; data: LeaderboardResponse }>()
      .data;

    // The seed creates 8 matches spread across 14 days, so weekly
    // must return a subset (or equal) of all-time, never more.
    expect(weeklyData.items.length).toBeLessThanOrEqual(allData.items.length);
    expect(weeklyData.items.length).toBeGreaterThan(0);

    // Each user in the weekly view must have at least one match
    // within the last 7 days. We sanity-check this via the DB.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    for (const item of weeklyData.items) {
      const recentCount = await getPrisma().match.count({
        where: {
          status: "FINISHED",
          endedAt: { gte: sevenDaysAgo },
          players: { some: { userId: item.userId } },
        },
      });
      expect(recentCount).toBeGreaterThan(0);
    }
  });

  it("rejects an invalid period with 400", async () => {
    const res = await testApp.inject(
      "GET",
      "/api/v1/rankings/leaderboard?period=monthly",
    );
    expect(res.statusCode).toBe(400);
  });
});
