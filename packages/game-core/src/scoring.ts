// ============================================================
// Game-core scoring — pure domain logic, no I/O.
// Scoring formula: total = SCORE_BASE_CORRECT + speed bonus.
// Speed bonus = max(0, (WINDOW - responseTimeMs) / DIVISOR).
// Incorrect answers earn 0 (caller should not invoke).
// ============================================================

import { GAME_CONFIG } from "@arena/shared";

export interface RoundScore {
  base: number;
  speedBonus: number;
  total: number;
}

export function computeRoundScore(responseTimeMs: number): RoundScore {
  const base = GAME_CONFIG.SCORE_BASE_CORRECT;
  const clamped = Math.max(0, responseTimeMs);
  const raw = Math.max(0, GAME_CONFIG.SCORE_SPEED_BONUS_WINDOW_MS - clamped);
  const speedBonus = raw / GAME_CONFIG.SCORE_SPEED_BONUS_DIVISOR;
  return { base, speedBonus, total: base + speedBonus };
}
