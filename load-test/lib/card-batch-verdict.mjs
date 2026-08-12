// ============================================================
// C3-card-batch — failover verdict (PURE module, no k6 / no I/O).
//
// The chaos orchestrator for the card-batch path (see
// `scripts/chaos-card-batch.mjs` if present; if not, the harness is the
// same inject-points used for the C3 owner-failover chaos CLI but pointed
// at card-batch checkpoints) writes a `*.card-batch.json` timeline;
// this module turns that artifact into a reproducible PASS / FAIL
// verdict. It is deliberately a plain Node module so the whole oracle
// runs under vitest with hand-built artifacts.
//
// Design rules from 72-C3-chaos-failover.md AND spec §5.2
// (D5 owner-failover + C3-owner-failover gate) plus spec §5.3 (C3-card-
// batch-failover gate):
//
//   * Durability of inner CARD_RESOLVED is the gate. Each inner event
//     carries a stable identity (seqNo) and is persisted BEFORE any
//     apply state. Replay dedup uses that identity + seqNo.
//   * CARD_RESOLVED_BATCH is transport-only — no replay identity of
//     its own. Its batch-level seqNo is NOT a replay cursor.
//   * Strict chaos: owner failures at three checkpoints must each
//     produce the same end state — every persisted CARD_RESOLVED must
//     appear AT LEAST ONCE in transport (no lost effect), and the
//     NEW owner must not double-apply effects.
//
// The chaos injects kills at three points:
//   * checkpoint `append_pre_emit`  — between CARD_RESOLVED append
//     and CARD_RESOLVED_BATCH emission.
//   * checkpoint `mid_batch_flush`   — mid-batch flush pending.
//   * checkpoint `pre_ack`           — emit sent, ack lost.
//
// The verdict is the SAME invariant across all three: the surviving
// nodes' view of the per-player effects MUST equal the set of effects
// recorded in the event log + a hand-derived expected_effects record,
// without doubles or drops.
// ============================================================

// Verdict is strictly binary: PASS | FAIL. (Earlier drafts listed
// INCONCLUSIVE but no code path actually returned it — the oracle
// either has enough evidence to declare PASS or it surfaces the
// failing reason as FAIL. Removing INCONCLUSIVE keeps the contract
// honest.)
export const CARD_BATCH_VERDICT = {
  PASS: "PASS",
  FAIL: "FAIL",
};

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Effect canonical identity = (playerId, effectId, seqNo). The
// artifact producer emits a CARD_RESOLVED with a stable seqNo; the
// triple is the canonical effect identity used for dedupe, diff,
// and conflict detection.
function effectKey(ev) {
  return `${ev.playerId}::${ev.effectId}::${ev.seqNo}`;
}

// Pair key (playerId, effectId) — used only by the conflict detector
// to surface distinct-seqNo observations of the same logical effect.
function effectPairKey(ev) {
  return `${ev.playerId}::${ev.effectId}`;
}

// Group valid effect observations by their canonical triple. Mirrors
// the dedupe strategy of failover-verdict.mjs — keeps the deterministic
// guarantee across orchestrator versions.
function groupByCanonical(raw) {
  const groups = new Map();
  for (const ev of raw || []) {
    if (!ev) continue;
    if (typeof ev.playerId !== "string" || typeof ev.effectId !== "string") {
      continue;
    }
    if (!isFiniteNumber(ev.t) || !isFiniteNumber(ev.seqNo)) continue;
    const key = effectKey(ev);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return groups;
}

// Canonicalize raw effect observations: drop malformed entries, dedupe
// by the (playerId, effectId, seqNo) triple using the earliest t.
// Mirrors the dedupe strategy of failover-verdict.mjs — keeps the
// deterministic guarantee across orchestrator versions.
export function dedupeEffects(raw) {
  const groups = groupByCanonical(raw);
  const canonical = [];
  for (const evs of groups.values()) {
    let chosen = evs[0];
    for (const ev of evs) {
      if (
        ev.t < chosen.t ||
        (ev.t === chosen.t && ev.seqNo < chosen.seqNo)
      ) {
        chosen = ev;
      }
    }
    canonical.push({
      t: chosen.t,
      seqNo: chosen.seqNo,
      playerId: chosen.playerId,
      effectId: chosen.effectId,
      nodeId: chosen.nodeId,
    });
  }
  return canonical.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    if (a.seqNo !== b.seqNo) return a.seqNo - b.seqNo;
    return a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0;
  });
}

