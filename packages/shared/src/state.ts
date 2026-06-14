// ============================================================
// State Types - Game Đấu Trường 100
// Server-Authoritative State Machine
// ============================================================

// Room States
export enum RoomStatus {
  WAITING = "WAITING",
  COUNTDOWN = "COUNTDOWN",
  STARTING = "STARTING",
  IN_GAME = "IN_GAME",
  FINISHED = "FINISHED",
}

// Match States (State Machine Pattern)
export enum MatchStatus {
  CREATED = "CREATED",
  COUNTDOWN = "COUNTDOWN",
  ROUND_ACTIVE = "ROUND_ACTIVE",
  ROUND_EVALUATING = "ROUND_EVALUATING",
  ROUND_RESULT = "ROUND_RESULT",
  FINISHED = "FINISHED",
}

// Player States in Match
//
// Note: drop-in spectating does NOT add a SPECTATOR member here.
// Spectators are not in MatchState.players (no RoomPlayer row, never
// call stateMachine.submitAnswer), so they never get a PlayerInfo
// with `status`. The "is this socket a spectator?" role is carried
// separately in the socket transport layer via JoinMode
// (`packages/shared/src/socket.ts` — see RoomJoinedPayload.joinedAs)
// and is consumed by the frontend to render the spectator UI.
export enum PlayerStatus {
  ACTIVE = "ACTIVE",
  ELIMINATED = "ELIMINATED",
  DISCONNECTED = "DISCONNECTED",
  WINNER = "WINNER",
}

// Room State
export interface RoomState {
  id: string;
  code: string;
  status: RoomStatus;
  hostId: string;
  roomType: "PUBLIC" | "PRIVATE";
  maxPlayers: number;
  currentPlayers: PlayerInfo[];
  currentMatchId: string | null;
  createdAt: number;
}

// Player Info
export interface PlayerInfo {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  totalResponseTimeMs: number;
  correctAnswers: number;
  isOnline: boolean;
}

// Match State
export interface MatchState {
  id: string;
  roomId: string;
  status: MatchStatus;
  currentRoundNo: number;
  totalRounds: number;
  players: Map<string, PlayerInfo>;
  survivingPlayerIds: string[];
  eliminatedPlayerIds: string[];
  winnerId: string | null;
  startedAt: number;
  endedAt: number | null;
}

// Round State
export interface RoundState {
  matchId: string;
  roundNo: number;
  question: QuestionState;
  startedAt: number;
  endsAt: number;
  answers: Map<string, AnswerState>;
  status: "PENDING" | "ACTIVE" | "EVALUATING" | "COMPLETED";
}

// Question State (client-safe, no correct answer)
export interface QuestionState {
  id: string;
  content: string;
  options: string[];
  difficulty?: "EASY" | "MEDIUM" | "HARD";
}

// Answer State
export interface AnswerState {
  playerId: string;
  answer: string;
  isCorrect: boolean;
  responseTimeMs: number;
  submittedAt: number;
}

// Snapshot for Reconnect (Observer Pattern)
export interface MatchSnapshot {
  matchId: string;
  status: MatchStatus;
  currentRoundNo: number;
  players: PlayerInfo[];
  currentQuestion: QuestionState | null;
  roundEndTime: number | null;
  lastEventSeqNo: number;
}

import { ErrorCode } from "./error-codes";
import { RoomError } from "./errors";

// Tie-break Result
export interface TieBreakResult {
  winnerId: string;
  tiedPlayerIds: string[];
  tieBreakReason: "TOTAL_RESPONSE_TIME" | "EARLIEST_CORRECT" | "RANDOM";
  details: {
    totalResponseTimeMs: Map<string, number>;
    earliestCorrectRound: Map<string, number>;
  };
}

export function asRoomType(value: string): "PUBLIC" | "PRIVATE" {
  if (value === "PUBLIC") return "PUBLIC";
  if (value === "PRIVATE") return "PRIVATE";
  throw new RoomError(ErrorCode.INVALID_ROOM_TYPE);
}

export function asRoomTypeOrDefault(value: string): "PUBLIC" | "PRIVATE" {
  return value === "PRIVATE" ? "PRIVATE" : "PUBLIC";
}
