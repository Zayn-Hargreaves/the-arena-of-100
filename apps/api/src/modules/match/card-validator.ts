// ============================================================
// Card validator — Arena of 100 (Phase 2 API Layer)
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task D + §4.5 (command-level idempotency) + §3.3
// (AOE cap + cooldown).
//
// Pure, dependency-free boundary validator. Runs BEFORE the
// resolver / state-machine work and rejects with the canonical
// `ErrorCode` set. The match handler converts the throw into
// the matching `ERROR_MESSAGES[...]` payload on the wire.
// ============================================================

import {
  ErrorCode,
  MatchStatus,
  RoomError,
  AOE_CAP_PER_ROUND,
  COMMAND_ID_MAX_LENGTH,
  MILESTONE_ROUNDS,
  type CardId,
  type CardEffectTemplate,
  type RoundState,
  getCardDefinition,
  hasCardDefinition,
} from "@arena/shared";

export { AOE_CAP_PER_ROUND, COMMAND_ID_MAX_LENGTH, MILESTONE_ROUNDS };

// ---------------------------------------------------------------------------
// `assertValidCommandId` — required, non-empty, ≤64 chars
// ---------------------------------------------------------------------------
export function assertValidCommandId(
  commandId: unknown,
): asserts commandId is string {
  if (typeof commandId !== "string") {
    throw new RoomError(ErrorCode.INVALID_COMMAND_ID);
  }
  if (commandId.length < 1 || commandId.length > COMMAND_ID_MAX_LENGTH) {
    throw new RoomError(ErrorCode.INVALID_COMMAND_ID);
  }
}

// ---------------------------------------------------------------------------
// `assertCardId` — must be in the v1 18-card catalog
// ---------------------------------------------------------------------------
export function assertCardId(cardId: unknown): asserts cardId is CardId {
  if (typeof cardId !== "string" || !hasCardDefinition(cardId)) {
    throw new RoomError(ErrorCode.CARD_NOT_FOUND);
  }
}

// ---------------------------------------------------------------------------
// `cooldownPerMatch` — v1 hard-codes 1 (single-use per match)
// ---------------------------------------------------------------------------
// Returns true if the card has already been played this match.
// The server tracks this via the event log (CARD_PICKED +
// CARD_RESOLVED) — there's no in-memory cooldown counter.
export function isCardAlreadyPlayed(
  cardId: CardId,
  playedCardIds: ReadonlySet<CardId>,
): boolean {
  return playedCardIds.has(cardId);
}

// ---------------------------------------------------------------------------
// `isAoeCard` — does the card's effect target more than 1 player?
// ---------------------------------------------------------------------------
// AOE status is a property of the EFFECT TEMPLATE, not the
// class — single-target ATTACK cards (CB-1, CB-2) are NOT AOE,
// and the 10 Defensive/DEFENSE cards (which are self-only) never
// consume
// the AOE budget. The cap is per-(matchId, roundNo) and is
// maintained incrementally on `MatchStateMachine.playCard`
// when `targetPlayerIds.length > 1` (spec §3.3 "AOE cap = 2
// per lobby per round").
//
// Use `isAoeCard` for the AOE-budget contract only — use
// `isAttackCard` (or check `classId === "ATTACK"` directly) when
// the question is "does this card accept a targetPlayerId".
export function isAoeCard(cardId: CardId): boolean {
  const template = getCardDefinition(cardId).effectTemplate as {
    targetCount?: number;
  };
  if (typeof template.targetCount === "number") {
    return template.targetCount > 1;
  }
  return false;
}

// `isAttackCard` — true iff the card belongs to the Offensive/ATTACK
// class. Offensive/ATTACK cards accept an optional
// `targetPlayerId` (single-target or AOE); Defensive/DEFENSE cards
// are
// self-only and reject any `targetPlayerId`.
export function isAttackCard(cardId: CardId): boolean {
  return getCardDefinition(cardId).classId === "ATTACK";
}
export function validateTarget(
  cardId: CardId,
  targetPlayerId: string | undefined,
  rosterPlayerIds: ReadonlySet<string>,
  actingPlayerId?: string,
): void {
  if (isAttackCard(cardId)) {
    if (!isAoeCard(cardId) && !targetPlayerId) {
      throw new RoomError(ErrorCode.INVALID_PAYLOAD);
    }
    if (targetPlayerId && actingPlayerId && targetPlayerId === actingPlayerId) {
      throw new RoomError(ErrorCode.INVALID_PAYLOAD);
    }
    if (targetPlayerId && !rosterPlayerIds.has(targetPlayerId)) {
      throw new RoomError(ErrorCode.PLAYER_NOT_IN_ROOM);
    }
    return;
  }
  if (targetPlayerId !== undefined) {
    throw new RoomError(ErrorCode.INVALID_PAYLOAD);
  }
}

