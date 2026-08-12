// ============================================================
// @arena/shared — Phase 2 (Class + Card Hybrid) type tests
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "Required test".
// ============================================================

import { describe, it, expect } from "vitest";
import {
  CARD_CATALOG,
  CARD_TIER_WEIGHTS,
  compareCardId,
  getCardDefinition,
  getClassPool,
  PRNG_CONTRACT_VERSION,
  type CardId,
} from "./cards";
import { CLASS_IDS, type ClassId } from "./classes";

describe("card catalog (Phase 2 — spec §3.1, §3.2)", () => {
  it("exports exactly 18 cards (8 Offensive/CONG + 10 Defensive/THU)", () => {
    expect(CARD_CATALOG.length).toBe(18);
    expect(CARD_CATALOG.filter((c) => c.classId === "CONG").length).toBe(8);
    expect(CARD_CATALOG.filter((c) => c.classId === "THU").length).toBe(10);
  });

  it("contains all 18 unique CardIds in the spec", () => {
    const expected: CardId[] = [
      "CB-1",
      "CB-2",
      "CB-3",
      "CB-4",
      "CB-5",
      "CB-6",
      "CB-7",
      "CB-8",
      "TN-1",
      "TN-2",
      "TN-3",
      "TN-4",
      "TN-5",
      "TN-6",
      "TN-7",
      "TN-8",
      "TN-9",
      "TN-10",
    ];
    const actual = CARD_CATALOG.map((c) => c.id)
      .slice()
      .sort(compareCardId);
    expect(actual).toEqual(expected);
  });

  it("every card has cohort-consistent backfireRate (0.0 for Defensive/THU, 0.1 for Offensive/CONG)", () => {
    for (const card of CARD_CATALOG) {
      if (card.classId === "CONG") {
        expect(card.backfireRate).toBe(0.1);
      } else {
        expect(card.backfireRate).toBe(0.0);
      }
    }
  });
});

describe("compareCardId (spec §3.3 — canonical 18-ID order)", () => {
  // Pinned canonical order from spec §3.3. Adding a two-digit
  // suffix (e.g. CB-10) MUST NOT silently change this ordering.
  const expected: CardId[] = [
    "CB-1",
    "CB-2",
    "CB-3",
    "CB-4",
    "CB-5",
    "CB-6",
    "CB-7",
    "CB-8",
    "TN-1",
    "TN-2",
    "TN-3",
    "TN-4",
    "TN-5",
    "TN-6",
    "TN-7",
    "TN-8",
    "TN-9",
    "TN-10",
  ];

  it("produces ascending canonical order across all 18 cards", () => {
    const sorted = [...expected].sort(compareCardId);
    expect(sorted).toEqual(expected);
  });

  it("places CB-* before TN-* (prefix ASCII ordering)", () => {
    expect(compareCardId("CB-1", "TN-1")).toBeLessThan(0);
    expect(compareCardId("TN-1", "CB-1")).toBeGreaterThan(0);
  });

  it("places TN-9 before TN-10 (numeric suffix ordering, not lexicographic)", () => {
    // This is the spec's exact failure case: plain `.sort()` would
    // order TN-10 before TN-2 (lexicographic). compareCardId must
    // not.
    expect(compareCardId("TN-9", "TN-10")).toBeLessThan(0);
    expect(compareCardId("TN-10", "TN-9")).toBeGreaterThan(0);
  });

  it("is consistent: equal ids return 0", () => {
    expect(compareCardId("CB-3", "CB-3")).toBe(0);
    expect(compareCardId("TN-7", "TN-7")).toBe(0);
  });
});

describe("getClassPool (spec §3.3 — frozen ordered pool)", () => {
  it("returns the 8 Offensive/CONG cards in canonical order", () => {
    const pool = getClassPool("CONG");
    expect(pool.length).toBe(8);
    expect(pool).toEqual([
      "CB-1",
      "CB-2",
      "CB-3",
      "CB-4",
      "CB-5",
      "CB-6",
      "CB-7",
      "CB-8",
    ]);
  });

  it("returns the 10 Defensive/THU cards in canonical order", () => {
    const pool = getClassPool("THU");
    expect(pool.length).toBe(10);
    expect(pool).toEqual([
      "TN-1",
      "TN-2",
      "TN-3",
      "TN-4",
      "TN-5",
      "TN-6",
      "TN-7",
      "TN-8",
      "TN-9",
      "TN-10",
    ]);
  });

  it("returns the same ordered list on every call", () => {
    // The spec requires the lists the sampling engine indexes
    // into to be ordered snapshots. We return the same
    // `readonly CardId[]` callers see across multiple calls so
    // accidental mutation is caught at compile time.
    const pool = getClassPool("CONG");
    expect(pool).toEqual(getClassPool("CONG"));
  });

  it("returns a runtime-immutable array (push / splice / index-assignment rejected)", () => {
    // The pool is `Object.freeze`'d at module load so a buggy
    // caller cannot poison the catalog. Mutation attempts throw
    // in strict mode and are silently ignored otherwise — the
    // contract is `Object.isFrozen(pool)`.
    const pool = getClassPool("CONG");
    expect(Object.isFrozen(pool)).toBe(true);
    const mutable = pool as unknown as CardId[];
    const expectThrow = (label: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw new Error(
            `Unexpected error type when mutating ${label}: ${err}`,
          );
        }
        return; // expected
      }
      throw new Error(`Mutation of ${label} did not throw`);
    };
    expectThrow("pool[0]", () => {
      mutable[0] = "CB-99" as CardId;
    });
    expectThrow("pool.push", () => {
      mutable.push("CB-99" as CardId);
    });
    expectThrow("pool.splice", () => {
      mutable.splice(0, 1);
    });
    // After the rejected mutations, the catalog is still the
    // canonical list — the contract guarantees the rejection.
    expect(getClassPool("CONG")).toEqual([
      "CB-1",
      "CB-2",
      "CB-3",
      "CB-4",
      "CB-5",
      "CB-6",
      "CB-7",
      "CB-8",
    ]);
  });

  it("freezes the Defensive/THU pool too", () => {
    expect(Object.isFrozen(getClassPool("THU"))).toBe(true);
  });
});

