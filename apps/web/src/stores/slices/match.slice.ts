import type { StateCreator } from "zustand";
import {
  ClientEvent,
  ServerEvent,
  type EliminationReason,
  type ErrorPayload,
  type SnapshotPayload,
} from "@arena/shared";
import { generateId } from "@/lib/id";
import type {
  LastAnswerResult,
  Match,
  PendingAnswer,
  SocketState,
  TopicVotingState,
} from "../socket-store.types";
import { debugLog, emitIfConnected } from "../socket-store.helpers";
import { applySnapshotState } from "../updaters/match.updaters";
import {
  applyConsumeSecondChance,
  hasSecondChance,
} from "../updaters/card.updaters";
import {
  confirmedTopicVoteBaselineByMatch,
  consumedSecondChanceBySubmissionId,
  getEffectiveTopicVote,
  pendingTopicVoteCommandsByMatch,
  type PendingTopicVoteCommand,
} from "../socket-store.state-maps";

export interface MatchSlice {
  match: Match | null;
  topicVoting: TopicVotingState | null;
  lastAnswerResult: LastAnswerResult | null;
  pendingAnswer: PendingAnswer | null;
  remainingCount: number | null;
  lastSeenSeqNo: number;
  isEliminated: boolean;
  eliminationReason: EliminationReason | null;
  roomTerminated: boolean;
  roomTerminationMessage: string | null;

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

export const createMatchSlice: StateCreator<SocketState, [], [], MatchSlice> = (
  set,
  get,
) => ({
  match: null,
  topicVoting: null,
  lastAnswerResult: null,
  pendingAnswer: null,
  remainingCount: null,
  lastSeenSeqNo: 0,
  isEliminated: false,
  eliminationReason: null,
  roomTerminated: false,
  roomTerminationMessage: null,

  voteBanTopic: (matchId: string, topic: string) => {
    const { socket, topicVoting } = get();
    if (!socket?.connected) return;

    const commandId = generateId();

    if (topicVoting && topicVoting.matchId === matchId) {
      const matchCmds = pendingTopicVoteCommandsByMatch.get(matchId) ?? [];

      if (
        !confirmedTopicVoteBaselineByMatch.has(matchId) ||
        matchCmds.length === 0
      ) {
        confirmedTopicVoteBaselineByMatch.set(
          matchId,
          topicVoting.myVotedTopic,
        );
      }

      const newCmd: PendingTopicVoteCommand = {
        commandId,
        matchId,
        topic,
      };
      matchCmds.push(newCmd);
      pendingTopicVoteCommandsByMatch.set(matchId, matchCmds);

      const effectiveTopic = getEffectiveTopicVote(matchId);

      set({
        topicVoting: {
          ...topicVoting,
          myVotedTopic: effectiveTopic,
        },
      });
    }

    emitIfConnected(socket, ClientEvent.VOTE_BAN_TOPIC, {
      matchId,
      topic,
      commandId,
    });
  },

  submitAnswer: (matchId: string, roundNo: number, answer: string) => {
    const { socket, pendingAnswer, cardState, userId, lastAnswerResult } =
      get();
    if (!socket?.connected) return null;

    const hasExistingSubmission =
      (pendingAnswer?.matchId === matchId &&
        pendingAnswer.roundNo === roundNo) ||
      (lastAnswerResult?.matchId === matchId &&
        lastAnswerResult.roundNo === roundNo);

    const currentUserId = userId;
    const hasSecondChancePermission = hasSecondChance(
      cardState,
      currentUserId,
      roundNo,
    );

    if (hasExistingSubmission && !hasSecondChancePermission) {
      return null;
    }

    const submissionId = generateId();
    if (hasExistingSubmission) {
      consumedSecondChanceBySubmissionId.set(submissionId, {
        matchId,
        cardState: get().cardState,
      });
    }
    set((state) => ({
      ...(hasExistingSubmission
        ? applyConsumeSecondChance(state, currentUserId ?? undefined)
        : {}),
      pendingAnswer: { matchId, roundNo, answer, submissionId },
    }));

    emitIfConnected(socket, ClientEvent.SUBMIT_ANSWER, {
      matchId,
      roundNo,
      answer,
      submissionId,
      clientTimestamp: Date.now(),
    });
    return submissionId;
  },

  requestSnapshot: (
    matchId: string,
    lastSeenSeqNo: number,
    fallbackSnapshot?: SnapshotPayload,
  ) => {
    const socket = get().socket;
    if (!socket) return;

    emitIfConnected(socket, ClientEvent.REQUEST_SNAPSHOT, {
      matchId,
      lastSeenSeqNo,
    });

    if (!fallbackSnapshot) return;

    const TIMEOUT_MS = 5000;
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      socket.off(ServerEvent.EVENT_BATCH, handleMatchEvent);
      socket.off(ServerEvent.SNAPSHOT, handleMatchEvent);
      socket.off(ServerEvent.ERROR, handleError);
      socket.off("disconnect", handleDisconnect);
    };

    const applyFallback = () => {
      if (resolved) return;
      cleanup();

      // Ignore fallback from a previous socket generation after reconnect churn.
      if (get().socket !== socket) return;

      const currentMatch = get().match;
      if (currentMatch?.id === matchId) {
        set((state) => applySnapshotState(state, fallbackSnapshot));
        console.warn(
          `⚠️ Delta request failed or timed out. Hydrated fallback snapshot for match: ${matchId}`,
        );
      }
    };

    const handleMatchEvent = (data: { matchId: string }) => {
      if (get().socket !== socket) return;
      if (data.matchId === matchId) {
        cleanup();
      }
    };

    const handleError = (data: ErrorPayload) => {
      if (get().socket !== socket) return;
      // Only fall back on errors tied to this snapshot request.
      // Unrelated ERRORs (e.g. SUBMIT_ANSWER) must not clobber match state.
      if (data.failedEvent === ClientEvent.REQUEST_SNAPSHOT) {
        applyFallback();
      }
    };

    const handleDisconnect = () => {
      if (get().socket !== socket) {
        cleanup();
        return;
      }
      applyFallback();
    };

    socket.on(ServerEvent.EVENT_BATCH, handleMatchEvent);
    socket.on(ServerEvent.SNAPSHOT, handleMatchEvent);
    socket.on(ServerEvent.ERROR, handleError);
    socket.on("disconnect", handleDisconnect);

    timeoutId = setTimeout(() => {
      if (!resolved) {
        debugLog(
          `⏱️ Delta request for match ${matchId} timed out after ${TIMEOUT_MS}ms.`,
        );
        applyFallback();
      }
    }, TIMEOUT_MS);
  },
});
