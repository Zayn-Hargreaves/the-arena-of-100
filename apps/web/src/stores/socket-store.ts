// ============================================================
// Socket Store - Zustand
// Real-time WebSocket Connection Management
// ============================================================

import { create } from "zustand";
import type { Socket } from "socket.io-client";
import {
  ClientEvent,
  ServerEvent,
  RoomStatus,
  type SnapshotPayload,
  type AnswerResultPayload,
  type ErrorPayload,
  type RoomJoinedPayload,
  type RoundStartedPayload,
  type RoundEndedPayload,
  type MatchFinishedPayload,
} from "@arena/shared";
import { API_URL } from "@/lib/api";

interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
}

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

interface LastAnswerResult {
  matchId: string;
  roundNo: number;
  isCorrect?: boolean;
  responseTimeMs?: number;
  correctAnswer?: string;
}

interface ConnectionState {
  isConnected: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  accessToken: string | null;
  userRole: string | null;
}

interface SocketState extends ConnectionState {
  socket: Socket | null;
  room: Room | null;
  match: Match | null;
  lastAnswerResult: LastAnswerResult | null;
  remainingCount: number | null;
  error: string | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  authenticate: (nickname: string) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  createRoom: (config: {
    roomType: "PUBLIC" | "PRIVATE";
    timeLimit: number;
    maxPlayers: number;
    category: string;
  }) => Promise<string>;
  joinRoom: (roomCode: string) => Promise<void>;
  leaveRoom: (roomId: string) => void;
  startMatch: (roomId: string) => void;
  submitAnswer: (matchId: string, roundNo: number, answer: string) => void;
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  // Initial state
  socket: null,
  isConnected: false,
  isAuthenticated: false,
  userId: null,
  username: null,
  accessToken: null,
  userRole: null,
  room: null,
  match: null,
  lastAnswerResult: null,
  remainingCount: null,
  error: null,

  // Connect to WebSocket
  connect: async () => {
    const state = get();
    // socket.connected only proves the WS handshake succeeded, not that
    // authentication completed. On auth failure the socket can be left
    // in a connected-but-unauthenticated state, so require the auth
    // flag as well — otherwise AppShellLayout's retry logic (which only
    // checks !isConnected) would be permanently bypassed.
    if (state.socket?.connected && state.isAuthenticated) return;

    const { io } = await import("socket.io-client");

    const newSocket = io(`${API_URL}/game`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    // Resolve only when the socket is both connected AND the server has
    // acknowledged authentication, so callers' `await connect()` guarantees
    // a ready/authenticated socket before invoking createRoom/joinRoom.
    const AUTH_TIMEOUT_MS = 5000;
    const authPromise = new Promise<void>((resolve, reject) => {
      const onAuthenticated = () => {
        clearTimeout(timeoutId);
        newSocket.off(ServerEvent.AUTHENTICATED, onAuthenticated);
        newSocket.off(ServerEvent.ERROR, onAuthError);
        resolve();
      };

      const onAuthError = (data: ErrorPayload) => {
        if (
          data.message === "Invalid or expired token" ||
          data.message === "Unauthorized"
        ) {
          clearTimeout(timeoutId);
          newSocket.off(ServerEvent.AUTHENTICATED, onAuthenticated);
          newSocket.off(ServerEvent.ERROR, onAuthError);
          reject(new Error(data.message));
        }
      };

      const timeoutId = setTimeout(() => {
        newSocket.off(ServerEvent.AUTHENTICATED, onAuthenticated);
        newSocket.off(ServerEvent.ERROR, onAuthError);
        reject(new Error("Authentication timed out"));
      }, AUTH_TIMEOUT_MS);

      newSocket.once(ServerEvent.AUTHENTICATED, onAuthenticated);
      newSocket.on(ServerEvent.ERROR, onAuthError);
    });

    newSocket.on("connect", () => {
      set({ isConnected: true, error: null });
      console.log("🔌 Connected to game server");

      const stateToken = get().accessToken;
      if (stateToken) {
        newSocket.emit(ClientEvent.AUTHENTICATE, { token: stateToken });
        return;
      }

      void get()
        .refreshAccessToken()
        .then((token) => {
          if (!token) {
            set({ error: "Failed to obtain access token" });
            return;
          }
          newSocket.emit(ClientEvent.AUTHENTICATE, { token });
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to refresh access token";
          set({ error: message });
          console.error("❌ Token refresh error:", err);
        });
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
          status: RoomStatus.WAITING,
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
          status: RoomStatus.WAITING,
          hostId: data.hostId ?? null,
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
      set({ remainingCount: null, lastAnswerResult: null });
      console.log("⚔️ Match starting:", data);
    });

    newSocket.on(ServerEvent.ROUND_STARTED, (data: RoundStartedPayload) => {
      set((state) => ({
        match: state.match
          ? {
              ...state.match,
              currentRoundNo: data.roundNo,
              currentQuestion: data.question,
              roundEndTime: data.endsAt,
            }
          : null,
        lastAnswerResult: null,
      }));
      console.log("⏱️ Round started:", data);
    });

    newSocket.on(ServerEvent.ROUND_ENDED, (data: RoundEndedPayload) => {
      const prev = get().lastAnswerResult;
      const priorForThisRound =
        prev && prev.matchId === data.matchId && prev.roundNo === data.roundNo
          ? prev
          : null;

      set((state) => ({
        match: state.match
          ? {
              ...state.match,
              roundEndTime: null, // Reset round end time
            }
          : null,
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
      }));
      console.log("🏁 Round ended:", data);
    });

    newSocket.on(ServerEvent.MATCH_FINISHED, (data: MatchFinishedPayload) => {
      console.log("🏆 Match finished:", data);
      // TODO: Navigate to results page - this would be handled by the UI component
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
        remainingCount: null,
        lastAnswerResult: null,
      });
      console.log("📸 Snapshot received");
    });

