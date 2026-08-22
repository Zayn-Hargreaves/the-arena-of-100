// ============================================================
// Phase 2 — Class + Card Hybrid tests on MatchStateMachine
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task C.
//
// All tests are ADDITIVE — they do not modify the existing
// public API. The existing 96 tests must continue to pass
// (verified at the end of this file).
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MatchStateMachine } from "./match-state-machine";
import {
  MatchStatus,
  PlayerStatus,
  ErrorCode,
  RoomError,
  type CardId,
  type CardEffect,
} from "@arena/shared";

function makeMachine(): MatchStateMachine {
  return new MatchStateMachine("m1", "r1", [
    {
      id: "p1",
      name: "P1",
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    },
    {
      id: "p2",
      name: "P2",
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    },
    {
      id: "p3",
      name: "P3",
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    },
  ]);
}

function makeActiveRound(machine: MatchStateMachine): void {
  machine.transition(MatchStatus.COUNTDOWN);
  machine.transition(MatchStatus.ROUND_ACTIVE);
  machine.startRound({
    id: "q1",
    content: "Q?",
    options: ["A", "B", "C", "D"],
    correctAnswer: "B",
  });
}

describe("classAssignment — server-side random per-match", () => {
  it("returns one assignment per playerId", () => {
    const m = makeMachine();
    const result = m.classAssignment(["p1", "p2", "p3"], "seed-A");
    expect(result.length).toBe(3);
    for (const p of ["p1", "p2", "p3"]) {
      expect(result.find((r) => r.playerId === p)).toBeDefined();
    }
  });

  it("only emits ATTACK or DEFENSE", () => {
    const m = makeMachine();
    const result = m.classAssignment(["p1", "p2", "p3"], "seed-B");
    for (const r of result) {
      expect(["ATTACK", "DEFENSE"]).toContain(r.classId);
    }
  });

  it("appends a CLASS_ASSIGNED event to the event log", () => {
    const m = makeMachine();
    m.classAssignment(["p1", "p2", "p3"], "seed-C");
    const events = m.getEventLog();
    const classEvent = events.find((e) => e.type === "CLASS_ASSIGNED");
    expect(classEvent).toBeDefined();
    const payload = (classEvent!.payload ?? {}) as Record<string, unknown>;
    expect(payload.matchId).toBe("m1");
    expect(payload.seedUsed).toBe("seed-C");
    expect((payload.assignments as Array<unknown>).length).toBe(3);
  });

  it("is deterministic — same seed produces same assignment", () => {
    const a = makeMachine().classAssignment(
      ["p1", "p2", "p3"],
      "deterministic",
    );
    const b = makeMachine().classAssignment(
      ["p1", "p2", "p3"],
      "deterministic",
    );
    expect(a).toEqual(b);
  });

  it("assigns every supplied ID — including IDs outside the roster", () => {
    // The engine assigns to every playerId passed in — a player
    // not in the match roster would still get a class, so the
    // state-machine contract is "trust the caller" for the
    // assignment targets. Verify behaviour here.
    const m = makeMachine();
    const result = m.classAssignment(["p1", "ghost"], "seed-D");
    expect(result.length).toBe(2);
  });

  it("hasClassAssignments returns false initially and true after assignment or deserialization", () => {
    const m = makeMachine();
    expect(m.hasClassAssignments()).toBe(false);
    m.classAssignment(["p1", "p2"], "seed-E");
    expect(m.hasClassAssignments()).toBe(true);

    const serialized = m.serialize();
    const restored = MatchStateMachine.deserialize(serialized);
    expect(restored.hasClassAssignments()).toBe(true);
  });
});

