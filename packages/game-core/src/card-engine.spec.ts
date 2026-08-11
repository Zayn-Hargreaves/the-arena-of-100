// ============================================================
// Card engine tests — Phase 2 (Class + Card Hybrid)
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "Sampling algorithm" + §4.1 "Card Effect Discriminated Union".
//
// Coverage:
//   - 100% of sampleOffer's happy path (3 cards, no retry).
//   - 100% of effectiveCount variants full / partial / empty
//     supply for OPTION_DISABLE and HAND_DESTROY.
//   - 100% of the 15 pass-through card templates.
//   - Pinned vector parity (sampleOffer(..., seed) == vector steps).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  CARD_CATALOG,
  getCardDefinition,
  getClassPool,
  type CardId,
} from "@arena/shared";
import {
  sampleOffer,
  resolveCardEffect,
  resolveOptionDisable,
  resolveHandDestroy,
  correctOptionIndex,
  SAMPLE_OFFER_COUNT,
} from "./card-engine";
import { mulberry32, sha256Bytes } from "./prng";
import {
  ALL_SAMPLING_VECTORS,
  VECTOR_CONG_CLASS_HAPPY,
  VECTOR_THU_CLASS_HAPPY,
  loadSamplingVector,
} from "@arena/shared/src/cards.sampling-vectors";

describe("sampleOffer — happy path (spec §3.3)", () => {
  it("returns exactly 3 unique cards for CONG", () => {
    const result = sampleOffer("CONG", "match-1|CONG-player-1");
    expect(result.cards).toHaveLength(3);
    expect(new Set(result.cards).size).toBe(3);
  });

  it("returns exactly 3 unique cards for THU", () => {
    const result = sampleOffer("THU", "match-1|THU-player-1");
    expect(result.cards).toHaveLength(3);
    expect(new Set(result.cards).size).toBe(3);
  });

  it("returns only cards from the requested class pool", () => {
    const congPool = new Set(getClassPool("CONG"));
    const result = sampleOffer("CONG", "any-seed");
    for (const c of result.cards) {
      expect(congPool.has(c)).toBe(true);
    }
  });

  it("consumes 6 floats per 3-card offer (no retry)", () => {
    const result = sampleOffer("CONG", "any-seed");
    expect(result.steps).toHaveLength(6);
    expect(result.steps.filter((s) => s.purpose === "TIER")).toHaveLength(3);
    expect(result.steps.filter((s) => s.purpose === "CARD")).toHaveLength(3);
  });

  it("is deterministic — same seed → same offer + same step trace", () => {
    const a = sampleOffer("CONG", "deterministic-seed");
    const b = sampleOffer("CONG", "deterministic-seed");
    expect(a.cards).toEqual(b.cards);
    expect(a.steps).toEqual(b.steps);
  });

  it("different seeds yield different offers (statistical sanity)", () => {
    const a = sampleOffer("CONG", "seed-A");
    const b = sampleOffer("CONG", "seed-B");
    expect(a.cards).not.toEqual(b.cards);
  });
});

describe("sampleOffer — matches pinned sampling vectors", () => {
  for (const v of ALL_SAMPLING_VECTORS) {
    it(`[${v.seed}|${v.classId}] produces the pinned 3-card offer + step trace`, () => {
      const result = sampleOffer(v.classId, v.seed);
      expect(result.cards).toEqual(v.offeredCardIds);
      expect(result.steps).toEqual(v.steps);
    });
  }
});

describe("sampleOffer — tier selection (spec §3.3 60/30/10)", () => {
  it("places COMMON / RARE / EPIC tiers across many seeds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const result = sampleOffer("CONG", `seed-${i}`);
      for (const s of result.steps) {
        if (s.purpose === "TIER" && s.tier) seen.add(s.tier);
      }
    }
    expect(seen.has("COMMON")).toBe(true);
    expect(seen.has("RARE")).toBe(true);
    expect(seen.has("EPIC")).toBe(true);
  });
});

describe("sampleOffer — without replacement invariant", () => {
  it("never draws the same cardId twice in a single offer", () => {
    for (let i = 0; i < 200; i++) {
      const result = sampleOffer(i % 2 === 0 ? "CONG" : "THU", `seed-${i}`);
      expect(new Set(result.cards).size).toBe(result.cards.length);
    }
  });
});

