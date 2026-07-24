// ============================================================
// C3 — failover verdict (PURE module, no k6 / no I/O).
//
// The chaos orchestrator (scripts/chaos-failover.mjs) writes a
// `*.failover.json` timeline; this module turns that artifact into a
// reproducible PASS / FAIL / INCONCLUSIVE verdict. It is deliberately a
// plain Node module so the whole oracle runs under vitest with hand-built
// artifacts — see failover-verdict.test.mjs.
//
// Design rules from 72-C3-chaos-failover.md:
//   * ONE clock: every t_* and round_events[].t is the orchestrator's
//     single monotonic clock, so all temporal comparisons are like-with-like.
//   * Step 0 validates the timeline and DERIVES recovery from evidence (the
//     fence in the round-event payload) instead of trusting recorded fields.
//   * The recovery oracle deduplicates round events by eventId (canonical =
//     smallest observed t), then requires strictly increasing roundIndex and
//     no stale-fence broadcast — split-brain checks.
//   * The reconnect criterion carries a coverage gate: a node-kill that
//     observed zero unexpected closes did not exercise reconnect, so vacuous
//     "rate 1.0" cannot become a PASS — it is INCONCLUSIVE.
// ============================================================

export const VERDICT = {
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE",
};

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// A round observation is usable ONLY when it carries all four pieces of
// evidence as the right types: a string eventId, and finite numeric t,
// roundIndex, and fence. A missing/typeless roundIndex or fence is a
// missing-evidence artifact — dropping it is correct, because feeding it into
// the oracle would fabricate a `round_regression` (roundIndex undefined never
// increases) or `unknown_fence` (fence undefined ∉ knownFences) violation the
// timeline never actually exhibited.
function isValidRoundEvent(ev) {
  return (
    ev &&
    typeof ev.eventId === "string" &&
    isFiniteNumber(ev.t) &&
    isFiniteNumber(ev.roundIndex) &&
    isFiniteNumber(ev.fence)
  );
}

// The canonical observation for a set of same-eventId records: the one with the
// SMALLEST observed t (the first observation); ties keep the first in iteration
// order. Shared by dedupeRoundEvents and detectRoundConflicts so both agree on
// exactly which observation is "the" canonical one.
function pickCanonical(evs) {
  let canonical = null;
  for (const ev of evs) {
    if (canonical === null || ev.t < canonical.t) canonical = ev;
  }
  return canonical;
}

// Canonicalize raw ROUND_STARTED observations: many clients/log lines
// re-observe one broadcast, so for each eventId keep exactly ONE entry (see
// pickCanonical — smallest observed t), then order the sequence by that
// canonical t. Deterministic regardless of arrival order or how many clients
// re-observed each event. Malformed observations (see isValidRoundEvent) are
// dropped, never counted as a round.
export function dedupeRoundEvents(raw) {
  const groups = new Map();
  for (const ev of raw || []) {
    if (!isValidRoundEvent(ev)) continue;
    if (!groups.has(ev.eventId)) groups.set(ev.eventId, []);
    groups.get(ev.eventId).push(ev);
  }
  const canonical = [];
  for (const evs of groups.values()) {
    const c = pickCanonical(evs);
    canonical.push({
      t: c.t,
      eventId: c.eventId,
      roundIndex: c.roundIndex,
      fence: c.fence,
    });
  }
  return canonical.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    // Stable tiebreak so equal-t canonical entries order deterministically.
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
}

// Zombie-writer detection. dedupeRoundEvents collapses each eventId to its
// earliest observation — which SILENTLY discards a later duplicate that
// disagrees on roundIndex or fence (exactly the fingerprint of a stale/killed
// owner re-emitting a round under an old fence). This scans the valid raw
// observations and, for every eventId whose observations do NOT all agree on
// (roundIndex, fence), records the divergent payload(s) so the oracle can
// report the split-brain instead of hiding it behind the smallest-t canonical.
export function detectRoundConflicts(raw) {
  const groups = new Map();
  for (const ev of raw || []) {
    if (!isValidRoundEvent(ev)) continue;
    if (!groups.has(ev.eventId)) groups.set(ev.eventId, []);
    groups.get(ev.eventId).push(ev);
  }
  const conflicts = [];
  for (const [eventId, evs] of groups) {
    const canonical = pickCanonical(evs);
    const conflicting = evs
      .filter(
        (e) =>
          e.roundIndex !== canonical.roundIndex || e.fence !== canonical.fence,
      )
      .map((e) => ({ roundIndex: e.roundIndex, fence: e.fence, t: e.t }));
    if (conflicting.length > 0) {
      conflicts.push({
        eventId,
        canonical: {
          roundIndex: canonical.roundIndex,
          fence: canonical.fence,
          t: canonical.t,
        },
        conflicting,
      });
    }
  }
  return conflicts;
}