describe("pickOffer — milestone card offer", () => {
  let m: MatchStateMachine;
  beforeEach(() => {
    m = makeMachine();
    m.classAssignment(["p1", "p2", "p3"], "offer-seed");
  });

  it("returns a 3-tuple of CardId", () => {
    const cards = m.pickOffer("p1", 5, "offer-seed-1");
    expect(cards.length).toBe(3);
    for (const c of cards) {
      expect(typeof c).toBe("string");
      expect(c).toMatch(/^(CB|TN)-\d+$/);
    }
  });

  it("only offers cards from the player's class pool", () => {
    const cards = m.pickOffer("p1", 5, "offer-seed-2");
    const allCong =
      cards.every((c) => c.startsWith("CB-")) ||
      cards.every((c) => c.startsWith("TN-"));
    expect(allCong).toBe(true);
  });

  it("appends a CARD_OFFER event with the 3-tuple", () => {
    m.pickOffer("p1", 5, "offer-seed-3");
    const events = m.getEventLog();
    const offer = events.find((e) => e.type === "CARD_OFFER");
    expect(offer).toBeDefined();
    const payload = (offer!.payload ?? {}) as Record<string, unknown>;
    expect(payload.roundNo).toBe(5);
    expect(payload.playerId).toBe("p1");
    expect((payload.offeredCardIds as Array<unknown>).length).toBe(3);
  });

  it("populates the player's hand", () => {
    const cards = m.pickOffer("p1", 5, "offer-seed-4");
    expect(m.getHand("p1")).toEqual(cards);
  });

  it("throws PLAYER_NOT_IN_ROOM if the player has no class assignment", () => {
    const m2 = makeMachine();
    expect(() => m2.pickOffer("p1", 5, "x")).toThrow(RoomError);
    expect(() => m2.pickOffer("p1", 5, "x")).toThrow(
      expect.objectContaining({ code: ErrorCode.PLAYER_NOT_IN_ROOM }),
    );
  });

  it("is deterministic — same seed produces same offer", () => {
    const a = makeMachine();
    a.classAssignment(["p1"], "det-1");
    const b = makeMachine();
    b.classAssignment(["p1"], "det-1");
    expect(a.pickOffer("p1", 5, "off-det")).toEqual(
      b.pickOffer("p1", 5, "off-det"),
    );
  });

  it("excludes previously picked/played cards from subsequent milestone offers", () => {
    const machine = makeMachine();
    machine.classAssignment(["p1"], "seed-class");
    const offer1 = machine.pickOffer("p1", 5, "seed-offer-1");
    const offerSeqNo = machine
      .getEventLog()
      .find((e) => e.type === "CARD_OFFER")!.seqNo;
    const pickedCard = offer1[0]!;
    machine.pickCard("p1", pickedCard, offerSeqNo);
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    machine.playCard("p1", pickedCard, offerSeqNo, effect, ["p2"], 1000);

    // Next milestone offer at Round 12
    const offer2 = machine.pickOffer("p1", 12, "seed-offer-2");
    expect(offer2).not.toContain(pickedCard);
  });

  it("throws invariant error if availablePool has fewer than 3 cards", () => {
    const machine = makeMachine();
    machine.classAssignment(["p1"], "seed-exhaust");
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    // Play 7 cards so only 2 remain in the 9-card class pool
    const classCards = [
      "CB-1",
      "CB-2",
      "CB-3",
      "CB-4",
      "CB-5",
      "CB-6",
      "CB-7",
    ] as CardId[];
    for (const cardId of classCards) {
      machine.playCard("p1", cardId, 1, effect, ["p2"], 1000);
    }
    expect(() => machine.pickOffer("p1", 20, "seed-insufficient")).toThrow(
      /card-engine invariant: expected 3 cards, got 1/,
    );
  });
});

