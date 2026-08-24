import {
  MatchStatus,
  PlayerStatus,
  type MatchmakingMatchedPayload,
  type MatchmakingStatusPayload,
  type RoomCountdownCancelledPayload,
  type RoomCountdownStartedPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  type RoomPresenceUpdatedPayload,
  type RoomStatusUpdatedPayload,
  type RoomTerminatedPayload,
} from "@arena/shared";
import {
  createInitialCardState,
  type Player,
  type SocketState,
} from "../socket-store.types";

function mapSocketPlayers(
  players: Array<{ playerId: string; playerName: string; isOnline: boolean }>,
): Player[] {
  return players.map((player) => ({
    id: player.playerId,
    name: player.playerName,
    status: PlayerStatus.ACTIVE,
    score: 0,
    isOnline: player.isOnline,
  }));
}

function createRoomEnteredState(
  data: RoomCreatedPayload | RoomJoinedPayload,
  countdownEndsAt: number | null,
): Partial<SocketState> {
  return {
    match: null,
    cardState: createInitialCardState(),
    topicVoting: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    remainingCount: null,
    lastSeenSeqNo: 0,
    isEliminated: false,
    eliminationReason: null,
    room: {
      id: data.roomId,
      code: data.code,
      status: data.roomStatus,
      hostId: data.hostId,
      roomType: data.roomType,
      maxPlayers: data.maxPlayers,
      currentMatchId: data.currentMatchId,
      countdownEndsAt,
      joinMode: data.joinedAs ?? "PLAYER",
      players: mapSocketPlayers(data.players),
    },
  };
}

export function applyRoomCreatedState(
  data: RoomCreatedPayload,
): Partial<SocketState> {
  return createRoomEnteredState(data, null);
}

export function applyRoomJoinedState(
  data: RoomJoinedPayload,
): Partial<SocketState> {
  return createRoomEnteredState(data, data.countdownEndsAt);
}

export function applyPlayerJoinedState(
  state: SocketState,
  data: RoomPlayerJoinedPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  const hasPlayer = state.room.players.some(
    (player) => player.id === data.playerId,
  );

  return {
    room: {
      ...state.room,
      players: hasPlayer
        ? state.room.players.map((player) =>
            player.id === data.playerId
              ? {
                  ...player,
                  name: data.playerName,
                  isOnline: data.isOnline,
                }
              : player,
          )
        : [
            ...state.room.players,
            {
              id: data.playerId,
              name: data.playerName,
              status: PlayerStatus.ACTIVE,
              score: 0,
              isOnline: data.isOnline,
            },
          ],
    },
  };
}

export function applyPlayerLeftState(
  state: SocketState,
  data: RoomPlayerLeftPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      players: state.room.players.filter(
        (player) => player.id !== data.playerId,
      ),
    },
  };
}

export function applyRoomStatusUpdatedState(
  state: SocketState,
  data: RoomStatusUpdatedPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      status: data.roomStatus,
      currentMatchId: data.currentMatchId,
      countdownEndsAt: null,
    },
  };
}

export function applyRoomCountdownStartedState(
  state: SocketState,
  data: RoomCountdownStartedPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      status: data.roomStatus,
      countdownEndsAt: data.countdownEndsAt,
    },
  };
}

export function applyRoomCountdownCancelledState(
  state: SocketState,
  data: RoomCountdownCancelledPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      status: data.roomStatus,
      countdownEndsAt: null,
    },
  };
}

export function applyRoomPresenceUpdatedState(
  state: SocketState,
  data: RoomPresenceUpdatedPayload,
): Partial<SocketState> | SocketState {
  if (state.room?.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      players: state.room.players.map((player) =>
        player.id === data.playerId
          ? { ...player, isOnline: data.isOnline }
          : player,
      ),
    },
  };
}

export function applyRoomTerminatedState(
  data: RoomTerminatedPayload,
): Partial<SocketState> {
  return {
    room: null,
    match: null,
    topicVoting: null,
    lastSeenSeqNo: 0,
    cardState: createInitialCardState(),
    remainingCount: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    isEliminated: false,
    eliminationReason: null,
    roomTerminated: true,
    roomTerminationMessage: data.message ?? null,
  };
}

export function applyMatchmakingStatusState(
  state: SocketState,
  data: MatchmakingStatusPayload,
): Partial<SocketState> {
  return {
    ...(data.isQueued ? { error: null } : {}),
    matchmaking: {
      isQueued: data.isQueued,
      queuedAt: data.queuedAt,
      elapsedSeconds: data.elapsedSeconds,
      estimatedWaitSeconds: data.estimatedWaitSeconds,
      playersInQueue: data.playersInQueue,
      matchedRoomCode: state.matchmaking.matchedRoomCode,
      matchedRoomId: state.matchmaking.matchedRoomId,
      matchedMatchId: state.matchmaking.matchedMatchId,
    },
  };
}

export function applyMatchmakingMatchedState(
  state: SocketState,
  data: MatchmakingMatchedPayload,
): Partial<SocketState> {
  const isSameMatch = Boolean(data.matchId && state.match?.id === data.matchId);
  const isSameTopicVoting = Boolean(
    data.matchId && state.topicVoting?.matchId === data.matchId,
  );

  return {
    match: isSameMatch
      ? state.match
      : data.matchId
        ? {
            id: data.matchId,
            status: MatchStatus.TOPIC_VOTING,
            currentRoundNo: 0,
            players: state.room?.players ?? [],
            currentQuestion: null,
            roundEndTime: null,
          }
        : null,
    topicVoting: isSameTopicVoting ? state.topicVoting : null,
    cardState: isSameMatch ? state.cardState : createInitialCardState(),
    lastAnswerResult: isSameMatch ? state.lastAnswerResult : null,
    pendingAnswer: isSameMatch ? state.pendingAnswer : null,
    remainingCount: isSameMatch ? state.remainingCount : null,
    isEliminated: isSameMatch ? state.isEliminated : false,
    eliminationReason: isSameMatch ? state.eliminationReason : null,
    matchmaking: {
      isQueued: false,
      queuedAt: null,
      elapsedSeconds: 0,
      estimatedWaitSeconds: 0,
      playersInQueue: state.matchmaking?.playersInQueue ?? 0,
      matchedRoomCode: data.roomCode,
      matchedRoomId: data.roomId,
      matchedMatchId: data.matchId ?? null,
    },
  };
}
