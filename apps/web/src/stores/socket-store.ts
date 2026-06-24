// ============================================================
// Socket Store - Zustand
// Real-time WebSocket Connection Management
// ============================================================

import { create } from "zustand";
import {
  ClientEvent,
  ServerEvent,
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
  ErrorCode,
} from "@arena/shared";
import { API_URL } from "@/lib/api";
import type { AuthResponse, SocketState } from "./socket-store.types";
import {
  applyClearedTerminationState,
  emitIfConnected,
  requireSocket,
  waitForSocketAck,
} from "./socket-store.helpers";
import {
  applyAnswerResultState,
  applyAuthenticatedState,
  applyMatchFinishedState,
  applyMatchStartedState,
  applyMatchStartingState,
  applyPlayerEliminatedState,
  applyPlayerJoinedState,
  applyPlayerLeftState,
  applyRoomCountdownCancelledState,
  applyRoomCountdownStartedState,
  applyRoomCreatedState,
  applyRoomJoinedState,
  applyRoomPresenceUpdatedState,
  applyRoomStatusUpdatedState,
  applyRoomTerminatedState,
  applyRoundEndedState,
  applyRoundStartedState,
  applySnapshotState,
  applyUnauthorizedErrorState,
} from "./socket-store.updaters";

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
    const authPromise = waitForSocketAck<void>({
      socket: newSocket,
      successEvent: ServerEvent.AUTHENTICATED,
      timeoutMs: AUTH_TIMEOUT_MS,
      timeoutMessage: "Authentication timed out",
      mapSuccess: () => undefined,
      shouldRejectOnError: (data) =>
        data.code === ErrorCode.INVALID_TOKEN ||
        data.code === ErrorCode.UNAUTHORIZED,
      getErrorMessage: (data) => data.message,
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
      // Only reset state if this socket is still the active one.
      // A previous socket's delayed disconnect event must not
      // clobber the state of a newer connection.
      if (get().socket !== newSocket) return;
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
      set(applyAuthenticatedState(data));
      console.log("✅ Authenticated:", data.username);
    });

    newSocket.on(ServerEvent.ROOM_CREATED, (data: RoomCreatedPayload) => {
      set(applyRoomCreatedState(data));
      console.log("🏠 Room created:", data.code);
    });

    newSocket.on(ServerEvent.ROOM_JOINED, (data: RoomJoinedPayload) => {
      set(applyRoomJoinedState(data));
      console.log("🏠 Room joined:", data.code, "as", data.joinedAs);
    });

    newSocket.on(ServerEvent.PLAYER_JOINED, (data: RoomPlayerJoinedPayload) => {
      set((state) => applyPlayerJoinedState(state, data));
      console.log("👤 Player joined:", data);
    });

    newSocket.on(ServerEvent.PLAYER_LEFT, (data: RoomPlayerLeftPayload) => {
      set((state) => applyPlayerLeftState(state, data));
      console.log("👤 Player left:", data);
    });

    newSocket.on(
      ServerEvent.ROOM_STATUS_UPDATED,
      (data: RoomStatusUpdatedPayload) => {
        set((state) => applyRoomStatusUpdatedState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_STARTED,
      (data: RoomCountdownStartedPayload) => {
        set((state) => applyRoomCountdownStartedState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      (data: RoomCountdownCancelledPayload) => {
        set((state) => applyRoomCountdownCancelledState(state, data));
      },
    );

    newSocket.on(
      ServerEvent.ROOM_PRESENCE_UPDATED,
      (data: RoomPresenceUpdatedPayload) => {
        set((state) => applyRoomPresenceUpdatedState(state, data));
      },
    );

    newSocket.on(ServerEvent.MATCH_STARTING, (data) => {
      set((state) => applyMatchStartingState(state, data));
      console.log("⚔️ Match starting:", data);
    });

    newSocket.on(ServerEvent.MATCH_STARTED, (data) => {
      set((state) => applyMatchStartedState(state, data));
      console.log("🚀 Match started:", data);
    });

    newSocket.on(ServerEvent.ROUND_STARTED, (data: RoundStartedPayload) => {
      set((state) => applyRoundStartedState(state, data));
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
      set((state) => applyRoundEndedState(state, data, priorForThisRound));
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
        set((state) => applyPlayerEliminatedState(state, data));
        console.log("💀 Player eliminated:", data);
      },
    );

    newSocket.on(ServerEvent.MATCH_FINISHED, (data: MatchFinishedPayload) => {
      set((state) => applyMatchFinishedState(state, data));
      console.log("🏆 Match finished:", data);
    });

    newSocket.on(ServerEvent.SNAPSHOT, (data: SnapshotPayload) => {
      set((state) => applySnapshotState(state, data));
      console.log("📸 Snapshot received");
    });

    newSocket.on(ServerEvent.ANSWER_RESULT, (data: AnswerResultPayload) => {
      set(applyAnswerResultState(data));
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
      set(applyRoomTerminatedState(data));
      console.warn("🛑 Room terminated by server:", data);
    });

    newSocket.on(ServerEvent.ERROR, (data) => {
      // If unauthorized or invalid token, clear local auth state and
      // null the socket so the next connect() can reinitialize
      // (otherwise the connect guard would short-circuit on
      // socket.connected and skip re-auth). Also disconnect the socket
      // so dangling listeners and duplicate reconnects don't linger.
      // Only reset state if this socket is still the active one — a
      // stale socket's ERROR must not clobber a newer connection.
      if (
        data.code === ErrorCode.INVALID_TOKEN ||
        data.code === ErrorCode.UNAUTHORIZED
      ) {
        if (get().socket === newSocket) {
          set(applyUnauthorizedErrorState());
        }
        newSocket.disconnect();
      }
      if (get().socket === newSocket) {
        set({ error: data.message });
      }
      console.error("❌ Error:", data.message);
    });

    set({ socket: newSocket });

    try {
      await authPromise;
    } catch (error) {
      // Authentication failed or timed out — tear down the socket so
      // we don't leave dangling listeners or buffered events that
      // would fire on an automatic reconnect.
      newSocket.disconnect();
      throw error;
    }

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
  authenticate: async (nickname: string): Promise<void> => {
    const socket = requireSocket(get().socket);

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
          data.code === ErrorCode.INVALID_TOKEN ||
          data.code === ErrorCode.UNAUTHORIZED
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

          emitIfConnected(socket, ClientEvent.AUTHENTICATE, {
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
  createRoom: async (config) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<string, { roomId: string; code: string }>({
      socket,
      successEvent: ServerEvent.ROOM_CREATED,
      timeoutMs: 8000,
      timeoutMessage: "Create room timed out",
      mapSuccess: (data) => {
        applyClearedTerminationState(set, get);
        return data.code;
      },
      getErrorMessage: (data) => data.message || "Failed to create room",
    });

    emitIfConnected(socket, ClientEvent.CREATE_ROOM, {
      roomType: config.roomType,
      maxPlayers: config.maxPlayers,
      timeLimit: config.timeLimit,
      category: config.category,
    });

    return ack;
  },

  // Join Room
  joinRoom: async (roomCode: string) => {
    const socket = requireSocket(get().socket);

    const ack = waitForSocketAck<void, RoomJoinedPayload>({
      socket,
      successEvent: ServerEvent.ROOM_JOINED,
      timeoutMs: 8000,
      timeoutMessage: "Join room timed out",
      matchesSuccess: (data) => data.code === roomCode,
      mapSuccess: () => {
        applyClearedTerminationState(set, get);
      },
      getErrorMessage: (data) => data.message || "Failed to join room",
    });

    emitIfConnected(socket, ClientEvent.JOIN_ROOM, { roomCode });
    return ack;
  },

  // Leave Room
  leaveRoom: (roomId: string) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.LEAVE_ROOM, { roomId });
  },

  // Start Match
  startMatch: (roomId: string) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.START_MATCH, { roomId });
  },

  // Submit Answer
  submitAnswer: (matchId: string, roundNo: number, answer: string) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.SUBMIT_ANSWER, {
      matchId,
      roundNo,
      answer,
      clientTimestamp: Date.now(),
    });
  },

  // Request Snapshot
  requestSnapshot: (matchId: string, lastSeenSeqNo: number) => {
    const { socket } = get();
    emitIfConnected(socket, ClientEvent.REQUEST_SNAPSHOT, {
      matchId,
      lastSeenSeqNo,
    });
  },
}));