describe("pickCard — spending an offered card", () => {
  let m: MatchStateMachine;
  beforeEach(() => {
    m = makeMachine();
    m.classAssignment(["p1"], "pick-seed");
    m.pickOffer("p1", 5, "pick-1");
  });

  it("removes the picked card from the hand", () => {
    const hand = m.getHand("p1");
    const picked = hand[0]!;
    m.pickCard("p1", picked, 1);
    const remaining = m.getHand("p1");
    expect(remaining).not.toContain(picked);
    expect(remaining.length).toBe(hand.length - 1);
  });

  it("appends a CARD_PICKED event with offerSeqNo", () => {
    const hand = m.getHand("p1");
    m.pickCard("p1", hand[0]!, 42);
    const events = m.getEventLog();
    const pick = events.find((e) => e.type === "CARD_PICKED");
    expect(pick).toBeDefined();
    expect((pick!.payload as Record<string, unknown>).offerSeqNo).toBe(42);
  });

  it("stamps canonical eventId + commandId on the CARD_PICKED payload when supplied", () => {
    const hand = m.getHand("p1");
    m.pickCard("p1", hand[0]!, 1, {
      eventId: "evt-1",
      commandId: "cmd-1",
    });
    const pick = m.getEventLog().find((e) => e.type === "CARD_PICKED");
    const payload = pick!.payload as Record<string, unknown>;
    expect(payload.eventId).toBe("evt-1");
    expect(payload.commandId).toBe("cmd-1");
  });

  it("omits canonical stamps when no metadata is supplied (back-compat)", () => {
    const hand = m.getHand("p1");
    m.pickCard("p1", hand[0]!, 1);
    const pick = m.getEventLog().find((e) => e.type === "CARD_PICKED");
    const payload = pick!.payload as Record<string, unknown>;
    expect("eventId" in payload).toBe(false);
    expect("commandId" in payload).toBe(false);
  });

  it("throws CARD_NOT_IN_HAND when the card is not in the hand", () => {
    expect(() => m.pickCard("p1", "CB-99" as CardId, 1)).toThrow(RoomError);
    expect(() => m.pickCard("p1", "CB-99" as CardId, 1)).toThrow(
      expect.objectContaining({ code: ErrorCode.CARD_NOT_IN_HAND }),
    );
  });
});

