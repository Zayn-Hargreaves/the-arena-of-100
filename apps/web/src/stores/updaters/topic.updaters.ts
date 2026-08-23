import {
  ClientEvent,
  MatchStatus,
  RoomStatus,
  type TopicVotingFinishedPayload,
  type TopicVotingStartedPayload,
  type TopicVotingSummaryPayload,
} from "@arena/shared";
import type { SocketState } from "../socket-store.types";
import {
  type PendingTopicVoteCommand,
  pendingTopicVoteCommandsByMatch,
  confirmedTopicVoteBaselineByMatch,
  getEffectiveTopicVote,
} from "../socket-store.state-maps";

export function applyTopicVotingStartedState(
  state: SocketState,
  data: TopicVotingStartedPayload,
): Partial<SocketState> {
  // If the room already tracks a different active match, drop stale payload
  if (
    state.room?.currentMatchId &&
    state.room.currentMatchId !== data.matchId
  ) {
    return {};
  }
  // If an ongoing (non-finished) match is already active with a different ID, drop stale payload
  if (
    state.match?.id &&
    state.match.id !== data.matchId &&
    state.match.status !== MatchStatus.FINISHED &&
    !state.room?.currentMatchId
  ) {
    return {};
  }
  const isSameMatch = state.match?.id === data.matchId;

  // Prevent stale/repeated topic_voting_started for the same match from overwriting completed or advanced state
  if (
    isSameMatch &&
    state.match &&
    (state.topicVoting?.isFinished ||
      state.match.status === MatchStatus.FINISHED ||
      state.match.status === MatchStatus.ROUND_ACTIVE ||
      state.match.status === MatchStatus.ROUND_EVALUATING ||
      state.match.status === MatchStatus.ROUND_RESULT)
  ) {
    return {};
  }

  const initialCounts: Record<string, number> = {};
  for (const t of data.candidateTopics) {
    initialCounts[t] = 0;
  }

  return {
    room: state.room
      ? {
          ...state.room,
          currentMatchId: data.matchId,
          status: RoomStatus.IN_GAME,
        }
      : null,
    match:
      isSameMatch && state.match
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
      voteCounts: initialCounts,
      myVotedTopic: null,
      endsAt: data.endsAt,
      durationMs: data.durationMs,
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

export function applyTopicVoteErrorState(
  state: SocketState,
  data: { failedEvent?: string; commandId?: string },
): Partial<SocketState> {
  if (data.failedEvent !== ClientEvent.VOTE_BAN_TOPIC || !data.commandId) {
    return {};
  }

  let failedCmd: PendingTopicVoteCommand | null = null;

  for (const [matchId, cmds] of pendingTopicVoteCommandsByMatch.entries()) {
    const cmdIndex = cmds.findIndex((c) => c.commandId === data.commandId);
    if (cmdIndex !== -1) {
      [failedCmd] = cmds.splice(cmdIndex, 1);
      if (cmds.length === 0) {
        pendingTopicVoteCommandsByMatch.delete(matchId);
      }
      break;
    }
  }

  if (failedCmd) {
    const matchPending =
      pendingTopicVoteCommandsByMatch.get(failedCmd.matchId) ?? [];
    const hasRemainingMatchCmds = matchPending.length > 0;
    const recomputedTopic = getEffectiveTopicVote(failedCmd.matchId);

    if (!hasRemainingMatchCmds) {
      confirmedTopicVoteBaselineByMatch.delete(failedCmd.matchId);
    }

    if (state.topicVoting && state.topicVoting.matchId === failedCmd.matchId) {
      return {
        topicVoting: {
          ...state.topicVoting,
          myVotedTopic: recomputedTopic,
        },
      };
    }
  }

  return {};
}
