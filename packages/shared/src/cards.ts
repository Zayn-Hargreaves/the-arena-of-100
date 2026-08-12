// ============================================================
// Cards - Arena of 100
// Source of truth: memory-bank/spec/class-cards-phase.md §3, §4.1
// Locked 2026-07-30 as part of Phase 2 (Class + Card Hybrid).
//
// This file owns the SHARED card contract (types, canonical
// `CardId` ordering, the `CardDefinition` catalog, the
// template/resolved effect unions, and the PRNG contract version).
// It does NOT own resolution logic — that lives in
// `@arena/game-core/src/card-engine.ts` and consumes the explicit
// types defined here. The API boundary re-validates the resolved
// `CardEffect` against the schema below before appending anything
// to the event log.
// ============================================================

import type { ClassId } from "./classes";

// ---------------------------------------------------------------------------
// PRNG contract version
// ---------------------------------------------------------------------------
//
// `PRNG_CONTRACT_VERSION` canonically identifies the ENTIRE
// deterministic card RNG contract — seed derivation, the Mulberry32
// algorithm, the RNG-consumption order (TIER/CARD float accounting),
// and the sampling rules. Bumping the version invalidates every
// existing sampling vector in lockstep across @arena/shared,
// @arena/game-core, @arena/api, and the replay harness.
//
// The constant is referenced by:
//   - The sampling vectors in `cards.sampling-vectors.ts` (co-located)
//   - The card-sampling engine in `@arena/game-core/src/card-engine.ts`
//   - The API boundary validator (`@arena/api`)
//   - The replay harness
//
// It is DISTINCT from `DailyRunHeader.prngVersion` ("sha256-v1") in
// the Gauntlet design — same field name, different namespace,
// versioned independently.
export const PRNG_CONTRACT_VERSION = "mulberry32-substream-v1";

// ---------------------------------------------------------------------------
// Tier + canonical CardId
// ---------------------------------------------------------------------------

export type CardTier = "COMMON" | "RARE" | "EPIC";

// Card pool v1 — exactly 18 IDs (8 Offensive/CONG + 10
// Defensive/THU). No other string is a valid `CardId`: the
// API boundary rejects anything outside this union at the
// Zod layer before any resolver is invoked.
export type CardId =
  | "CB-1"
  | "CB-2"
  | "CB-3"
  | "CB-4"
  | "CB-5"
  | "CB-6"
  | "CB-7"
  | "CB-8"
  | "TN-1"
  | "TN-2"
  | "TN-3"
  | "TN-4"
  | "TN-5"
  | "TN-6"
  | "TN-7"
  | "TN-8"
  | "TN-9"
  | "TN-10";

