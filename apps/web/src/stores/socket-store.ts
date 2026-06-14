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
  type JoinMode,
  type RoomCreatedPayload,
  type SnapshotPayload,
  type AnswerResultPayload,
  type ErrorPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  type RoomCountdownStartedPayload,
  type RoomCountdownCancelledPayload,
  type RoomPresenceUpdatedPayload,
  type RoomStatusUpdatedPayload,
  type RoomTerminatedPayload,
  type RoundStartedPayload,
  type RoundEndedPayload,
  type MatchFinishedPayload,
  type PlayerEliminatedPayload,
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

export interface Player {
  id: string;
  name: string;
  status: string;
  score: number;
  isOnline: boolean;
}

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  hostId: string | null;
  roomType?: "PUBLIC" | "PRIVATE";
  currentMatchId?: string | null;
  countdownEndsAt?: number | null;
  players: Player[];
  // Drop-in spectating baseline: which role the current socket joined
  // as. PLAYER = the user is a participant in the match. SPECTATOR =
  // the user is a read-only late-joiner (joined an IN_GAME or FINISHED
  // room). The lobby and game pages read this to render the spectator
  // UI and to block answer submission on the client side (the server
  // still enforces the gate independently).
  joinMode: JoinMode;
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

function mapRoomPlayersToMatchPlayers(players: Player[]): Player[] {
  return players.map((player) => ({
    ...player,
  }));
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
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  isEliminated: boolean;
  roomTerminated: boolean;
  roomTerminationMessage: string | null;

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
  heartbeatInterval: null,
  isEliminated: false,
  roomTerminated: false,
  roomTerminationMessage: null,

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
      // Clear heartbeat on unexpected socket disconnects (network drop, server
      // restart) so we never leave orphaned intervals running. A reconnection
      // (connect() called again) will create a fresh interval below.
      const { heartbeatInterval: hb } = get();
      if (hb) {
        clearInterval(hb);
      }
      set({
        isConnected: false,
        isAuthenticated: false,
        heartbeatInterval: null,
      });
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

    newSocket.on(ServerEvent.ROOM_CREATED, (data: RoomCreatedPayload) => {
      set({
        room: {
          id: data.roomId,
          code: data.code,
          status: data.roomStatus,
          hostId: data.hostId,
          roomType: data.roomType,
          currentMatchId: data.currentMatchId,
          countdownEndsAt: null,
          // The host is always a player.
          joinMode: data.joinedAs ?? "PLAYER",
          players: data.players.map((player) => ({
            id: player.playerId,
            name: player.playerName,
            status: "READY",
            score: 0,
            isOnline: player.isOnline,
          })),
        },
      });
      console.log("🏠 Room created:", data.code);
    });

    newSocket.on(ServerEvent.ROOM_JOINED, (data: RoomJoinedPayload) => {
      set({
        isEliminated: false,
        room: {
          id: data.roomId,
          code: data.code,
          status: data.roomStatus,
          hostId: data.hostId,
          roomType: data.roomType,
          currentMatchId: data.currentMatchId,
          countdownEndsAt: data.countdownEndsAt,
          // Default to PLAYER for legacy servers that may not include
          // the field, then override with whatever the server sent.
          joinMode: data.joinedAs ?? "PLAYER",
          players: data.players.map((player) => ({
            id: player.playerId,
            name: player.playerName,
            status: "READY",
            score: 0,
            isOnline: player.isOnline,
          })),
        },
      });
      console.log("🏠 Room joined:", data.code, "as", data.joinedAs);
    });

    newSocket.on(ServerEvent.PLAYER_JOINED, (data: RoomPlayerJoinedPayload) => {
      set((state) => {
        if (!state.room || state.room.id !== data.roomId) {
          return state;
        }

        const hasPlayer = state.room.players.some(
          (player) => player.id === data.playerId,
        );
        if (hasPlayer) {
          return {
            room: {
              ...state.room,
              players: state.room.players.map((player) =>
                player.id === data.playerId
                  ? {
                      ...player,
                      name: data.playerName,
                      isOnline: data.isOnline,
                    }
                  : player,
              ),
            },
          };
        }

        return {
          room: {
            ...state.room,
            players: [
              ...state.room.players,
              {
                id: data.playerId,
                name: data.playerName,
                status: "READY",
                score: 0,
                isOnline: data.isOnline,
              },
            ],
          },
        };
      });
      console.log("👤 Player joined:", data);
    });

    newSocket.on(ServerEvent.PLAYER_LEFT, (data: RoomPlayerLeftPayload) => {
      set((state) => {
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
      });
      console.log("👤 Player left:", data);
    });

    newSocket.on(
      ServerEvent.ROOM_STATUS_UPDATED,
      (data: RoomStatusUpdatedPayload) => {
        set((state) => {
          if (!state.room || state.room.id !== data.roomId) {
            return state;
          }

          return {
            room: {
              ...state.room,
              status: data.roomStatus,
              currentMatchId: data.currentMatchId,
              countdownEndsAt:
                data.roomStatus === RoomStatus.COUNTDOWN
                  ? (state.room.countdownEndsAt ?? null)
                  : null,
            },
          };
        });
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_STARTED,
      (data: RoomCountdownStartedPayload) => {
        set((state) => {
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
        });
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      (data: RoomCountdownCancelledPayload) => {
        set((state) => {
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
        });
      },
    );

    newSocket.on(
      ServerEvent.ROOM_PRESENCE_UPDATED,
      (data: RoomPresenceUpdatedPayload) => {
        set((state) => {
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
        });
      },
    );

    newSocket.on(ServerEvent.MATCH_STARTING, (data) => {
      set((state) => ({
        remainingCount: null,
        lastAnswerResult: null,
        room: state.room
          ? {
              ...state.room,
              status: RoomStatus.STARTING,
              currentMatchId: data.matchId,
              countdownEndsAt: null,
            }
          : null,
      }));
      console.log("⚔️ Match starting:", data);
    });

    newSocket.on(ServerEvent.MATCH_STARTED, (data) => {
      set((state) => ({
        isEliminated: false,
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
          players: mapRoomPlayersToMatchPlayers(state.room?.players ?? []),
          currentQuestion: null,
          roundEndTime: null,
        },
      }));
      console.log("🚀 Match started:", data);
    });

    newSocket.on(ServerEvent.ROUND_STARTED, (data: RoundStartedPayload) => {
      set((state) => ({
        match: state.match
          ? {
              ...state.match,
              status: "ROUND_ACTIVE",
              currentRoundNo: data.roundNo,
              currentQuestion: data.question,
              roundEndTime: data.endsAt,
            }
          : {
              id: data.matchId,
              status: "ROUND_ACTIVE",
              currentRoundNo: data.roundNo,
              players: mapRoomPlayersToMatchPlayers(state.room?.players ?? []),
              currentQuestion: data.question,
              roundEndTime: data.endsAt,
            },
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

      // F1 fix: cross-check the server's `eliminatedPlayerIds` array
      // and stamp `status = "ELIMINATED"` on each player in
      // `match.players`. The previous sidebar rendered a hardcoded
      // list of mock opponents (`Zero_Cool`, `Acid_Burn`, …) that
      // was a flat-out deception to the user. Now the sidebar reads
      // from `match.players` and reflects actual server-side
      // elimination state. We use an immutable map update so React
      // re-renders on player status changes.
      set((state) => {
        const eliminatedSet = new Set(data.eliminatedPlayerIds);
        const updatedPlayers = state.match?.players.map((player) =>
          eliminatedSet.has(player.id)
            ? { ...player, status: "ELIMINATED" as const }
            : player,
        );
        return {
          match: state.match
            ? {
                ...state.match,
                players: updatedPlayers ?? state.match.players,
                status: "ROUND_RESULT",
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
        };
      });
      console.log("🏁 Round ended:", data);
    });

    newSocket.on(
      ServerEvent.PLAYER_ELIMINATED,
      (data: PlayerEliminatedPayload) => {
        const currentState = get();
        if (data.playerId === currentState.userId) {
          set({ isEliminated: true });
        }
        // F1 fix: stamp `status = "ELIMINATED"` on the affected
        // player in `match.players` so the sidebar / opponents
        // list can render the correct badge without waiting for
        // the ROUND_ENDED broadcast (which carries the full
        // `eliminatedPlayerIds` array). This is a real-time
        // mirror of the per-player event.
        set((state) => {
          if (!state.match) return state;
          const updatedPlayers = state.match.players.map((player) =>
            player.id === data.playerId
              ? { ...player, status: "ELIMINATED" as const }
              : player,
          );
          return { match: { ...state.match, players: updatedPlayers } };
        });
        console.log("💀 Player eliminated:", data);
      },
    );

    newSocket.on(ServerEvent.MATCH_FINISHED, (data: MatchFinishedPayload) => {
      set((state) => ({
        room: state.room
          ? {
              ...state.room,
              status: RoomStatus.FINISHED,
              countdownEndsAt: null,
            }
          : null,
        match: state.match
          ? {
              ...state.match,
              status: "FINISHED",
            }
          : state.match,
      }));
      console.log("🏆 Match finished:", data);
    });

    newSocket.on(ServerEvent.SNAPSHOT, (data: SnapshotPayload) => {
      set((state) => ({
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
          currentRoundNo: data.currentRoundNo,
          players: (data.players as Player[]).map((player) => ({
            ...player,
            isOnline: player.isOnline ?? true,
          })),
          currentQuestion: data.currentQuestion,
          roundEndTime: data.roundEndTime,
        },
        remainingCount: null,
        lastAnswerResult: null,
      }));
      console.log("📸 Snapshot received");
    });

    newSocket.on(ServerEvent.ANSWER_RESULT, (data: AnswerResultPayload) => {
      set({ lastAnswerResult: data });
      console.log("✅ Answer result:", data);
    });

    // Admin kill-switch: server has force-terminated this room (and any
    // active match in it). Clear local room/match state and surface a
    // termination flag so the lobby page can redirect + toast. We do NOT
    // auto-redirect here — page-level navigation needs the i18n router.
    // `isEliminated` is also reset: a previous match's elimination state
    // must not leak into the next room after a forced restart, otherwise
    // the spectator/ELIMINATED UI would persist on reconnect/join.
    newSocket.on(ServerEvent.ROOM_TERMINATED, (data: RoomTerminatedPayload) => {
      set({
        room: null,
        match: null,
        remainingCount: null,
        lastAnswerResult: null,
        isEliminated: false,
        roomTerminated: true,
        roomTerminationMessage: data.message ?? null,
      });
      console.warn("🛑 Room terminated by server:", data);
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

    // Start heartbeat interval (every 10 seconds)
    const currentState = get();
    if (currentState.heartbeatInterval) {
      clearInterval(currentState.heartbeatInterval);
    }
    const interval = setInterval(() => {
      const state = get();
      if (state.socket?.connected && state.room?.id) {
        state.socket.emit(ClientEvent.HEARTBEAT, {
          roomId: state.room.id,
          sentAt: Date.now(),
        });
      }
    }, 10000);

    set({ heartbeatInterval: interval });
  },

  // Disconnect
  disconnect: () => {
    const { socket, heartbeatInterval } = get();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
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
        heartbeatInterval: null,
        roomTerminated: false,
        roomTerminationMessage: null,
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

      const onCreated = (data: { roomId: string; code: string }) => {
        cleanup();
        // Clear stale termination flag — user is now in a fresh room.
        const { roomTerminated, roomTerminationMessage } = get();
        if (roomTerminated || roomTerminationMessage) {
          set({ roomTerminated: false, roomTerminationMessage: null });
        }
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
        // Clear stale termination flag — user is now in a fresh room.
        const { roomTerminated, roomTerminationMessage } = get();
        if (roomTerminated || roomTerminationMessage) {
          set({ roomTerminated: false, roomTerminationMessage: null });
        }
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
