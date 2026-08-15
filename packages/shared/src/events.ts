// ============================================================
// Event Types - Game Đấu Trường 100
// Event Sourcing Pattern: All game actions are events
// ============================================================

import type { CardId, CardEffect } from "./cards";
import type { ClassId } from "./classes";
import { MatchStatus, RoomStatus, type RoomType } from "./state";
import type { QuestionSnapshot } from "./schemas";

// Room Events
export enum RoomEventType {
  ROOM_CREATED = "ROOM_CREATED",
  PLAYER_JOINED = "PLAYER_JOINED",
  PLAYER_LEFT = "PLAYER_LEFT",
  ROOM_STATUS_UPDATED = "ROOM_STATUS_UPDATED",
  ROOM_COUNTDOWN_STARTED = "ROOM_COUNTDOWN_STARTED",
  ROOM_COUNTDOWN_CANCELLED = "ROOM_COUNTDOWN_CANCELLED",
  PLAYER_PRESENCE_UPDATED = "PLAYER_PRESENCE_UPDATED",
  ROOM_SETTINGS_UPDATED = "ROOM_SETTINGS_UPDATED",
  ROOM_TERMINATED = "ROOM_TERMINATED",
  MATCH_STARTED = "MATCH_STARTED",
}

// Match Events
export enum MatchEventType {
  MATCH_CREATED = "MATCH_CREATED",
  MATCH_STARTED = "MATCH_STARTED",
  ROUND_STARTED = "ROUND_STARTED",
  ROUND_ENDED = "ROUND_ENDED",
  ANSWER_SUBMITTED = "ANSWER_SUBMITTED",
  PLAYER_ELIMINATED = "PLAYER_ELIMINATED",
  MATCH_FINISHED = "MATCH_FINISHED",
  PLAYER_RECONNECTED = "PLAYER_RECONNECTED",
  PLAYER_DISCONNECTED = "PLAYER_DISCONNECTED",
  // Phase 2 — Class + Card Hybrid. Source of truth:
  // memory-bank/spec/class-cards-phase.md §5.2. These are
  // append-only event-log entries with stable `seqNo` minted at
  // append time; replay reads them verbatim and MUST NOT re-run
  // any RNG (spec §3.3 "Replay MUST NOT re-randomize").
  CLASS_ASSIGNED = "CLASS_ASSIGNED",
  CARD_OFFER = "CARD_OFFER",
  CARD_PICKED = "CARD_PICKED",
  CARD_RESOLVED = "CARD_RESOLVED",
  // Topic Ban Voting (Pre-match draft)
  TOPIC_VOTING_STARTED = "TOPIC_VOTING_STARTED",
  TOPIC_VOTE_SUBMITTED = "TOPIC_VOTE_SUBMITTED",
  TOPIC_VOTING_FINISHED = "TOPIC_VOTING_FINISHED",
}

export enum TransportFrameType {
  CARD_RESOLVED_BATCH = "CARD_RESOLVED_BATCH",
}

// Base Event Interface
export interface BaseEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  payload: T;
  seqNo: number;
}

// Room Event Payloads
export interface RoomCreatedEventPayload {
  roomId: string;
  roomCode: string;
  hostId: string;
  roomType: RoomType;
  maxPlayers: number;
}

export interface PlayerJoinedPayload {
  roomId: string;
  playerId: string;
  playerName: string;
  joinedAt: number;
}

export interface PlayerLeftPayload {
  roomId: string;
  playerId: string;
  reason: "DISCONNECTED" | "KICKED" | "LEFT";
}

export interface RoomStatusUpdatedEventPayload {
  roomId: string;
  roomStatus: RoomStatus;
  currentMatchId: string | null;
  updatedAt: number;
}

export interface RoomCountdownStartedEventPayload {
  roomId: string;
  roomStatus: RoomStatus.COUNTDOWN | RoomStatus.STARTING;
  countdownEndsAt: number;
  countdownMs: number;
  startedAt: number;
}

export interface RoomCountdownCancelledEventPayload {
  roomId: string;
  roomStatus: RoomStatus;
  reason:
    | "NOT_ENOUGH_PLAYERS"
    | "HOST_CANCELLED"
    | "PLAYER_LEFT"
    | "HOST_STALE"
    | "SYSTEM";
  cancelledAt: number;
}

