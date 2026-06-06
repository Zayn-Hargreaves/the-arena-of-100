// ============================================================
// Socket Events - Game Đấu Trường 100
// Client-Server Communication Protocol
// ============================================================

import type { RoomStatus } from "./state";

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

  // Connection Events
  AUTHENTICATED = "authenticated",
  ERROR = "error",
  PONG = "pong",
  KICKED = "kicked",
}

// Client Event Payloads
export interface JoinRoomPayload {
  roomCode?: string;
  roomType?: "PUBLIC" | "PRIVATE";
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface CreateRoomPayload {
  roomType: "PUBLIC" | "PRIVATE";
  maxPlayers?: number;
  timeLimit?: number;
  category?: string;
}

export interface StartMatchPayload {
  roomId: string;
}

export interface SubmitAnswerPayload {
  matchId: string;
  roundNo: number;
  answer: string;
  clientTimestamp: number;
}

export interface RequestSnapshotPayload {
  matchId: string;
  lastSeenSeqNo: number;
}

export interface AuthenticatePayload {
  token: string;
}

export interface HeartbeatPayload {
  roomId?: string;
  matchId?: string;
  sentAt: number;
}

// Server Event Payloads
export interface ErrorPayload {
  code: string;
  message: string;
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

export interface EventBatchPayload {
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
  roomType: "PUBLIC" | "PRIVATE";
  roomStatus: RoomStatus;
  currentMatchId: string | null;
  players: RoomPlayerSummary[];
}

export interface RoomJoinedPayload {
  roomId: string;
  code: string;
  hostId: string;
  roomType: "PUBLIC" | "PRIVATE";
  roomStatus: RoomStatus;
  currentMatchId: string | null;
  countdownEndsAt: number | null;
  players: RoomPlayerSummary[];
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
  reason: "NOT_ENOUGH_PLAYERS" | "HOST_CANCELLED" | "PLAYER_LEFT" | "SYSTEM";
  cancelledAt: number;
}

export interface RoomPresenceUpdatedPayload {
  roomId: string;
  playerId: string;
  isOnline: boolean;
  updatedAt: number;
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
