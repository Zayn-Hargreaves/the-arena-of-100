import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  type AnswerResultPayload,
  type MatchFinishedPayload,
  type MatchStartedRealtimePayload,
  type MatchStartingRealtimePayload,
  type PlayerEliminatedPayload,
  type RoomCountdownCancelledPayload,
  type RoomCountdownStartedPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  type RoomPresenceUpdatedPayload,
  type RoomStatusUpdatedPayload,
  type RoomTerminatedPayload,
  type RoundEndedPayload,
  type RoundStartedPayload,
  type SnapshotPayload,
} from "@arena/shared";
import type {
  LastAnswerResult,
  Player,
  SocketState,
} from "./socket-store.types";

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

export function applyAuthenticatedState(data: {
  userId: string;
  username: string;
}): Partial<SocketState> {
  return {
    isAuthenticated: true,
    userId: data.userId,
    username: data.username,
  };
}

export function applyRoomCreatedState(
  data: RoomCreatedPayload,
): Partial<SocketState> {
  return {
    match: null,
    lastAnswerResult: null,
    remainingCount: null,
    isEliminated: false,
    room: {
      id: data.roomId,
      code: data.code,
      status: data.roomStatus,
      hostId: data.hostId,
      roomType: data.roomType,
      currentMatchId: data.currentMatchId,
      countdownEndsAt: null,
      joinMode: data.joinedAs ?? "PLAYER",
      players: mapSocketPlayers(data.players),
    },
  };
}

export function applyRoomJoinedState(
  data: RoomJoinedPayload,
): Partial<SocketState> {
  return {
    match: null,
    lastAnswerResult: null,
    remainingCount: null,
    isEliminated: false,
    room: {
      id: data.roomId,
      code: data.code,
      status: data.roomStatus,
      hostId: data.hostId,
      roomType: data.roomType,
      currentMatchId: data.currentMatchId,
      countdownEndsAt: data.countdownEndsAt,
      joinMode: data.joinedAs ?? "PLAYER",
      players: mapSocketPlayers(data.players),
    },
  };
}