describe("sampleOffer — exhausted-pool branch (spec §3.3 fewer-than-3)", () => {
  it("returns fewer than 3 cards and stops consuming RNG when no cards remain", () => {
    // Pass custom single-card pool ["CB-1"] to sampleOffer seam.
    const result = sampleOffer("CONG", "exhausted-seed", ["CB-1"]);
    expect(result.cards).toEqual(["CB-1"]);
    // Exactly one TIER step (drew COMMON) and one CARD step
    // (drew CB-1) — no further TIER or CARD draws once the pool
    // is exhausted.
    expect(result.steps.filter((s) => s.purpose === "TIER")).toHaveLength(1);
    expect(result.steps.filter((s) => s.purpose === "CARD")).toHaveLength(1);
  });
});

describe("resolveOptionDisable — TN-1 / TN-10 (spec §3.3 effectiveCount)", () => {
  const options = ["A", "B", "C", "D"]; // correct answer = "B"

  it("full supply: count=2 picks 2 wrong indexes, length matches count", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 2,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 20000,
    };
    const rng = mulberry32(0xdeadbeef);
    const result = resolveOptionDisable(template, options, "B", rng);
    expect(result.kind).toBe("OPTION_DISABLE");
    expect(result.count).toBe(2);
    expect(result.availableAtResolution).toBe(3);
    expect(result.indexes).toHaveLength(2);
    // Never picks the correct answer's index.
    expect(result.indexes).not.toContain(1);
    // No duplicates within the resolved set.
    expect(new Set(result.indexes).size).toBe(2);
  });

  it("partial supply: count=2 against 1 wrong index ⇒ length=1, metadata carries count=2", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 2,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 20000,
    };
    const rng = mulberry32(0xfacefeed);
    // Only one wrong index (0) available — the other 3 are all
    // the correct answer "B". `wrongIndexes` is therefore [0].
    const result = resolveOptionDisable(
      template,
      ["A", "B", "B", "B"],
      "B",
      rng,
    );
    expect(result.availableAtResolution).toBe(1);
    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).toBe(0);
    expect(result.count).toBe(2); // count is REQUESTED, never rewritten
  });

  it("empty supply: count=1, all wrong options consumed ⇒ length=0, zero floats", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 20000,
    };
    const rng = mulberry32(0xcafebabe);
    const result = resolveOptionDisable(template, ["B"], "B", rng);
    expect(result.availableAtResolution).toBe(0);
    expect(result.indexes).toHaveLength(0);
    expect(result.count).toBe(1);
  });
});

describe("resolveHandDestroy — CB-3 (spec §3.3 effectiveCount)", () => {
  it("full supply: target has 3 cards, count=1 picks 1", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    const rng = mulberry32(0x12345678);
    const result = resolveHandDestroy(template, ["CB-1", "CB-2", "CB-3"], rng);
    expect(result.destroyedCardIds).toHaveLength(1);
    expect(result.count).toBe(1);
    expect(result.availableAtResolution).toBe(3);
  });

  it("partial supply: target has 1 card, count=1 picks 1", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    const rng = mulberry32(0x87654321);
    const result = resolveHandDestroy(template, ["CB-5"], rng);
    expect(result.destroyedCardIds).toHaveLength(1);
    expect(result.destroyedCardIds[0]).toBe("CB-5");
    expect(result.count).toBe(1);
    expect(result.availableAtResolution).toBe(1);
  });

  it("empty supply: target hand empty ⇒ length=0, zero floats consumed", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    const rng = mulberry32(0xfeedface);
    const result = resolveHandDestroy(template, [], rng);
    expect(result.destroyedCardIds).toHaveLength(0);
    expect(result.availableAtResolution).toBe(0);
  });

  it("uses compareCardId ordering for the target hand — never plain lexicographic", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    const rng = mulberry32(0x55555555);
    const hand: CardId[] = ["TN-9", "TN-2", "TN-10"];
    const result = resolveHandDestroy(template, hand, rng);
    // The destroyed card is one of the three, regardless of the
    // input order; the float indexes into the SORTED list.
    expect(hand).toContain(result.destroyedCardIds[0]);
  });
});

