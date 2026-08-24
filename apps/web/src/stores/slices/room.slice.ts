import type { StateCreator } from "zustand";
import {
  ClientEvent,
  ServerEvent,
  type RoomJoinedPayload,
  type RoomType,
} from "@arena/shared";
import {
  createInitialCardState,
  type MatchmakingState,
  type Room,
  type SocketState,
} from "../socket-store.types";
import {
  applyClearedTerminationState,
  emitIfConnected,
  requireSocket,
  waitForSocketAck,
} from "../socket-store.helpers";
import {
  clearCardCommandState,
  clearTopicVoteState,
} from "../socket-store.state-maps";

function getMatchLeavingResetState(): Partial<SocketState> {
  return {
    room: null,
    match: null,
    cardState: createInitialCardState(),
    topicVoting: null,
    lastAnswerResult: null,
    pendingAnswer: null,
    remainingCount: null,
    lastSeenSeqNo: 0,
    isEliminated: false,
    eliminationReason: null,
    roomTerminated: false,
    roomTerminationMessage: null,
  };
}

export interface RoomSlice {
  room: Room | null;
  matchmaking: MatchmakingState;

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
}

export const createRoomSlice: StateCreator<SocketState, [], [], RoomSlice> = (
  set,
  get,
) => ({
  room: null,
  matchmaking: {
    isQueued: false,
    queuedAt: null,
    elapsedSeconds: 0,
    estimatedWaitSeconds: 0,
    playersInQueue: 0,
    matchedRoomCode: null,
    matchedRoomId: null,
    matchedMatchId: null,
  },

  createRoom: async (config) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<string, { roomId: string; code: string }>({
      socket,
      successEvent: ServerEvent.ROOM_CREATED,
      timeoutMs: 8000,
      timeoutMessage: "Create room timed out",
      mapSuccess: (data) => data.code,
      getErrorMessage: (data) => data.message || "Failed to create room",
    });

    emitIfConnected(socket, ClientEvent.CREATE_ROOM, {
      roomType: config.roomType,
      maxPlayers: config.maxPlayers,
      timeLimit: config.timeLimit,
      category: config.category,
    });

    const code = await ack;
    applyClearedTerminationState(set, get);
    return code;
  },

  joinRoom: async (roomCode: string) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<void, RoomJoinedPayload>({
      socket,
      successEvent: ServerEvent.ROOM_JOINED,
      timeoutMs: 8000,
      timeoutMessage: "Join room timed out",
      matchesSuccess: (data) => data.code === roomCode,
      mapSuccess: () => undefined,
      getErrorMessage: (data) => data.message || "Failed to join room",
    });

    emitIfConnected(socket, ClientEvent.JOIN_ROOM, { roomCode });
    await ack;
    applyClearedTerminationState(set, get);
  },

  leaveRoom: (roomId: string) => {
    const { socket } = get();
    clearTopicVoteState();
    clearCardCommandState();
    emitIfConnected(socket, ClientEvent.LEAVE_ROOM, { roomId });
    set(getMatchLeavingResetState());
  },

  startMatch: (roomId: string) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.START_MATCH, { roomId });
  },

  joinMatchmaking: (category?: string) => {
    const socket = get().socket;
    if (!socket?.connected) {
      set({ error: "Socket is not connected" });
      return;
    }
    clearTopicVoteState();
    clearCardCommandState();
    set(getMatchLeavingResetState());
    emitIfConnected(socket, ClientEvent.JOIN_MATCHMAKING, {
      category: category && category !== "ALL" ? category : undefined,
    });
  },

  leaveMatchmaking: () => {
    clearTopicVoteState();
    clearCardCommandState();
    const socket = get().socket;
    if (socket?.connected) {
      emitIfConnected(socket, ClientEvent.LEAVE_MATCHMAKING, {});
    }
    set((state) => ({
      cardState: createInitialCardState(),
      matchmaking: {
        ...state.matchmaking,
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 0,
        playersInQueue: 0,
        matchedRoomCode: null,
        matchedRoomId: null,
        matchedMatchId: null,
      },
    }));
  },

  clearMatchmakingMatched: () => {
    set((state) => ({
      matchmaking: {
        ...state.matchmaking,
        matchedRoomCode: null,
        matchedRoomId: null,
        matchedMatchId: null,
      },
    }));
  },
});
