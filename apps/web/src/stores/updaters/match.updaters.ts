import {
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  GAME_CONFIG,
  ReplayEventSchema,
  type AnswerResultPayload,
  type EventBatchPayload,
  type MatchFinishedPayload,
  type MatchStartedRealtimePayload,
  type MatchStartingRealtimePayload,
  type PlayerEliminatedPayload,
  type RoundEndedPayload,
  type RoundStartedPayload,
  type SnapshotPayload,
} from "@arena/shared";
import {
  createInitialCardState,
  type LastAnswerResult,
  type Player,
  type SocketState,
  type TopicVotingState,
} from "../socket-store.types";
import { applyConsumeSecondChance } from "./card.updaters";

export function applyMatchStartingState(
  state: SocketState,
  data: MatchStartingRealtimePayload,
): Partial<SocketState> {
  return {
    remainingCount: null,
    cardState: createInitialCardState(),
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
    // Plan D — reset the delta cursor on match boundary
    lastSeenSeqNo: 0,
  };
}

export function applyRoundStartedState(
  state: SocketState,
  data: RoundStartedPayload,
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  const currentMatch = state.match?.id === data.matchId ? state.match : null;
  const basePlayers = currentMatch?.players ?? state.room?.players ?? [];

  // Activate pending card effects targeted for this round
  const pendingEffects = state.cardState?.pendingNextRoundEffects ?? [];
  const activatingEffects = pendingEffects.filter(
    (e) => (e.targetRoundNo ?? e.roundNo + 1) <= data.roundNo,
  );
  const remainingPending = pendingEffects.filter(
    (e) => (e.targetRoundNo ?? e.roundNo + 1) > data.roundNo,
  );

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
    ...(state.cardState
      ? {
          cardState: {
            ...state.cardState,
            activeRoundEffects: activatingEffects,
            pendingNextRoundEffects: remainingPending,
          },
        }
      : {}),
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
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  const currentMatch = state.match?.id === data.matchId ? state.match : null;
  const basePlayers = currentMatch?.players ?? state.room?.players ?? [];
  const eliminatedSet = new Set(data.eliminatedPlayerIds);
  const survivingSet =
    "survivingPlayerIds" in data && Array.isArray(data.survivingPlayerIds)
      ? new Set(data.survivingPlayerIds)
      : null;

  const updatedPlayers = basePlayers.map((player) => {
    if (eliminatedSet.has(player.id)) {
      return { ...player, status: PlayerStatus.ELIMINATED };
    }
    if (survivingSet !== null) {
      if (!survivingSet.has(player.id)) {
        return { ...player, status: PlayerStatus.ELIMINATED };
      }
      return player.status === PlayerStatus.ELIMINATED
        ? { ...player, status: PlayerStatus.ACTIVE }
        : player;
    }
    return player;
  });

  const survivingCount =
    "survivingCount" in data && typeof data.survivingCount === "number"
      ? data.survivingCount
      : (survivingSet?.size ?? null);

  let isEliminated = state.isEliminated;
  if (state.userId) {
    if (eliminatedSet.has(state.userId)) {
      isEliminated = true;
    } else if (survivingSet !== null && survivingSet.has(state.userId)) {
      isEliminated = false;
    } else {
      const localPlayer = updatedPlayers.find((p) => p.id === state.userId);
      if (localPlayer) {
        isEliminated = localPlayer.status === PlayerStatus.ELIMINATED;
      }
    }
  }

  const eliminationReason = isEliminated ? state.eliminationReason : null;

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
      ...(priorForThisRound?.submissionId !== undefined && {
        submissionId: priorForThisRound.submissionId,
      }),
      ...(priorForThisRound?.submittedAnswer !== undefined && {
        submittedAnswer: priorForThisRound.submittedAnswer,
      }),
      ...(priorForThisRound?.isCorrect !== undefined && {
        isCorrect: priorForThisRound.isCorrect,
      }),
      ...(priorForThisRound?.responseTimeMs !== undefined && {
        responseTimeMs: priorForThisRound.responseTimeMs,
      }),
      correctAnswer: data.correctAnswer,
    },
    remainingCount: survivingCount,
    isEliminated,
    eliminationReason,
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
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};

  const currentMatch = state.match?.id === data.matchId ? state.match : null;

  return {
    cardState: createInitialCardState(),
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

export function resolveSnapshotTopicVoting(
  state: SocketState,
  data: SnapshotPayload,
): TopicVotingState | null {
  const matchStatus = normalizeMatchStatus(data.status);
  if (!matchStatus) {
    return state.topicVoting;
  }

  if (
    matchStatus !== MatchStatus.TOPIC_VOTING &&
    matchStatus !== MatchStatus.COUNTDOWN
  ) {
    return null;
  }

  const totalVotes = data.voteCounts
    ? Object.values(data.voteCounts).reduce(
        (sum: number, n: number) => sum + n,
        0,
      )
    : 0;

  if (data.candidateTopics && data.candidateTopics.length > 0) {
    return {
      matchId: data.matchId,
      candidateTopics: data.candidateTopics,
      endsAt: data.phaseEndsAt ?? data.roundEndTime ?? 0,
      durationMs: GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
      myVotedTopic:
        state.topicVoting?.matchId === data.matchId
          ? state.topicVoting.myVotedTopic
          : null,
      voteCounts: data.voteCounts ?? {},
      totalVotes,
      bannedTopics:
        (data.bannedTopics !== undefined
          ? data.bannedTopics
          : state.topicVoting?.matchId === data.matchId
            ? state.topicVoting.bannedTopics
            : []) ?? [],
      activeTopics:
        (data.activeTopics !== undefined
          ? data.activeTopics
          : state.topicVoting?.matchId === data.matchId
            ? state.topicVoting.activeTopics
            : []) ?? [],
      isFinished: matchStatus !== MatchStatus.TOPIC_VOTING,
    };
  }

  if (state.topicVoting?.matchId === data.matchId) {
    return {
      ...state.topicVoting,
      bannedTopics:
        (data.bannedTopics !== undefined
          ? data.bannedTopics
          : state.topicVoting.bannedTopics) ?? [],
      activeTopics:
        (data.activeTopics !== undefined
          ? data.activeTopics
          : state.topicVoting.activeTopics) ?? [],
      isFinished:
        matchStatus !== MatchStatus.TOPIC_VOTING
          ? true
          : state.topicVoting.isFinished,
    };
  }

  if (
    (data.bannedTopics && data.bannedTopics.length > 0) ||
    (data.activeTopics && data.activeTopics.length > 0)
  ) {
    return {
      matchId: data.matchId,
      candidateTopics: data.candidateTopics ?? [],
      endsAt: data.phaseEndsAt ?? data.roundEndTime ?? 0,
      durationMs: GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
      myVotedTopic: null,
      voteCounts: data.voteCounts ?? {},
      totalVotes,
      bannedTopics: data.bannedTopics ?? [],
      activeTopics: data.activeTopics ?? [],
      isFinished: matchStatus !== MatchStatus.TOPIC_VOTING,
    };
  }

  return null;
}

export function normalizePlayerStatus(status: unknown): PlayerStatus | null {
  if (
    typeof status === "string" &&
    Object.values(PlayerStatus).includes(status as PlayerStatus)
  ) {
    return status as PlayerStatus;
  }
  return null;
}

export function normalizeMatchStatus(status: unknown): MatchStatus | null {
  if (
    typeof status === "string" &&
    Object.values(MatchStatus).includes(status as MatchStatus)
  ) {
    return status as MatchStatus;
  }
  return null;
}

export function applySnapshotState(
  state: SocketState,
  data: SnapshotPayload,
): Partial<SocketState> {
  const matchStatus = normalizeMatchStatus(data.status);
  if (!matchStatus) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `⚠️ Snapshot hydration failed: invalid match status "${String(data.status)}". Dropping snapshot.`,
      );
    }
    return {};
  }

  if (!Array.isArray(data.players)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "⚠️ Snapshot hydration failed: players is not an array. Dropping snapshot.",
      );
    }
    return {};
  }

  const players: Player[] = [];
  for (const player of data.players) {
    const playerStatus = normalizePlayerStatus(player.status);
    if (!playerStatus) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `⚠️ Snapshot hydration failed: invalid player status "${String(player.status)}" for player "${player.id}". Dropping snapshot.`,
        );
      }
      return {};
    }
    players.push({
      id: player.id,
      name: player.name,
      status: playerStatus,
      score: player.score,
      isOnline: player.isOnline ?? true,
    });
  }

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
      status: matchStatus,
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
    lastSeenSeqNo: data.lastEventSeqNo,
    topicVoting: resolveSnapshotTopicVoting(state, data),
  };
}