export function applyPlayerJoinedState(
  state: SocketState,
  data: RoomPlayerJoinedPayload,
): Partial<SocketState> | SocketState {
  if (!state.room || state.room.id !== data.roomId) {
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
  if (!state.room || state.room.id !== data.roomId) {
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
  if (!state.room || state.room.id !== data.roomId) {
    return state;
  }

  return {
    room: {
      ...state.room,
      status: data.roomStatus,
      currentMatchId: data.currentMatchId,
      // The dedicated ROOM_COUNTDOWN_STARTED event supplies the
      // authoritative countdownEndsAt. Setting it to null here
      // avoids a flash of a stale timestamp from a previous room
      // status transition (e.g. WAITING -> COUNTDOWN) and lets the
      // ROOM_COUNTDOWN_STARTED handler drive the countdown UI.
      countdownEndsAt: null,
    },
  };
}

export function applyRoomCountdownStartedState(
  state: SocketState,
  data: RoomCountdownStartedPayload,
): Partial<SocketState> | SocketState {
  if (!state.room || state.room.id !== data.roomId) {
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
  if (!state.room || state.room.id !== data.roomId) {
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
  if (!state.room || state.room.id !== data.roomId) {
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

export function applyMatchStartingState(
  state: SocketState,
  data: MatchStartingRealtimePayload,
): Partial<SocketState> {
  return {
    remainingCount: null,
    lastAnswerResult: null,
    room: state.room
      ? {
          ...state.room,
          status: RoomStatus.STARTING,
          currentMatchId: data.matchId,
          countdownEndsAt: null,
        }
      : null,
  };
}

export function applyMatchStartedState(
  state: SocketState,
  data: MatchStartedRealtimePayload,
): Partial<SocketState> {
  return {
    isEliminated: false,
    room: state.room
      ? {
          ...state.room,
          status: RoomStatus.IN_GAME,
          currentMatchId: data.matchId,
          countdownEndsAt: null,
        }
      : null,
    match: {
      id: data.matchId,
      status: data.status,
      currentRoundNo: 0,
      players: state.room?.players ?? [],
      currentQuestion: null,
      roundEndTime: null,
    },
  };
}

export function applyRoundStartedState(
  state: SocketState,
  data: RoundStartedPayload,
): Partial<SocketState> {
  // Guard: ignore stale round events from a previous match after
  // reconnect or room switch. Prioritize `state.room?.currentMatchId`
  // (set by `applyMatchStartingState`) as the authoritative active
  // match over `state.match?.id`, so ROUND_STARTED is not dropped
  // during the transition window where `state.match.id` still points
  // to the previous match but `currentMatchId` already matches the
  // incoming matchId. When both IDs exist, neither matching the
  // incoming matchId means the broadcast is stale and must be
  // rejected.
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  // Treat `state.match` as current only when its id matches the event.
  // During the transition window the room can already point at the new
  // match while `state.match` still reflects the previous one; in that
  // case we must not spread the stale match object.
  const currentMatch = state.match?.id === data.matchId ? state.match : null;
  const basePlayers = currentMatch?.players ?? state.room?.players ?? [];

  return {
    match: currentMatch
      ? {
          ...currentMatch,
          id: data.matchId,
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: data.roundNo,
          currentQuestion: data.question,
          roundEndTime: data.endsAt,
        }
      : {
          id: data.matchId,
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: data.roundNo,
          players: basePlayers,
          currentQuestion: data.question,
          roundEndTime: data.endsAt,
        },
    lastAnswerResult: null,
  };
}

export function applyRoundEndedState(
  state: SocketState,
  data: RoundEndedPayload,
  priorForThisRound: LastAnswerResult | null,
): Partial<SocketState> {
  // Guard: ignore stale round events from a previous match after
  // reconnect or room switch. Prioritize `state.room?.currentMatchId`
  // (set by `applyMatchStartingState`) as the authoritative active
  // match over `state.match?.id` so ROUND_ENDED is not dropped during
  // the transition window.
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  // Treat `state.match` as the current match ONLY when its id matches
  // the event; otherwise `state.match` is from a previous match and
  // must not be spread (which would carry stale roster/fields over).
  const currentMatch = state.match?.id === data.matchId ? state.match : null;
  const basePlayers = currentMatch?.players ?? state.room?.players ?? [];
  const eliminatedSet = new Set(data.eliminatedPlayerIds);
  const updatedPlayers = basePlayers.map((player) =>
    eliminatedSet.has(player.id)
      ? { ...player, status: PlayerStatus.ELIMINATED }
      : player,
  );

  return {
    match: currentMatch
      ? {
          ...currentMatch,
          id: data.matchId,
          players: updatedPlayers,
          status: MatchStatus.ROUND_RESULT,
          roundEndTime: null,
        }
      : {
          id: data.matchId,
          status: MatchStatus.ROUND_RESULT,
          currentRoundNo: data.roundNo,
          players: updatedPlayers,
          currentQuestion: null,
          roundEndTime: null,
        },
    lastAnswerResult: {
      matchId: data.matchId,
      roundNo: data.roundNo,
      ...(priorForThisRound?.isCorrect !== undefined && {
        isCorrect: priorForThisRound.isCorrect,
      }),
      ...(priorForThisRound?.responseTimeMs !== undefined && {
        responseTimeMs: priorForThisRound.responseTimeMs,
      }),
      correctAnswer: data.correctAnswer,
    },
    remainingCount: data.survivingPlayerIds.length,
  };
}

export function applyPlayerEliminatedState(
  state: SocketState,
  data: PlayerEliminatedPayload,
): Partial<SocketState> | SocketState {
  if (!state.match) return state;

  return {
    match: {
      ...state.match,
      players: state.match.players.map((player) =>
        player.id === data.playerId
          ? { ...player, status: PlayerStatus.ELIMINATED }
          : player,
      ),
    },
  };
}

export function applyMatchFinishedState(
  state: SocketState,
  data: MatchFinishedPayload,
): Partial<SocketState> {
  // Guard: ignore stale MATCH_FINISHED events from a previous match.
  // Prioritize `state.room?.currentMatchId` (set by
  // `applyMatchStartingState`) as the authoritative active match over
  // `state.match?.id`. When both IDs exist and neither matches the
  // incoming `data.matchId`, the broadcast is stale and must be
  // rejected so it cannot mutate the lobby/room state.
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  // Treat `state.match` as the current match ONLY when its id matches
  // the event; otherwise `state.match` is from a previous match and
  // must not be spread. The returned `match.id` must always equal
  // `data.matchId` so the finished state cannot carry forward a stale
  // roster/id from an older match.
  const currentMatch = state.match?.id === data.matchId ? state.match : null;

  return {
    room: state.room
      ? {
          ...state.room,
          status: RoomStatus.FINISHED,
          countdownEndsAt: null,
        }
      : null,
    match: currentMatch
      ? {
          ...currentMatch,
          id: data.matchId,
          status: MatchStatus.FINISHED,
        }
      : {
          id: data.matchId,
          status: MatchStatus.FINISHED,
          currentRoundNo: 0,
          players: state.room?.players ?? [],
          currentQuestion: null,
          roundEndTime: null,
        },
  };
}

export function applySnapshotState(
  state: SocketState,
  data: SnapshotPayload,
): Partial<SocketState> {
  return {
    room: state.room
      ? {
          ...state.room,
          status: RoomStatus.IN_GAME,
          currentMatchId: data.matchId,
          countdownEndsAt: null,
        }
      : null,
    match: {
      id: data.matchId,
      // SnapshotPayload.status is `string` for wire-compat reasons;
      // the state machine always sends a MatchStatus value.
      status: data.status as MatchStatus,
      currentRoundNo: data.currentRoundNo,
      players: (data.players as Player[]).map((player) => ({
        ...player,
        isOnline: player.isOnline ?? true,
      })),
      currentQuestion: data.currentQuestion,
      roundEndTime: data.roundEndTime,
    },
    remainingCount: null,
    lastAnswerResult: null,
  };
}

export function applyAnswerResultState(
  state: SocketState,
  data: AnswerResultPayload,
): Partial<SocketState> {
  if (state.match && state.match.id !== data.matchId) return {};
  return { lastAnswerResult: data };
}

export function applyRoomTerminatedState(
  data: RoomTerminatedPayload,
): Partial<SocketState> {
  return {
    room: null,
    match: null,
    remainingCount: null,
    lastAnswerResult: null,
    isEliminated: false,
    roomTerminated: true,
    roomTerminationMessage: data.message ?? null,
  };
}

export function applyUnauthorizedErrorState(
  errorMessage: string | null,
): Partial<SocketState> {
  return {
    socket: null,
    isConnected: false,
    isAuthenticated: false,
    accessToken: null,
    userRole: null,
    userId: null,
    username: null,
    room: null,
    match: null,
    remainingCount: null,
    lastAnswerResult: null,
    isEliminated: false,
    heartbeatInterval: null,
    roomTerminated: false,
    roomTerminationMessage: null,
    // Include the error message in the SAME set call that resets the
    // socket/heartbeat state. A separate follow-up `set({ error })`
    // would be a no-op because this function sets `socket: null`,
    // and any subsequent `if (get().socket === newSocket)` gate would
    // never match — the error message would silently be dropped.
    error: errorMessage,
  };
}