// Detect EFFECT-level conflicts: same (playerId, effectId) observed
// with DIFFERENT seqNo. A double-apply fingerprint — the bug we are
// guarding against. Mirrors detectRoundConflicts from the
// owner-failover oracle.
export function detectEffectConflicts(raw) {
  const byPair = new Map();
  for (const ev of raw || []) {
    if (!ev) continue;
    if (typeof ev.playerId !== "string" || typeof ev.effectId !== "string") {
      continue;
    }
    if (!isFiniteNumber(ev.seqNo)) continue;
    const key = effectPairKey(ev);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(ev);
  }
  const conflicts = [];
  for (const [pairKey, evs] of byPair) {
    const seqNos = new Set(evs.map((e) => e.seqNo));
    if (seqNos.size <= 1) continue;
    const [playerId, effectId] = pairKey.split("::");
    // Choose canonical as the lowest seqNo (mirrors apply-order).
    const canonicalSeqNo = Math.min(...seqNos);
    const canonical = evs.find((e) => e.seqNo === canonicalSeqNo);
    const conflicting = evs
      .filter((e) => e.seqNo !== canonicalSeqNo)
      .map((e) => ({
        seqNo: e.seqNo,
        nodeId: e.nodeId,
        t: e.t,
      }));
    conflicts.push({
      playerId,
      effectId,
      canonical: {
        seqNo: canonicalSeqNo,
        nodeId: canonical?.nodeId,
        t: canonical?.t,
      },
      conflicting,
    });
  }
  return conflicts;
}