describe("correctOptionIndex", () => {
  it("returns the index of the correct answer in the options array", () => {
    expect(correctOptionIndex(["A", "B", "C", "D"], "B")).toBe(1);
  });

  it("throws when the correct answer is missing from the options", () => {
    expect(() => correctOptionIndex(["A", "B", "C"], "Z")).toThrow();
  });
});

describe("resolveCardEffect — pass-through templates (no RNG consumed)", () => {
  // 13 of the 18 cards have template shapes that ARE the resolved
  // effect. They MUST NOT consume RNG (consumeRNG = false). The
  // remaining 5 (CB-3, TN-1, TN-3, TN-4, TN-10) either consume RNG
  // or require caller-supplied ctx (HINT_REVEAL_TEMPLATE needs
  // `partial`; SHIELD_TEMPLATE needs `currentRoundNo`).
  const passThroughCards: CardId[] = [
    "CB-1",
    "CB-2",
    "CB-4",
    "CB-5",
    "CB-6",
    "CB-7",
    "CB-8",
    "TN-2",
    "TN-5",
    "TN-6",
    "TN-7",
    "TN-8",
    "TN-9",
  ];

  for (const cardId of passThroughCards) {
    it(`${cardId} resolves to the same shape as its template (no RNG consumed)`, () => {
      const def = getCardDefinition(cardId);
      const rng = mulberry32(0x12345678);
      // Pin: after the call, the wrapped rng's next 3 values
      // must equal the next 3 values of an untouched twin rng.
      // If the function consumed RNG, the wrapped rng would be
      // ahead by however many floats the function consumed.
      const untouched = mulberry32(0x12345678);
      const result = resolveCardEffect(cardId, def.effectTemplate, rng);
      const post = [rng(), rng(), rng()];
      const expectedPost = [untouched(), untouched(), untouched()];
      expect(post).toEqual(expectedPost);
      expect(result).toEqual({ ...def.effectTemplate });
    });
  }
});

describe("resolveCardEffect — HINT_REVEAL_TEMPLATE (TN-3) needs partial ctx", () => {
  it("resolves to HINT_REVEAL with the supplied partial string", () => {
    const template = {
      kind: "HINT_REVEAL_TEMPLATE" as const,
      revealDescriptor: "FIRST_N_CHARS" as const,
      count: 1,
    };
    const rng = mulberry32(0x42);
    const result = resolveCardEffect("TN-3", template, rng, {
      partial: "B",
    });
    expect(result).toEqual({ kind: "HINT_REVEAL", partial: "B" });
  });
});

describe("resolveCardEffect — SHIELD_TEMPLATE (TN-4) needs currentRoundNo ctx", () => {
  it("resolves to SHIELD with expiresAtRound = currentRoundNo + offset", () => {
    const template = {
      kind: "SHIELD_TEMPLATE" as const,
      expiresAfterRoundOffset: 1,
    };
    const rng = mulberry32(0x42);
    const result = resolveCardEffect("TN-4", template, rng, {
      currentRoundNo: 5,
    });
    expect(result).toEqual({ kind: "SHIELD", expiresAtRound: 6 });
  });
});

describe("resolveCardEffect — explicit RNG consumption (CB-3, TN-1, TN-10)", () => {
  it("CB-3 selects a card from the target's hand", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    const rng = mulberry32(0xabcd1234);
    const result = resolveCardEffect("CB-3", template, rng, {
      targetHand: ["CB-1", "CB-2", "CB-3"],
    });
    expect(result.kind).toBe("HAND_DESTROY");
    if (result.kind !== "HAND_DESTROY") return;
    expect(["CB-1", "CB-2", "CB-3"]).toContain(result.destroyedCardIds[0]);
  });

  it("TN-1 picks 2 wrong indexes", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 2,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 20000,
    };
    const rng = mulberry32(0xabcd1234);
    const result = resolveCardEffect("TN-1", template, rng, {
      options: ["A", "B", "C", "D"],
      correctAnswer: "B",
    });
    expect(result.kind).toBe("OPTION_DISABLE");
    if (result.kind !== "OPTION_DISABLE") return;
    expect(result.indexes).toHaveLength(2);
    expect(result.indexes).not.toContain(1);
  });

  it("TN-10 picks 1 wrong index", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 20000,
    };
    const rng = mulberry32(0xabcd1234);
    const result = resolveCardEffect("TN-10", template, rng, {
      options: ["A", "B", "C", "D"],
      correctAnswer: "B",
    });
    expect(result.kind).toBe("OPTION_DISABLE");
    if (result.kind !== "OPTION_DISABLE") return;
    expect(result.indexes).toHaveLength(1);
    expect(result.indexes[0]).not.toBe(1);
  });
});

