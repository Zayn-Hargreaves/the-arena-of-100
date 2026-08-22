import { z } from "zod";
import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import {
  classWinrateSchema,
  classStatsSchema,
  classStatsResponseSchema,
  rankTierSchema,
  type ClassWinrate,
  type ClassStats,
  type ClassStatsResponse,
  type RankTier,
} from "@arena/shared";

export const userSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  avatar: z.string(),
  role: z.enum(["GUEST", "ADMIN"]),
  elo: z.number().int().nonnegative().default(1200),
  rankTier: rankTierSchema.default("SILVER"),
  createdAt: z.string().optional(),
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

  @ApiProperty({ example: 1250, description: "Current ELO rating" })
  elo!: number;

  @ApiProperty({
    enum: [
      "BRONZE",
      "SILVER",
      "GOLD",
      "PLATINUM",
      "DIAMOND",
      "MASTER",
      "GRANDMASTER",
    ],
    example: "SILVER",
  })
  rankTier!: RankTier;

  @ApiProperty({
    example: "2026-08-01T00:00:00.000Z",
    required: false,
    description: "Account creation timestamp in ISO 8601",
  })
  createdAt?: string;
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

// ============================================================
// Class stats — Profile stats additions (class winrate, streak,
// cards played).
//
// The Zod schema + Zod-inferred TS types (ClassWinrate,
// ClassStats, ClassStatsResponse) live in `@arena/shared` so the
// web hook + this DTO consume the same single source of truth.
// NestJS-specific Swagger DTOs + decorators stay local so the
// API package remains the only place that knows about Swagger.
// ============================================================

// Re-export shared schemas + types for downstream API code that
// imports them from `./dto` (e.g. users.controller.ts validates the
// response shape with the same Zod schema).
export { classWinrateSchema, classStatsSchema, classStatsResponseSchema };
export type { ClassWinrate, ClassStats, ClassStatsResponse };

export class ClassWinrateDto implements ClassWinrate {
  @ApiProperty({
    example: 12,
    description: "FINISHED matches where the user was this class",
  })
  plays!: number;

  @ApiProperty({ example: 3, description: "Wins while this class" })
  wins!: number;

  @ApiProperty({
    example: 0.25,
    description: "wins / plays (0 when plays = 0)",
  })
  winRate!: number;
}

@ApiExtraModels(ClassWinrateDto)
export class ClassStatsDto implements ClassStats {
  @ApiProperty({
    description:
      "Per-class winrate keyed by ClassId (ATTACK / DEFENSE). Both keys are optional; the value is absent when the user has no class-assigned matches yet.",
    type: "object",
    additionalProperties: false,
    properties: {
      ATTACK: { allOf: [{ $ref: getSchemaPath(ClassWinrateDto) }] },
      DEFENSE: { allOf: [{ $ref: getSchemaPath(ClassWinrateDto) }] },
    },
    example: {
      ATTACK: { plays: 12, wins: 3, winRate: 0.25 },
      DEFENSE: { plays: 9, wins: 2, winRate: 0.22 },
    },
  })
  classWinrate!: {
    ATTACK?: ClassWinrateDto;
    DEFENSE?: ClassWinrateDto;
  };

  @ApiProperty({
    example: 7,
    description:
      "Latest streakAfter from daily attempts (0 if the most-recent attempt is not UTC today or yesterday)",
  })
  currentStreak!: number;

  @ApiProperty({
    example: 28,
    description:
      "Total of MatchPlayer.cardsPlayed across the user's FINISHED matches (authoritative counter persisted at finishMatch)",
  })
  cardsPlayed!: number;
}

export class ClassStatsResponseDto implements ClassStatsResponse {
  @ApiProperty({ type: ClassStatsDto })
  stats!: ClassStatsDto;
}