type ReplayAccumulator = {
  match: NonNullable<SocketState["match"]>;
  room: SocketState["room"];
  remainingCount: SocketState["remainingCount"];
  lastAnswerResult: SocketState["lastAnswerResult"];
  pendingAnswer: SocketState["pendingAnswer"];
  topicVoting: SocketState["topicVoting"];
  cardState: SocketState["cardState"];
};

type ReplayEvent = Extract<
  ReturnType<typeof ReplayEventSchema.safeParse>,
  { success: true }
>["data"];

function mergeAccumulator(
  acc: ReplayAccumulator,
  res: Partial<SocketState>,
): ReplayAccumulator {
  return {
    match: (res.match ?? acc.match) as NonNullable<SocketState["match"]>,
    room: res.room !== undefined ? res.room : acc.room,
    remainingCount:
      res.remainingCount !== undefined
        ? res.remainingCount
        : acc.remainingCount,
    lastAnswerResult:
      res.lastAnswerResult !== undefined
        ? res.lastAnswerResult
        : acc.lastAnswerResult,
    pendingAnswer:
      res.pendingAnswer !== undefined ? res.pendingAnswer : acc.pendingAnswer,
    topicVoting:
      res.topicVoting !== undefined ? res.topicVoting : acc.topicVoting,
    cardState: res.cardState !== undefined ? res.cardState : acc.cardState,
  };
}

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
    topicVoting: acc.topicVoting,
    cardState: acc.cardState,
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
      return mergeAccumulator(acc, res);
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
      return mergeAccumulator(acc, res);
    }
    case "MATCH_FINISHED": {
      const res = applyMatchFinishedState(synthState, {
        matchId,
        winnerId: event.payload.winnerId ?? "",
        totalRounds: event.payload.totalRounds ?? 0,
        finishedAt: Date.now(),
      });
      return mergeAccumulator(acc, res);
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
  const player = match.players.find((p) => p.id === userId);
  if (!player) return fallback;
  return player.status === PlayerStatus.ELIMINATED;
}

