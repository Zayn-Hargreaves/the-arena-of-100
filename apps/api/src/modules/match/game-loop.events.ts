import { GAME_CONFIG, ServerEvent, getRoomChannel } from "@arena/shared";
import type { Server } from "socket.io";

interface MatchStateLike {
  players: Map<string, { name: string }>;
  currentRoundNo: number;
}

export function emitRoundStarted(
  server: Server,
  roomId: string,
  matchId: string,
  state: MatchStateLike,
  question: {
    id: string;
    content: string;
    options: string[];
    difficulty: string;
  },
  endsAt: number,
) {
  // Broadcast ROUND_STARTED (STRIP correctAnswer from question!)
  const channel = getRoomChannel(roomId);
  const clientQuestion = {
    id: question.id,
    content: question.content,
    options: question.options,
    difficulty: question.difficulty,
  };
  server.to(channel).emit(ServerEvent.ROUND_STARTED, {
    matchId,
    roundNo: state.currentRoundNo,
    question: clientQuestion,
    endsAt,
    roundDurationMs: GAME_CONFIG.ROUND_DURATION_MS,
  });
}

export interface RoundEndedEmitContext {
  server: Server;
  roomId: string;
  matchId: string;
  state: MatchStateLike;
  correctAnswer: string;
  survivingIds: string[];
  eliminatedIds: string[];
}

export function emitRoundEnded(ctx: RoundEndedEmitContext) {
  const {
    server,
    roomId,
    matchId,
    state,
    correctAnswer,
    survivingIds,
    eliminatedIds,
  } = ctx;
  const channel = getRoomChannel(roomId);
  // Convert Maps to arrays for Socket.io serialization
  const playerInfos = Array.from(state.players.values());
  // Broadcast ROUND_ENDED (KHÔNG gửi correctAnswer trong question object)
  server.to(channel).emit(ServerEvent.ROUND_ENDED, {
    matchId,
    roundNo: state.currentRoundNo,
    correctAnswer, // standalone field, NOT inside question
    survivingPlayerIds: survivingIds,
    eliminatedPlayerIds: eliminatedIds,
    playerResults: playerInfos,
  });
}

export interface PlayerEliminatedReason {
  matchId: string;
  roomId: string;
  server: Server;
  state: MatchStateLike;
  playerId: string;
  playerName: string;
  answeredThisRound: boolean;
  /** True when the player still had an online socket at elimination. */
  wasOnline: boolean;
}

export function emitPlayerEliminated(ctx: PlayerEliminatedReason) {
  const {
    server,
    roomId,
    matchId,
    state,
    playerId,
    playerName,
    answeredThisRound,
    wasOnline,
  } = ctx;
  const channel = getRoomChannel(roomId);
  // WRONG_ANSWER: submitted but incorrect.
  // AFK: no answer while still connected (idle / didn't press).
  // TIMEOUT: no answer and already offline (disconnect mid-round).
  const reason = answeredThisRound
    ? "WRONG_ANSWER"
    : wasOnline
      ? "AFK"
      : "TIMEOUT";
  server.to(channel).emit(ServerEvent.PLAYER_ELIMINATED, {
    matchId,
    roundNo: state.currentRoundNo,
    playerId,
    playerName,
    reason,
  });
}

export function emitMatchFinished(
  server: Server,
  roomId: string,
  matchId: string,
  state: MatchStateLike,
  winnerId: string | null,
) {
  const channel = getRoomChannel(roomId);
  const playerInfos = Array.from(state.players.values());
  server.to(channel).emit(ServerEvent.MATCH_FINISHED, {
    matchId,
    winnerId,
    totalRounds: state.currentRoundNo,
    players: playerInfos,
  });
}

export function emitMatchPlayerLeft(
  server: Server,
  roomId: string,
  playerId: string,
  reason: "LEFT" | "STALE" = "LEFT",
) {
  const channel = getRoomChannel(roomId);
  server.to(channel).emit(ServerEvent.PLAYER_LEFT, {
    roomId,
    playerId,
    reason,
  });
}

export function emitMatchDisconnected(
  server: Server,
  roomId: string,
  playerId: string,
) {
  const channel = getRoomChannel(roomId);
  server.to(channel).emit(ServerEvent.PLAYER_LEFT, {
    roomId,
    playerId,
    reason: "DISCONNECTED",
  });
}