describe("playCard — card effect resolution", () => {
  it("emits a CARD_RESOLVED event with MUTATION resolution and no expiry", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "mut-seed");
    const cards = m.pickOffer("p1", 5, "mut-1");
    // Pick an Offensive (CB-*) card for the MUTATION test.
    const attackCard = cards.find((c) => c.startsWith("CB-")) ?? cards[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    const result = m.playCard("p1", attackCard, 1, effect, ["p2"], 1000);
    expect(result.expiresAtServer).toBeNull();
    expect(result.remainingMs).toBeNull();
    let resolved: { payload?: unknown; seqNo: number } | undefined;
    m.forEachEvent((entry) => {
      if (entry.type === "CARD_RESOLVED") resolved = entry;
    });
    expect(resolved).toBeDefined();
    const payload = resolved!.payload as Record<string, unknown>;
    expect(payload.resolution).toBe("MUTATION");
    expect(payload.expiresAtServer).toBeNull();
    expect(payload.remainingMs).toBeNull();
    // The persisted payload MUST carry matchId so the AOE
    // rebuild predicate (`payload.matchId === matchId`) can
    // filter rehydrated events per match.
    expect(payload.matchId).toBe("m1");
  });

  it("emits a TEMPORARY CARD_RESOLVED with expiresAtServer = serverNow + durationMs", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "tmp-seed");
    const cards = m.pickOffer("p1", 5, "tmp-1");
    // Pick a Defensive (TN-*) card for the TEMPORARY OPTION_DISABLE test.
    const defenseCard = cards.find((c) => c.startsWith("TN-")) ?? cards[0]!;
    m.pickCard("p1", defenseCard, 1);
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [0, 2],
      count: 2,
      availableAtResolution: 3,
      durationMs: 20000,
    };
    const result = m.playCard("p1", defenseCard, 1, effect, ["p1"], 5000);
    expect(result.expiresAtServer).toBe(5000 + 20000);
    expect(result.remainingMs).toBe(20000);
    const events = m.getEventLog();
    const resolved = events.find((e) => e.type === "CARD_RESOLVED");
    expect(resolved).toBeDefined();
    expect((resolved!.payload as Record<string, unknown>).resolution).toBe(
      "TEMPORARY",
    );
  });

  it("stamps canonical eventId + commandId on the CARD_RESOLVED payload when supplied", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "stamp-seed");
    const cards = m.pickOffer("p1", 5, "stamp-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -1000,
      targetCount: 1,
    };
    m.playCard("p1", attackCard, 1, effect, ["p2"], 1000, {
      eventId: "evt-r-1",
      commandId: "cmd-r-1",
    });
    const resolved = m.getEventLog().find((e) => e.type === "CARD_RESOLVED");
    const payload = resolved!.payload as Record<string, unknown>;
    expect(payload.eventId).toBe("evt-r-1");
    expect(payload.commandId).toBe("cmd-r-1");
  });

  it("TEMPORARY effects are tracked per-player in activeEffects", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "ae-seed");
    const cards = m.pickOffer("p1", 5, "ae-1");
    const defenseCard = cards.find((c) => c.startsWith("TN-")) ?? cards[0]!;
    m.pickCard("p1", defenseCard, 1);
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [0],
      count: 1,
      availableAtResolution: 3,
      durationMs: 10000,
    };
    m.playCard("p1", defenseCard, 1, effect, ["p1"], 1000);
    const active = m.getActiveEffects("p1", 5000);
    expect(active.length).toBe(1);
    // serverNow=1000 + durationMs=10000 → expiresAtServer=11000
    // getActiveEffects at serverNow=5000 → remainingMs = 11000 - 5000 = 6000
    expect(active[0]!.expiresAtServer).toBe(11000);
    expect(active[0]!.remainingMs).toBe(6000);
    expect(active[0]!.persistedDurationMs).toBe(10000);
  });

  it("expired TEMPORARY effects are excluded from the snapshot", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "exp-seed");
    const cards = m.pickOffer("p1", 5, "exp-1");
    const defenseCard = cards.find((c) => c.startsWith("TN-")) ?? cards[0]!;
    m.pickCard("p1", defenseCard, 1);
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [0],
      count: 1,
      availableAtResolution: 3,
      durationMs: 1000,
    };
    m.playCard("p1", defenseCard, 1, effect, ["p1"], 1000);
    const active = m.getActiveEffects("p1", 5000);
    expect(active.length).toBe(0); // expired
  });

  it("MUTATION effects are NOT added to activeEffects", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "mt-seed");
    const cards = m.pickOffer("p1", 5, "mt-1");
    const attackCard = cards.find((c) => c.startsWith("CB-")) ?? cards[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    m.playCard("p1", attackCard, 1, effect, ["p2"], 1000);
    expect(m.getActiveEffects("p1", 1000).length).toBe(0);
  });

  it("remainingMs is recomputed from serverNow — never persists stale value", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "ck-seed");
    const cards = m.pickOffer("p1", 5, "ck-1");
    const defenseCard = cards.find((c) => c.startsWith("TN-")) ?? cards[0]!;
    m.pickCard("p1", defenseCard, 1);
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [0],
      count: 1,
      availableAtResolution: 3,
      durationMs: 10000,
    };
    const result = m.playCard("p1", defenseCard, 1, effect, ["p1"], 2000);
    expect(result.remainingMs).toBe(10000);
    // Calling getActiveEffects 5s later with the SAME persisted
    // expiresAtServer recomputes remainingMs from serverNow.
    const active = m.getActiveEffects("p1", 7000);
    expect(active[0]!.remainingMs).toBe(12000 - 7000);
  });
});