describe("getCardDefinition (catalog lookup)", () => {
  it("returns the canonical definition for each catalog id", () => {
    for (const card of CARD_CATALOG) {
      const def = getCardDefinition(card.id);
      expect(def.id).toBe(card.id);
      expect(def.classId).toBe(card.classId);
      expect(def.tier).toBe(card.tier);
    }
  });

  it("throws on unknown id (defensive against tampering)", () => {
    expect(() => getCardDefinition("XX-1" as unknown as CardId)).toThrow();
  });
});

describe("PRNG contract version + tier weights (spec §3.3)", () => {
  it("PRNG_CONTRACT_VERSION is the canonical 'mulberry32-substream-v1'", () => {
    expect(PRNG_CONTRACT_VERSION).toBe("mulberry32-substream-v1");
  });

  it("tier weights sum to 1.0 (CARD_TIER_WEIGHTS 60/30/10)", () => {
    expect(
      CARD_TIER_WEIGHTS.COMMON +
        CARD_TIER_WEIGHTS.RARE +
        CARD_TIER_WEIGHTS.EPIC,
    ).toBeCloseTo(1.0, 10);
  });
});

describe("classes (spec §2)", () => {
  it("CLASS_IDS contains exactly CONG and THU", () => {
    expect(CLASS_IDS.length).toBe(2);
    expect(new Set(CLASS_IDS)).toEqual(new Set<ClassId>(["CONG", "THU"]));
  });
});

// ============================================================
// Phase 3 — card variant cosmetic unlock (spec §2 Decision 19)
// ============================================================

import {
  CARD_VARIANT_ORDER,
  CARD_VARIANT_STREAK_THRESHOLD,
  nextCardVariant,
  pickCardForVariantUnlock,
} from "./cards";

describe("card variant unlock (Phase 3)", () => {
  it("CARD_VARIANT_ORDER is exactly DEFAULT, NEON, GOLD", () => {
    expect(CARD_VARIANT_ORDER).toEqual(["DEFAULT", "NEON", "GOLD"]);
  });

  it("CARD_VARIANT_STREAK_THRESHOLD is 7", () => {
    expect(CARD_VARIANT_STREAK_THRESHOLD).toBe(7);
  });

  it("nextCardVariant returns NEON for a fresh user (owns only DEFAULT)", () => {
    expect(nextCardVariant(new Set(["DEFAULT"]))).toBe("NEON");
  });

  it("nextCardVariant returns NEON when owned set is empty (first-ever unlock)", () => {
    expect(nextCardVariant(new Set())).toBe("NEON");
  });

  it("nextCardVariant returns GOLD after NEON is owned", () => {
    expect(nextCardVariant(new Set(["DEFAULT", "NEON"]))).toBe("GOLD");
  });

  it("nextCardVariant returns null when every variant above DEFAULT is owned", () => {
    expect(nextCardVariant(new Set(["DEFAULT", "NEON", "GOLD"]))).toBe(null);
  });

  it("pickCardForVariantUnlock rotates through the CONG pool deterministically", () => {
    const pool = getClassPool("CONG");
    expect(pool.length).toBeGreaterThan(0);
    // Every unlock index maps to a card in the CONG pool.
    for (const idx of [0, 1, 2, 3, 5, 7]) {
      const card = pickCardForVariantUnlock("CONG", idx);
      expect(pool).toContain(card);
    }
  });

  it("pickCardForVariantUnlock is deterministic for a given classId + index", () => {
    expect(pickCardForVariantUnlock("CONG", 0)).toBe(
      pickCardForVariantUnlock("CONG", 0),
    );
    expect(pickCardForVariantUnlock("THU", 2)).toBe(
      pickCardForVariantUnlock("THU", 2),
    );
  });
});
