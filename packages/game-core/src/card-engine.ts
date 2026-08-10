// ============================================================
// Card sampling engine — Arena of 100 (Phase 2)
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "Byte-level RNG consumption" + §4.1 "Card Effect Discriminated
// Union".
//
// Pure, dependency-free, infrastructure-free. Consumes an
// explicit RNG input (never ambient `Math.random`) so the same
// seed produces the same offer + the same per-float consumption
// trace across @arena/shared, @arena/game-core, @arena/api, and
// the replay harness.
//
// Two surfaces:
//   1. `sampleOffer` — emits a 3-card offer per milestone round
//      (Q5/12/20) using the canonical 60/30/10 tier weights.
//   2. `resolveCardEffect` — expands a TEMPLATE-bearing
//      `CardEffectTemplate` into a concrete `CardEffect` for the
//      3 RNG-consuming cards (CB-3, TN-1, TN-10). The remaining
//      15 cards are pass-through (template == resolved).
//
// `Backfire` is NOT a runtime RNG consumer in v1 (spec §3.3
// "backfireRate"); no float is drawn for it and no backfire
// outcome is resolved. If a backfire roll is introduced later,
// it MUST be added to the spec's float-consumption table before
// being implemented.
// ============================================================

import {
  CARD_TIER_WEIGHTS,
  compareCardId,
  getClassPool,
  getCardDefinition,
  type CardId,
  type CardTier,
  type CardEffect,
  type CardEffectTemplate,
} from "@arena/shared";
import { deriveSubstream, mulberry32 } from "./prng";

// ---------------------------------------------------------------------------
// Sampling trace (one per float consumed)
// ---------------------------------------------------------------------------
//
// Used by sampling vectors and replay harnesses. The shape is
// pinned byte-for-byte across consumers (spec §3.3 "Every
// consumed float is recorded"). A TIER step records the resolved
// `tier` and `retry`; an exhausted-tier retry records `retry:
// true` and NO `cardIndex` / `drawnCardId` (no CARD float was
// consumed).
export interface SamplingStep {
  float: number;
  purpose: "TIER" | "CARD";
  tier?: CardTier;
  cardIndex?: number;
  retry: boolean;
  drawnCardId?: CardId;
}

export interface SamplingResult {
  cards: readonly CardId[];
  steps: readonly SamplingStep[];
}

// ---------------------------------------------------------------------------
// Tier selection (60/30/10 — spec §3.3)
// ---------------------------------------------------------------------------
//
// `u ∈ [0, 1)`:
//   COMMON if u < 0.60
//   RARE   if 0.60 ≤ u < 0.90
//   EPIC   if 0.90 ≤ u < 1.00
//
// The boundary at 0.90 belongs to EPIC (inclusive lower bound),
// so `u = 0.90` selects EPIC. The boundary at 0.60 belongs to
// RARE (inclusive lower bound), so `u = 0.60` selects RARE.
// This is the canonical contract; do NOT change the boundaries
// without bumping PRNG_CONTRACT_VERSION.
function selectTier(u: number): CardTier {
  if (u < CARD_TIER_WEIGHTS.COMMON) return "COMMON";
  if (u < CARD_TIER_WEIGHTS.COMMON + CARD_TIER_WEIGHTS.RARE) return "RARE";
  return "EPIC";
}

export const SAMPLE_OFFER_COUNT = 3;

