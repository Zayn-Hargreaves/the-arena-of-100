// ============================================================
// Event Types - Game Đấu Trường 100
// Event Sourcing Pattern: All game actions are events
// ============================================================

import { MatchStatus, RoomStatus, type RoomType } from "./state";
import type {
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

// Question Snapshot (used in events) — single source of truth is the
// Zod schema in `schemas.ts` (`QuestionSnapshotSchema`); this re-export
// keeps the public surface stable for downstream consumers.
export type { QuestionSnapshot };

// ---------------------------------------------------------------------------
// Replay events (Plan D — delta replay)
//
// Compile-time types live in `schemas.ts` (`ReplayEventSchema`,
// `ReplayEvent`). They are derived from the runtime schema so the
// server-side log sites and the client-side fold cannot drift apart.
// correctAnswer is never included.
// ---------------------------------------------------------------------------
export type {
  ReplayEvent,
  ReplayStateTransitionPayload,
  ReplayRoundStartedPayload,
  ReplayAnswerSubmittedPayload,
  ReplayRoundEvaluatedPayload,
  ReplayTieBreakPayload,
  ReplayMatchFinishedPayload,
  ReplayPlayerPresencePayload,
};

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
  | BaseEvent<PlayerReconnectedPayload>;

// Factory function for creating events (Command Pattern)
export function createEvent<T>(
  type: string,
  payload: T,
  seqNo: number,
): BaseEvent<T> {
  return {
    id:
      crypto.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    timestamp: Date.now(),
    payload,
    seqNo,
  };
}