// Find duplicate transport observations of the SAME canonical effect
// — i.e. the same (playerId, effectId, seqNo) observed more than once
// across the surviving nodes' transport. Hiding these behind dedupe
// would let the new owner re-emit the same transport frame and pass
// the no-duplicates invariant silently; we surface them as a
// separate violation.
export function findDuplicateObservations(raw) {
  const counts = new Map();
  for (const ev of raw || []) {
    if (!ev) continue;
    if (typeof ev.playerId !== "string" || typeof ev.effectId !== "string") {
      continue;
    }
    if (!isFiniteNumber(ev.seqNo)) continue;
    const key = effectKey(ev);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = [];
  for (const [key, count] of counts) {
    if (count > 1) duplicates.push({ key, count });
  }
  return duplicates;
}

// Compare the expected effect set (derived from the event log) against
// the canonical surviving-nodes observation. Returns the list of
// drops (in log but not seen) and dupes (seen but not in log —
// different from `findDuplicateObservations`, which catches the
// intra-observed-set repeat).
export function diffEffects(expectedEffects, observedEffects) {
  const observedKeys = new Set(observedEffects.map((e) => effectKey(e)));
  const expectedKeys = new Set(expectedEffects.map((e) => effectKey(e)));

  const dropped = expectedEffects.filter((e) => !observedKeys.has(effectKey(e)));
  const extra = observedEffects.filter((e) => !expectedKeys.has(effectKey(e)));
  return { dropped, extra };
}

// Evaluate a *.card-batch.json artifact. Returns
//   { verdict, reasons: [{code, detail}], derived: {...} }
export function evaluateCardBatchFailover(artifact) {
  const reasons = [];
  const fail = (code, detail) => reasons.push({ code, detail });

  // ---- Step 0a: artifact itself must be a non-null object ----
  if (
    artifact === null ||
    typeof artifact !== "object" ||
    Array.isArray(artifact)
  ) {
    fail("invalid_artifact", "artifact must be a non-null object");
    return {
      verdict: CARD_BATCH_VERDICT.FAIL,
      reasons,
      derived: null,
    };
  }

  // ---- Step 0b: timeline sanity ----
  const required = ["t_start", "t_kill", "t_owner_flip", "t_recover"];
  let timelineOk = true;
  for (const name of required) {
    const val = artifact[name];
    if (!isFiniteNumber(val)) {
      fail("invalid_artifact", `${name} missing or not finite`);
      timelineOk = false;
    }
  }
  const allowedCheckpoints = new Set([
    "append_pre_emit",
    "mid_batch_flush",
    "pre_ack",
  ]);
  if (!allowedCheckpoints.has(artifact.t_kill_checkpoint)) {
    fail(
      "invalid_artifact",
      `t_kill_checkpoint must be one of append_pre_emit|mid_batch_flush|pre_ack (got ${artifact.t_kill_checkpoint})`,
    );
    timelineOk = false;
  }
  if (
    timelineOk &&
    !(artifact.t_start <= artifact.t_kill && artifact.t_kill < artifact.t_owner_flip)
  ) {
    fail(
      "invalid_artifact",
      `t_start(${artifact.t_start}) <= t_kill(${artifact.t_kill}) < t_owner_flip(${artifact.t_owner_flip}) violated`,
    );
    timelineOk = false;
  }
  // Recovery cannot precede the owner flip — otherwise the artifact
  // describes an impossible timeline.
  if (timelineOk && !(artifact.t_owner_flip <= artifact.t_recover)) {
    fail(
      "invalid_artifact",
      `t_owner_flip(${artifact.t_owner_flip}) <= t_recover(${artifact.t_recover}) violated`,
    );
    timelineOk = false;
  }

  // ---- Step 1: validate inputs ----
  const observed = Array.isArray(artifact.observed_effects)
    ? artifact.observed_effects
    : null;
  const expected = Array.isArray(artifact.expected_effects)
    ? artifact.expected_effects
    : null;
  if (observed === null) {
    fail("invalid_artifact", "observed_effects must be an array");
  }
  if (expected === null) {
    fail("invalid_artifact", "expected_effects must be an array");
  }

  if (reasons.some((r) => r.code === "invalid_artifact")) {
    return {
      verdict: CARD_BATCH_VERDICT.FAIL,
      reasons,
      derived: null,
    };
  }

  // ---- Step 2: dedupe + conflict + duplicate detection ----
  const canonical = dedupeEffects(observed);
  const conflicts = detectEffectConflicts(observed);
  const duplicates = findDuplicateObservations(observed);

  // ---- Step 3: the invariant — every expected effect was observed ----
  const diff = diffEffects(expected, canonical);

  if (diff.dropped.length > 0) {
    fail(
      "lost_effect",
      `${diff.dropped.length} persisted CARD_RESOLVED event(s) did NOT reach the surviving nodes: ${diff.dropped
        .slice(0, 5)
        .map((e) => `${e.playerId}:${e.effectId}@${e.seqNo}`)
        .join(", ")}`,
    );
  }
  if (diff.extra.length > 0) {
    fail(
      "extra_effect",
      `${diff.extra.length} observed effect(s) not in the expected set: ${diff.extra
        .slice(0, 5)
        .map((e) => `${e.playerId}:${e.effectId}@${e.seqNo}`)
        .join(", ")}`,
    );
  }

  // ---- Step 4: split-brain — same (player, effect) seen with different seqNos ----
  if (conflicts.length > 0) {
    fail(
      "double_apply",
      `${conflicts.length} effect(s) observed with conflicting seqNos — zombie owner or duplicated transport: ${conflicts
        .slice(0, 3)
        .map((c) => `${c.playerId}:${c.effectId}`)
        .join(", ")}`,
    );
  }

  // ---- Step 5: duplicate transport observations of the SAME effect ----
  if (duplicates.length > 0) {
    fail(
      "duplicate_observation",
      `${duplicates.length} effect(s) observed multiple times with identical (playerId, effectId, seqNo): ${duplicates
        .slice(0, 5)
        .map((d) => `${d.key} (x${d.count})`)
        .join(", ")}`,
    );
  }

  // ---- Step 6: recovery oracle (basic — full version mirrors owner-failover) ----
  const ownerAfter = artifact.owner_after || {};
  if (!isFiniteNumber(ownerAfter.fence)) {
    fail("invalid_artifact", "owner_after.fence missing or not finite");
  }

  // ---- final verdict ----
  if (reasons.length === 0) {
    return {
      verdict: CARD_BATCH_VERDICT.PASS,
      reasons,
      derived: {
        canonicalEffectCount: canonical.length,
        expectedEffectCount: expected.length,
        conflicts: conflicts.length,
        duplicates: duplicates.length,
        dropped: diff.dropped.length,
        extra: diff.extra.length,
        checkpoint: artifact.t_kill_checkpoint,
      },
    };
  }

  return {
    verdict: CARD_BATCH_VERDICT.FAIL,
    reasons,
    derived: {
      canonicalEffectCount: canonical.length,
      expectedEffectCount: expected.length,
      conflicts: conflicts.length,
      duplicates: duplicates.length,
      dropped: diff.dropped.length,
      extra: diff.extra.length,
      checkpoint: artifact.t_kill_checkpoint,
    },
  };
}
