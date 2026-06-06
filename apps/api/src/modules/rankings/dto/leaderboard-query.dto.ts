import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const leaderboardPeriodSchema = z.enum(["weekly", "all"]);
export type LeaderboardPeriod = z.infer<typeof leaderboardPeriodSchema>;

export const LEADERBOARD_CACHE_TTL_SEC = 60;

export const leaderboardQuerySchema = z.object({
  period: leaderboardPeriodSchema
    .default("weekly")
    .describe("Time window: weekly (last 7 days) or all-time"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Number of top players to return (1-100, default 50)"),
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
    required: false,
    default: 50,
    minimum: 1,
    maximum: 100,
    description: "Number of top players to return (1-100)",
  })
  limit!: number;
}
