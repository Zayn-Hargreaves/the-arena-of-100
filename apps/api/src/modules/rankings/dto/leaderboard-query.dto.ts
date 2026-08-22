import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { CACHE_TTL } from "../../../common/config/cache-ttl";
import {
  LEADERBOARD_CACHE_LIMITS,
  type LeaderboardCacheLimit,
} from "../leaderboard-cache.helper";

export const leaderboardPeriodSchema = z.enum(["weekly", "all"]);
export type LeaderboardPeriod = z.infer<typeof leaderboardPeriodSchema>;

/**
 * @deprecated Import `CACHE_TTL.LEADERBOARD` from
 * `apps/api/src/common/config/cache-ttl` instead.
 */
export const LEADERBOARD_CACHE_TTL_SEC = CACHE_TTL.LEADERBOARD;

export const leaderboardQuerySchema = z.object({
  period: leaderboardPeriodSchema
    .default("weekly")
    .describe("Time window: weekly (last 7 days) or all-time"),
  limit: z.coerce
    .number()
    .int()
    .refine(
      (val): val is LeaderboardCacheLimit =>
        (LEADERBOARD_CACHE_LIMITS as readonly number[]).includes(val),
      {
        message: `Limit must be one of: ${LEADERBOARD_CACHE_LIMITS.join(", ")}`,
      },
    )
    .default(50)
    .describe("Number of top players to return (10, 25, 50, 100, default 50)"),
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export class LeaderboardQueryDto implements LeaderboardQuery {
  @ApiProperty({
    enum: ["weekly", "all"],
    required: false,
    default: "weekly",
    description: "Time window: weekly (last 7 days) or all-time",
  })
  period!: LeaderboardPeriod;

  @ApiProperty({
    enum: LEADERBOARD_CACHE_LIMITS,
    required: false,
    default: 50,
    description: "Number of top players to return (10, 25, 50, 100)",
  })
  limit!: LeaderboardCacheLimit;
}