// ---------------------------------------------------------------------------
// `sampleOffer` — milestone card offer (Q5/12/20)
// ---------------------------------------------------------------------------
//
// Consumes floats from `rng` per the byte-level RNG-consumption
// contract:
//
//   - Draw 3 cards per offer (or fewer if the class pool is
//     exhausted before 3 unique cards are drawn).
//   - Tier selection per draw: consume ONE float `u ∈ [0, 1)`;
//     resolve tier via the 60/30/10 weights.
//   - Card-within-tier selection: consume ONE float `u2` ONLY
//     when the selected tier has at least one remaining card.
//     `idx = Math.floor(u2 * remainingTierCards)`.
//   - Deterministic retry on exhausted tier: if the selected
//     tier has zero remaining cards in the class pool, the draw
//     consumes ONLY the TIER float — NO CARD float — and retries
//     on the same substream by pulling the next tier float. A
//     retry records `retry: true` and no `cardIndex` /
//     `drawnCardId`.
//   - If the entire class pool is exhausted, stop and return
//     fewer than 3 cards; do NOT consume further floats.
//
// Class pool is the canonical `CardId` list ordered by
// `compareCardId` (spec §3.3 "Canonical CardId order"). The
// per-tier frozen list at each draw is built from the REMAINING
// cards of that tier, sorted by `compareCardId` — never plain
// lexicographic order.
//
// The `seedUsed` is recorded verbatim on the resulting
// `CardOfferEvent` so replay can reproduce the same offer
// byte-for-byte.
export function sampleOffer(
  classId: "CONG" | "THU",
  seed: string,
  customPool?: readonly CardId[],
): SamplingResult {
  const substreamSeed = deriveSubstream(seed, `card|${classId}`);
  const rng = mulberry32(substreamSeed);

  const poolIds = customPool ?? getClassPool(classId);
  const classPoolDefs = poolIds.map((id) => getCardDefinition(id));
  const remaining = new Map<CardTier, CardId[]>(
    (["COMMON", "RARE", "EPIC"] as CardTier[]).map((tier) => [
      tier,
      classPoolDefs
        .filter((c) => c.tier === tier)
        .map((c) => c.id)
        .sort(compareCardId),
    ]),
  );

  const cards: CardId[] = [];
  const steps: SamplingStep[] = [];

  for (let draw = 0; draw < SAMPLE_OFFER_COUNT; draw++) {
    // Total remaining across every tier — if the class pool is
    // exhausted before this draw completes, stop and return what
    // we have without consuming further RNG values (spec §3.3
    // "If the entire class pool is exhausted, stop and return
    // fewer than 3 cards").
    const totalRemaining = Array.from(remaining.values()).reduce(
      (n, list) => n + list.length,
      0,
    );
    if (totalRemaining === 0) break;

    // Pick a tier; retry on the same substream if exhausted.
    let tier: CardTier;
    let retry = false;
    while (true) {
      const u = rng();
      tier = selectTier(u);
      const list = remaining.get(tier) ?? [];
      if (list.length > 0) {
        steps.push({ float: u, purpose: "TIER", tier, retry });
        break;
      }
      // Exhausted tier — record the TIER float with retry=true
      // and no CARD float. Loop continues; the next draw picks a
      // new TIER float off the same substream.
      steps.push({ float: u, purpose: "TIER", tier, retry: true });
      retry = true;
    }

    // Pick a card from the remaining tier pool.
    const tierList = remaining.get(tier) ?? [];
    const u2 = rng();
    const idx = Math.floor(u2 * tierList.length);
    const drawnCardId = tierList[idx];
    if (drawnCardId === undefined) {
      // Defensive: should be unreachable because the
      // selectTier loop above only exits when `tierList.length > 0`.
      throw new Error(
        `card-engine invariant: tier=${tier} list empty after TIER pick`,
      );
    }
    steps.push({
      float: u2,
      purpose: "CARD",
      cardIndex: idx,
      retry: false,
      drawnCardId,
    });
    cards.push(drawnCardId);

    // Remove the drawn card from the class pool for the
    // remainder of this offer (without replacement).
    const updatedTier = tierList.filter((_, i) => i !== idx);
    remaining.set(tier, updatedTier);
  }

  return { cards, steps };
}