export interface PlayerPresenceUpdatedEventPayload {
  roomId: string;
  playerId: string;
  isOnline: boolean;
  updatedAt: number;
}

export type RoomTerminationReason =
  | "ADMIN_TERMINATED"
  | "SYSTEM_MAINTENANCE"
  | "INACTIVITY_TIMEOUT";

export interface RoomTerminatedEventPayload {
  roomId: string;
  reason: RoomTerminationReason;
  matchId: string | null;
  message?: string;
  terminatedAt: number;
}

// Match Event Payloads
export interface MatchCreatedPayload {
  matchId: string;
  roomId: string;
  playerIds: string[];
}

// Socket-event wire shape for `MATCH_STARTING`. Distinct from
// `MatchStartedPayload` below: this is the "match is about to
// begin" notification sent over the room channel (used by the
// lobby UI to switch to a countdown view) and only carries the
// data the lobby needs (matchId + seconds remaining).
export interface MatchStartingRealtimePayload {
  matchId: string;
  countdown: number;
}

// Socket-event wire shape for `MATCH_STARTED`. Sent right before
// the first round's countdown begins. `roomId` lets the client
// reconcile which room the match belongs to without a second
// round-trip, and `countdownMs` drives the first-round countdown
// UI. `status` is the initial match state (typically
// `MatchStatus.COUNTDOWN`).
export interface MatchStartedRealtimePayload {
  matchId: string;
  roomId: string;
  status: MatchStatus.COUNTDOWN;
  countdownMs: number;
}

export interface MatchStartedPayload {
  matchId: string;
  playerIds: string[];
  startTime: number;
}

export interface RoundStartedPayload {
  matchId: string;
  roundNo: number;
  question: QuestionSnapshot;
  startedAt: number;
  endsAt: number;
}

export interface RoundEndedPayload {
  matchId: string;
  roundNo: number;
  correctAnswer: string;
  survivingPlayerIds: string[];
  eliminatedPlayerIds: string[];
}

export interface AnswerSubmittedPayload {
  matchId: string;
  roundNo: number;
  playerId: string;
  answer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  submittedAt: number;
}

// Why a player was eliminated in a round. Single source of truth shared
// by the server emitter (game-loop.events.ts) and the web client so the
// eliminated overlay can render the correct copy without re-deriving it.
export type EliminationReason = "WRONG_ANSWER" | "TIMEOUT" | "AFK";

export interface PlayerEliminatedPayload {
  matchId: string;
  roundNo: number;
  playerId: string;
  playerName?: string;
  reason: EliminationReason;
}

export interface MatchFinishedPayload {
  matchId: string;
  winnerId: string;
  totalRounds: number;
  finishedAt: number;
}

export interface PlayerReconnectedPayload {
  matchId: string;
  playerId: string;
  lastSeenSeqNo: number;
  reconnectedAt: number;
}

// Topic Ban Voting (Pre-match draft) Event Payloads
export interface TopicVotingStartedEventPayload {
  matchId: string;
  candidateTopics: string[];
  endsAt: number;
  durationMs: number;
}

export interface TopicVoteSubmittedEventPayload {
  matchId: string;
  playerId: string;
  topic: string;
  eventId?: string;
}

export interface TopicVotingSummaryEventPayload {
  matchId: string;
  voteCounts: Record<string, number>;
  totalVotes: number;
}

export interface TopicVotingFinishedEventPayload {
  matchId: string;
  bannedTopics: string[];
  activeTopics: string[];
  voteCounts: Record<string, number>;
}

export type TopicVotingStartedPayload = TopicVotingStartedEventPayload;
export type TopicVoteSubmittedPayload = TopicVoteSubmittedEventPayload;
export type TopicVotingSummaryPayload = TopicVotingSummaryEventPayload;
export type TopicVotingFinishedPayload = TopicVotingFinishedEventPayload;

// ---------------------------------------------------------------------------
// Phase 2 — Class + Card Hybrid event payloads
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// (sub-task A — Shared Schema).
//
// All `*` fields are append-only event-log entries with stable
// `seqNo` minted at append time. Replay reads them verbatim and
// MUST NOT re-run any RNG (§3.3 "Replay MUST NOT re-randomize").
// ---------------------------------------------------------------------------

