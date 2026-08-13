// ============================================================
// C3-card-batch — failover oracle tests.
//
// Three checkpoint scenarios must each produce a PASS when the artifact
// (observed_effects + expected_effects) matches the invariant — every
// persisted CARD_RESOLVED was observed by the surviving nodes, no
// duplicates, no extras. The tests use a SHARED event log (a 5-card
// session, all effects observed by the surviving node with the original
// seqNo) but inject checkpoints (a) append_pre_emit, (b) mid_batch_flush,
// (c) pre_ack. Each scenario builds a complete timeline with the same
// expected/observed payload structure, varying only the
// `t_kill_checkpoint` field — proving the oracle treats the three
// checkpoints symmetrically (the gate cares about the invariant, not
// the failure mode).
//
// `node_modules/.bin/vitest run --config load-test/vitest.config.mjs`
// ============================================================

import { describe, it, expect } from "vitest";
import {
  evaluateCardBatchFailover,
  dedupeEffects,
  detectEffectConflicts,
  findDuplicateObservations,
  diffEffects,
  CARD_BATCH_VERDICT,
} from "./card-batch-verdict.mjs";

// Shared single-scenario shape — five effects, all observed exactly
// once with their original seqNos, no duplicates, no extras. Reused
// across the three checkpoint tests below.
//
// Phase 3 — the cohort invariant pins the CHAOS round-trip: every
// cohort_effects member must appear in `expected_effects` with `t <
// t_kill` AND in the surviving-nodes observation with `t >=
// t_owner_flip`. We splice one effect (p2:TIME_MODIFY@1002) so its
// expected record lands BEFORE the kill (t = 102 < t_kill = 50
// would normally fail, so we model the chaos contract instead:
// the expected record at t = 40 represents a freshly-persisted
// CARD_RESOLVED the original owner appended right before the kill;
// the observation at t = 70 is the surviving node's view after
// reconciliation. The OTHER four effects stand in for the bulk of
// the batch — they round-trip normally through the surviving
// observation regardless of the kill window.
//
// Timeline constants:
//   t_start = 0
//   t_kill = 50     (checkpoint varies per scenario)
//   t_owner_flip = 60
//   t_recover = 80
//
// Cohort round-trip:
//   pre-kill expected record : p2 TIME_MODIFY t = 40 (< 50)
//   post-flip observed record: p2 TIME_MODIFY t = 75 (>= 60)
function buildHappyTimeline(checkpoint) {
  const expected = [
    { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 40 },
    // Cohort pre-kill record — persisted BEFORE the kill window.
    { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002, t: 45 },
    { playerId: "p3", effectId: "HINT_REVEAL", seqNo: 1003, t: 48 },
    { playerId: "p4", effectId: "SCORE_MULT", seqNo: 1004, t: 49 },
    { playerId: "p1", effectId: "TIMER_MODIFY", seqNo: 1005, t: 49 },
  ];
  // Surviving nodes observed each effect exactly once. The matching
  // seqNo proves the canonical effect came from the original event,
  // not a zombie re-emit. Cohort observation lands AFTER the flip.
  const observed = [
    { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 65, nodeId: "node-2" },
    // Cohort post-flip record — surviving node observed after reconciliation.
    { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002, t: 75, nodeId: "node-2" },
    { playerId: "p3", effectId: "HINT_REVEAL", seqNo: 1003, t: 78, nodeId: "node-2" },
    { playerId: "p4", effectId: "SCORE_MULT", seqNo: 1004, t: 79, nodeId: "node-2" },
    { playerId: "p1", effectId: "TIMER_MODIFY", seqNo: 1005, t: 80, nodeId: "node-2" },
  ];
  return {
    t_start: 0,
    t_kill: 50,
    t_kill_checkpoint: checkpoint,
    t_owner_flip: 60,
    t_recover: 80,
    owner_after: { nodeId: "node-2", fence: 42 },
    expected_effects: expected,
    observed_effects: observed,
    cohort_effects: [
      { playerId: "p2", effectId: "TIME_MODIFY" },
    ],
  };
}