// ---------------------------------------------------------------------------
// `resolveCardEffect` — Template → concrete CardEffect
// ---------------------------------------------------------------------------
//
// Only 3 cards consume RNG at effect-resolution time (spec §3.3
// "Random effect resolution"). Resolution happens server-side
// in the resolver only; the resolver draws the floats, then
// appends exactly ONE `CARD_RESOLVED` event carrying the
// concrete outcome. Downstream consumers (reducer, replay, web)
// apply the persisted outcome verbatim — they MUST NOT re-run
// the RNG.
//
// Float accounting per template (spec §3.3 "effectiveCount"):
//   - OPTION_DISABLE_TEMPLATE (TN-1, TN-10): wrong-option
//     indexes (ascending) form an ordered frozen list. For each
//     of `effectiveCount` picks, consume ONE float; remove
//     picked index (without replacement). Persist
//     `indexes` + `count` + `availableAtResolution`.
//   - HAND_DESTROY_TEMPLATE (CB-3): target's hand sorted by
//     `compareCardId`. For each of `effectiveCount` picks,
//     consume ONE float; remove picked card (without
//     replacement). Persist `destroyedCardIds` + `count` +
//     `availableAtResolution`.
//
// `availableAtResolution` = the candidate supply at resolve
// time (wrong-option count or hand size). `effectiveCount =
// Math.min(count, availableAtResolution)` — partial exhaustion
// is the normal case, not an error.

// 0-based index of the correct answer in `options`.
export function correctOptionIndex(
  options: readonly string[],
  correctAnswer: string,
): number {
  const idx = options.indexOf(correctAnswer);
  if (idx === -1) {
    throw new Error(
      `card-engine: correct answer not found in question options`,
    );
  }
  return idx;
}

// Resolve TN-1 (`count=2`) and TN-10 (`count=1`) — disable
// `count` random wrong options for the round.
//
// `wrongIndexes` is the list of positions where the option is
// NOT the correct answer — duplicate options that happen to
// match the correct answer are not "wrong" positions (they
// would defeat the purpose of disabling a wrong option).
export function resolveOptionDisable(
  template: Extract<CardEffectTemplate, { kind: "OPTION_DISABLE_TEMPLATE" }>,
  options: readonly string[],
  correctAnswer: string,
  rng: () => number,
): Extract<CardEffect, { kind: "OPTION_DISABLE" }> {
  const wrongIndexes = options
    .map((value, i) => ({ value, i }))
    .filter(({ value }) => value !== correctAnswer)
    .map(({ i }) => i);
  const availableAtResolution = wrongIndexes.length;
  const effectiveCount = Math.min(template.count, availableAtResolution);

  const picked: number[] = [];
  const remaining = wrongIndexes.slice();
  for (let i = 0; i < effectiveCount; i++) {
    const u = rng();
    const idx = Math.floor(u * remaining.length);
    const chosen = remaining[idx];
    if (chosen === undefined) {
      throw new Error(`card-engine invariant: remaining[] drained mid-resolve`);
    }
    picked.push(chosen);
    remaining.splice(idx, 1);
  }

  return {
    kind: "OPTION_DISABLE",
    indexes: picked,
    count: template.count,
    availableAtResolution,
    durationMs: template.durationMs,
  };
}

// Resolve CB-3 — destroy `count` random cards from the target's
// hand. Target's hand is sorted by `compareCardId` (spec §3.3
// "Canonical CardId order").
export function resolveHandDestroy(
  template: Extract<CardEffectTemplate, { kind: "HAND_DESTROY_TEMPLATE" }>,
  targetHand: readonly CardId[],
  rng: () => number,
): Extract<CardEffect, { kind: "HAND_DESTROY" }> {
  const sortedHand = targetHand.slice().sort(compareCardId);
  const availableAtResolution = sortedHand.length;
  const effectiveCount = Math.min(template.count, availableAtResolution);

  const destroyed: CardId[] = [];
  const remaining = sortedHand.slice();
  for (let i = 0; i < effectiveCount; i++) {
    const u = rng();
    const idx = Math.floor(u * remaining.length);
    const chosen = remaining[idx];
    if (chosen === undefined) {
      throw new Error(`card-engine invariant: remaining[] drained mid-resolve`);
    }
    destroyed.push(chosen);
    remaining.splice(idx, 1);
  }

  return {
    kind: "HAND_DESTROY",
    count: template.count,
    availableAtResolution,
    destroyedCardIds: destroyed,
  };
}

