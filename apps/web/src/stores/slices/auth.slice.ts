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

function getStoredGuestCredentials(nickname: string): {
  guestSecret?: string;
  avatar?: string;
} {
  if (typeof window === "undefined") return {};
  try {
    const guestSecret = localStorage.getItem(`guestSecret:${nickname.trim()}`);
    const storedAvatar = localStorage.getItem("avatarSeed");
    return {
      guestSecret: guestSecret || undefined,
      avatar: storedAvatar || undefined,
    };
  } catch {
    return {};
  }
}

function persistGuestAuthData(data: AuthResponse, nickname: string): void {
  if (typeof window === "undefined") return;
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

async function extractAuthErrorMessage(response: Response): Promise<string> {
  try {
    const errorData = await response.json();
    const parsed = parseErrorPayload(errorData);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Ignore JSON parse failure
  }
  return "Authentication failed";
}

async function requestGuestLogin(
  nickname: string,
  credentials: { guestSecret?: string; avatar?: string },
): Promise<AuthResponse> {
  const response = await apiFetch("/api/v1/auth/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: nickname,
      guestSecret: credentials.guestSecret,
      avatar: credentials.avatar,
    }),
  });

  if (!response.ok) {
    const errorMessage = await extractAuthErrorMessage(response);
    throw new Error(errorMessage);
  }

  const raw = (await response.json()) as {
    data?: AuthResponse;
  } & AuthResponse;
  const data = raw.data || raw;

  if (!data.user) {
    throw new Error("Invalid authentication response");
  }

  return data;
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

    const credentials = getStoredGuestCredentials(nickname);
    let token: string;
    try {
      const data = await requestGuestLogin(nickname, credentials);
      persistGuestAuthData(data, nickname);

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
