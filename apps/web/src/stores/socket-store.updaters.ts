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
  type TopicVotingStartedPayload,
  type TopicVotingSummaryPayload,
  type TopicVotingFinishedPayload,
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
    topicVoting: null,
    lastAnswerResult: null,
    pendingAnswer: null,
  };
}

export function applyRoundEndedState(
  state: SocketState,
  data:
    | RoundEndedPayload
    | {
        matchId: string;
        roundNo: number;
        correctAnswer: string;
        eliminatedPlayerIds: string[];
        survivingCount?: number;
        survivingPlayerIds?: string[];
      },
  priorForThisRound: LastAnswerResult | null = null,
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

  const survivingCount =
    "survivingCount" in data && typeof data.survivingCount === "number"
      ? data.survivingCount
      : (data.survivingPlayerIds?.length ?? null);

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
    remainingCount: survivingCount,
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
          roundEndTime: null,
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
    topicVoting:
      data.status === MatchStatus.TOPIC_VOTING ||
      data.status === MatchStatus.COUNTDOWN
        ? data.candidateTopics && data.candidateTopics.length > 0
          ? {
              matchId: data.matchId,
              candidateTopics: data.candidateTopics,
              endsAt: data.phaseEndsAt ?? data.roundEndTime ?? 0,
              durationMs: 10000,
              myVotedTopic:
                state.topicVoting?.matchId === data.matchId
                  ? state.topicVoting.myVotedTopic
                  : null,
              voteCounts: data.voteCounts ?? {},
              totalVotes: data.voteCounts
                ? Object.values(data.voteCounts).reduce(
                    (sum: number, n: number) => sum + n,
                    0,
                  )
                : 0,
              bannedTopics:
                (state.topicVoting?.matchId === data.matchId &&
                state.topicVoting.bannedTopics.length > 0
                  ? state.topicVoting.bannedTopics
                  : data.bannedTopics) ?? [],
              activeTopics:
                (state.topicVoting?.matchId === data.matchId &&
                state.topicVoting.activeTopics.length > 0
                  ? state.topicVoting.activeTopics
                  : data.activeTopics) ?? [],
              isFinished: data.status !== MatchStatus.TOPIC_VOTING,
            }
          : state.topicVoting?.matchId === data.matchId
            ? {
                ...state.topicVoting,
                bannedTopics:
                  state.topicVoting.bannedTopics.length > 0
                    ? state.topicVoting.bannedTopics
                    : (data.bannedTopics ?? []),
                activeTopics:
                  state.topicVoting.activeTopics.length > 0
                    ? state.topicVoting.activeTopics
                    : (data.activeTopics ?? []),
                isFinished:
                  data.status !== MatchStatus.TOPIC_VOTING
                    ? true
                    : state.topicVoting.isFinished,
              }
            : (data.bannedTopics && data.bannedTopics.length > 0) ||
                (data.activeTopics && data.activeTopics.length > 0)
              ? {
                  matchId: data.matchId,
                  candidateTopics: data.candidateTopics ?? [],
                  endsAt: data.phaseEndsAt ?? data.roundEndTime ?? 0,
                  durationMs: 10000,
                  myVotedTopic: null,
                  voteCounts: data.voteCounts ?? {},
                  totalVotes: data.voteCounts
                    ? Object.values(data.voteCounts).reduce(
                        (sum: number, n: number) => sum + n,
                        0,
                      )
                    : 0,
                  bannedTopics: data.bannedTopics ?? [],
                  activeTopics: data.activeTopics ?? [],
                  isFinished: data.status !== MatchStatus.TOPIC_VOTING,
                }
              : null
        : null,
  };
}

type ReplayAccumulator = {
  match: NonNullable<SocketState["match"]>;
  room: SocketState["room"];
  remainingCount: SocketState["remainingCount"];
  lastAnswerResult: SocketState["lastAnswerResult"];
  pendingAnswer: SocketState["pendingAnswer"];
};

type ReplayEvent = Extract<
  ReturnType<typeof ReplayEventSchema.safeParse>,
  { success: true }
>["data"];