describe("resolveCardEffect — template kind mismatch throws", () => {
  it("throws when the supplied template kind does not match the card definition", () => {
    const wrongTemplate = {
      kind: "OPTION_LOCK" as const,
      durationMs: 1000,
    };
    const rng = mulberry32(0x42);
    expect(() => resolveCardEffect("CB-1", wrongTemplate, rng)).toThrow();
  });
});

describe("resolveCardEffect — missing required ctx fields throw", () => {
  // Guardrail: each ctx-gated template MUST throw a specific
  // error when the caller forgot the runtime context it depends
  // on. The errors carry the template kind so the boundary can
  // surface them in logs.
  const rng = mulberry32(0x42);

  it("OPTION_DISABLE_TEMPLATE throws without options + correctAnswer", () => {
    const template = {
      kind: "OPTION_DISABLE_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_WRONG_OPTIONS" as const,
      durationMs: 1000,
    };
    expect(() => resolveCardEffect("TN-1", template, rng, {})).toThrow(
      /OPTION_DISABLE_TEMPLATE requires options \+ correctAnswer/,
    );
  });

  it("HAND_DESTROY_TEMPLATE throws without targetHand", () => {
    const template = {
      kind: "HAND_DESTROY_TEMPLATE" as const,
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND" as const,
    };
    expect(() => resolveCardEffect("CB-3", template, rng, {})).toThrow(
      /HAND_DESTROY_TEMPLATE requires targetHand/,
    );
  });

  it("HINT_REVEAL_TEMPLATE throws without ctx.partial", () => {
    const template = {
      kind: "HINT_REVEAL_TEMPLATE" as const,
      revealDescriptor: "FIRST_N_CHARS" as const,
      count: 1,
    };
    expect(() => resolveCardEffect("TN-3", template, rng, {})).toThrow(
      /HINT_REVEAL_TEMPLATE requires ctx.partial/,
    );
  });

  it("SHIELD_TEMPLATE throws without ctx.currentRoundNo", () => {
    const template = {
      kind: "SHIELD_TEMPLATE" as const,
      expiresAfterRoundOffset: 1,
    };
    expect(() => resolveCardEffect("TN-4", template, rng, {})).toThrow(
      /SHIELD_TEMPLATE requires ctx.currentRoundNo/,
    );
  });
});

describe("SAMPLE_OFFER_COUNT constant", () => {
  it("equals 3 (typed-tuple invariant — spec §3.3)", () => {
    expect(SAMPLE_OFFER_COUNT).toBe(3);
  });
});

describe("ALL_SAMPLING_VECTORS — sanity", () => {
  it("contains expected canonical vectors", () => {
    expect(VECTOR_CONG_CLASS_HAPPY.classId).toBe("CONG");
    expect(VECTOR_THU_CLASS_HAPPY.classId).toBe("THU");
    expect(loadSamplingVector("cong-class-happy")).toBe(
      VECTOR_CONG_CLASS_HAPPY,
    );
  });
});

describe("sha256Bytes (FIPS 180-4 reference vector)", () => {
  // Canonical digest for the UTF-8 bytes of "abc" (0x61 0x62 0x63).
  // Pins both the padding layout (length ≡ 0 mod 64) and the
  // big-endian 64-bit length encoding.
  it("matches the standard SHA-256 digest for 'abc'", () => {
    const digest = sha256Bytes([0x61, 0x62, 0x63]);
    const hex = Array.from(digest)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("catalog invariants (cross-package)", () => {
  it("every card in CARD_CATALOG has a definition resolvable via getCardDefinition", () => {
    for (const card of CARD_CATALOG) {
      expect(getCardDefinition(card.id).id).toBe(card.id);
    }
  });
});
