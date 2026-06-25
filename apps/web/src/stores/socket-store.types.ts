import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type JoinMode,
  type RoomType,
} from "@arena/shared";
import type { Socket } from "socket.io-client";

export interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  isOnline: boolean;
}

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  hostId: string;
  roomType: RoomType;
  currentMatchId: string | null;
  countdownEndsAt: number | null;
  players: Player[];
  joinMode: JoinMode;
}

export interface Match {
  id: string;
  status: MatchStatus;
  currentRoundNo: number;
  players: Player[];
  currentQuestion: {
    id: string;
    content: string;
    options: string[];
  } | null;
  roundEndTime: number | null;
}

export interface LastAnswerResult {
  matchId: string;
  roundNo: number;
  isCorrect?: boolean;
  responseTimeMs?: number;
  correctAnswer?: string;
}

export interface ConnectionState {
  isConnected: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  accessToken: string | null;
  userRole: string | null;
}

export interface SocketState extends ConnectionState {
  socket: Socket | null;
  room: Room | null;
  match: Match | null;
  lastAnswerResult: LastAnswerResult | null;
  remainingCount: number | null;
  error: string | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  isEliminated: boolean;
  roomTerminated: boolean;
  roomTerminationMessage: string | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: (nickname: string) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  createRoom: (config: {
    roomType: RoomType;
    timeLimit: number;
    maxPlayers: number;
    category: string;
  }) => Promise<string>;
  joinRoom: (roomCode: string) => Promise<void>;
  leaveRoom: (roomId: string) => void;
  startMatch: (roomId: string) => void;
  submitAnswer: (matchId: string, roundNo: number, answer: string) => void;
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => void;
}