// First post-kill round event emitted under the NEW owner's fence. The fence
// (not a poll timestamp) proves the event was emitted by the new owner; both
// come from the same broadcast payload, so no cross-clock comparison.
export function deriveRecovery(canonicalEvents, tKill, ownerAfterFence) {
  for (const ev of canonicalEvents) {
    if (ev.t > tKill && ev.fence === ownerAfterFence) {
      return { tRecoverDerived: ev.t, event: ev };
    }
  }
  return { tRecoverDerived: null, event: null };
}

// Split-brain oracle over the canonical (deduped, t-ordered) sequence.
// `conflicts` (from detectRoundConflicts) are same-eventId observations that
// disagreed on roundIndex/fence — surfaced here as zombie_writer_conflict so a
// stale-owner re-emission is never hidden by dedupe keeping only the earliest t.
export function runOracle(
  canonicalEvents,
  { tKill, ownerBefore, ownerAfter, conflicts = [] },
) {
  const violations = [];
  for (const c of conflicts) {
    violations.push({
      code: "zombie_writer_conflict",
      eventId: c.eventId,
      canonical: c.canonical,
      conflicting: c.conflicting,
    });
  }
  const knownFences = new Set([ownerBefore.fence, ownerAfter.fence]);

  let prevRound = null;
  let prevFence = null;
  for (const ev of canonicalEvents) {
    if (prevRound !== null && !(ev.roundIndex > prevRound)) {
      // Not merely "no repeated round" — a 3->2 regression is split-brain too.
      violations.push({
        code: "round_regression",
        eventId: ev.eventId,
        roundIndex: ev.roundIndex,
        prevRound,
      });
    }
    if (!knownFences.has(ev.fence)) {
      violations.push({
        code: "unknown_fence",
        eventId: ev.eventId,
        fence: ev.fence,
      });
    }
    if (prevFence !== null && ev.fence < prevFence) {
      // A lower fence after a higher one = a stale owner still emitting.
      violations.push({
        code: "fence_regression",
        eventId: ev.eventId,
        fence: ev.fence,
        prevFence,
      });
    }
    if (ev.t > tKill && ev.fence < ownerAfter.fence) {
      // A post-kill broadcast under an OLD fence — the killed owner or a
      // zombie writer. Stale even when its round number is unique.
      violations.push({
        code: "stale_fence_post_kill",
        eventId: ev.eventId,
        fence: ev.fence,
        expectedMinFence: ownerAfter.fence,
      });
    }
    prevRound = ev.roundIndex;
    prevFence = ev.fence;
  }

  return {
    passed: violations.length === 0,
    deduped_event_count: canonicalEvents.length,
    violations,
  };
}

// reconnect.rate = successes / unexpected_closes over the SAME population of
// non-intentional closes k6 observed. Zero-denominator: rate is 1.0 for
// DISPLAY only (never NaN/null); the coverage gate is what a real verdict
// reads, and a zero denominator can never satisfy it.
export function computeReconnectRate({ successes, unexpected_closes }, minCloses) {
  const s = isFiniteNumber(successes) ? successes : 0;
  const d = isFiniteNumber(unexpected_closes) ? unexpected_closes : 0;
  const displayRate = d === 0 ? 1.0 : s / d;
  return {
    successes: s,
    unexpectedCloses: d,
    displayRate,
    coverageMet: d >= minCloses,
    // The rate that can satisfy a threshold: undefined when vacuous, so a
    // zero-denominator 1.0 never counts toward PASS.
    effectiveRate: d === 0 ? null : s / d,
  };
}

const DEFAULT_THRESHOLDS = {
  answer_p95_multiplier_max: 5,
  time_to_recover_max_ms: 20000,
  reconnect_success_min: 0.99,
  min_unexpected_closes: 1,
};

