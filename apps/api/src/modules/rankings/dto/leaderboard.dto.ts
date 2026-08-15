import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { leaderboardPeriodSchema } from "./leaderboard-query.dto";
import {
  DEFAULT_ELO,
  getRankTier,
  rankTierSchema,
  type RankTier,
} from "@arena/shared";

export const leaderboardItemSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  username: z.string(),
  avatar: z.string(),
  elo: z.number().int().nonnegative().default(DEFAULT_ELO),
  rankTier: rankTierSchema.default(getRankTier(DEFAULT_ELO)),
  wins: z.number().int().nonnegative(),
  matchesPlayed: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  avgResponseMs: z.number().nonnegative(),
  totalScore: z.number().int().nonnegative(),
});

export const leaderboardResponseSchema = z.object({
  period: leaderboardPeriodSchema,
  generatedAt: z.string(),
  cached: z.boolean(),
  items: z.array(leaderboardItemSchema),
});

export type LeaderboardItem = z.infer<typeof leaderboardItemSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

export class LeaderboardItemDto implements LeaderboardItem {
  @ApiProperty({ example: 1, description: "1-based rank by wins desc" })
  rank!: number;

  @ApiProperty({ example: "ckl5g2x1y0000abcd1234efgh" })
  userId!: string;

  @ApiProperty({ example: "Zero_Cool" })
  username!: string;

  @ApiProperty({ example: "jellyfrog" })
  avatar!: string;

  @ApiProperty({ example: 1350, description: "Current ELO rating" })
  elo!: number;

  @ApiProperty({
    enum: rankTierSchema.options,
    example: "SILVER",
  })
  rankTier!: RankTier;

  @ApiProperty({
    example: 8,
    description: "Number of FINISHED wins (primary sort)",
  })
  wins!: number;

  @ApiProperty({ example: 42, description: "Matches played in the period" })
  matchesPlayed!: number;

  @ApiProperty({ example: 0.74, description: "Accuracy (0-1) over the period" })
  accuracy!: number;

  @ApiProperty({
    example: 580.5,
    description: "Average answer responseTimeMs over the period",
  })
  avgResponseMs!: number;

  @ApiProperty({
    example: 12450,
    description: "Sum of MatchPlayer.score over the period (tiebreak)",
  })
  totalScore!: number;
}

export class LeaderboardResponseDto implements LeaderboardResponse {
  @ApiProperty({ enum: ["weekly", "all"] })
  period!: "weekly" | "all";

  @ApiProperty({ example: "2026-06-06T18:24:00.000Z" })
  generatedAt!: string;

  @ApiProperty({
    example: false,
    description: "true = served from Redis cache",
  })
  cached!: boolean;

  @ApiProperty({ type: [LeaderboardItemDto] })
  items!: LeaderboardItemDto[];
}