describe("C3-card-batch-failover — dedupe + diff helpers", () => {
  it("dedupeEffects drops malformed entries and keeps the earliest observation per (playerId, effectId)", () => {
    const raw = [
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 100, nodeId: "n2" },
      // Same effect seen later on the same node (typical post-failover
      // re-broadcast) — should be deduped.
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 110, nodeId: "n2" },
      // Malformed — missing seqNo, dropped.
      { playerId: "p2", effectId: "TIME_MODIFY", t: 105 },
      // Good entry, distinct effect.
      { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002, t: 102, nodeId: "n2" },
    ];
    const canonical = dedupeEffects(raw);
    expect(canonical).toHaveLength(2);
    // Earliest wins (t = 100 for SHIELD, t = 102 for TIME_MODIFY)
    const shield = canonical.find((e) => e.effectId === "SHIELD");
    expect(shield?.t).toBe(100);
    const time = canonical.find((e) => e.effectId === "TIME_MODIFY");
    expect(time?.t).toBe(102);
  });

  it("detectEffectConflicts flags double-applied effects (zombie owner or transport duplication)", () => {
    const raw = [
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 100, nodeId: "n2" },
      { playerId: "p1", effectId: "SHIELD", seqNo: 9999, t: 105, nodeId: "n3" },
    ];
    const conflicts = detectEffectConflicts(raw);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.playerId).toBe("p1");
    expect(conflicts[0]?.effectId).toBe("SHIELD");
    expect(conflicts[0]?.canonical.seqNo).toBe(1001);
    expect(conflicts[0]?.conflicting.map((c) => c.seqNo)).toContain(9999);
  });

  it("diffEffects detects lost effects in observed set vs expected", () => {
    const expected = [
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001 },
      { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002 },
    ];
    const observed = [
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 0 },
    ];
    const diff = diffEffects(expected, observed);
    expect(diff.dropped).toHaveLength(1);
    expect(diff.dropped[0]).toMatchObject({
      playerId: "p2",
      effectId: "TIME_MODIFY",
      seqNo: 1002,
    });
    expect(diff.extra).toEqual([]);
  });
});

