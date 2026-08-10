// ============================================================
// AOE cap tracker — Arena of 100 (Phase 2 — sub-task F)
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "AOE cap = 2 per lobby per round" + §4.5 "post-append path".
//
// Spec contract:
//   - AOE counter is persisted, scoped (matchId, roundNo).
//     On init/failover it is derived from persisted CARD_RESOLVED
//     events (or canonical state) for the CURRENT persisted round.
//     NEVER trust an in-memory counter across a failover.
//   - Reset happens only when the persisted roundNo advances
//     in `endRound()`.
//   - This class is the in-memory mirror. The event log is the
//     source of truth — the server rebuilds the counter on
//     deserialize by scanning `currentRoundNo` and the log.
// ============================================================

import { AOE_CAP_PER_ROUND, type CardEffectEvent } from "@arena/shared";

// Derive the AOE count for a (matchId, roundNo) from the event log.
// Pure function — used by both the live handler and the deserializer.
//
// `events` is the event log (in seqNo order). It counts every
// `CARD_RESOLVED` event that targets more than the player
// themselves (i.e. `targetPlayerIds.length > 1` — the AOE shape).
//
// v1 simplification: ONLY effects with `targetPlayerIds.length > 1`
// count toward the cap. A single-target Offensive/CONG card is
// NOT considered AOE for budgeting purposes (the cap is about
// broadcast cost, not single-target cost).
export function countAoeResolved(
  events: ReadonlyArray<{ type: string; payload?: unknown }>,
  matchId: string,
  roundNo: number,
): number {
  let count = 0;
  for (const e of events) {
    if (e.type !== "CARD_RESOLVED") continue;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    if (payload.matchId !== matchId) continue;
    if (payload.roundNo !== roundNo) continue;
    const targets = (payload.targetPlayerIds ?? []) as string[];
    if (targets.length > 1) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// AoeCapTracker — per-match in-memory mirror
// ---------------------------------------------------------------------------
//
// The server keeps one of these per active match. The state
// machine or the match handler is responsible for calling
// `onCardResolved` after each successful append and `onEndRound`
// when the round boundary advances.
//
// In a multi-node deployment the counter is rebuilt on node
// startup via `rebuildFromLog` — same contract as the spec's
// "owner-fencing" rule for the persisted round counter.
// ---------------------------------------------------------------------------
export class AoeCapTracker {
  private currentRoundNo = 0;
  private currentAoeCount = 0;

  constructor(
    private readonly matchId: string,
    initialRoundNo: number,
    initialAoeCount: number,
  ) {
    this.currentRoundNo = initialRoundNo;
    this.currentAoeCount = initialAoeCount;
  }

  static empty(matchId: string): AoeCapTracker {
    return new AoeCapTracker(matchId, 0, 0);
  }

  // Rebuild from the event log (called on deserialize / failover).
  static rebuildFromLog(
    matchId: string,
    currentRoundNo: number,
    events: ReadonlyArray<{ type: string; payload?: unknown; seqNo: number }>,
  ): AoeCapTracker {
    const count = countAoeResolved(events, matchId, currentRoundNo);
    return new AoeCapTracker(matchId, currentRoundNo, count);
  }

  getCurrentRoundNo(): number {
    return this.currentRoundNo;
  }

  getCurrentAoeCount(): number {
    return this.currentAoeCount;
  }

  // AOE cap is 2 per round (spec §3.3).
  getCap(): number {
    return AOE_CAP_PER_ROUND;
  }

  // Called after a `CARD_RESOLVED` event is appended. Increments
  // the counter only for AOE-shaped resolutions (targetPlayerIds
  // length > 1). Single-target Offensive/CONG cards do NOT count.
  onCardResolved(event: CardEffectEvent): void {
    if (event.roundNo !== this.currentRoundNo) return;
    if (event.targetPlayerIds.length > 1) {
      this.currentAoeCount++;
    }
  }

  // Called when the round boundary advances (endRound).
  // Resets the counter for the next round.
  onEndRound(nextRoundNo: number): void {
    this.currentRoundNo = nextRoundNo;
    this.currentAoeCount = 0;
  }

  // Has the AOE cap for the current round been reached?
  isExhausted(): boolean {
    return this.currentAoeCount >= AOE_CAP_PER_ROUND;
  }
}
