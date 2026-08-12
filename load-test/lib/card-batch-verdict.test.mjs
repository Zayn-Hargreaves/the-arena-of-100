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
function buildHappyTimeline(checkpoint) {
  // 5 CARD_RESOLVED events, each with its own seqNo + playerId +
  // effectId. Names are arbitrary — the oracle only reads the
  // (playerId, effectId, seqNo) triple for matching.
  const expected = [
    { playerId: "p1", effectId: "SHIELD", seqNo: 1001, t: 100 },
    { playerId: "p2", effectId: "TIME_MODIFY", seqNo: 1002, t: 102 },
    { playerId: "p3", effectId: "HINT_REVEAL", seqNo: 1003, t: 105 },
    { playerId: "p4", effectId: "SCORE_MULT", seqNo: 1004, t: 110 },
    { playerId: "p1", effectId: "TIMER_MODIFY", seqNo: 1005, t: 115 },
  ];
  // Surviving nodes observed each effect exactly once. The matching
  // seqNo proves the canonical effect came from the original event,
  // not a zombie re-emit.
  const observed = expected.map((e) => ({
    playerId: e.playerId,
    effectId: e.effectId,
    seqNo: e.seqNo,
    t: e.t,
    nodeId: "node-2",
  }));
  return {
    t_start: 0,
    t_kill: 50,
    t_kill_checkpoint: checkpoint,
    t_owner_flip: 60,
    t_recover: 80,
    owner_after: { nodeId: "node-2", fence: 42 },
    expected_effects: expected,
    observed_effects: observed,
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
});