describe("C3-card-batch-failover — strict chaos gate (3 checkpoints)", () => {
  it("checkpoint (a) append_pre_emit — PASS when every persisted CARD_RESOLVED is observed post-failover", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.PASS);
    expect(result.reasons).toEqual([]);
    expect(result.derived?.checkpoint).toBe("append_pre_emit");
    expect(result.derived?.canonicalEffectCount).toBe(5);
    expect(result.derived?.expectedEffectCount).toBe(5);
    expect(result.derived?.dropped).toBe(0);
  });

  it("checkpoint (b) mid_batch_flush — PASS when batch is re-emitted by new owner without dupe", () => {
    const artifact = buildHappyTimeline("mid_batch_flush");
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.PASS);
    expect(result.derived?.checkpoint).toBe("mid_batch_flush");
    expect(result.derived?.conflicts).toBe(0);
  });

  it("checkpoint (c) pre_ack — PASS when ack-loss recovery replays exactly the committed batch", () => {
    const artifact = buildHappyTimeline("pre_ack");
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.PASS);
    expect(result.derived?.checkpoint).toBe("pre_ack");
  });

  it("rejects invalid checkpoint label with FAIL (invalid_artifact)", () => {
    const artifact = buildHappyTimeline("unknown_checkpoint");
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.reasons.some((r) => r.code === "invalid_artifact")).toBe(true);
  });

  it("rejects timeline where t_kill >= t_owner_flip with FAIL", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.t_owner_flip = artifact.t_kill;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.reasons.some((r) => r.code === "invalid_artifact")).toBe(true);
  });

  it("FAILS (lost_effect) when one persisted effect is missing from observed set", () => {
    const artifact = buildHappyTimeline("mid_batch_flush");
    // Drop one expected effect — surviving node never observed it.
    artifact.observed_effects = artifact.observed_effects.filter(
      (e) => e.effectId !== "HINT_REVEAL",
    );
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "lost_effect"),
    ).toBe(true);
  });

  it("FAILS (double_apply) when same (player, effect) appears with two different seqNos", () => {
    const artifact = buildHappyTimeline("pre_ack");
    // Inject a zombie re-emit from a stale owner with the same
    // (playerId, effectId) but a different seqNo. The original
    // 1001 event survives; an old owner re-emitted seqNo 9999.
    artifact.observed_effects.push({
      playerId: "p1",
      effectId: "SHIELD",
      seqNo: 9999,
      t: 200,
      nodeId: "node-1",
    });
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "double_apply"),
    ).toBe(true);
  });

  it("FAILS (duplicate_observation) when two transport frames share the same (playerId, effectId, seqNo)", () => {
    const artifact = buildHappyTimeline("mid_batch_flush");
    // Re-emit the SAME canonical effect (same seqNo) — the new owner
    // duplicated the transport frame. dedupeEffects would silently
    // collapse this and pass; findDuplicateObservations must catch it.
    const original = artifact.observed_effects[0];
    artifact.observed_effects.push({
      playerId: original.playerId,
      effectId: original.effectId,
      seqNo: original.seqNo,
      t: original.t + 5,
      nodeId: "node-3",
    });
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "duplicate_observation"),
    ).toBe(true);
    expect(result.derived?.duplicates).toBeGreaterThan(0);
  });

  it("findDuplicateObservations returns one entry per repeated canonical triple", () => {
    const raw = [
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 100, nodeId: "n2" },
      { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 110, nodeId: "n3" },
      { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002, t: 105, nodeId: "n2" },
    ];
    const dupes = findDuplicateObservations(raw);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.key).toBe("p1::SHIELD::1001");
    expect(dupes[0]?.count).toBe(2);
  });

  it("rejects timeline where t_recover < t_owner_flip with FAIL", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.t_recover = artifact.t_owner_flip - 1;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
    // The new check must surface the specific ordering violation.
    const detail = result.reasons.find((r) => r.code === "invalid_artifact")?.detail ?? "";
    expect(detail).toMatch(/t_owner_flip.*<=.*t_recover/);
  });

  it("rejects null artifact with FAIL (invalid_artifact)", () => {
    const result = evaluateCardBatchFailover(null);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.derived).toBeNull();
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
  });

  it("rejects undefined artifact with FAIL (invalid_artifact)", () => {
    const result = evaluateCardBatchFailover(undefined);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.derived).toBeNull();
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
  });

  it("rejects array artifact with FAIL (invalid_artifact)", () => {
    const result = evaluateCardBatchFailover([]);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.derived).toBeNull();
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
  });

  it("rejects artifact missing observed_effects with FAIL (invalid_artifact)", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    delete artifact.observed_effects;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
  });

  it("rejects artifact whose expected_effects contains a NULL element with FAIL (invalid_artifact)", () => {
    // Regression: a null in `expected_effects` used to slip past the
    // Array.isArray guard and surface as either a phantom
    // `extra_effect` or quietly underflow the diff. Per-element
    // validation must now reject the artifact up-front.
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.expected_effects = [null];
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(result.derived).toBeNull();
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
    const detail = result.reasons.find(
      (r) => r.code === "invalid_artifact",
    )?.detail;
    expect(detail).toMatch(/expected_/);
    expect(detail).toMatch(/effects\[0\]/);
  });

  it("rejects artifact whose observed_effects is missing a required field (seqNo)", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.observed_effects = [
      { playerId: "p9", effectId: "SHIELD", t: 70 /* no seqNo */ },
    ];
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(true);
    const detail = result.reasons.find(
      (r) => r.code === "invalid_artifact",
    )?.detail;
    expect(detail).toMatch(/observed_/);
    expect(detail).toMatch(/seqNo/);
  });

  it("FAILS (cohort_missed) when a cohort effect has no pre-kill expected record", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    // Drop the p2:TIME_MODIFY pre-kill entry from expected — leaves
    // `t = 45` only on the pre-flip observation, so the cohort
    // round-trip contract is broken on the persistence side.
    artifact.expected_effects = artifact.expected_effects.filter(
      (e) => !(e.playerId === "p2" && e.effectId === "TIME_MODIFY"),
    );
    // Add a fallback expected record that sits AFTER the kill so
    // it still appears once in expected but not in the pre-kill
    // window — keeps the rest of the diff sane.
    artifact.expected_effects.push({
      playerId: "p2",
      effectId: "TIME_MODIFY",
      seqNo: 1002,
      t: 65,
    });
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "cohort_missed"),
    ).toBe(true);
    const detail = result.reasons.find(
      (r) => r.code === "cohort_missed",
    )?.detail;
    expect(detail).toMatch(/p2:TIME_MODIFY/);
    expect(detail).toMatch(/pre-kill/);
  });

  it("FAILS (cohort_missed) when a cohort effect has no post-flip observed record", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    // Isolate the post-flip condition: keep the p2:TIME_MODIFY
    // observation present but stamp it with a timestamp BEFORE the
    // owner flip (t_owner_flip = 60). Other observed effects match
    // expected, so the diff / `lost_effect` invariant holds — only
    // the cohort post-flip contract breaks.
    artifact.observed_effects = artifact.observed_effects.map((e) =>
      e.playerId === "p2" && e.effectId === "TIME_MODIFY"
        ? { ...e, t: 50 }
        : e,
    );
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some((r) => r.code === "cohort_missed"),
    ).toBe(true);
    expect(
      result.reasons.some((r) => r.code === "lost_effect"),
    ).toBe(false);
    const detail = result.reasons.find(
      (r) => r.code === "cohort_missed",
    )?.detail;
    expect(detail).toMatch(/p2:TIME_MODIFY/);
    expect(detail).toMatch(/post-flip/);
  });

  it("PASSES the cohort invariant when both pre-kill and post-flip records are present", () => {
    // buildHappyTimeline includes exactly that shape — this test
    // explicitly verifies the happy-path cohort PASS so future
    // refactors of checkCohortInvariant can't silently downgrade.
    const artifact = buildHappyTimeline("mid_batch_flush");
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.PASS);
    expect(
      result.reasons.some((r) => r.code === "cohort_missed"),
    ).toBe(false);
  });

  // Phase 3 hardening — `cohort_effects` must be either absent
  // (undefined → no-op cohort check) or a valid array. Any other
  // type (null, primitive, plain object) is a malformed artifact and
  // must surface as `invalid_artifact` BEFORE the cohort contract is
  // evaluated, so a future regression in checkCohortInvariant's type
  // guard cannot silently degrade the gate into a no-op.
  it("treats undefined cohort_effects as absent (no-op)", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    delete artifact.cohort_effects;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.PASS);
    expect(
      result.reasons.some((r) => r.code === "invalid_artifact"),
    ).toBe(false);
  });

  it("FAILS (invalid_artifact) when cohort_effects is null", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.cohort_effects = null;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some(
        (r) => r.code === "invalid_artifact" && /cohort_effects/.test(r.detail),
      ),
    ).toBe(true);
  });

  it("FAILS (invalid_artifact) when cohort_effects is a number", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.cohort_effects = 42;
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some(
        (r) => r.code === "invalid_artifact" && /cohort_effects/.test(r.detail),
      ),
    ).toBe(true);
  });

  it("FAILS (invalid_artifact) when cohort_effects is a string", () => {
    const artifact = buildHappyTimeline("append_pre_emit");
    artifact.cohort_effects = "COMMON";
    const result = evaluateCardBatchFailover(artifact);
    expect(result.verdict).toBe(CARD_BATCH_VERDICT.FAIL);
    expect(
      result.reasons.some(
        (r) => r.code === "invalid_artifact" && /cohort_effects/.test(r.detail),
      ),
    ).toBe(true);
  });
});
