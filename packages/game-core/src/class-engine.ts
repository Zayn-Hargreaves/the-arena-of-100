// ============================================================
// Class assignment engine — Arena of 100 (Phase 2)
// Source of truth: memory-bank/spec/class-cards-phase.md §2
// (Decision 2: "Random server-side per match").
// §5.2 "Architectural commitments" — Class assignment
// persistence: once a (matchId, playerId) pair is assigned, the
// immutable CLASS_ASSIGNED event is the authoritative source
// for that player's class.
//
// Pure, dependency-free, infrastructure-free. Consumes an
// explicit seed (never ambient `Math.random`) so the same seed
// produces the same assignment across processes / replays.
// ============================================================

import type { ClassId } from "@arena/shared";
import { deriveSubstream, mulberry32 } from "./prng";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassAssignment {
  playerId: string;
  classId: ClassId;
}

// Stable ordering for the seed-derived bytes: playerIds are
// sorted by `comparePlayerId` (ASCII) so the assignment is a
// function of `(sortedPlayerIds, seed)` only — the order in
// which the caller passes playerIds is irrelevant.
function comparePlayerId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Assign a random class to each playerId.
 *
 * Algorithm: roll-and-rank. Sort the playerIds canonically; draw
 * one RNG float per player; sort the (playerId, roll) pairs by
 * the roll; then assign classes alternately by rank —
 * ATTACK, DEFENSE, ATTACK, DEFENSE, … — so even ranks (0, 2, 4…)
 * get ATTACK and odd ranks get DEFENSE. For an even player count
 * this yields exactly 50/50; for an odd count the extra rank goes
 * to ATTACK (the "off-by-one split going in favor of
 * Offensive/ATTACK" the spec asks for under Decision 2 + Risk 5).
 *
 * The roll is deterministic given the seed. Replay the
 * assignments by re-running with the same `seedUsed` — the
 * returned array preserves the order of `drawn` (sorted by roll),
 * so the result is byte-identical across processes.
 */
export function assignClasses(
  playerIds: readonly string[],
  seedUsed: string,
): ClassAssignment[] {
  if (playerIds.length === 0) return [];

  const substreamSeed = deriveSubstream(seedUsed, "class");
  const rng = mulberry32(substreamSeed);

  // Pair (playerId, rng byte) for each player, then sort by the
  // RNG byte — equivalent to a single shuffle per draw. This
  // avoids the need to keep a running pool of unused classes
  // and matches the spec's "random assignment" without
  // favoring one class over the other.
  const sortedPlayers = playerIds.slice().sort(comparePlayerId);
  const drawn = sortedPlayers.map((playerId) => ({
    playerId,
    roll: rng(),
  }));
  drawn.sort((a, b) => a.roll - b.roll);

  // Zip the sorted result with an ATTACK/DEFENSE alternating
  // pattern — the canonical fair split. For 100 players this yields
  // exactly 50/50.
  return drawn.map((d, i) => ({
    playerId: d.playerId,
    classId: (i % 2 === 0 ? "ATTACK" : "DEFENSE") as ClassId,
  }));
}