// Resolve a TEMPLATE-bearing card to a concrete CardEffect.
//
// The remaining 15 cards (everything except CB-3, TN-1, TN-10)
// have template shapes that ARE the resolved effect — they
// pass through unchanged. The three RNG-consuming cards are
// resolved here using the provided `rng` (seeded by the
// caller via `deriveSubstream(seed, "resolve|<cardId>")`).
//
// `hand` is the target player's current hand (only consulted
// for CB-3 / HAND_DESTROY). `options` + `correctAnswer` are
// only consulted for OPTION_DISABLE_TEMPLATE (TN-1, TN-10).
export function resolveCardEffect(
  cardId: CardId,
  template: CardEffectTemplate,
  rng: () => number,
  ctx: {
    targetHand?: readonly CardId[];
    options?: readonly string[];
    correctAnswer?: string;
    partial?: string;
    currentRoundNo?: number;
  } = {},
): CardEffect {
  const def = getCardDefinition(cardId);
  if (def.effectTemplate.kind !== template.kind) {
    throw new Error(
      `card-engine: template kind mismatch for ${cardId} (got ${template.kind}, expected ${def.effectTemplate.kind})`,
    );
  }

  switch (template.kind) {
    case "OPTION_DISABLE_TEMPLATE": {
      if (!ctx.options || ctx.correctAnswer === undefined) {
        throw new Error(
          `card-engine: OPTION_DISABLE_TEMPLATE requires options + correctAnswer`,
        );
      }
      return resolveOptionDisable(
        template,
        ctx.options,
        ctx.correctAnswer,
        rng,
      );
    }
    case "HAND_DESTROY_TEMPLATE": {
      if (!ctx.targetHand) {
        throw new Error(
          `card-engine: HAND_DESTROY_TEMPLATE requires targetHand`,
        );
      }
      return resolveHandDestroy(template, ctx.targetHand, rng);
    }
    // Pass-through templates: the resolved shape is the
    // template itself, no RNG consumption, no ctx required.
    case "TIMER_MODIFY":
      return { ...template };
    case "OPTION_FAKE":
      return { ...template };
    case "OPTION_LOCK":
      return { ...template };
    case "HINT_REVEAL_TEMPLATE": {
      // Server-side: resolve to a concrete `HINT_REVEAL` with
      // `partial` derived from the current question. The caller
      // MUST supply `partial` via `ctx.partial` (the canonical
      // first-N-chars of the correct answer). No RNG consumed.
      if (ctx.partial === undefined) {
        throw new Error(
          "card-engine: HINT_REVEAL_TEMPLATE requires ctx.partial",
        );
      }
      return { kind: "HINT_REVEAL", partial: ctx.partial };
    }
    case "DELAY_RENDER":
      return { ...template };
    case "VISUAL_OVERLAY":
      return { ...template };
    case "SEMANTIC_FLIP":
      return { ...template };
    case "QUESTION_REPLAY":
      return { ...template };
    case "SHIELD_TEMPLATE": {
      // Server-side: resolve `expiresAfterRoundOffset` to
      // absolute `expiresAtRound` from the persisted roundNo.
      // Caller MUST supply `currentRoundNo` via `ctx.currentRoundNo`.
      if (ctx.currentRoundNo === undefined) {
        throw new Error(
          "card-engine: SHIELD_TEMPLATE requires ctx.currentRoundNo",
        );
      }
      return {
        kind: "SHIELD",
        expiresAtRound: ctx.currentRoundNo + template.expiresAfterRoundOffset,
      };
    }
    case "SCORE_MULT":
      return { ...template };
    case "SECOND_CHANCE":
      return { kind: "SECOND_CHANCE" };
    default: {
      // Exhaustive guard — adding a new CardEffectTemplate variant
      // without updating this switch is a compile-time error
      // (`template` would no longer narrow to `never`).
      const _exhaustive: never = template;
      throw new Error(
        `card-engine: unhandled CardEffectTemplate kind ${(_exhaustive as { kind: string }).kind}`,
      );
    }
  }
}