// ---------------------------------------------------------------------------
// `validatePickedCard` — the card must be the one the player
// explicitly picked via `CARD_PICK` (NOT a member of the current
// post-pick hand, which `pickCard` has already removed the
// picked cardId from). The pick set is the pick-specific data
// that survives the pick→play gap, so a valid play is one
// whose `cardId` is in `pickedCards` AND in the offer envelope
// pointed at by `offerSeqNo` (the offer correlation is enforced
// separately by `validateOfferCorrelation`).
// ---------------------------------------------------------------------------
export function validatePickedCard(
  cardId: CardId,
  pickedCards: ReadonlyArray<CardId>,
): void {
  if (!pickedCards.includes(cardId)) {
    throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
  }
}

// ---------------------------------------------------------------------------
// `validateOfferCorrelation` — the cardId must be in the offer
// payload pointed at by `offerSeqNo`. The server resolves the
// terminal event from the log on retry; for first-time calls,
// the caller passes the offering directly.
// ---------------------------------------------------------------------------
export function validateOfferCorrelation(
  cardId: CardId,
  offeredCardIds: readonly CardId[],
): void {
  if (!offeredCardIds.includes(cardId)) {
    throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
  }
}

// ---------------------------------------------------------------------------
// `validateAoeBudget` — AOE cap = 2 per (matchId, roundNo).
// The server keeps a per-(match, round) counter; on hit, return
// `AOE_CAP_EXHAUSTED` to the client. The reset happens at
// round boundary (spec §4.5 "Advancing persisted roundNo
// implicitly resets the AOE counter for the next round").
// ---------------------------------------------------------------------------
export function validateAoeBudget(
  cardId: CardId,
  currentAoeCount: number,
): void {
  if (!isAoeCard(cardId)) return; // self-only Defensive/DEFENSE cards do not consume budget
  if (currentAoeCount >= AOE_CAP_PER_ROUND) {
    throw new RoomError(ErrorCode.AOE_CAP_EXHAUSTED);
  }
}

// ---------------------------------------------------------------------------
// `validateCardCommand` — top-level validator for `handleCardPlay`.
// Throws on the first violation. Returns the canonical `CardId`
// + the resolved `CardEffectTemplate` so the caller can pass them
// to the resolver.
// ---------------------------------------------------------------------------
export function validateCardCommand(args: {
  cardId: unknown;
  offeredCardIds: readonly CardId[];
  targetPlayerId: string | undefined;
  rosterPlayerIds: ReadonlySet<string>;
  currentAoeCount: number;
  playedCardIds: ReadonlySet<CardId>;
  pickedCards: readonly CardId[];
  actingPlayerId?: string;
  matchStatus?: MatchStatus;
  roundStatus?: RoundState["status"];
}): {
  cardId: CardId;
  template: CardEffectTemplate;
} {
  if (
    args.matchStatus !== undefined &&
    args.matchStatus !== MatchStatus.ROUND_ACTIVE
  ) {
    throw new RoomError(ErrorCode.ROUND_NOT_ACTIVE);
  }
  if (args.roundStatus !== undefined && args.roundStatus !== "ACTIVE") {
    throw new RoomError(ErrorCode.ROUND_NOT_ACTIVE);
  }
  assertCardId(args.cardId);
  const cardId = args.cardId as CardId;
  // The picked-card set is the pick-specific data the validator
  // checks against — the post-pick hand is no longer authoritative
  // for "is this card currently playable" because `pickCard` has
  // stripped the picked cardId from it.
  validatePickedCard(cardId, args.pickedCards);
  validateOfferCorrelation(cardId, args.offeredCardIds);
  if (isCardAlreadyPlayed(cardId, args.playedCardIds)) {
    // Single-use per match (v1 invariant).
    throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
  }
  validateTarget(
    cardId,
    args.targetPlayerId,
    args.rosterPlayerIds,
    args.actingPlayerId,
  );
  validateAoeBudget(cardId, args.currentAoeCount);
  const def = getCardDefinition(cardId);
  return { cardId, template: def.effectTemplate };
}

// ---------------------------------------------------------------------------
// `isMilestoneRound` — the server emits a `CARD_OFFER` at Q5/12/20.
// ---------------------------------------------------------------------------
export function isMilestoneRound(roundNo: number): boolean {
  return MILESTONE_ROUNDS.has(roundNo);
}

// ---------------------------------------------------------------------------
// `catalogHasCard` — exists for callers that want to avoid the
// throw-tasting pattern of `getCardDefinition`. Backs the O(1)
// `hasCardDefinition` predicate in `@arena/shared` (backed by
// a Map<CardId, CardDefinition>).
// ---------------------------------------------------------------------------
export function catalogHasCard(cardId: unknown): cardId is CardId {
  return typeof cardId === "string" && hasCardDefinition(cardId);
}
