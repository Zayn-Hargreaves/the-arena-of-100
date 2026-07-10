// ============================================================
// Tie-break resolution — Game Đấu Trường 100
//
// Pure, deterministic tie-break extracted from MatchStateMachine.
// Given the tied player ids, their info, and a stable per-match
// seed source (the match id), it returns the winning player id
// (or null for an empty roster). Behaviour is unchanged from the
// original private `MatchStateMachine.tieBreak`.
//
// Kept as a plain function on purpose: it is the low-blast-radius
// Strategy candidate noted in the memory-bank. Only promote to a
// `TieBreakStrategy` interface if a second variant actually appears.
// ============================================================

import type { PlayerInfo } from "@arena/shared";
import { hashStringToSeed, mulberry32 } from "./prng";

/**
 * Resolve the tie-break winner from a set of tied player ids.
 *
 * Ordering (strict weak, so Array#sort is stable/reproducible):
 *   1. Faster total response time wins.
 *   2. More correct answers wins.
 *   3. Deterministic per-match random offset (L5 fix) — removes the
 *      "alphabetical id wins" structural bias while staying
 *      reproducible across process restarts.
 *   4. Alphabetical player id as the final deterministic fallback.
 *
 * Missing players (state corruption / desync) always sort last so
 * they can never win, while still yielding a total order.
 *
 * @returns the winning player id, or `null` when `playerIds` is empty.
 */
export function resolveTieBreak(
  playerIds: string[],
  players: ReadonlyMap<string, PlayerInfo>,
  matchId: string,
): string | null {
  // Filter out any players not present in the players map (missing/disconnected/desynced/corrupted/empty).
  const activePlayerIds = playerIds.filter((id) => players.has(id));

  // Empty-roster short-circuit. Sort + seeded RNG on an empty array
  // is wasted work, and `sorted[0]` would be `undefined`.
  if (activePlayerIds.length === 0) {
    return null;
  }

  // Seed a deterministic PRNG from the match id so the same match +
  // the same stats always produce the same winner, then assign each
  // player a uniformly-distributed offset used as tie-breaker #3.
  const seed = hashStringToSeed(matchId);
  const offsets = new Map<string, number>();
  const rng = mulberry32(seed);
  for (const id of activePlayerIds) {
    offsets.set(id, rng());
  }

  const sorted = [...activePlayerIds].sort((a, b) => {
    const playerA = players.get(a)!;
    const playerB = players.get(b)!;

    // First: compare total response time (ascending = faster is better).
    if (playerA.totalResponseTimeMs !== playerB.totalResponseTimeMs) {
      return playerA.totalResponseTimeMs - playerB.totalResponseTimeMs;
    }

    // Second: compare correct answers count (more is better).
    if (playerA.correctAnswers !== playerB.correctAnswers) {
      return playerB.correctAnswers - playerA.correctAnswers;
    }

    // Third: deterministic random offset (per-match seed, L5 fix).
    const offsetA = offsets.get(a) ?? 0;
    const offsetB = offsets.get(b) ?? 0;
    if (offsetA !== offsetB) return offsetA - offsetB;

    // Final: alphabetical by player id (strict weak ordering guarantee).
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return sorted[0];
}