export function applyEventBatchState(
  state: SocketState,
  data: EventBatchPayload,
): Partial<SocketState> {
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (!activeMatchId || activeMatchId !== data.matchId) return {};
  if (state.match?.id !== data.matchId) return {};

  let current: ReplayAccumulator = {
    match: state.match,
    room: state.room,
    remainingCount: state.remainingCount,
    lastAnswerResult: state.lastAnswerResult,
    pendingAnswer: state.pendingAnswer,
    topicVoting: state.topicVoting,
    cardState: state.cardState,
  };
  let cursor = state.lastSeenSeqNo;

  for (const rawEvent of data.events) {
    if (rawEvent.seqNo <= cursor) continue;

    const parsed = ReplayEventSchema.safeParse({
      type: rawEvent.type,
      payload: rawEvent.payload,
    });
    if (!parsed.success) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `⚠️ Replay event parse failed at seqNo ${rawEvent.seqNo}, skipping event.`,
          parsed.error,
        );
      }
      cursor = rawEvent.seqNo;
      continue;
    }
    cursor = rawEvent.seqNo;
    current = foldReplayEvent(current, parsed.data, data.matchId);
  }

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
  const activeMatchId = state.room?.currentMatchId ?? state.match?.id ?? null;
  if (activeMatchId === null || activeMatchId !== data.matchId) return {};
  const isPendingAnswer =
    state.pendingAnswer?.matchId === data.matchId &&
    state.pendingAnswer.roundNo === data.roundNo &&
    state.pendingAnswer.submissionId === data.submissionId;
  const submittedAnswer = isPendingAnswer
    ? state.pendingAnswer?.answer
    : state.lastAnswerResult?.matchId === data.matchId &&
        state.lastAnswerResult?.roundNo === data.roundNo
      ? state.lastAnswerResult.submittedAnswer
      : undefined;

  const isRetry = Boolean(
    state.lastAnswerResult &&
    state.lastAnswerResult.matchId === data.matchId &&
    state.lastAnswerResult.roundNo === data.roundNo &&
    state.lastAnswerResult.submissionId &&
    data.submissionId &&
    state.lastAnswerResult.submissionId !== data.submissionId,
  );

  const consumed = isRetry
    ? applyConsumeSecondChance(state, state.userId ?? undefined)
    : {};

  return {
    ...consumed,
    lastAnswerResult: {
      ...data,
      submittedAnswer,
    },
    pendingAnswer: isPendingAnswer ? null : state.pendingAnswer,
  };
}