// Evaluate a *.failover.json artifact. Returns
//   { verdict, reasons: [{code, detail}], derived: {...}, oracle: {...} }
// `reasons` is the list of UNSATISFIED criteria (empty on PASS). A single
// `invalid_artifact` reason means Step 0 rejected the timeline before any
// threshold was evaluated.
export function evaluateFailover(artifact) {
  const reasons = [];
  const fail = (code, detail) => reasons.push({ code, detail });

  const th = { ...DEFAULT_THRESHOLDS, ...(artifact.thresholds || {}) };
  const ownerBefore = artifact.owner_before || {};
  const ownerAfter = artifact.owner_after || {};

  // Reject non-finite threshold OVERRIDES up front. A NaN override silently
  // survives the spread above and would make every bounded comparison
  // (p95 <= NaN, timeToRecover <= NaN, rate >= NaN) evaluate false — a false
  // FAIL. Treat it as an invalid artifact instead of comparing against NaN.
  if (artifact.thresholds && typeof artifact.thresholds === "object") {
    for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
      if (key in artifact.thresholds && !isFiniteNumber(artifact.thresholds[key])) {
        fail("invalid_artifact", `threshold ${key} is not a finite number`);
      }
    }
  }

  // ---- Step 0: timeline sanity (all present, finite, non-zero where req'd) ----
  const tStart = artifact.t_start;
  const tMatch = artifact.t_match_started;
  const tKill = artifact.t_kill;
  const tFlip = artifact.t_owner_flip;
  const tRecover = artifact.t_recover;

  const timeline = [
    ["t_start", tStart, false],
    ["t_match_started", tMatch, false],
    ["t_kill", tKill, true],
    ["t_owner_flip", tFlip, true],
    ["t_recover", tRecover, true],
  ];
  let timelineOk = true;
  for (const [name, val, nonZero] of timeline) {
    if (!isFiniteNumber(val)) {
      fail("invalid_artifact", `${name} missing or not finite`);
      timelineOk = false;
    } else if (nonZero && val <= 0) {
      fail("invalid_artifact", `${name} must be > 0 (got ${val})`);
      timelineOk = false;
    }
  }

  if (timelineOk) {
    // NOTE: deliberately NOT requiring t_owner_flip <= t_recover — a valid
    // post-failover round event can be observed during the poll gap, before
    // the periodic poll notices the lease flip.
    if (!(tStart <= tMatch))
      fail("invalid_artifact", `t_start(${tStart}) > t_match_started(${tMatch})`);
    if (!(tMatch <= tKill))
      fail("invalid_artifact", `t_match_started(${tMatch}) > t_kill(${tKill})`);
    if (!(tKill < tFlip))
      fail("invalid_artifact", `t_kill(${tKill}) >= t_owner_flip(${tFlip})`);
    if (!(tKill < tRecover))
      fail("invalid_artifact", `t_kill(${tKill}) >= t_recover(${tRecover})`);
  }

  // ---- Derive recovery from evidence (fence), not the recorded field ----
  const canonical = dedupeRoundEvents(artifact.round_events);
  let tRecoverDerived = null;
  let timeToRecover = null;
  if (timelineOk && isFiniteNumber(ownerAfter.fence)) {
    const d = deriveRecovery(canonical, tKill, ownerAfter.fence);
    tRecoverDerived = d.tRecoverDerived;
    if (tRecoverDerived === null) {
      fail(
        "invalid_artifact",
        "no post-kill round_events entry carrying owner_after.fence",
      );
    } else {
      if (isFiniteNumber(tRecover) && tRecover !== tRecoverDerived) {
        fail(
          "invalid_artifact",
          `recorded t_recover(${tRecover}) != derived(${tRecoverDerived})`,
        );
      }
      timeToRecover = tRecoverDerived - tKill;
      if (
        isFiniteNumber(artifact.time_to_recover_ms) &&
        artifact.time_to_recover_ms !== timeToRecover
      ) {
        fail(
          "invalid_artifact",
          `recorded time_to_recover_ms(${artifact.time_to_recover_ms}) != recomputed(${timeToRecover})`,
        );
      }
    }
  }

  // If Step 0 rejected the artifact, stop before threshold evaluation.
  const invalid = reasons.some((r) => r.code === "invalid_artifact");
  const derived = {
    tRecoverDerived,
    timeToRecoverMs: timeToRecover,
    dedupedEventCount: canonical.length,
    canonicalRoundEvents: canonical,
  };
  if (invalid) {
    return { verdict: VERDICT.FAIL, reasons, derived, oracle: null };
  }

  // ---- Recovery oracle (split-brain) ----
  const conflicts = detectRoundConflicts(artifact.round_events);
  const oracle = runOracle(canonical, { tKill, ownerBefore, ownerAfter, conflicts });
  if (!oracle.passed) {
    fail(
      "duplicate_round_check",
      `${oracle.violations.length} violation(s): ${oracle.violations
        .map((v) => v.code)
        .join(",")}`,
    );
  }

  // ---- match finished ----
  if (artifact.match_finished !== true) {
    fail("match_not_finished", "MATCH_FINISHED not delivered to survivors");
  }

  // ---- ownership takeover ----
  const alive = Array.isArray(artifact.nodes_alive_after)
    ? artifact.nodes_alive_after
    : [];
  if (!alive.includes(ownerAfter.nodeId)) {
    fail(
      "owner_not_alive",
      `owner_after.nodeId(${ownerAfter.nodeId}) not in nodes_alive_after`,
    );
  }
  if (ownerAfter.nodeId === ownerBefore.nodeId) {
    fail("owner_unchanged", `owner_after.nodeId == owner_before.nodeId`);
  }
  if (!(isFiniteNumber(ownerAfter.fence) && isFiniteNumber(ownerBefore.fence) && ownerAfter.fence > ownerBefore.fence)) {
    // A takeover MUST mint a strictly higher fence.
    fail(
      "fence_not_higher",
      `owner_after.fence(${ownerAfter.fence}) not > owner_before.fence(${ownerBefore.fence})`,
    );
  }
  // NOTE: no t_owner_flip > t_kill check here — Step 0 already fails
  // `invalid_artifact` on `!(tKill < tFlip)` and returns before this point, so
  // such a check could never execute. The criteria list stays honest.

  // ---- answer latency spike (bounded, not a stall) ----
  const p95 = artifact.answer_p95_failover_ms;
  const steady = artifact.steady_state_p95_ms;
  if (isFiniteNumber(p95) && isFiniteNumber(steady)) {
    const limit = th.answer_p95_multiplier_max * steady;
    if (!(p95 <= limit)) {
      fail(
        "answer_p95_spike",
        `answer_p95_failover_ms(${p95}) > ${th.answer_p95_multiplier_max}x steady(${steady})=${limit}`,
      );
    }
  } else {
    fail("answer_p95_missing", "answer_p95_failover_ms / steady_state_p95_ms not finite");
  }

  // ---- recovery time ----
  if (isFiniteNumber(timeToRecover) && !(timeToRecover <= th.time_to_recover_max_ms)) {
    fail(
      "recovery_too_slow",
      `time_to_recover_ms(${timeToRecover}) > ${th.time_to_recover_max_ms}`,
    );
  }

  // ---- reconnect: rate + coverage gate (evaluated last so it can be the
  //      sole INCONCLUSIVE-making criterion) ----
  const rc = computeReconnectRate(artifact.reconnect || {}, th.min_unexpected_closes);
  let reconnectRateFailed = false;
  let coverageFailed = false;
  if (!rc.coverageMet) {
    coverageFailed = true;
  }
  if (rc.effectiveRate === null || !(rc.effectiveRate >= th.reconnect_success_min)) {
    // effectiveRate null (zero denominator) can't satisfy the min either, but
    // that case is really a coverage problem — only mark a rate failure when
    // there WAS a population to measure.
    if (rc.unexpectedCloses > 0) reconnectRateFailed = true;
  }
  if (reconnectRateFailed) {
    fail(
      "reconnect_rate",
      `reconnect.rate(${rc.effectiveRate}) < ${th.reconnect_success_min}`,
    );
  }

  derived.reconnect = rc;

  // ---- final verdict ----
  // INCONCLUSIVE iff the coverage gate is the ONLY unsatisfied criterion.
  if (reasons.length === 0) {
    if (coverageFailed) {
      return {
        verdict: VERDICT.INCONCLUSIVE,
        reasons: [
          {
            code: "reconnect_coverage",
            detail: `unexpected_closes(${rc.unexpectedCloses}) < min(${th.min_unexpected_closes}) — reconnect unproven`,
          },
        ],
        derived,
        oracle,
      };
    }
    return { verdict: VERDICT.PASS, reasons, derived, oracle };
  }

  // Some other criterion failed. If coverage ALSO failed, surface it too, but
  // the verdict is FAIL (coverage is only INCONCLUSIVE-making when alone).
  if (coverageFailed) {
    fail(
      "reconnect_coverage",
      `unexpected_closes(${rc.unexpectedCloses}) < min(${th.min_unexpected_closes})`,
    );
  }
  return { verdict: VERDICT.FAIL, reasons, derived, oracle };
}