// Canonical CardId comparator. Spec §3.3 forbids plain `.sort()` /
// `localeCompare` for `CardId` ordering because the suffixes pass
// 9 (`TN-10`), so the obvious implementations disagree and
// `idx = Math.floor(u2 * remainingTierCards)` then indexes into
// the wrong list — a silent divergence between API, game-core,
// and replay that byte-identical replay cannot tolerate.
//
// Every consumer (loader, sampling engine, API validator, replay
// harness) MUST import this comparator — no layer may re-implement
// or re-sort with an ad-hoc comparator.
//
// Spec §3.3 "Canonical CardId order" pins the expected 18-ID
// ordering (suffix ascending, prefix ASCII by string comparison):
//   CB-1, CB-2, CB-3, CB-4, CB-5, CB-6, CB-7, CB-8,
//   TN-1, TN-2, TN-3, TN-4, TN-5, TN-6, TN-7, TN-8, TN-9, TN-10
//
// A test in `packages/shared/src/cards.spec.ts` pins this exact
// ordering so adding a two-digit suffix (e.g. `CB-10`) cannot
// silently reintroduce the lexicographic split.
export function compareCardId(a: CardId, b: CardId): number {
  const parse = (id: CardId): { prefix: string; suffix: number } => {
    const dash = id.indexOf("-");
    return {
      prefix: id.slice(0, dash),
      suffix: Number.parseInt(id.slice(dash + 1), 10),
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.prefix !== pb.prefix) {
    return pa.prefix < pb.prefix ? -1 : 1;
  }
  return pa.suffix - pb.suffix;
}

// ---------------------------------------------------------------------------
// CardDefinition — canonical catalog row
// ---------------------------------------------------------------------------

// Source-of-truth card templates. The catalog is the only place
// where `backfireRate`, `name`, `description`, and the
// `effectTemplate` are defined; the API boundary loads each
// `CardDefinition` by `cardId` and never trusts client-supplied
// template fields. If a legacy request still carries template-like
// fields (`extraMs`, `factor`, `indexes`, `durationMs`, ...), the
// API compares them to the canonical definition and rejects
// mismatches.
export interface CardDefinition {
  id: CardId;
  classId: ClassId;
  tier: CardTier;
  name: string;
  description: string;
  // Unresolved template — server-side resolver expands the
  // template into a concrete `CardEffect` before appending the
  // `CARD_RESOLVED` event. The client never sees a template.
  effectTemplate: CardEffectTemplate;
  // Runtime-validated ∈ [0.0, 0.1]. v1 backfire is a simple
  // visible animation (no penalty roll) per Decision 13.
  backfireRate: number;
  // v1: every card is single-use per match.
  cooldownPerMatch: 1;
}

/**
 * Deeply-readonly view of a `CardDefinition`, matching the runtime
 * `Object.freeze` applied to every entry in `CARD_CATALOG`.
 * Consumers that receive a card via `getCardDefinition` or iterate
 * `CARD_CATALOG` get this type and cannot mutate it.
 */
export type ReadonlyCardDefinition = Readonly<CardDefinition> & {
  readonly effectTemplate: Readonly<CardEffectTemplate>;
};

// ---------------------------------------------------------------------------
// Effect discriminated unions (template → resolved)
// ---------------------------------------------------------------------------
//
// Preserved verbatim from spec §4.1. A `_TEMPLATE` suffix means
// the server-side resolver replaces the template with concrete
// runtime values (orbs chosen, wrong-options chosen, hand cards
// destroyed) BEFORE append — a single name means the template and
// the resolved shapes are identical (no server-side resolution
// step).
//
// `satisfies never` exhaustive-switch check is enforced at
// every consumer (`card-engine.ts`, `match-state-machine.ts`,
// web reducer) — adding a new variant without updating all
// consumers is a compile-time error.

export type CardEffectTemplate =
  | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
  | {
      kind: "OPTION_DISABLE_TEMPLATE";
      count: number;
      selectionPolicy: "RANDOM_WRONG_OPTIONS";
      durationMs: number;
    }
  | { kind: "OPTION_FAKE"; indexes: number[]; durationMs: number }
  | { kind: "OPTION_LOCK"; durationMs: number }
  | {
      kind: "HINT_REVEAL_TEMPLATE";
      revealDescriptor: "FIRST_N_CHARS";
      count: number;
    }
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  | {
      kind: "SHIELD_TEMPLATE";
      expiresAfterRoundOffset: number;
    }
  | { kind: "SCORE_MULT"; factor: number }
  | {
      kind: "HAND_DESTROY_TEMPLATE";
      count: number;
      selectionPolicy: "RANDOM_FROM_TARGET_HAND";
    }
  | { kind: "SECOND_CHANCE" };

export type CardEffect =
  | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
  // Resolved: `count` is the REQUESTED number and is never
  // rewritten; `availableAtResolution` is the wrong-option supply
  // captured at resolve time. The validator checks
  // `indexes.length === Math.min(count, availableAtResolution)`
  // from the payload alone — never from live question state.
  // Replay reads these indexes verbatim and MUST NOT re-run the
  // RNG (spec §3.3 "Replay MUST NOT re-randomize").
  | {
      kind: "OPTION_DISABLE";
      readonly indexes: readonly number[];
      count: number;
      availableAtResolution: number;
      durationMs: number;
    }
  | {
      kind: "OPTION_FAKE";
      readonly indexes: readonly number[];
      durationMs: number;
    }
  | { kind: "OPTION_LOCK"; durationMs: number }
  // Resolved: concrete string derived from the current question.
  | { kind: "HINT_REVEAL"; partial: string }
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  // Resolved: absolute round number derived from persisted roundNo.
  | { kind: "SHIELD"; expiresAtRound: number }
  | { kind: "SCORE_MULT"; factor: number }
  // Resolved: concrete cards chosen server-side. `count` +
  // `availableAtResolution` carry the canonical cardinality so
  // `destroyedCardIds.length === Math.min(count, availableAtResolution)`.
  | {
      kind: "HAND_DESTROY";
      count: number;
      availableAtResolution: number;
      readonly destroyedCardIds: readonly CardId[];
    }
  | { kind: "SECOND_CHANCE" };

// ---------------------------------------------------------------------------
// Card catalog (v1 — 18 cards)
// ---------------------------------------------------------------------------
//
// Built from spec §3.1 (Offensive/CONG) + §3.2 (Defensive/THU).
// The 18 cards are wired to the appropriate `CardEffectTemplate`
// + tier + class. The catalog is the canonical source for both
// the sampling engine (class-pool partition) and the API
// boundary (per-card validation).

const RAW_CARD_CATALOG: readonly CardDefinition[] = [
  // Offensive (CONG) — 8 cards
  {
    id: "CB-1",
    classId: "CONG",
    tier: "COMMON",
    name: "Time Freeze",
    description: "Reduce a target's answer window by 5s.",
    effectTemplate: { kind: "TIMER_MODIFY", deltaMs: -5000, targetCount: 1 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-2",
    classId: "CONG",
    tier: "COMMON",
    name: "Sabotage Q",
    description: "Delay a target's question render by 3s.",
    effectTemplate: { kind: "DELAY_RENDER", delayMs: 3000, targetCount: 1 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-3",
    classId: "CONG",
    tier: "COMMON",
    name: "Burn Card",
    description: "Destroy 1 random card from the target's hand.",
    effectTemplate: {
      kind: "HAND_DESTROY_TEMPLATE",
      count: 1,
      selectionPolicy: "RANDOM_FROM_TARGET_HAND",
    },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-4",
    classId: "CONG",
    tier: "RARE",
    name: "Question Lock",
    description: "Lock a target's options for 2s.",
    effectTemplate: { kind: "OPTION_LOCK", durationMs: 2000 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-5",
    classId: "CONG",
    tier: "RARE",
    name: "Brain Fog",
    description: "Apply Brain Fog visual overlay for 5s.",
    effectTemplate: {
      kind: "VISUAL_OVERLAY",
      flag: "BRAIN_FOG",
      durationMs: 5000,
    },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-6",
    classId: "CONG",
    tier: "COMMON",
    name: "Fake Flag",
    description: "Show 1 fake flag option to a target for 8s.",
    effectTemplate: { kind: "OPTION_FAKE", indexes: [1], durationMs: 8000 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-7",
    classId: "CONG",
    tier: "COMMON",
    name: "Question Flip",
    description: "Flip a target's question semantics for 10s.",
    effectTemplate: { kind: "SEMANTIC_FLIP", durationMs: 10000 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  {
    id: "CB-8",
    classId: "CONG",
    tier: "EPIC",
    name: "Mass Distraction",
    description: "Delay up to 3 targets' question render by 2s.",
    effectTemplate: { kind: "DELAY_RENDER", delayMs: 2000, targetCount: 3 },
    backfireRate: 0.1,
    cooldownPerMatch: 1,
  },
  // Defensive (THU) — 10 cards
  {
    id: "TN-1",
    classId: "THU",
    tier: "COMMON",
    name: "50:50",
    description: "Disable 2 random wrong options for the round.",
    effectTemplate: {
      kind: "OPTION_DISABLE_TEMPLATE",
      count: 2,
      selectionPolicy: "RANDOM_WRONG_OPTIONS",
      durationMs: 20000,
    },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-2",
    classId: "THU",
    tier: "COMMON",
    name: "Double Points",
    description: "Double your score for the next correct answer.",
    effectTemplate: { kind: "SCORE_MULT", factor: 2 },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-3",
    classId: "THU",
    tier: "COMMON",
    name: "Hint Reveal",
    description: "Reveal the first character of the correct answer.",
    effectTemplate: {
      kind: "HINT_REVEAL_TEMPLATE",
      revealDescriptor: "FIRST_N_CHARS",
      count: 1,
    },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-4",
    classId: "THU",
    tier: "RARE",
    name: "Shield",
    description: "Block 1 incoming card for the next round.",
    effectTemplate: {
      kind: "SHIELD_TEMPLATE",
      expiresAfterRoundOffset: 1,
    },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-5",
    classId: "THU",
    tier: "COMMON",
    name: "Time Bonus",
    description: "Add 5s to your per-question answer deadline.",
    effectTemplate: { kind: "QUESTION_REPLAY", extraMs: 5000 },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-6",
    classId: "THU",
    tier: "COMMON",
    name: "Second Chance",
    description: "Allow yourself to re-submit before the deadline.",
    effectTemplate: { kind: "SECOND_CHANCE" },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-7",
    classId: "THU",
    tier: "RARE",
    name: "Deep Read",
    description: "Apply Deep Read visual overlay for 5s.",
    effectTemplate: {
      kind: "VISUAL_OVERLAY",
      flag: "DEEP_READ",
      durationMs: 5000,
    },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-8",
    classId: "THU",
    tier: "COMMON",
    name: "Time Bonus",
    description: "Add 5s to your per-question answer deadline.",
    effectTemplate: { kind: "QUESTION_REPLAY", extraMs: 5000 },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-9",
    classId: "THU",
    tier: "RARE",
    name: "Brain Burst",
    description: "×1.5 score for the next correct answer.",
    effectTemplate: { kind: "SCORE_MULT", factor: 1.5 },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
  {
    id: "TN-10",
    classId: "THU",
    tier: "EPIC",
    name: "Perfect Recall",
    description: "Disable 1 random wrong option for the round.",
    effectTemplate: {
      kind: "OPTION_DISABLE_TEMPLATE",
      count: 1,
      selectionPolicy: "RANDOM_WRONG_OPTIONS",
      durationMs: 20000,
    },
    backfireRate: 0.0,
    cooldownPerMatch: 1,
  },
];

export const CARD_CATALOG: readonly ReadonlyCardDefinition[] = Object.freeze(
  RAW_CARD_CATALOG.map((card) =>
    Object.freeze({
      ...card,
      effectTemplate: Object.freeze({ ...card.effectTemplate }),
    }),
  ),
);

// Lookup a card by id. Throws if the id is not in the catalog —
// the API boundary should never reach this with an invalid id, but
// failing loud beats silent misclassification.
//
// Implementation: O(1) via a pre-computed `Map<CardId, CardDefinition>`.
// The previous `CARD_CATALOG.find(...)` was O(N) and was called
// from every `pickCard` / `playCard` / `validateCardCommand` path
// AND from the React `CardHand` component per render per card —
// at 100 players × 3 cards per render that's 300 calls reduced
// to 300 hash lookups. The Map is built once at module load.
const CARD_CATALOG_BY_ID: ReadonlyMap<CardId, ReadonlyCardDefinition> = new Map(
  CARD_CATALOG.map((c) => [c.id, c] as const),
);

// Runtime-enforce the catalog invariant on `backfireRate`. The
// CardDefinition JSDoc claims every entry lies in the inclusive
// range [0.0, 0.1]; this assertion guarantees that claim is
// true at module load (so a future catalog edit cannot silently
// violate it).
for (const c of CARD_CATALOG) {
  if (c.backfireRate < 0 || c.backfireRate > 0.1) {
    throw new Error(
      `Card catalog invariant violated: ${c.id} backfireRate=${c.backfireRate} not in [0.0, 0.1]`,
    );
  }
}

export function getCardDefinition(id: CardId): ReadonlyCardDefinition {
  const def = CARD_CATALOG_BY_ID.get(id);
  if (!def) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return def;
}

// Pre-computed per-class pool of `CardId`s, sorted by `compareCardId`.
// The list is the ONLY ordered frozen list the sampling engine
// indexes into — never re-sort with an ad-hoc comparator.
//
// Built once at module load. Each array is deeply frozen so a
// caller that mutates it via cast does NOT poison the catalog
// (push / splice / indexed assignment all throw in strict mode
// and are no-ops otherwise — the contract is `Object.isFrozen`).
const CARD_CATALOG_BY_CLASS: Readonly<Record<ClassId, readonly CardId[]>> = {
  CONG: Object.freeze(
    CARD_CATALOG.filter((c) => c.classId === "CONG")
      .map((c) => c.id)
      .slice()
      .sort(compareCardId),
  ),
  THU: Object.freeze(
    CARD_CATALOG.filter((c) => c.classId === "THU")
      .map((c) => c.id)
      .slice()
      .sort(compareCardId),
  ),
};

export function getClassPool(classId: ClassId): readonly CardId[] {
  return CARD_CATALOG_BY_CLASS[classId];
}

// Quick membership test exposed for callers that want to avoid
// the throw-tasting pattern of `getCardDefinition`. Backs the
// `catalogHasCard` predicate in `card-validator.ts`.
export function hasCardDefinition(id: string): id is CardId {
  return CARD_CATALOG_BY_ID.has(id as CardId);
}

// Tier weights are constants per spec §3.3 (60/30/10 global).
// Exposed as a single source so the sampling engine, the API
// boundary, and the replay harness all read the same numbers.
export const CARD_TIER_WEIGHTS = {
  COMMON: 0.6,
  RARE: 0.3,
  EPIC: 0.1,
} as const;

// AOE cap = 2 per lobby per round (spec §3.3 "AOE cap"). The
// cap is a per-(matchId, roundNo) counter, server-enforced at
// the API boundary. The constant lives in @arena/shared so the
// API boundary, the live handlers, and the validator all read
// the same number — a future bump must be made here in one
// commit and apply to every consumer in lockstep.
export const AOE_CAP_PER_ROUND = 2;

export const COMMAND_ID_MAX_LENGTH = 64;

export const MILESTONE_ROUNDS: ReadonlySet<number> = new Set([5, 12, 20]);

// ---------------------------------------------------------------------------
// Phase 3 — Card variant cosmetics (streak ≥ 7 unlock)
// ---------------------------------------------------------------------------
//
// Spec §2 Decision 19: "Daily streak ≥ 7 unlock 1 card variant
// (border/glow, no effect change)". The variant is cosmetic only —
// it swaps the card's visual border/glow in the UI; it does NOT
// change any card effect, tier, or gameplay property.
//
// `CardVariantKey` is the canonical union. It mirrors the Prisma
// `CardVariantKey` enum — the two MUST stay in lockstep. A test in
// `cards.spec.ts` pins the mapping so a future enum bump on either
// side cannot silently diverge.
export type CardVariantKey = "DEFAULT" | "NEON" | "GOLD";

// Ordered by unlock tier — `DEFAULT` is the starting variant every
// player has implicitly; `NEON` is the first unlock (streak 7);
// `GOLD` is the second unlock (streak 14). The array is the single
// source of truth for "which variant comes next" — both the API
// (which decides which variant to grant) and the UI (which knows
// the order for display) import it.
export const CARD_VARIANT_ORDER: readonly CardVariantKey[] = [
  "DEFAULT",
  "NEON",
  "GOLD",
];

// Streak threshold: every multiple of 7 unlocks the next variant
// (spec §2 Decision 19). The constant is shared so the service
// (trigger), the DTO (response shape), and the UI (display) all
// agree on when an unlock fires.
export const CARD_VARIANT_STREAK_THRESHOLD = 7;

// Pick the next variant to unlock for a user, given the variants
// they already own. Returns `null` when the user already owns
// every variant (v1: DEFAULT + NEON + GOLD = 3, so after 2
// unlocks there is nothing more to grant).
//
// Pure function — no IO, no side effects — so it is unit-tested
// directly and stays deterministic across the API boundary.
export function nextCardVariant(
  ownedVariants: ReadonlySet<CardVariantKey>,
): CardVariantKey | null {
  for (const key of CARD_VARIANT_ORDER) {
    if (key === "DEFAULT") continue;
    if (!ownedVariants.has(key)) return key;
  }
  return null;
}

// Pick the card to attach the unlock to. v1 strategy: rotate
// through the user's class-pool cards deterministically by streak
// count, so consecutive unlocks target different cards. The exact
// card chosen is cosmetic (no effect), so a simple rotation is
// sufficient — no RNG, no persistence of "last unlock index"
// beyond the owned-variant rows themselves.
//
// Falls back to the first card in the CONG pool if the classId
// has no pool (unreachable in v1 — both pools are non-empty).
export function pickCardForVariantUnlock(
  classId: ClassId,
  unlockIndex: number,
): CardId {
  const pool = getClassPool(classId);
  if (pool.length === 0) {
    return CARD_CATALOG[0].id;
  }
  return pool[unlockIndex % pool.length];
}
