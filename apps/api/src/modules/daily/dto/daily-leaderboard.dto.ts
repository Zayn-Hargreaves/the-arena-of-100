// ============================================================
// Daily Challenge - Leaderboard DTOs
// GET /daily/leaderboard query + response shape.
// ============================================================

import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { dateKeySchema } from "./daily-question.dto";

/**
 * Default page size for the leaderboard.
 *
 * Shared on purpose: `DailyService.invalidateLeaderboardCache` evicts exactly
 * the key produced by this default, so a literal in either place would let the
 * two drift apart and leave a stale entry that nothing ever clears.
 */
export const DAILY_LEADERBOARD_DEFAULT_LIMIT = 50;

export const dailyLeaderboardQuerySchema = z.object({
  /** Omitted = today (UTC). Explicit value lets a client browse past days. */
  dateKey: dateKeySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DAILY_LEADERBOARD_DEFAULT_LIMIT)
    .describe("Number of top players to return (1-100, default 50)"),
});

export type DailyLeaderboardQuery = z.infer<typeof dailyLeaderboardQuerySchema>;

export const dailyLeaderboardItemSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  username: z.string(),
  avatar: z.string(),
  score: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  streakAfter: z.number().int().nonnegative(),
  completedAt: z.string(),
});

export type DailyLeaderboardItem = z.infer<typeof dailyLeaderboardItemSchema>;

export const dailyLeaderboardResponseSchema = z.object({
  dateKey: dateKeySchema,
  generatedAt: z.string(),
  cached: z.boolean(),
  items: z.array(dailyLeaderboardItemSchema),
});

export type DailyLeaderboardResponse = z.infer<
  typeof dailyLeaderboardResponseSchema
>;

export class DailyLeaderboardQueryDto implements DailyLeaderboardQuery {
  @ApiProperty({
    required: false,
    example: "2026-08-09",
    description: "UTC day to rank. Defaults to today.",
  })
  dateKey?: string;

  @ApiProperty({
    required: false,
    default: 50,
    minimum: 1,
    maximum: 100,
    description: "Number of top players to return (1-100)",
  })
  limit!: number;
}

export class DailyLeaderboardItemDto implements DailyLeaderboardItem {
  @ApiProperty({ example: 1, description: "1-based rank by score desc" })
  rank!: number;

  @ApiProperty({ example: "ckl5g2x1y0000abcd1234efgh" })
  userId!: string;

  @ApiProperty({ example: "Zero_Cool" })
  username!: string;

  @ApiProperty({ example: "jellyfrog" })
  avatar!: string;

  @ApiProperty({ example: 1000 })
  score!: number;

  @ApiProperty({ example: 5 })
  correctCount!: number;

  @ApiProperty({ example: 7 })
  streakAfter!: number;

  @ApiProperty({ example: "2026-08-09T10:15:00.000Z" })
  completedAt!: string;
}

export class DailyLeaderboardResponseDto implements DailyLeaderboardResponse {
  @ApiProperty({ example: "2026-08-09" })
  dateKey!: string;

  @ApiProperty({ example: "2026-08-09T10:16:00.000Z" })
  generatedAt!: string;

  @ApiProperty({
    example: false,
    description: "true = served from Redis cache",
  })
  cached!: boolean;

  @ApiProperty({ type: [DailyLeaderboardItemDto] })
  items!: DailyLeaderboardItemDto[];
}
