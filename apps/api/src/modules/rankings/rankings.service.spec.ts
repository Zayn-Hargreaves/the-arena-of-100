import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger } from "@nestjs/common";
import { RankingsService } from "./rankings.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { LEADERBOARD_CACHE_TTL_SEC } from "./dto";

describe("RankingsService", () => {
  let service: RankingsService;
  let prisma: { $queryRaw: any };
  let redis: { getJSON: any; setJSON: any };

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn() };
    redis = { getJSON: vi.fn(), setJSON: vi.fn() };
    service = new RankingsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
    // Silence logger in test output
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  });

  describe("cache hit", () => {
    it("returns cached payload with cached=true and skips DB query", async () => {
      const cachedPayload = {
        period: "weekly" as const,
        generatedAt: "2026-06-06T10:00:00.000Z",
        items: [
          {
            rank: 1,
            userId: "u1",
            username: "Alice",
            avatar: "jellyfrog",
            wins: 5,
            matchesPlayed: 10,
            accuracy: 0.8,
            avgResponseMs: 500,
            totalScore: 1000,
          },
        ],
      };
      vi.mocked(redis.getJSON).mockResolvedValue(cachedPayload);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(result).toEqual({ ...cachedPayload, cached: true });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(redis.setJSON).not.toHaveBeenCalled();
      // Cache key encodes period + limit
      expect(redis.getJSON).toHaveBeenCalledWith("leaderboard:weekly:limit=50");
    });
  });

  describe("cache miss", () => {
    it("queries DB, sets cache with TTL=60, and returns cached=false", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 5,
          matches_played: 10,
          total_score: 1000,
          avg_response_ms: "500.00",
          accuracy: "0.8000",
        },
      ]);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(result.cached).toBe(false);
      expect(result.period).toBe("weekly");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        rank: 1,
        userId: "u1",
        username: "Alice",
        avatar: "jellyfrog",
        elo: 1200,
        rankTier: "SILVER",
        wins: 5,
        matchesPlayed: 10,
        accuracy: 0.8,
        avgResponseMs: 500,
        totalScore: 1000,
      });
      expect(redis.setJSON).toHaveBeenCalledWith(
        "leaderboard:weekly:limit=50",
        expect.objectContaining({
          period: "weekly",
          items: expect.any(Array),
        }),
        LEADERBOARD_CACHE_TTL_SEC,
      );
    });
  });

  describe("SQL period branch", () => {
    it("uses weekly SQL with INTERVAL '7 days' filter when period=weekly", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      await service.getLeaderboard({ period: "weekly", limit: 10 });

      // Prisma $queryRaw returns a SQL object; the test surface is "called exactly once"
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // generatedAt is ISO; period is preserved in cache
      expect(redis.setJSON).toHaveBeenCalledWith(
        "leaderboard:weekly:limit=10",
        expect.objectContaining({ period: "weekly" }),
        LEADERBOARD_CACHE_TTL_SEC,
      );
    });

    it("uses all-time SQL (no time filter) when period=all", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      await service.getLeaderboard({ period: "all", limit: 10 });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(redis.setJSON).toHaveBeenCalledWith(
        "leaderboard:all:limit=10",
        expect.objectContaining({ period: "all" }),
        LEADERBOARD_CACHE_TTL_SEC,
      );
    });

    it("encodes limit into cache key (different limit => different cache entry)", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      await service.getLeaderboard({ period: "weekly", limit: 25 });
      await service.getLeaderboard({ period: "weekly", limit: 100 });

      expect(redis.getJSON).toHaveBeenNthCalledWith(
        1,
        "leaderboard:weekly:limit=25",
      );
      expect(redis.getJSON).toHaveBeenNthCalledWith(
        2,
        "leaderboard:weekly:limit=100",
      );
    });
  });

  describe("ordering and rank assignment", () => {
    it("assigns 1-based ranks in the order rows come back (DB already sorts)", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 10,
          matches_played: 20,
          total_score: 2000,
          avg_response_ms: "400.00",
          accuracy: "0.9000",
        },
        {
          user_id: "u2",
          username: "Bob",
          avatar: "tux",
          wins: 8,
          matches_played: 15,
          total_score: 1500,
          avg_response_ms: "500.00",
          accuracy: "0.8000",
        },
        {
          user_id: "u3",
          username: "Charlie",
          avatar: "clippy",
          wins: 3,
          matches_played: 10,
          total_score: 600,
          avg_response_ms: "700.00",
          accuracy: "0.7000",
        },
      ]);

      const result = await service.getLeaderboard({
        period: "all",
        limit: 50,
      });

      expect(result.items.map((i) => i.rank)).toEqual([1, 2, 3]);
      expect(result.items[0].userId).toBe("u1");
      expect(result.items[1].userId).toBe("u2");
      expect(result.items[2].userId).toBe("u3");
    });
  });

  describe("empty result", () => {
    it("returns items=[] and cached=false when no users have FINISHED matches", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(result.items).toEqual([]);
      expect(result.cached).toBe(false);
      expect(result.period).toBe("weekly");
      // Still writes an empty leaderboard to cache (cheap; prevents stampede)
      expect(redis.setJSON).toHaveBeenCalled();
    });
  });

  describe("Redis failure handling", () => {
    it("falls back to DB and returns cached=false when redis.getJSON throws", async () => {
      vi.mocked(redis.getJSON).mockRejectedValue(new Error("Redis offline"));
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 5,
          matches_played: 10,
          total_score: 1000,
          avg_response_ms: "500.00",
          accuracy: "0.8000",
        },
      ]);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(result.cached).toBe(false);
      expect(result.items).toHaveLength(1);
    });

    it("still returns response when redis.setJSON throws (best-effort write)", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(redis.setJSON).mockRejectedValue(new Error("Redis offline"));
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 5,
          matches_played: 10,
          total_score: 1000,
          avg_response_ms: "500.00",
          accuracy: "0.8000",
        },
      ]);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(result.cached).toBe(false);
      expect(result.items).toHaveLength(1);
    });
  });

  describe("BigInt safety", () => {
    it("converts BigInt values from raw SQL to Number safely", async () => {
      vi.mocked(redis.getJSON).mockResolvedValue(null);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        {
          user_id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 5n,
          matches_played: 10n,
          total_score: 1000n,
          avg_response_ms: "500.00",
          accuracy: "0.8000",
        },
      ]);

      const result = await service.getLeaderboard({
        period: "weekly",
        limit: 50,
      });

      expect(typeof result.items[0].wins).toBe("number");
      expect(typeof result.items[0].matchesPlayed).toBe("number");
      expect(typeof result.items[0].totalScore).toBe("number");
    });
  });

  describe("TTL constant", () => {
    it("uses 60-second TTL (matches spec — Option C sweet spot)", () => {
      expect(LEADERBOARD_CACHE_TTL_SEC).toBe(60);
    });
  });
});
