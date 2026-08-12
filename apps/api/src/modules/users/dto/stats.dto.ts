import { z } from "zod";
import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";

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

// ============================================================
// Phase 3 — Profile stats additions (class winrate, streak, sabotage)
// ============================================================

/** Per-class winrate record. `plays` is 0 → `winRate` is 0 (not NaN). */
export const classWinrateSchema = z.object({
  plays: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
});

export type ClassWinrate = z.infer<typeof classWinrateSchema>;

export const phase3StatsSchema = z.object({
  /** Winrate split by ClassId (CONG / THU). Empty object when the user has no class-assigned matches yet. */
  classWinrate: z.object({
    CONG: classWinrateSchema.optional(),
    THU: classWinrateSchema.optional(),
  }),
  /**
   * Latest streakAfter across the user's daily attempts (0 if none).
   */
  currentStreak: z.number().int().nonnegative(),
  /**
   * SUM(MatchPlayer.cardsPlayed) across the user's FINISHED matches.
   * cardsPlayed is the authoritative counter persisted at
   * finishMatch (derived from CARD_RESOLVED events in the state
   * machine event log), so this aggregate survives event-log
   * eviction and stays a stable "aggression" counter across FINISHED
   * matches regardless of target.
   */
  sabotageCount: z.number().int().nonnegative(),
});

export type Phase3Stats = z.infer<typeof phase3StatsSchema>;

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
export class Phase3StatsDto implements Phase3Stats {
  @ApiProperty({
    description:
      "Per-class winrate keyed by ClassId (CONG / THU). Both keys are optional; the value is absent when the user has no class-assigned matches yet.",
    type: "object",
    additionalProperties: false,
    properties: {
      CONG: { allOf: [{ $ref: getSchemaPath(ClassWinrateDto) }] },
      THU: { allOf: [{ $ref: getSchemaPath(ClassWinrateDto) }] },
    },
    example: {
      CONG: { plays: 12, wins: 3, winRate: 0.25 },
      THU: { plays: 9, wins: 2, winRate: 0.22 },
    },
  })
  classWinrate!: {
    CONG?: ClassWinrateDto;
    THU?: ClassWinrateDto;
  };

  @ApiProperty({
    example: 7,
    description: "Latest streakAfter from daily attempts (0 if none)",
  })
  currentStreak!: number;

  @ApiProperty({
    example: 28,
    description:
      "Total of MatchPlayer.cardsPlayed across the user's FINISHED matches (authoritative counter persisted at finishMatch)",
  })
  sabotageCount!: number;
}

export const phase3StatsResponseSchema = z.object({
  stats: phase3StatsSchema,
});

export type Phase3StatsResponse = z.infer<typeof phase3StatsResponseSchema>;

export class Phase3StatsResponseDto implements Phase3StatsResponse {
  @ApiProperty({ type: Phase3StatsDto })
  stats!: Phase3StatsDto;
}