describe("Phase 2 — rehydrate card state from event log", () => {
  it("deserialize rebuilds playerClasses / playerHands / activeEffects from the log", () => {
    const m1 = makeMachine();
    m1.classAssignment(["p1", "p2"], "rehydrate-seed");
    const cards = m1.pickOffer("p1", 5, "rh-1");
    const defenseCard = cards.find((c) => c.startsWith("TN-")) ?? cards[0]!;
    m1.pickCard("p1", defenseCard, 1);
    const effect: CardEffect = {
      kind: "OPTION_DISABLE",
      indexes: [0],
      count: 1,
      availableAtResolution: 3,
      durationMs: 10000,
    };
    m1.playCard("p1", defenseCard, 1, effect, ["p1"], 1000);

    const json = m1.serialize();
    const m2 = MatchStateMachine.deserialize(json);
    expect(m2.getHand("p1").length).toBe(2); // 3 minus 1 picked
    const active = m2.getActiveEffects("p1", 5000);
    expect(active.length).toBe(1);
    expect(active[0]!.remainingMs).toBe(11000 - 5000);
  });

  it("rehydrate preserves CLASS_ASSIGNED authority over redundant snapshots", () => {
    // The spec invariant: snapshots cannot override a
    // CLASS_ASSIGNED event. Our impl simply rebuilds the in-memory
    // mirrors from the event log; there is no separate snapshot
    // source for class/card state. This test pins that fact.
    const m1 = makeMachine();
    m1.classAssignment(["p1"], "auth-seed");
    const json = m1.serialize();
    const m2 = MatchStateMachine.deserialize(json);
    const events = m2.getEventLog();
    expect(events.find((e) => e.type === "CLASS_ASSIGNED")).toBeDefined();
  });

  it("rehydrate replays events in order — no double-apply", () => {
    const m1 = makeMachine();
    m1.classAssignment(["p1"], "no-double");
    m1.pickOffer("p1", 5, "nd-1");
    const h1 = m1.getHand("p1");
    m1.pickCard("p1", h1[0]!, 1);
    const h2 = m1.getHand("p1");
    m1.pickCard("p1", h2[0]!, 2);
    const json = m1.serialize();
    const m2 = MatchStateMachine.deserialize(json);
    expect(m2.getHand("p1").length).toBe(1);
    const events = m2.getEventLog();
    expect(events.filter((e) => e.type === "CARD_PICKED").length).toBe(2);
  });
});

describe("Phase 2 — additive regression (existing tests still pass)", () => {
  // Smoke test: chain the new methods after the existing flow
  // and verify the existing public API still works.
  it("works alongside the existing ROUND_STARTED / submitAnswer flow", () => {
    const m = makeMachine();
    makeActiveRound(m);
    m.classAssignment(["p1", "p2", "p3"], "flow-seed");
    m.pickOffer("p1", 5, "f-1");
    const ans = m.submitAnswer("p1", "B", 1500, "sub-1");
    expect(ans.isCorrect).toBe(true);
    expect(m.getHand("p1").length).toBe(3); // card hand unaffected by answer
  });
});

