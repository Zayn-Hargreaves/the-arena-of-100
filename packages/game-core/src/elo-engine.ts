// ============================================================
// Game-core ELO Engine — pure domain logic, no I/O.
// Multi-player Battle Royale ELO calculation.
// ============================================================

import { DEFAULT_K_FACTOR } from "@arena/shared";

export interface EloPlayerInput {
  userId: string;
  currentElo: number;
  placement: number; // 1 for 1st, 2 for 2nd, etc.
  score: number;
}

export interface EloCalculationResult {
  userId: string;
  currentElo: number;
  newElo: number;
  delta: number;
  placement: number;
  score: number;
}

/**
 * Calculates multiplayer ELO ratings for all participants in a Battle Royale match.
 *
 * Uses the Pairwise Expected Outcome algorithm:
 * - Each player is evaluated against every other player in the room.
 * - Expected score against opponent j: E_ij = 1 / (1 + 10^((R_j - R_i) / 400))
 * - Actual score against opponent j: S_ij = 1 (higher placement), 0.5 (tie), 0 (lower placement)
 * - Normalized K-factor per pairing: K_norm = K / (N - 1)
 * - Delta = Math.round(K_norm * (S_i - E_i))
 * - New ELO = Math.max(0, currentElo + delta)
 *
 * Guarantees:
 * - Deterministic, pure function without external dependencies.
 * - Scales to any player count N >= 2 (tested from 2 to 100 players).
 * - Symmetrical zero-sum property before non-negative clamping.
 */
export function calculateMultiplayerElo(
  players: EloPlayerInput[],
  kFactor: number = DEFAULT_K_FACTOR,
): EloCalculationResult[] {
  const n = players.length;
  if (n === 0) return [];
  if (n === 1) {
    const p = players[0]!;
    return [
      {
        userId: p.userId,
        currentElo: p.currentElo,
        newElo: p.currentElo,
        delta: 0,
        placement: p.placement,
        score: p.score,
      },
    ];
  }

  const kNorm = kFactor / (n - 1);
  const results: EloCalculationResult[] = [];
  const powers = players.map((p) => Math.pow(10, p.currentElo / 400));

  for (let i = 0; i < n; i++) {
    const playerI = players[i]!;
    const powerI = powers[i]!;
    let expectedSum = 0;
    let actualSum = 0;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const playerJ = players[j]!;

      // Expected outcome of i vs j using precomputed powers
      const expectedAgainstJ = powerI / (powerI + powers[j]!);
      expectedSum += expectedAgainstJ;

      // Actual outcome of i vs j based on placement
      if (playerI.placement < playerJ.placement) {
        // Player i placed better (higher rank, smaller placement number)
        actualSum += 1;
      } else if (playerI.placement === playerJ.placement) {
        // Tied placement
        actualSum += 0.5;
      } else {
        // Player i placed worse
        actualSum += 0;
      }
    }

    const rawDelta = kNorm * (actualSum - expectedSum);
    const delta = Math.round(rawDelta);
    const newElo = Math.max(0, playerI.currentElo + delta);

    results.push({
      userId: playerI.userId,
      currentElo: playerI.currentElo,
      newElo,
      delta,
      placement: playerI.placement,
      score: playerI.score,
    });
  }

  return results;
}

/**
 * Assigns 1-based standard placement to players based on their scores.
 * Higher score = better placement (1st, 2nd, etc.).
 * Ties broken deterministically by avgResponseMs (lower is faster/better) then userId.
 */
export function assignPlacements<
  T extends { userId: string; score: number; avgResponseMs?: number },
>(players: T[]): Array<T & { placement: number }> {
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aSpeed = a.avgResponseMs ?? 0;
    const bSpeed = b.avgResponseMs ?? 0;
    if (aSpeed !== bSpeed) return aSpeed - bSpeed;
    return a.userId.localeCompare(b.userId);
  });

  return sorted.map((player, index) => ({
    ...player,
    placement: index + 1,
  }));
}
