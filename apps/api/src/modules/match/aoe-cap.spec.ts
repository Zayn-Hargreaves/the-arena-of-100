// ============================================================
// AOE cap tracker tests — Phase 2 (Class + Card Hybrid)
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "AOE cap = 2 per lobby per round" + §4.5 "post-append path".
// ============================================================

import { describe, it, expect } from "vitest";
import { AoeCapTracker, countAoeResolved } from "./aoe-cap";
import { AOE_CAP_PER_ROUND } from "./card-validator";

describe("AoeCapTracker", () => {
  it("starts empty", () => {
    const t = AoeCapTracker.empty("m1");
    expect(t.getCurrentRoundNo()).toBe(0);
    expect(t.getCurrentAoeCount()).toBe(0);
    expect(t.isExhausted()).toBe(false);
  });

  it("rebuildFromLog mirrors persisted state", () => {
    const events = [
      {
        seqNo: 1,
        type: "CARD_RESOLVED",
        payload: {
          matchId: "m1",
          roundNo: 5,
          targetPlayerIds: ["p2", "p3", "p4"],
        },
      },
      {
        seqNo: 2,
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 5, targetPlayerIds: ["p1", "p2"] },
      },
      {
        seqNo: 3,
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 5, targetPlayerIds: ["p5"] },
      }, // single-target, not AOE
    ];
    const t = AoeCapTracker.rebuildFromLog("m1", 5, events);
    expect(t.getCurrentRoundNo()).toBe(5);
    expect(t.getCurrentAoeCount()).toBe(2); // 2 AOE-shaped
    expect(t.isExhausted()).toBe(true);
  });

  it("onCardResolved increments only for AOE-shaped resolutions", () => {
    const t = new AoeCapTracker("m1", 5, 0);
    t.onCardResolved({
      matchId: "m1",
      roundNo: 5,
      cardId: "CB-1",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2"],
      effect: { kind: "TIMER_MODIFY", deltaMs: -5000, targetCount: 1 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    expect(t.getCurrentAoeCount()).toBe(0); // single-target, not AOE
    t.onCardResolved({
      matchId: "m1",
      roundNo: 5,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3", "p4"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    expect(t.getCurrentAoeCount()).toBe(1); // AOE-shaped
  });

  it("onEndRound resets the counter for the next round", () => {
    const t = new AoeCapTracker("m1", 5, 0);
    t.onCardResolved({
      matchId: "m1",
      roundNo: 5,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3", "p4"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    t.onEndRound(6);
    expect(t.getCurrentRoundNo()).toBe(6);
    expect(t.getCurrentAoeCount()).toBe(0);
  });

  it("getCap returns the AOE cap constant", () => {
    const t = AoeCapTracker.empty("m1");
    expect(t.getCap()).toBe(AOE_CAP_PER_ROUND);
  });

  it("isExhausted returns true at AOE_CAP_PER_ROUND", () => {
    const t = new AoeCapTracker("m1", 5, 0);
    t.onCardResolved({
      matchId: "m1",
      roundNo: 5,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3", "p4"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    t.onCardResolved({
      matchId: "m1",
      roundNo: 5,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p2",
      targetPlayerIds: ["p3", "p4", "p5"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    expect(t.isExhausted()).toBe(true);
    expect(t.getCurrentAoeCount()).toBe(AOE_CAP_PER_ROUND);
  });

  it("ignores events from a different round", () => {
    const t = new AoeCapTracker("m1", 5, 0);
    t.onCardResolved({
      matchId: "m1",
      roundNo: 6,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3", "p4"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    expect(t.getCurrentAoeCount()).toBe(0);
  });

  it("ignores events from a different matchId", () => {
    const t = new AoeCapTracker("m1", 5, 0);
    t.onCardResolved({
      matchId: "m2",
      roundNo: 5,
      cardId: "CB-8",
      offerSeqNo: 1,
      playedByPlayerId: "p1",
      targetPlayerIds: ["p2", "p3", "p4"],
      effect: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
      resolution: "MUTATION",
      serverTimestamp: 0,
      expiresAtServer: null,
      remainingMs: null,
    });
    expect(t.getCurrentAoeCount()).toBe(0);
  });
});

describe("countAoeResolved (pure)", () => {
  it("counts only AOE resolutions for the current (matchId, roundNo)", () => {
    const events = [
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 5, targetPlayerIds: ["p2", "p3"] },
      },
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 5, targetPlayerIds: ["p4"] },
      },
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 6, targetPlayerIds: ["p2", "p3"] },
      }, // other round
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m2", roundNo: 5, targetPlayerIds: ["p1", "p2"] },
      }, // other match
    ];
    expect(countAoeResolved(events, "m1", 5)).toBe(1);
  });

  it("returns 0 on empty log", () => {
    expect(countAoeResolved([], "m1", 5)).toBe(0);
  });

  it("ignores non-CARD_RESOLVED entries and undefined payload fields", () => {
    const events = [
      { type: "ROUND_STARTED", payload: { matchId: "m1", roundNo: 5 } },
      // Payload present but not the target match.
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "mX", roundNo: 5, targetPlayerIds: ["p2", "p3"] },
      },
      // Round mismatch.
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 9, targetPlayerIds: ["p2", "p3"] },
      },
      // targetPlayerIds missing entirely — default [] guard.
      { type: "CARD_RESOLVED", payload: { matchId: "m1", roundNo: 5 } },
      // payload field absent entirely — `??` fallback to {}.
      { type: "CARD_RESOLVED" } as { type: string; payload?: unknown },
      // Single-target — does NOT count as AOE.
      {
        type: "CARD_RESOLVED",
        payload: { matchId: "m1", roundNo: 5, targetPlayerIds: ["p2"] },
      },
    ];
    expect(countAoeResolved(events, "m1", 5)).toBe(0);
  });
});