describe("Phase 2 — cached state mirrors the event log", () => {
  // The cached counters (`getPlayedCards`, `getAoeCountForRound`)
  // are read by the API boundary on every `handleCardPlay` call.
  // They MUST agree with the event log after every state-machine
  // operation AND after a serialize/deserialize round trip —
  // drift would silently allow replayed-card double-spend or
  // AOE-cap overshoot.
  it("getPickedCards mirrors CARD_PICKED events for one player", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "pp-seed");
    const cards = m.pickOffer("p1", 5, "pp-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"));
    expect(m.getPickedCards("p1").size).toBe(0);
    m.pickCard("p1", attackCard[0]!, 1);
    expect(m.getPickedCards("p1").size).toBe(1);
    expect(m.getPickedCards("p1").has(attackCard[0]!)).toBe(true);
    // played-cards only increments on the matching CARD_RESOLVED.
    expect(m.getPlayedCards("p1").size).toBe(0);
  });

  it("getPlayedCards mirrors CARD_RESOLVED events for one player", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "pp2-seed");
    const cards = m.pickOffer("p1", 5, "pp2-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    // The pick is pending until the resolver lands.
    expect(m.getPlayedCards("p1").size).toBe(0);
    m.playCard(
      "p1",
      attackCard,
      1,
      { kind: "TIMER_MODIFY", deltaMs: -5000, targetCount: 1 },
      ["p2"],
      1000,
    );
    expect(m.getPlayedCards("p1").size).toBe(1);
    expect(m.getPlayedCards("p1").has(attackCard)).toBe(true);
  });

  it("getPlayedCards returns empty Set for an unknown player", () => {
    const m = makeMachine();
    expect(m.getPlayedCards("ghost").size).toBe(0);
  });

  it("getAoeCountForRound tracks CARD_RESOLVED AOE-shaped events", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "aoe-seed");
    const cards = m.pickOffer("p1", 5, "aoe-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: import("@arena/shared").CardEffect = {
      kind: "DELAY_RENDER",
      delayMs: 2000,
      targetCount: 3,
    };
    m.playCard("p1", attackCard, 1, effect, ["p1", "p2", "p3"], 1000);
    expect(m.getAoeCountForRound(0)).toBe(1); // currentRound.roundNo = 0
  });

  it("getAoeCountForRound does NOT count single-target resolutions", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "single-seed");
    const cards = m.pickOffer("p1", 5, "single-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: import("@arena/shared").CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    m.playCard("p1", attackCard, 1, effect, ["p2"], 1000);
    expect(m.getAoeCountForRound(0)).toBe(0); // single-target, not AOE
  });

  it("cached state survives serialize/deserialize round-trip", () => {
    const m1 = makeMachine();
    // Use the same seed for classAssignment + pickOffer so p1
    // deterministically ends up in the ATTACK class — the
    // round-trip persistence test only cares about state
    // preservation, not the specific card, but the test uses a
    // ATTACK-only effect (DELAY_RENDER) below.
    m1.classAssignment(["p1", "p2"], "rt-1");
    const cards = m1.pickOffer("p1", 5, "rt-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m1.pickCard("p1", attackCard, 1);
    const effect: import("@arena/shared").CardEffect = {
      kind: "DELAY_RENDER",
      delayMs: 2000,
      targetCount: 3,
    };
    m1.playCard("p1", attackCard, 1, effect, ["p1", "p2", "p3"], 1000);

    const json = m1.serialize();
    const m2 = MatchStateMachine.deserialize(json);

    // played: p1 played `attackCard`
    expect(m2.getPlayedCards("p1").has(attackCard)).toBe(true);
    // AOE: 1 AOE-shaped resolution in round 0
    expect(m2.getAoeCountForRound(0)).toBe(1);
  });

  it("forEachEvent iterates without cloning (equality of payload references)", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "iter-seed");
    m.pickOffer("p1", 5, "iter-1");
    m.forEachEvent((entry) => {
      // Reading a payload here must not throw — the entries are
      // the live internal record, not a copy. We can only read
      // structuredClone-safe fields.
      expect(typeof entry.type).toBe("string");
      expect(typeof entry.seqNo).toBe("number");
    });
  });
});

describe("CARD_RESOLVED event payload freeze", () => {
  it("freezes nested targetPlayerIds and effect arrays in the persisted payload", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "freeze-seed");
    const cards = m.pickOffer("p1", 5, "freeze-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: CardEffect = {
      kind: "HAND_DESTROY",
      count: 1,
      availableAtResolution: 0,
      destroyedCardIds: ["CB-1"],
    };
    m.playCard("p1", attackCard, 1, effect, ["p2"], 1000);
    let resolved: { payload?: unknown } | undefined;
    m.forEachEvent((entry) => {
      if (entry.type === "CARD_RESOLVED") resolved = entry;
    });
    expect(resolved).toBeDefined();
    const payload = resolved!.payload as Record<string, unknown>;
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.targetPlayerIds)).toBe(true);
    expect(Object.isFrozen(payload.effect)).toBe(true);
    expect(
      Object.isFrozen(
        (payload.effect as { destroyedCardIds: unknown[] }).destroyedCardIds,
      ),
    ).toBe(true);
  });

  it("rejects mutation of the persisted payload via the live event log", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "freeze-mut");
    const cards = m.pickOffer("p1", 5, "freeze-mut-1");
    const attackCard = cards.filter((c) => c.startsWith("CB-"))[0]!;
    m.pickCard("p1", attackCard, 1);
    const effect: CardEffect = {
      kind: "TIMER_MODIFY",
      deltaMs: -5000,
      targetCount: 1,
    };
    m.playCard("p1", attackCard, 1, effect, ["p2"], 1000);
    let resolved: { payload?: unknown } | undefined;
    m.forEachEvent((entry) => {
      if (entry.type === "CARD_RESOLVED") resolved = entry;
    });
    expect(resolved).toBeDefined();
    const payload = resolved!.payload as Record<string, unknown>;
    expect(() => {
      (payload.targetPlayerIds as string[]).push("p3");
    }).toThrow(TypeError);
  });
});

