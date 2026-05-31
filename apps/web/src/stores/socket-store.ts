// ============================================================
// Socket Store - Zustand
// Real-time WebSocket Connection Management
// ============================================================

import { create } from "zustand";
import type { Socket } from "socket.io-client";
import {
  ClientEvent,
  ServerEvent,
  type SnapshotPayload,
  type AnswerResultPayload,
  type RoomJoinedPayload,
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
  hostId?: string | null;
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
  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: (token: string) => void;
  createRoom: (config: {
    roomType: "PUBLIC" | "PRIVATE";
    timeLimit: number;
    maxPlayers: number;
    category: string;
  }) => void;
  joinRoom: (roomCode: string) => Promise<void>;
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
  connect: async () => {
    const { socket } = get();
    if (socket?.connected) return;

    const { io } = await import("socket.io-client");

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
          hostId: data.hostId ?? get().userId,
          players: [],
        },
      });
      console.log("🏠 Room created:", data.code);
    });

    newSocket.on(ServerEvent.ROOM_JOINED, (data: RoomJoinedPayload) => {
      set({
        room: {
          id: data.roomId,
          code: data.code,
          status: "WAITING",
          hostId:
            (data as RoomJoinedPayload & { hostId?: string }).hostId ?? null,
          players: data.players
            ? data.players.map((p) => ({
                id: p.playerId,
                name: p.playerName,
                status: "READY",
                score: 0,
              }))
            : [],
        },
      });
      console.log("🏠 Room joined:", data.code);
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
  createRoom: (config) => {
    const { socket } = get();
    if (socket) {
      socket.emit(ClientEvent.CREATE_ROOM, {
        roomType: config.roomType,
        maxPlayers: config.maxPlayers,
      });
    }
  },

  // Join Room
  joinRoom: (roomCode: string) => {
    const { socket } = get();
    if (!socket) {
      return Promise.reject(new Error("Socket not connected"));
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Join room timed out"));
      }, 8000);

      const onJoined = (data: RoomJoinedPayload) => {
        if (data.code !== roomCode) return;
        cleanup();
        resolve();
      };

      const onError = (data: { message: string }) => {
        cleanup();
        reject(new Error(data.message || "Failed to join room"));
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(ServerEvent.ROOM_JOINED, onJoined);
        socket.off(ServerEvent.ERROR, onError);
      };

      socket.on(ServerEvent.ROOM_JOINED, onJoined);
      socket.on(ServerEvent.ERROR, onError);
      socket.emit(ClientEvent.JOIN_ROOM, { roomCode });
    });
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