    newSocket.on(ServerEvent.ANSWER_RESULT, (data: AnswerResultPayload) => {
      set({ lastAnswerResult: data });
      console.log("✅ Answer result:", data);
    });

    newSocket.on(ServerEvent.ERROR, (data) => {
      // If unauthorized or invalid token, clear local auth state and
      // null the socket so the next connect() can reinitialize
      // (otherwise the connect guard would short-circuit on
      // socket.connected and skip re-auth).
      if (
        data.message === "Invalid or expired token" ||
        data.message === "Unauthorized"
      ) {
        set({
          socket: null,
          isConnected: false,
          isAuthenticated: false,
          accessToken: null,
          userRole: null,
          userId: null,
          username: null,
        });
      }
      set({ error: data.message });
      console.error("❌ Error:", data.message);
    });

    set({ socket: newSocket });

    await authPromise;
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
        userId: null,
        username: null,
        accessToken: null,
        userRole: null,
        room: null,
        match: null,
        remainingCount: null,
        lastAnswerResult: null,
      });
    }
  },

  refreshAccessToken: async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        set({
          accessToken: null,
          isAuthenticated: false,
          userId: null,
          username: null,
          userRole: null,
        });
        return null;
      }

      const data = (await response.json()) as AuthResponse;

      set({
        accessToken: data.accessToken,
        userId: data.user.id,
        username: data.user.username,
        userRole: data.user.role,
      });

      return data.accessToken;
    } catch {
      set({
        accessToken: null,
        isAuthenticated: false,
        userId: null,
        username: null,
        userRole: null,
      });
      return null;
    }
  },

  // Authenticate
  authenticate: (nickname: string): Promise<void> => {
    const { socket } = get();
    if (!socket) {
      return Promise.reject(new Error("Socket not connected"));
    }

    const AUTH_TIMEOUT_MS = 5000;

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(ServerEvent.AUTHENTICATED, onAuthenticated);
        socket.off(ServerEvent.ERROR, onAuthError);
      };

      const onAuthenticated = () => {
        cleanup();
        resolve();
      };

      const onAuthError = (data: ErrorPayload) => {
        if (
          data.message === "Invalid or expired token" ||
          data.message === "Unauthorized"
        ) {
          cleanup();
          reject(new Error(data.message));
        }
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Authentication timed out"));
      }, AUTH_TIMEOUT_MS);

      socket.on(ServerEvent.AUTHENTICATED, onAuthenticated);
      socket.on(ServerEvent.ERROR, onAuthError);

      void (async () => {
        try {
          const response = await fetch(`${API_URL}/auth/guest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username: nickname }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || "Authentication failed");
          }

          const data = (await response.json()) as AuthResponse;

          set({
            accessToken: data.accessToken,
            userRole: data.user.role,
          });

          socket.emit(ClientEvent.AUTHENTICATE, {
            token: data.accessToken,
          });
        } catch (err) {
          cleanup();
          const message =
            err instanceof Error ? err.message : "Failed to authenticate";
          set({ error: message });
          console.error("❌ Authentication error:", err);
          reject(err instanceof Error ? err : new Error(message));
        }
      })();
    });
  },

  // Create Room
  createRoom: (config) => {
    const { socket } = get();
    if (!socket) {
      return Promise.reject(new Error("Socket not connected"));
    }

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Create room timed out"));
      }, 8000);

      const onCreated = (data: {
        roomId: string;
        code: string;
        hostId?: string;
      }) => {
        cleanup();
        set({
          room: {
            id: data.roomId,
            code: data.code,
            status: RoomStatus.WAITING,
            hostId: data.hostId ?? get().userId,
            players: [],
          },
        });
        resolve(data.code);
      };

      const onError = (data: ErrorPayload) => {
        cleanup();
        reject(new Error(data.message || "Failed to create room"));
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off(ServerEvent.ROOM_CREATED, onCreated);
        socket.off(ServerEvent.ERROR, onError);
      };

      socket.on(ServerEvent.ROOM_CREATED, onCreated);
      socket.on(ServerEvent.ERROR, onError);

      socket.emit(ClientEvent.CREATE_ROOM, {
        roomType: config.roomType,
        maxPlayers: config.maxPlayers,
        timeLimit: config.timeLimit,
        category: config.category,
      });
    });
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

      const onError = (data: ErrorPayload) => {
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
