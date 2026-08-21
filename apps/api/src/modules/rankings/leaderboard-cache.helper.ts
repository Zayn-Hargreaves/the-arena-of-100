import { Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export const LEADERBOARD_CACHE_PERIODS = ["weekly", "all"] as const;
export const LEADERBOARD_CACHE_LIMITS = [10, 25, 50, 100] as const;

export type LeaderboardCachePeriod = (typeof LEADERBOARD_CACHE_PERIODS)[number];
export type LeaderboardCacheLimit = (typeof LEADERBOARD_CACHE_LIMITS)[number];

export function getLeaderboardCacheKey(
  period: LeaderboardCachePeriod,
  limit: LeaderboardCacheLimit,
): string {
  return `leaderboard:v2:${period}:limit=${limit}`;
}

export async function invalidateLeaderboardCache(
  redis?: RedisService | null,
  logger?: Logger,
): Promise<void> {
  if (!redis) return;
  const promises: Promise<void>[] = [];
  for (const period of LEADERBOARD_CACHE_PERIODS) {
    for (const limit of LEADERBOARD_CACHE_LIMITS) {
      const key = getLeaderboardCacheKey(period, limit);
      promises.push(
        redis.del(key).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          logger?.warn(
            `Failed to delete leaderboard cache key ${key}: ${message}`,
          );
        }),
      );
    }
  }
  await Promise.all(promises);
}
