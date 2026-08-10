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
  offeredCardIds: [CardId, CardId, CardId];
  seedUsed: string;
}

export interface CardPickedEvent {
  matchId: string;
  roundNo: number;
  playerId: string;
  selectedCardId: CardId;
  offerSeqNo: number;
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
  matchId: string;
  roundNo: number;
  cardId: CardId;
  offerSeqNo: number;
  playedByPlayerId: string;
  targetPlayerIds: string[];
  effect: Extract<CardEffect, { kind: MutationEffectKind }>;
  resolution: "MUTATION";
  serverTimestamp: number;
  expiresAtServer: null;
  remainingMs: null;
};

export type TemporaryEffect = {
  matchId: string;
  roundNo: number;
  cardId: CardId;
  offerSeqNo: number;
  playedByPlayerId: string;
  targetPlayerIds: string[];
  effect: Extract<CardEffect, { kind: TemporaryEffectKind }>;
  resolution: "TEMPORARY";
  serverTimestamp: number;
  expiresAtServer: number;
  remainingMs: number;
};

export type CardEffectEvent = MutationEffect | TemporaryEffect;

type _AllKindsCovered = [CardEffect["kind"]] extends [
  MutationEffectKind | TemporaryEffectKind,
]
  ? true
  : false;
export const _checkAllKindsCovered: _AllKindsCovered = true;

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
    payload,
    seqNo,
  };
}