// CLASS_ASSIGNED — server-side random per-match assignment.
// The full map is persisted as ONE event so a diff or replay
// detects class changes by comparing the maps. The seed that
// produced the assignment is also persisted so a replay can
// reproduce (deterministic + auditable).
export interface ClassAssignedEvent {
  matchId: string;
  assignments: Array<{ playerId: string; classId: ClassId }>;
  seedUsed: string;
}

export interface CardOfferEvent {
  matchId: string;
  roundNo: number;
  playerId: string;
  readonly offeredCardIds: readonly [CardId, CardId, CardId];
  seedUsed: string;
}

export interface CardPickedEvent {
  matchId: string;
  roundNo: number;
  playerId: string;
  selectedCardId: CardId;
  offerSeqNo: number;
  // Canonical command identity (populated by the owner when the event is
  // appended; absent on legacy persisted entries replayed from older
  // snapshots). Used by the API boundary's `recoverDuplicatePickEvent` to
  // confirm a redelivery matches the originally-committed command before
  // re-broadcasting the canonical `CARD_PICKED` event.
  readonly eventId?: string;
  readonly commandId?: string;
}

// ---------------------------------------------------------------------------
// CardEffectEvent — Track D event-log extension
// Source of truth: spec §4.2
//
// Split into MUTATION (no countdown) and TEMPORARY (carries
// `expiresAtServer` + `remainingMs`). The rehydrate reducer
// applies `MUTATION` once regardless of countdown; restores
// `TEMPORARY` only while `expiresAtServer` is still in the
// future relative to the trusted `replayServerNow`.
// ---------------------------------------------------------------------------

export type CardEffectResolution = "MUTATION" | "TEMPORARY";

export type MutationEffectKind =
  | "TIMER_MODIFY"
  | "DELAY_RENDER"
  | "HINT_REVEAL"
  | "QUESTION_REPLAY"
  | "SHIELD"
  | "SCORE_MULT"
  | "HAND_DESTROY"
  | "SECOND_CHANCE";

export type TemporaryEffectKind =
  | "OPTION_DISABLE"
  | "OPTION_FAKE"
  | "OPTION_LOCK"
  | "VISUAL_OVERLAY"
  | "SEMANTIC_FLIP";

export type MutationEffect = {
  readonly matchId: string;
  readonly roundNo: number;
  readonly cardId: CardId;
  readonly offerSeqNo: number;
  readonly playedByPlayerId: string;
  readonly targetPlayerIds: readonly string[];
  readonly effect: Extract<CardEffect, { kind: MutationEffectKind }>;
  readonly resolution: "MUTATION";
  readonly serverTimestamp: number;
  readonly expiresAtServer: null;
  readonly remainingMs: null;
  // Canonical command identity (see `CardPickedEvent` above). Used by
  // `recoverDuplicatePlayEvent` to confirm the incoming command matches
  // the originally-committed one before re-broadcasting.
  readonly eventId?: string;
  readonly commandId?: string;
};

export type TemporaryEffect = {
  readonly matchId: string;
  readonly roundNo: number;
  readonly cardId: CardId;
  readonly offerSeqNo: number;
  readonly playedByPlayerId: string;
  readonly targetPlayerIds: readonly string[];
  readonly effect: Extract<CardEffect, { kind: TemporaryEffectKind }>;
  readonly resolution: "TEMPORARY";
  readonly serverTimestamp: number;
  readonly expiresAtServer: number;
  readonly remainingMs: number;
  // Canonical command identity (see `CardPickedEvent` above). Used by
  // `recoverDuplicatePlayEvent` to confirm the incoming command matches
  // the originally-committed one before re-broadcasting.
  readonly eventId?: string;
  readonly commandId?: string;
};

export type CardEffectEvent = MutationEffect | TemporaryEffect;

export type _AssertAllKindsCovered = [CardEffect["kind"]] extends [
  MutationEffectKind | TemporaryEffectKind,
]
  ? [MutationEffectKind | TemporaryEffectKind] extends [CardEffect["kind"]]
    ? [Extract<MutationEffectKind, TemporaryEffectKind>] extends [never]
      ? true
      : never
    : never
  : never;