function foldReplayEvent(
  acc: ReplayAccumulator,
  event: ReplayEvent,
  matchId: string,
): ReplayAccumulator {
  const synthState = {
    room: acc.room,
    match: acc.match,
    remainingCount: acc.remainingCount,
    lastAnswerResult: acc.lastAnswerResult,
    pendingAnswer: acc.pendingAnswer,
  } as SocketState;

  switch (event.type) {
    case "STATE_TRANSITION":
      return { ...acc, match: { ...acc.match, status: event.payload.to } };
    case "ROUND_STARTED": {
      const res = applyRoundStartedState(synthState, {
        matchId,
        roundNo: event.payload.roundNo,
        question: event.payload.question,
        startedAt: Date.now(),
        endsAt: event.payload.endsAt,
      });
      return { ...acc, ...res } as ReplayAccumulator;
    }
    case "ROUND_EVALUATED": {
      const res = applyRoundEndedState(
        synthState,
        {
          matchId,
          roundNo: event.payload.roundNo,
          correctAnswer: event.payload.correctAnswer,
          eliminatedPlayerIds: event.payload.eliminatedIds,
          survivingCount: event.payload.survivingCount,
        },
        acc.lastAnswerResult,
      );
      return { ...acc, ...res } as ReplayAccumulator;
    }
    case "MATCH_FINISHED": {
      const res = applyMatchFinishedState(synthState, {
        matchId,
        winnerId: event.payload.winnerId ?? "",
        totalRounds: event.payload.totalRounds ?? 0,
        finishedAt: Date.now(),
      });
      return { ...acc, ...res } as ReplayAccumulator;
    }
    default:
      return acc;
  }
}

function computeIsEliminated(
  userId: string | null,
  match: NonNullable<SocketState["match"]>,
  fallback: boolean,
): boolean {
  if (!userId) return fallback;
  return (
    match.players.find((p) => p.id === userId)?.status ===
    PlayerStatus.ELIMINATED
  );
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
  if (!activeMatchId || activeMatchId !== data.matchId) return {};

  // A delta applies onto the live match only. Without a base match for
  // this id there is nothing to fold onto (the question/timer cannot be
  // rebuilt from summary events) — the caller must full-hydrate.
  if (state.match?.id !== data.matchId) return {};

  let current: ReplayAccumulator = {
    match: state.match,
    room: state.room,
    remainingCount: state.remainingCount,
    lastAnswerResult: state.lastAnswerResult,
    pendingAnswer: state.pendingAnswer,
  };
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
    if (parsed.success) {
      current = foldReplayEvent(current, parsed.data, data.matchId);
    }
  }

  // Recompute self-elimination from the resulting roster (mirrors
  // applySnapshotState) so the watch-only overlay + answer lock are
  // correct after the delta.
  const selfEliminated = computeIsEliminated(
    state.userId,
    current.match,
    state.isEliminated,
  );

  return {
    ...current,
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
    topicVoting: null,
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

export function applyTopicVotingStartedState(
  state: SocketState,
  data: TopicVotingStartedPayload,
): Partial<SocketState> {
  const currentMatchId = state.room?.currentMatchId ?? state.match?.id;
  if (currentMatchId && currentMatchId !== data.matchId) {
    return {};
  }
  const initialCounts: Record<string, number> = {};
  for (const t of data.candidateTopics) {
    initialCounts[t] = 0;
  }
  return {
    match: state.match
      ? {
          ...state.match,
          status: MatchStatus.TOPIC_VOTING,
        }
      : {
          id: data.matchId,
          status: MatchStatus.TOPIC_VOTING,
          currentRoundNo: 0,
          players: state.room?.players ?? [],
          currentQuestion: null,
          roundEndTime: null,
        },
    topicVoting: {
      matchId: data.matchId,
      candidateTopics: data.candidateTopics,
      endsAt: data.endsAt,
      durationMs: data.durationMs,
      myVotedTopic: null,
      voteCounts: initialCounts,
      totalVotes: 0,
      bannedTopics: [],
      activeTopics: [],
      isFinished: false,
    },
  };
}

export function applyTopicVotingSummaryState(
  state: SocketState,
  data: TopicVotingSummaryPayload,
): Partial<SocketState> {
  if (!state.topicVoting || state.topicVoting.matchId !== data.matchId) {
    return {};
  }
  return {
    topicVoting: {
      ...state.topicVoting,
      voteCounts: data.voteCounts,
      totalVotes: data.totalVotes,
    },
  };
}

export function applyTopicVotingFinishedState(
  state: SocketState,
  data: TopicVotingFinishedPayload,
): Partial<SocketState> {
  if (!state.topicVoting || state.topicVoting.matchId !== data.matchId) {
    return {};
  }
  return {
    topicVoting: {
      ...state.topicVoting,
      bannedTopics: data.bannedTopics,
      activeTopics: data.activeTopics,
      voteCounts: data.voteCounts,
      isFinished: true,
    },
  };
}
