import {
  createInitialCardState,
  type SocketState,
} from "../socket-store.types";

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

export function applyUnauthorizedErrorState(
  errorMessage: string | null,
  state: SocketState,
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
    cardState: createInitialCardState(),
    topicVoting: null,
    remainingCount: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    isEliminated: false,
    eliminationReason: null,
    heartbeatInterval: null,
    roomTerminated: false,
    roomTerminationMessage: null,
    lastSeenSeqNo: 0,
    matchmaking: {
      isQueued: false,
      queuedAt: null,
      elapsedSeconds: 0,
      estimatedWaitSeconds: 0,
      playersInQueue: 0,
      matchedRoomCode: state.matchmaking.matchedRoomCode,
      matchedRoomId: state.matchmaking.matchedRoomId,
      matchedMatchId: state.matchmaking.matchedMatchId,
    },
    error: errorMessage,
  };
}