// Compile-time witness — forces TypeScript to evaluate
// `_AssertAllKindsCovered`. If it resolves to `never` (missing
// or overlapping kind), this assignment fails the build.
export const _assertAllKindsCovered: _AssertAllKindsCovered = true;

export interface CardResolvedBatchEvent {
  type: "CARD_RESOLVED_BATCH";
  matchId: string;
  seqNo: number;
  roundNo: number;
  effects: CardEffectEvent[];
  aoeCountInRound: number;
}

/**
 * `cardId` + `offerSeqNo` correlation: both fields are immutable
 * and MUST be validated before appending a `CARD_RESOLVED` event.
 * The server checks that `offerSeqNo` points to a valid
 * `CARD_OFFER` event whose `offeredCardIds` contains `cardId`,
 * and that the player picked that card via a `CARD_PICKED` event.
 * This correlation is part of the audit/replay contract —
 * `@arena/shared` owns the event schema; the API boundary enforces
 * the validation.
 *
 * `rolledBack` field removed for v1: replay cannot use it to
 * reverse already-materialized state. No replay-time skipping
 * based on a rollback flag. If rollback support is required later,
 * model it as an explicit compensating event with reducer
 * semantics — not a boolean on the original event.
 */

/**
 * Snapshot fragment for the reconnect rehydrate of card state.
 * `expiresAtServer` is the AUTHORITATIVE logical expiry
 * (canonical epoch ms), used for reconnect/failover restore.
 * `remainingMs` is DERIVED at snapshot time and is informational —
 * rehydrate recomputes `remainingMs = max(0, expiresAtServer - replayServerNow)`
 * instead of trusting the persisted `remainingMs`. `persistedDurationMs`
 * is the original duration cap so restore can clamp to a sane upper
 * bound (e.g. capped to `durationMs` even if clock skew made a stale
 * snapshot look like more time remained).
 */
export interface ActiveEffectSnapshot {
  sourceSeqNo: number;
  effect: TemporaryEffect["effect"];
  remainingMs: number;
  persistedDurationMs: number;
  expiresAtServer: number;
}

// Per-turn snapshot used by the replay reducer so the rehydrate
// can re-apply everything from `(snapshotSeqNo, replayServerNow]`
// deterministically across reconnect / failover.
export interface CardTurnSnapshot {
  snapshotSeqNo: number;
  serverNow: number;
  playerTurns: Record<string, PlayerTurnSnapshot>;
  activeEffects: Record<string, ActiveEffectSnapshot[]>;
}

// Minimal per-player turn state — the Web reducer materializes
// this from the canonical event log. Full definition lives in
// the web client; the server only carries the snapshot shape.
export interface PlayerTurnSnapshot {
  hand: CardId[];
  classId: ClassId;
  pendingPick: CardId | null;
  shieldSeqNo: number | null;
  playedCardIds: CardId[];
  pickedCardIds: CardId[];
}

// Question Snapshot & Replay events — single source of truth is schemas.ts
export type {
  QuestionSnapshot,
  ReplayEvent,
  ReplayStateTransitionPayload,
  ReplayRoundStartedPayload,
  ReplayAnswerSubmittedPayload,
  ReplayRoundEvaluatedPayload,
  ReplayTieBreakPayload,
  ReplayMatchFinishedPayload,
  ReplayPlayerPresencePayload,
} from "./schemas";

// Union types for type safety
export type RoomEvent =
  | BaseEvent<RoomCreatedEventPayload>
  | BaseEvent<PlayerJoinedPayload>
  | BaseEvent<PlayerLeftPayload>
  | BaseEvent<RoomStatusUpdatedEventPayload>
  | BaseEvent<RoomCountdownStartedEventPayload>
  | BaseEvent<RoomCountdownCancelledEventPayload>
  | BaseEvent<PlayerPresenceUpdatedEventPayload>
  | BaseEvent<RoomTerminatedEventPayload>;

export type MatchEvent =
  | BaseEvent<MatchCreatedPayload>
  | BaseEvent<MatchStartedPayload>
  | BaseEvent<RoundStartedPayload>
  | BaseEvent<RoundEndedPayload>
  | BaseEvent<AnswerSubmittedPayload>
  | BaseEvent<PlayerEliminatedPayload>
  | BaseEvent<MatchFinishedPayload>
  | BaseEvent<PlayerReconnectedPayload>
  | BaseEvent<ClassAssignedEvent>
  | BaseEvent<CardOfferEvent>
  | BaseEvent<CardPickedEvent>
  | BaseEvent<CardEffectEvent>;

