import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type EliminationReason,
  type JoinMode,
  type RoomType,
  type SnapshotPayload,
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
  maxPlayers: number;
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
  submissionId?: string;
  isCorrect?: boolean;
  responseTimeMs?: number;
  correctAnswer?: string;
}

export interface PendingAnswer {
  matchId: string;
  roundNo: number;
  answer: string;
  submissionId: string;
}

export interface ConnectionState {
  isConnected: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  accessToken: string | null;
  userRole: string | null;
}

export interface TopicVotingState {
  matchId: string;
  candidateTopics: string[];
  endsAt: number;
  durationMs: number;
  myVotedTopic: string | null;
  voteCounts: Record<string, number>;
  totalVotes: number;
  bannedTopics: string[];
  activeTopics: string[];
  isFinished: boolean;
}

export interface MatchmakingState {
  isQueued: boolean;
  queuedAt: number | null;
  elapsedSeconds: number;
  estimatedWaitSeconds: number;
  playersInQueue: number;
  matchedRoomCode: string | null;
  matchedRoomId: string | null;
}

export interface SocketState extends ConnectionState {
  socket: Socket | null;
  room: Room | null;
  match: Match | null;
  topicVoting: TopicVotingState | null;
  matchmaking: MatchmakingState;
  lastAnswerResult: LastAnswerResult | null;
  pendingAnswer: PendingAnswer | null;
  remainingCount: number | null;
  // Plan D delta replay: the highest event seqNo this client has
  // applied. Set from SNAPSHOT.lastEventSeqNo on a full hydrate and
  // advanced by each applied EVENT_BATCH event. Sent back as the
  // REQUEST_SNAPSHOT cursor so the server can reply with only newer
  // events. 0 means "have not applied anything" → the server sends a
  // full snapshot.
  lastSeenSeqNo: number;
  error: string | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  isEliminated: boolean;
  // Why the local player was eliminated, so the overlay can show
  // "wrong answer" vs "ran out of time". null until eliminated and
  // reset whenever isEliminated resets to false.
  eliminationReason: EliminationReason | null;
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
  joinMatchmaking: (category?: string) => void;
  leaveMatchmaking: () => void;
  clearMatchmakingMatched: () => void;
  voteBanTopic: (matchId: string, topic: string) => void;
  submitAnswer: (
    matchId: string,
    roundNo: number,
    answer: string,
  ) => string | null;
  requestSnapshot: (
    matchId: string,
    lastSeenSeqNo: number,
    fallbackSnapshot?: SnapshotPayload,
  ) => void;
}
