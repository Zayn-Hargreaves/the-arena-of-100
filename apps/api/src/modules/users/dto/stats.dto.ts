import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const userSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  avatar: z.string(),
  role: z.enum(["GUEST", "ADMIN"]),
});

export const statsSchema = z.object({
  matchesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
  avgResponseMs: z.number().nonnegative(),
  accuracy: z.number().min(0).max(1),
  winRate: z.number().min(0).max(1),
  survivalRate: z.number().min(0).max(1),
  totalCorrectAnswers: z.number().int().nonnegative(),
});

export const statsResponseSchema = z.object({
  user: userSummarySchema,
  stats: statsSchema,
});

export type UserSummary = z.infer<typeof userSummarySchema>;
export type Stats = z.infer<typeof statsSchema>;
export type StatsResponse = z.infer<typeof statsResponseSchema>;

export class UserSummaryDto implements UserSummary {
  @ApiProperty({ example: "ckl5g2x1y0000abcd1234efgh" })
  id!: string;

  @ApiProperty({ example: "Zero_Cool" })
  username!: string;

  @ApiProperty({ example: "jellyfrog" })
  avatar!: string;

  @ApiProperty({ enum: ["GUEST", "ADMIN"], example: "GUEST" })
  role!: "GUEST" | "ADMIN";
}

export class StatsDto implements Stats {
  @ApiProperty({
    example: 42,
    description: "Number of FINISHED matches the user joined",
  })
  matchesPlayed!: number;

  @ApiProperty({
    example: 8,
    description: "Number of FINISHED matches where the user is the winner",
  })
  wins!: number;

  @ApiProperty({
    example: 12450,
    description: "Sum of MatchPlayer.score across FINISHED matches",
  })
  totalScore!: number;

  @ApiProperty({
    example: 580.5,
    description: "Average Answer.responseTimeMs (ms) across FINISHED matches",
  })
  avgResponseMs!: number;

  @ApiProperty({
    example: 0.74,
    description: "Accuracy (0-1) = correct/total answers in FINISHED matches",
  })
  accuracy!: number;

  @ApiProperty({
    example: 0.19,
    description: "Win rate (0-1) = wins / matchesPlayed",
  })
  winRate!: number;

  @ApiProperty({
    example: 0.62,
    description:
      "Share of FINISHED matches where user finished in top 50% by score",
  })
  survivalRate!: number;

  @ApiProperty({
    example: 235,
    description:
      "Total correct answers across FINISHED matches (proxy for eliminations)",
  })
  totalCorrectAnswers!: number;
}

export class StatsResponseDto implements StatsResponse {
  @ApiProperty({ type: UserSummaryDto })
  user!: UserSummaryDto;

  @ApiProperty({ type: StatsDto })
  stats!: StatsDto;
}
