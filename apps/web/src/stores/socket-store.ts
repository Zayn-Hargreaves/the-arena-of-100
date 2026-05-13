// ============================================================
// Socket Store - Zustand
// Real-time WebSocket Connection Management
// ============================================================

import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import {
  ClientEvent,
  ServerEvent,
  type SnapshotPayload,
  type AnswerResultPayload,
} from "@arena/shared";

interface Player {
  id: string;
  name: string;
  status: string;
  score: number;
}

interface Room {
  id: string;
  code: string;
  status: string;
  players: Player[];
}

interface Match {
  id: string;
  status: string;
  currentRoundNo: number;
  players: Player[];
  currentQuestion: {
    id: string;
    content: string;
    options: string[];
  } | null;
  roundEndTime: number | null;
}

interface ConnectionState {
  isConnected: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
}

interface SocketState extends ConnectionState {
  socket: Socket | null;
  room: Room | null;
  match: Match | null;
  lastAnswerResult: AnswerResultPayload | null;
  error: string | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  authenticate: (token: string) => void;
  createRoom: (roomType: "PUBLIC" | "PRIVATE") => void;
  joinRoom: (roomCode: string) => void;
  leaveRoom: (roomId: string) => void;
  startMatch: (roomId: string) => void;
  submitAnswer: (matchId: string, roundNo: number, answer: string) => void;
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const useSocketStore = create<SocketState>((set, get) => ({
  // Initial state
  socket: null,
  isConnected: false,
  isAuthenticated: false,
  userId: null,
  username: null,
  room: null,
  match: null,
  lastAnswerResult: null,
  error: null,

  // Connect to WebSocket
  connect: () => {
    const { socket } = get();
    if (socket?.connected) return;

    const newSocket = io(`${API_URL}/game`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    newSocket.on("connect", () => {
      set({ isConnected: true, error: null });
      console.log("🔌 Connected to game server");
    });

    newSocket.on("disconnect", () => {
      set({ isConnected: false, isAuthenticated: false });
      console.log("🔌 Disconnected from game server");
    });

    newSocket.on(ServerEvent.AUTHENTICATED, (data) => {
      set({
        isAuthenticated: true,
        userId: data.userId,
        username: data.username,
      });
      console.log("✅ Authenticated:", data.username);
    });

    newSocket.on(ServerEvent.ROOM_CREATED, (data) => {
      set({
        room: {
          id: data.roomId,
          code: data.code,
          status: "WAITING",
          players: [],
        },
      });
      console.log("🏠 Room created:", data.code);
    });

    newSocket.on(ServerEvent.PLAYER_JOINED, (data) => {
      console.log("👤 Player joined:", data);
    });

    newSocket.on(ServerEvent.PLAYER_LEFT, (data) => {
      console.log("👤 Player left:", data);
    });

    newSocket.on(ServerEvent.MATCH_STARTING, (data) => {
      console.log("⚔️ Match starting:", data);
    });

    newSocket.on(ServerEvent.SNAPSHOT, (data: SnapshotPayload) => {
      set({
        match: {
          id: data.matchId,
          status: data.status,
          currentRoundNo: data.currentRoundNo,
          players: data.players as Player[],
          currentQuestion: data.currentQuestion,
          roundEndTime: data.roundEndTime,
        },
      });
      console.log("📸 Snapshot received");
    });

    newSocket.on(ServerEvent.ANSWER_RESULT, (data: AnswerResultPayload) => {
      set({ lastAnswerResult: data });
      console.log("✅ Answer result:", data);
    });

    newSocket.on(ServerEvent.ERROR, (data) => {
      set({ error: data.message });
      console.error("❌ Error:", data.message);
    });

    set({ socket: newSocket });
  },

  // Disconnect
  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({
        socket: null,
        isConnected: false,
        isAuthenticated: false,
        room: null,
        match: null,
      });
    }
  },

  // Authenticate
  authenticate: (token: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.AUTHENTICATE, { token });
    }
  },

  // Create Room
  createRoom: (roomType: "PUBLIC" | "PRIVATE") => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.CREATE_ROOM, { roomType });
    }
  },

  // Join Room
  joinRoom: (roomCode: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.JOIN_ROOM, { roomCode });
    }
  },

  // Leave Room
  leaveRoom: (roomId: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.LEAVE_ROOM, { roomId });
    }
  },

  // Start Match
  startMatch: (roomId: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.START_MATCH, { roomId });
    }
  },

  // Submit Answer
  submitAnswer: (matchId: string, roundNo: number, answer: string) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.SUBMIT_ANSWER, {
        matchId,
        roundNo,
        answer,
        clientTimestamp: Date.now(),
      });
    }
  },

  // Request Snapshot
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.REQUEST_SNAPSHOT, { matchId, lastSeenSeqNo });
    }
  },
}));
