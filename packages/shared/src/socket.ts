// ============================================================
// Socket Events - Game Đấu Trường 100
// Client-Server Communication Protocol
// ============================================================

import type { RoomTerminationReason } from "./events";
import type { RoomStatus, RoomType } from "./state";

// Socket Namespaces
export enum SocketNamespace {
  ROOM = "room",
  MATCH = "match",
}

// Client -> Server Events (Commands)
export enum ClientEvent {
  // Room Events
  JOIN_ROOM = "join_room",
  LEAVE_ROOM = "leave_room",
  CREATE_ROOM = "create_room",
  START_MATCH = "start_match",

  // Match Events
  SUBMIT_ANSWER = "submit_answer",
  REQUEST_SNAPSHOT = "request_snapshot",

  // Connection Events
  AUTHENTICATE = "authenticate",
  HEARTBEAT = "heartbeat",
  PING = "ping",
}

// How a user joined a room. PLAYER = the user has (or just gained) a
// RoomPlayer row and is participating in the match. SPECTATOR = the user
// entered a room that is already IN_GAME or FINISHED and will only
// receive read-only state. The frontend uses this to render the
// spectator UI and to block answer submission on the client side
// (the server still enforces the gate independently in
// MatchHandler.handleSubmitAnswer).
export type JoinMode = "PLAYER" | "SPECTATOR";

// Server -> Client Events (Notifications)
export enum ServerEvent {
  // Room Events
  ROOM_CREATED = "room_created",
  ROOM_JOINED = "room_joined",
  PLAYER_JOINED = "player_joined",
  PLAYER_LEFT = "player_left",
  ROOM_STATUS_UPDATED = "room_status_updated",
  ROOM_COUNTDOWN_STARTED = "room_countdown_started",
  ROOM_COUNTDOWN_CANCELLED = "room_countdown_cancelled",
  ROOM_PRESENCE_UPDATED = "room_presence_updated",
  MATCH_STARTING = "match_starting",

  // Match Events
  MATCH_STARTED = "match_started",
  ROUND_STARTED = "round_started",
  ROUND_ENDED = "round_ended",
  ANSWER_RESULT = "answer_result",
  PLAYER_ELIMINATED = "player_eliminated",
  MATCH_FINISHED = "match_finished",

  // Sync Events
  SNAPSHOT = "snapshot",
  EVENT_BATCH = "event_batch",

  // Operator Events
  ROOM_TERMINATED = "room_terminated",

  // Connection Events
  AUTHENTICATED = "authenticated",
  ERROR = "error",
  PONG = "pong",
  KICKED = "kicked",
}

// Client Event Payloads
//
// The interfaces below were previously hand-written and have been
// replaced by `z.infer` types from `./schemas.ts` so the runtime
// validation (WsValidationPipe) and the compile-time types cannot
// drift. They are re-exported here under the same names so existing
// `import { type SubmitAnswerPayload } from "@arena/shared"` keeps
// working without touching every call site.
export type {
  JoinRoomPayload,
  LeaveRoomPayload,
  CreateRoomPayload,
  StartMatchPayload,
  SubmitAnswerPayload,
  RequestSnapshotPayload,
  AuthenticatePayload,
  HeartbeatPayload,
} from "./schemas";

// Server Event Payloads
export interface ErrorPayload {
  code: string;
  message: string;
  submissionId?: string;
  failedEvent?: ClientEvent;
}

export interface SnapshotPayload {
  matchId: string;
  status: string;
  currentRoundNo: number;
  players: Array<{
    id: string;
    name: string;
    status: string;
    score: number;
  }>;
  currentQuestion: {
    id: string;
    content: string;
    options: string[];
  } | null;
  roundEndTime: number | null;
  lastEventSeqNo: number;
}

// Delta replay batch (ServerEvent.EVENT_BATCH). Emitted instead of a
// full SNAPSHOT when a reconnecting client sends a valid, in-range
// `lastSeenSeqNo` cursor: it carries only the events with
// `seqNo > lastSeenSeqNo`, in ascending seqNo order. The client applies
// them sequentially onto its current state and advances its cursor to
// the last seqNo. See MatchStateMachine.getDelta.
export interface EventBatchPayload {
  matchId: string;
  events: Array<{
    id: string;
    type: string;
    timestamp: number;
    payload: unknown;
    seqNo: number;
  }>;
}

export interface AnswerResultPayload {
  matchId: string;
  roundNo: number;
  submissionId: string;
  isCorrect: boolean;
  responseTimeMs: number;
  correctAnswer?: string;
}

export interface RoomPlayerSummary {
  playerId: string;
  playerName: string;
  isOnline: boolean;
}

export interface RoomCreatedPayload {
  roomId: string;
  code: string;
  hostId: string;
  roomType: RoomType;
  roomStatus: RoomStatus;
  maxPlayers: number;
  currentMatchId: string | null;
  players: RoomPlayerSummary[];
  // The host is always a player; included for consistency with
  // RoomJoinedPayload so frontend code can rely on a single shape.
  joinedAs: JoinMode;
}

export interface RoomJoinedPayload {
  roomId: string;
  code: string;
  hostId: string;
  roomType: RoomType;
  roomStatus: RoomStatus;
  maxPlayers: number;
  currentMatchId: string | null;
  countdownEndsAt: number | null;
  players: RoomPlayerSummary[];
  // Tells the client whether this socket just joined as a participant
  // (PLAYER) or as a read-only late-joiner (SPECTATOR). Backwards-
  // compatible defaults to PLAYER at the call site if a legacy server
  // omits the field.
  joinedAs: JoinMode;
}

export interface RoomPlayerJoinedPayload {
  roomId: string;
  playerId: string;
  playerName: string;
  isOnline: boolean;
}

export interface RoomPlayerLeftPayload {
  roomId: string;
  playerId: string;
  reason: "DISCONNECTED" | "KICKED" | "LEFT" | "STALE" | "HOST_STALE";
}

export interface RoomStatusUpdatedPayload {
  roomId: string;
  roomStatus: RoomStatus;
  currentMatchId: string | null;
  updatedAt: number;
}

export interface RoomCountdownStartedPayload {
  roomId: string;
  roomStatus: RoomStatus.COUNTDOWN | RoomStatus.STARTING;
  countdownEndsAt: number;
  countdownMs: number;
  startedAt: number;
}

export interface RoomCountdownCancelledPayload {
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

export interface RoomPresenceUpdatedPayload {
  roomId: string;
  playerId: string;
  isOnline: boolean;
  updatedAt: number;
}

export interface RoomTerminatedPayload {
  roomId: string;
  reason: RoomTerminationReason;
  matchId: string | null;
  message?: string;
  terminatedAt: number;
}

// Socket Channel Helpers
export function getRoomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export function getMatchChannel(matchId: string): string {
  return `match:${matchId}`;
}

export function getPlayerChannel(playerId: string): string {
  return `player:${playerId}`;
}