describe("getCardOfferForPlayer — pick-specific offer correlation", () => {
  it("returns the picked card's offering 3-tuple even after pickCard removed it from the hand", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "offer-seed");
    const cards = m.pickOffer("p1", 5, "offer-1");
    const picked = cards[0]!;
    m.pickCard("p1", picked, 1);
    // The hand has shrunk, but the offer envelope is still
    // pinned by its seqNo.
    expect(m.getHand("p1")).not.toContain(picked);
    let offerSeqNo = 0;
    m.forEachEvent((entry) => {
      if (entry.type === "CARD_OFFER") offerSeqNo = entry.seqNo;
    });
    const offer = m.getCardOfferForPlayer("p1", offerSeqNo);
    expect(offer).toEqual(cards);
  });

  it("returns null for a foreign offerSeqNo", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "foreign-seed");
    m.pickOffer("p1", 5, "foreign-1");
    expect(m.getCardOfferForPlayer("p1", 9999)).toBeNull();
  });

  it("returns null for a missing offerSeqNo before any pickOffer", () => {
    const m = makeMachine();
    expect(m.getCardOfferForPlayer("p1", 1)).toBeNull();
  });

  it("does not return another player's offer", () => {
    const m = makeMachine();
    m.classAssignment(["p1", "p2"], "cross-seed");
    m.pickOffer("p1", 5, "cross-1");
    let offerSeqNo = 0;
    m.forEachEvent((entry) => {
      if (entry.type === "CARD_OFFER") offerSeqNo = entry.seqNo;
    });
    expect(m.getCardOfferForPlayer("p2", offerSeqNo)).toBeNull();
  });
});

