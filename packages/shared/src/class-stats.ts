// ============================================================
// Class stats — profile stats contracts (class winrate + streak +
// cards played).
//
// Source of truth: memory-bank/spec/class-cards-phase.md §"Phase 3
// Profile stats". The Zod schemas + TS types live here so both
// `@arena/api` (server-side Zod parsing + DTO shape) and
// `@arena/web` (useClassStats hook + profile page) consume the
// SAME source of truth without duplicating definitions. NestJS
// `@ApiProperty` / DTO classes remain in `@arena/api` so Swagger
// metadata does not leak into a pure-shared package.
// ============================================================

import { z } from "zod";

/** Per-class winrate record. `plays` is 0 → `winRate` is 0 (not NaN). */
export const classWinrateSchema = z
  .object({
    plays: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1),
  })
  .refine((v) => v.plays !== 0 || v.winRate === 0, {
    message: "winRate must be 0 when plays is 0",
    path: ["winRate"],
  })
  .refine((v) => v.wins <= v.plays, {
    message: "wins cannot exceed plays",
    path: ["wins"],
  });

export type ClassWinrate = z.infer<typeof classWinrateSchema>;

export const classStatsSchema = z.object({
  /**
   * Winrate split by ClassId (ATTACK / DEFENSE). Empty object when
   * the user has no class-assigned matches yet.
   */
  classWinrate: z.object({
    ATTACK: classWinrateSchema.optional(),
    DEFENSE: classWinrateSchema.optional(),
  }),
  /**
   * Latest streakAfter across the user's daily attempts, but ONLY
   * if that attempt's dateKey matches UTC today or yesterday.
   * `0` when no recent attempt exists.
   */
  currentStreak: z.number().int().nonnegative(),
  /**
   * SUM(MatchPlayer.cardsPlayed) across the user's FINISHED matches.
   * cardsPlayed is the authoritative counter persisted at
   * finishMatch (derived from CARD_RESOLVED events in the state
   * machine event log), so this aggregate survives event-log
   * eviction and stays a stable "cards played" counter across
   * FINISHED matches regardless of target.
   */
  cardsPlayed: z.number().int().nonnegative(),
});

export type ClassStats = z.infer<typeof classStatsSchema>;

export const classStatsResponseSchema = z.object({
  stats: classStatsSchema,
});

export type ClassStatsResponse = z.infer<typeof classStatsResponseSchema>;
