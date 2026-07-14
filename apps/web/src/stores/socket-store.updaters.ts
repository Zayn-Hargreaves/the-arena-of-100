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
  type EventBatchPayload,
  ReplayEventSchema,
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
    eliminationReason: null,
    room: {
      id: data.roomId,
      code: data.code,
      status: data.roomStatus,
      hostId: data.hostId,
      roomType: data.roomType,
      maxPlayers: data.maxPlayers,
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
    eliminationReason: null,
    room: {
      id: data.roomId,
      code: data.code,
      status: data.roomStatus,
      hostId: data.hostId,
      roomType: data.roomType,
      maxPlayers: data.maxPlayers,
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
    pendingAnswer: null,
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
    eliminationReason: null,
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
    // Plan D — reset the delta cursor on match boundary so a stale
    // seqNo from the previous match cannot qualify for delta delivery
    // against the new match's event log (the handler's `canDelta`
    // check would otherwise emit a delta the client then no-ops on,
    // or — worse — replay stale events against the new match). The
    // next REQUEST_SNAPSHOT will be a full SNAPSHOT, then delta kicks
    // in from there.
    lastSeenSeqNo: 0,
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
    pendingAnswer: null,
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
    pendingAnswer:
      state.pendingAnswer?.matchId === data.matchId &&
      state.pendingAnswer.roundNo === data.roundNo
        ? null
        : state.pendingAnswer,
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
  const players = (data.players as Player[]).map((player) => ({
    ...player,
    isOnline: player.isOnline ?? true,
  }));

  // Reconnect-after-elimination: the snapshot roster is the source of
  // truth for whether the local player is still in the match. If we
  // were eliminated before dropping, hydrate `isEliminated` from the
  // roster so the watch-only overlay + answer-panel lock come back
  // immediately — the store flag is otherwise false after a fresh
  // page load. The snapshot carries no reason, so leave it null (the
  // overlay falls back to its generic subtitle).
  const selfEliminated = state.userId
    ? players.find((p) => p.id === state.userId)?.status ===
      PlayerStatus.ELIMINATED
    : false;

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
      players,
      currentQuestion: data.currentQuestion,
      roundEndTime: data.roundEndTime,
    },
    isEliminated: selfEliminated,
    eliminationReason: null,
    remainingCount: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    // Plan D: a full hydrate resets the delta cursor to the log head,
    // so subsequent reconnects can ask for only newer events.
    lastSeenSeqNo: data.lastEventSeqNo,
  };
}

