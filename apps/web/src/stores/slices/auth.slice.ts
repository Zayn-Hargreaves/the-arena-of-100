import type { StateCreator } from "zustand";
import { ClientEvent } from "@arena/shared";
import { apiFetch } from "@/lib/api";
import { parseErrorPayload } from "@/lib/api-client";
import type { AuthResponse, SocketState } from "../socket-store.types";
import {
  emitIfConnected,
  requireSocket,
  waitForAuthAck,
} from "../socket-store.helpers";

export interface AuthSlice {
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  accessToken: string | null;
  userRole: string | null;

  authenticate: (nickname: string) => Promise<void>;
  updateAuth: (auth: {
    accessToken: string;
    userId: string;
    username: string;
    userRole: string;
  }) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

export const createAuthSlice: StateCreator<SocketState, [], [], AuthSlice> = (
  set,
  get,
) => ({
  isAuthenticated: false,
  userId: null,
  username: null,
  accessToken: null,
  userRole: null,

  refreshAccessToken: async () => {
    try {
      const response = await apiFetch("/api/v1/auth/refresh", {
        method: "POST",
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

      const raw = (await response.json()) as {
        data?: AuthResponse;
      } & AuthResponse;
      const data = raw.data || raw;

      if (!data.user) {
        throw new Error("Invalid authentication response");
      }

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

  updateAuth: async (auth: {
    accessToken: string;
    userId: string;
    username: string;
    userRole: string;
  }): Promise<void> => {
    set({
      accessToken: auth.accessToken,
      userId: auth.userId,
      username: auth.username,
      userRole: auth.userRole,
      isAuthenticated: false,
    });

    const socket = get().socket;
    if (socket?.connected) {
      const ack = waitForAuthAck(socket);

      socket.emit(ClientEvent.AUTHENTICATE, { token: auth.accessToken });
      try {
        await ack;
        if (get().socket === socket) {
          set({ isAuthenticated: true });
        }
      } catch (err) {
        if (get().socket === socket) {
          socket.disconnect();
        }
        throw err;
      }
    } else {
      await get().connect();
    }
  },

  authenticate: async (nickname: string): Promise<void> => {
    requireSocket(get().socket);

    let guestSecret: string | null = null;
    let storedAvatar: string | null = null;
    if (typeof window !== "undefined") {
      try {
        guestSecret = localStorage.getItem(`guestSecret:${nickname.trim()}`);
        storedAvatar = localStorage.getItem("avatarSeed");
      } catch {
        // ignore storage error
      }
    }

    let token: string;
    try {
      const response = await apiFetch("/api/v1/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: nickname,
          guestSecret: guestSecret || undefined,
          avatar: storedAvatar || undefined,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Authentication failed";
        try {
          const errorData = await response.json();
          const parsed = parseErrorPayload(errorData);
          if (parsed) {
            errorMessage = parsed;
          }
        } catch {
          // Ignore JSON parse failure
        }
        throw new Error(errorMessage);
      }

      const raw = (await response.json()) as {
        data?: AuthResponse;
      } & AuthResponse;
      const data = raw.data || raw;

      if (!data.user) {
        throw new Error("Invalid authentication response");
      }

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("userId", data.user.id);
          localStorage.setItem("callsign", data.user.username);
          if (data.guestSecret) {
            const trimmedNickname = nickname.trim();
            if (trimmedNickname) {
              localStorage.setItem(
                `guestSecret:${trimmedNickname}`,
                data.guestSecret,
              );
            }
            if (data.user.username && data.user.username !== trimmedNickname) {
              localStorage.setItem(
                `guestSecret:${data.user.username}`,
                data.guestSecret,
              );
            }
          }
        } catch {
          // ignore storage error
        }
      }

      set({
        accessToken: data.accessToken,
        userId: data.user.id,
        username: data.user.username,
        userRole: data.user.role,
      });
      token = data.accessToken;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to authenticate";
      set({ error: message });
      console.error("❌ Authentication error:", err);
      throw err instanceof Error ? err : new Error(message);
    }

    const socket = requireSocket(get().socket);

    const ack = waitForAuthAck(socket);

    emitIfConnected(socket, ClientEvent.AUTHENTICATE, {
      token,
    });

    try {
      await ack;
    } catch (err) {
      if (get().socket === socket) {
        socket.disconnect();
      }
      throw err;
    }
  },
});