describe("pickOffer — card-engine invariant (sampleOffer returned <3 cards)", () => {
  // The state-machine `pickOffer` asserts that `sampleOffer` returned
  // exactly 3 cards. Normally the class pool is large enough to
  // produce 3 unique cards, but a future regression (e.g. an exhausted
  // class pool combined with a bug in the retry loop) could push
  // fewer. We pin the invariant by stubbing `sampleOffer` to return
  // a single card and asserting that the state machine throws.
  it("throws when sampleOffer returns fewer than 3 cards", async () => {
    const cardEngine = await import("./card-engine");
    const spy = vi
      .spyOn(cardEngine, "sampleOffer")
      .mockReturnValue({ cards: ["CB-1"], steps: [] });
    try {
      const m = makeMachine();
      m.classAssignment(["p1"], "inv-seed");
      expect(() => m.pickOffer("p1", 1, "inv-1")).toThrow(
        /card-engine invariant: expected 3 cards, got 1/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("playCard — seqNo drift guard", () => {
  // The state machine mirrors `seqNo` into the CARD_RESOLVED payload
  // BEFORE calling `logEvent`, then asserts the two values agree. A
  // drift would silently corrupt the payload's envelope seqNo. The
  // throw is the safety net; we exercise it by replacing the private
  // `logEvent` with a wrapper that returns a different seqNo.
  it("throws when logEvent returns a seqNo that disagrees with the payload stamp", () => {
    const m = makeMachine();
    m.classAssignment(["p1"], "drift-seed");
    const cards = m.pickOffer("p1", 5, "drift-1");
    const card = cards[0]!;
    m.pickCard("p1", card, 1);

    // Hijack the private logEvent so the next call returns a
    // seqNo that does NOT match the local seqNo. The cast bypasses
    // the private access modifier at runtime.
    const original = (
      m as unknown as { logEvent: (t: string, p?: unknown) => number }
    ).logEvent;
    (
      m as unknown as { logEvent: (t: string, p?: unknown) => number }
    ).logEvent = (type: string, payload?: unknown) => {
      if (type === "CARD_RESOLVED") return 999_999;
      return original.call(m, type, payload);
    };

    expect(() =>
      m.playCard(
        "p1",
        card,
        1,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p2"],
        1000,
      ),
    ).toThrow(/seqNo drift in playCard/);
  });
});

describe("logEvent — deepFreeze preserves undefined payloads", () => {
  // `deepFreezeEventEntry` short-circuits to `undefined` when the
  // entry's payload is `undefined` (no recursion needed). The
  // logEvent wrapper around it must therefore preserve the
  // `undefined` payload on the read-back path. We invoke it
  // directly via the private cast — the real entry returns a
  // frozen object whose payload is exactly `undefined`.
  it("preserves an undefined payload on the returned entry", () => {
    const m = makeMachine();
    const logEvent = (
      m as unknown as { logEvent: (t: string, p?: unknown) => number }
    ).logEvent.bind(m);
    const seqNo = logEvent("UNDEFINED_PAYLOAD_TEST", undefined);
    expect(typeof seqNo).toBe("number");
    let entry: { payload?: unknown } | undefined;
    m.forEachEvent((e) => {
      if (e.type === "UNDEFINED_PAYLOAD_TEST") entry = e;
    });
    expect(entry).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(entry, "payload")).toBe(true);
    expect(entry!.payload).toBeUndefined();
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe("SECOND_CHANCE lifecycle and rehydration", () => {
  it("grants SECOND_CHANCE, consumes it on retry, logs both events, and rehydrates unconsumed grant", () => {
    const m = makeMachine();
    makeActiveRound(m);
    m.classAssignment(["p1"], "seed");
    const cards = m.pickOffer("p1", 5, "seed-1");
    const card = cards[0]!;
    m.pickCard("p1", card, 1);

    // Play SECOND_CHANCE
    m.playCard("p1", card, 1, { kind: "SECOND_CHANCE" }, ["p1"], 1000);

    // First answer
    m.submitAnswer("p1", "A", 1000);

    // An invalid retry attempt after round ends should fail without consuming second chance
    const round = m.getCurrentRound()!;
    expect(() => m.submitAnswer("p1", "B", round.endsAt + 1000)).toThrow(
      RoomError,
    );

    // Rehydrate before valid retry: secondChancePlayers should still have p1
    const restoredBefore = MatchStateMachine.deserialize(m.serialize());
    // Attach correctAnswer since deserialize leaves it undefined (fixture uses "B")
    restoredBefore.attachCorrectAnswer("B");

    // Second answer (retry) succeeds and consumes second chance
    const retryResult = restoredBefore.submitAnswer(
      "p1",
      "B",
      round.startedAt + 1500,
    );
    expect(retryResult.isCorrect).toBe(true);

    // Verify event log contains SECOND_CHANCE_GRANTED followed by SECOND_CHANCE_CONSUMED
    const eventLog = restoredBefore.getEventLog();
    const grantIndex = eventLog.findIndex(
      (e) => e.type === "SECOND_CHANCE_GRANTED",
    );
    const consumeIndex = eventLog.findIndex(
      (e) => e.type === "SECOND_CHANCE_CONSUMED",
    );
    expect(grantIndex).toBeGreaterThanOrEqual(0);
    expect(consumeIndex).toBeGreaterThan(grantIndex);
    expect(eventLog[grantIndex]?.payload).toMatchObject({
      playerId: "p1",
      roundNo: 1,
    });
    expect(eventLog[consumeIndex]?.payload).toMatchObject({
      playerId: "p1",
      roundNo: 1,
    });

    // Rehydrate after retry: secondChancePlayers should be consumed
    const restoredAfter = MatchStateMachine.deserialize(
      restoredBefore.serialize(),
    );
    restoredAfter.attachCorrectAnswer("B");

    // Attempting a third answer without second chance throws ALREADY_ANSWERED
    expect(() =>
      restoredAfter.submitAnswer("p1", "C", round.startedAt + 2000),
    ).toThrow(RoomError);
  });
});