// Factory function for creating events (Command Pattern)
export function createEvent<T>(
  type: string,
  payload: T,
  seqNo: number,
): BaseEvent<T> {
  return {
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    payload: cloneAndFreeze(payload),
    seqNo,
  };
}

/**
 * Recursively clones and deep-freezes a payload so the resulting event tree
 * owns fresh references for every nested object/array and cannot be mutated
 * by downstream consumers.
 *
 * Contract:
 *  - Rejects `undefined` at the root OR any nested slot with the same
 *    `TypeError` shape as `bigint` / `function` / `symbol`: JSON has no
 *    representation of `undefined`, so dropping a `undefined` value would
 *    silently rewrite it as `null` on serialization. Callers MUST encode
 *    optionality explicitly (omitting the key or using `null`).
 *  - Accepts plain-object payloads whose prototype is `Object.prototype` or
 *    `null`. Class instances (`Date`, `Map`, `Set`, etc.) are rejected with a
 *    `TypeError` to keep the event log JSON-serializable.
 *  - Supports enumerable **string-keyed** properties only. Symbol-keyed
 *    properties are intentionally omitted — they are not part of the
 *    serialized wire shape and are excluded by `Object.entries`.
 *  - Getters are evaluated **once** during cloning; the resulting static
 *    value is stored on the cloned tree. Side effects from getter invocation
 *    are not preserved.
 *  - Arrays are cloned element-by-element and frozen.
 *  - Already-frozen inputs are still cloned (the returned tree owns fresh
 *    references for every nested object/array), so callers never have to
 *    think about whether the input was previously frozen.
 *  - Circular references are detected (a true cycle returns to an object
 *    that is still on the current recursion path) and rejected with a
 *    `TypeError`. Acyclic shared references — two properties pointing at
 *    the same object — are allowed and are deep-cloned independently, with
 *    each branch owning its own frozen copy.
 */
function cloneAndFreeze<T>(value: T): T {
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new TypeError(
      `createEvent: ${value === undefined ? "undefined" : typeof value} is not a JSON-serializable value`,
    );
  }
  // Path-tracked `seen` set: an object is only "in progress" while its
  // subtree is being cloned. Removing it in `finally` once cloning
  // completes lets a legitimate shared reference (two properties pointing
  // at the same object via different paths) be walked on the second
  // branch instead of being misreported as a circular reference.
  const seen = new WeakSet<object>();
  return cloneAndFreezeInner(value, seen);
}

function cloneAndFreezeInner<T>(value: T, seen: WeakSet<object>): T {
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new TypeError(
      `createEvent: ${value === undefined ? "undefined" : typeof value} is not a JSON-serializable value`,
    );
  }
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as unknown as object)) {
    throw new TypeError("createEvent: circular object reference detected");
  }
  seen.add(value as unknown as object);
  try {
    // Always clone first — including for already-frozen inputs —
    // so the returned tree owns fresh references for every nested
    // object/array. Returning early on `Object.isFrozen(value)`
    // would silently alias the caller's frozen reference, allowing
    // a shallow-frozen parent to keep mutable children reachable
    // from the returned event payload.
    if (Array.isArray(value)) {
      return Object.freeze(
        [...value].map((v) => cloneAndFreezeInner(v, seen)) as unknown as T[],
      ) as T;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const ctor =
        proto && typeof proto === "object" && "constructor" in proto
          ? (proto as { constructor?: { name?: string } }).constructor?.name
          : undefined;
      throw new TypeError(
        `createEvent: ${ctor ?? "class"} instance is not a serializable plain object payload`,
      );
    }
    // `Object.entries` walks enumerable string-keyed properties and invokes
    // each accessor (getter) exactly once to capture its return value.
    // Symbol-keyed and non-enumerable properties are intentionally omitted.
    const cloned = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        cloneAndFreezeInner(v, seen),
      ]),
    ) as T;
    return Object.freeze(cloned) as T;
  } finally {
    // Drop the object from the recursion path so a sibling reference
    // sharing the same instance is treated as a fresh walk, not a cycle.
    seen.delete(value as unknown as object);
  }
}