// Plan D — delta replay. Fold an EVENT_BATCH onto the current match,
// event by event in seqNo order, so the resulting state equals what a
// continuously connected client would hold (each case mirrors the
// matching live updater above). Applied only on top of an existing
// match for the same id — a delta has no base to reconstruct a question
// from scratch, so a client with no match must full-hydrate first.
//
// Idempotent: events with seqNo <= the current cursor are skipped, so a
// duplicated or out-of-order batch is a no-op. The cursor advances to
// the highest applied seqNo.
export function applyEventBatchState(
  state: SocketState,
  data: EventBatchPayload,
): Partial<SocketState> {
  // Match guard (mirrors the live round updaters): ignore a batch for a
  // stale or different match.
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  // A delta applies onto the live match only. Without a base match for
  // this id there is nothing to fold onto (the question/timer cannot be
  // rebuilt from summary events) — the caller must full-hydrate.
  if (state.match?.id !== data.matchId) return {};

  let match = state.match;
  let room = state.room;
  let remainingCount = state.remainingCount;
  let lastAnswerResult = state.lastAnswerResult;
  let pendingAnswer = state.pendingAnswer;
  let cursor = state.lastSeenSeqNo;

  for (const rawEvent of data.events) {
    if (rawEvent.seqNo <= cursor) continue; // idempotent skip
    // Advance cursor even when the payload is invalid / unknown so a
    // corrupt entry cannot pin the client behind the server log head.
    cursor = rawEvent.seqNo;

    const parsed = ReplayEventSchema.safeParse({
      type: rawEvent.type,
      payload: rawEvent.payload,
    });
    if (!parsed.success) continue;

    const event = parsed.data;
    switch (event.type) {
      case "STATE_TRANSITION":
        match = { ...match, status: event.payload.to };
        break;
      case "ROUND_STARTED":
        match = {
          ...match,
          status: MatchStatus.ROUND_ACTIVE,
          currentRoundNo: event.payload.roundNo,
          currentQuestion: event.payload.question,
          roundEndTime: event.payload.endsAt,
        };
        // Mirror live applyRoundStartedState: a new round opens with a
        // clean answer panel — the previous round's result and any
        // pending submission are no longer relevant.
        lastAnswerResult = null;
        pendingAnswer = null;
        break;
      case "ROUND_EVALUATED": {
        const eliminated = new Set(event.payload.eliminatedIds);
        match = {
          ...match,
          status: MatchStatus.ROUND_RESULT,
          players: match.players.map((player) =>
            eliminated.has(player.id)
              ? { ...player, status: PlayerStatus.ELIMINATED }
              : player,
          ),
          roundEndTime: null,
        };
        remainingCount = event.payload.survivingCount;
        // Mirror live applyRoundEndedState: clear pendingAnswer only
        // when it belongs to the round that just resolved. A pending
        // answer from an earlier round (out-of-order delivery) is
        // preserved so the client can still resolve it on reconnect.
        if (
          pendingAnswer?.matchId === data.matchId &&
          pendingAnswer.roundNo === event.payload.roundNo
        ) {
          pendingAnswer = null;
        }
        break;
      }
      case "MATCH_FINISHED":
        match = { ...match, status: MatchStatus.FINISHED, roundEndTime: null };
        // Mirror live applyMatchFinishedState: flip the room channel
        // status to FINISHED so the lobby / leave-flow observes the
        // match end even when the finish arrives via delta replay.
        if (room) {
          room = {
            ...room,
            status: RoomStatus.FINISHED,
            countdownEndsAt: null,
          };
        }
        break;
      // No-op on match state (cursor still advances above):
      //  - ANSWER_SUBMITTED / TIE_BREAK: peers' submissions and the
      //    internal tie-break do not change the rendered match (mirrors
      //    live play).
      //  - PLAYER_DISCONNECTED / PLAYER_RECONNECTED: presence lives on
      //    `room.players`, not `match.players` — live play never updates
      //    match-roster `isOnline` either. A full SNAPSHOT refreshes
      //    presence; the delta deliberately leaves it untouched so a
      //    reconnecting client matches a continuously connected one.
      default:
        break;
    }
  }

  // Recompute self-elimination from the resulting roster (mirrors
  // applySnapshotState) so the watch-only overlay + answer lock are
  // correct after the delta.
  const selfEliminated = state.userId
    ? match.players.find((p) => p.id === state.userId)?.status ===
      PlayerStatus.ELIMINATED
    : state.isEliminated;

  return {
    match,
    room,
    remainingCount,
    lastAnswerResult,
    pendingAnswer,
    isEliminated: selfEliminated,
    lastSeenSeqNo: cursor,
  };
}

export function applyAnswerResultState(
  state: SocketState,
  data: AnswerResultPayload,
): Partial<SocketState> {
  if (state.match && state.match.id !== data.matchId) return {};
  const isPendingAnswer =
    state.pendingAnswer?.matchId === data.matchId &&
    state.pendingAnswer.roundNo === data.roundNo &&
    state.pendingAnswer.submissionId === data.submissionId;
  return {
    lastAnswerResult: data,
    pendingAnswer: isPendingAnswer ? null : state.pendingAnswer,
  };
}

export function applyRoomTerminatedState(
  data: RoomTerminatedPayload,
): Partial<SocketState> {
  return {
    room: null,
    match: null,
    remainingCount: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    isEliminated: false,
    eliminationReason: null,
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
    pendingAnswer: null,
    isEliminated: false,
    eliminationReason: null,
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
