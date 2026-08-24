import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type EliminationReason,
  type JoinMode,
  type RoomType,
  type SnapshotPayload,
  type CardId,
  type ClassId,
  type CardEffectEvent,
} from "@arena/shared";
import type { Socket } from "socket.io-client";

export interface AuthResponse {
  accessToken: string;
  guestSecret?: string;
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
  avatarUrl?: string | null;
  classId?: ClassId | null;
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
  submittedAnswer?: string;
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
  matchedMatchId: string | null;
}

export interface CardOfferState {
  matchId: string;
  roundNo: number;
  offeredCardIds: readonly [CardId, CardId, CardId];
  offerSeqNo: number;
  seedUsed: string;
  expiresAt: number;
}

export interface CardState {
  classId: ClassId | null;
  hand: CardId[];
  playedCardIds: CardId[];
  offerSeqNoByCardId: Partial<Record<CardId, number>>;
  currentOffer: CardOfferState | null;
  lastResolvedEffect: CardEffectEvent | null;
  pendingNextRoundEffects: CardEffectEvent[];
  activeRoundEffects: CardEffectEvent[];
}

export function createInitialCardState(): CardState {
  return {
    classId: null,
    hand: [],
    playedCardIds: [],
    offerSeqNoByCardId: {},
    currentOffer: null,
    lastResolvedEffect: null,
    pendingNextRoundEffects: [],
    activeRoundEffects: [],
  };
}

export const INITIAL_CARD_STATE: Readonly<CardState> = Object.freeze({
  classId: null,
  hand: Object.freeze([]) as unknown as CardId[],
  playedCardIds: Object.freeze([]) as unknown as CardId[],
  offerSeqNoByCardId: Object.freeze({}),
  currentOffer: null,
  lastResolvedEffect: null,
  pendingNextRoundEffects: Object.freeze([]) as unknown as CardEffectEvent[],
  activeRoundEffects: Object.freeze([]) as unknown as CardEffectEvent[],
});

export interface SocketState extends ConnectionState {
  socket: Socket | null;
  room: Room | null;
  match: Match | null;
  topicVoting: TopicVotingState | null;
  matchmaking: MatchmakingState;
  cardState: CardState;
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
  pickCard: (cardId: CardId, offerSeqNo: number) => void;
  playCard: (
    cardId: CardId,
    offerSeqNo: number,
    targetPlayerId?: string,
  ) => void;
  dismissCardOffer: () => void;
  clearResolvedCardEffect: () => void;
  consumeSecondChance: (playerId?: string) => void;
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
