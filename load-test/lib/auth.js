// ============================================================
// Guest-login helper — mints a real handshake token via the REST API.
//
// This is the *real* auth flow (POST /api/auth/guest), not a mocked
// JWT: it creates/reuses a User row so the handshake token maps to a
// user that can own RoomPlayer rows and be added to a match roster.
// (Signing tokens locally would skip user creation and break the
// foreign keys the room/match handlers rely on — see Plan A "Rủi ro".)
//
// Usernames are sanitized server-side: allowed chars [\p{L}\p{N}_\- *],
// length 3..20 after trim. Keep the ones we generate inside that range
// AND unique per concurrent socket (a reused username == same user ==
// the single-session kick fires and disconnects the older socket).
// ============================================================

import http from "k6/http";
import { sleep } from "k6";

const CSRF_COOKIE = "csrf_token";

// CsrfGuard is a stateless double-submit check: header `x-csrf-token`
// must equal the `csrf_token` cookie. The server sets that cookie with
// `Secure` whenever NODE_ENV=production (auth.controller.ts →
// shouldUseSecureCookies), and k6's cookie jar will not replay a Secure
// cookie over plain http — so against the production-mode docker cluster
// on http://localhost:8080 the jar is always empty and every mutating
// request 403s. Replay the cookie explicitly per request instead: the
// endpoint returns the very same value it put in the cookie, so the
// guard's header==cookie comparison still holds and nothing about the
// server's cookie policy has to be weakened for the load test.
function fetchCsrfToken(httpBase) {
  const res = http.get(`${httpBase}/auth/csrf-token`, {
    tags: { name: "auth/csrf-token" },
  });
  if (res.status !== 200) {
    return null;
  }
  try {
    return res.json().data?.csrfToken || null;
  } catch (_e) {
    return null;
  }
}

export function guestLogin(httpBase, username) {
  const csrfToken = fetchCsrfToken(httpBase);
  if (!csrfToken) {
    return null;
  }

  const res = http.post(
    `${httpBase}/auth/guest`,
    JSON.stringify({ username }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      cookies: { [CSRF_COOKIE]: csrfToken },
      tags: { name: "auth/guest" },
    },
  );

  if (res.status !== 200) {
    console.log(`guestLogin status: ${res.status}`);
    return null;
  }

  let body;
  try {
    body = res.json();
  } catch (_e) {
    return null;
  }

  if (!body || !body.data || !body.data.accessToken || !body.data.user)
    return null;

  // NOTE: never console.log `body` or `res.body` here. The guest-login
  // response carries a long-lived accessToken; logging it would expose
  // real JWTs to CI logs / artifact uploads.
  return {
    token: body.data.accessToken,
    userId: body.data.user.id,
    username: body.data.user.username,
  };
}

// Create a PRIVATE room over REST as the host. Requires a Bearer token
// (JwtAuthGuard is global). Returns { roomId, code } or null.
export function createRoom(httpBase, hostToken, { maxPlayers, timeLimit }) {
  const csrfToken = fetchCsrfToken(httpBase);
  if (!csrfToken) {
    return null;
  }

  const res = http.post(
    `${httpBase}/rooms`,
    JSON.stringify({
      roomType: "PRIVATE",
      maxPlayers,
      timeLimit,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hostToken}`,
        "x-csrf-token": csrfToken,
      },
      cookies: { [CSRF_COOKIE]: csrfToken },
      tags: { name: "rooms/create" },
    },
  );

  if (res.status !== 200 && res.status !== 201) {
    return null;
  }

  let body;
  try {
    body = res.json();
  } catch (_e) {
    return null;
  }
  if (!body || !body.data || !body.data.id || !body.data.code) return null;

  return { roomId: body.data.id, code: body.data.code };
}

export function verifyRoomExists(httpBase, roomCode) {
  const maxAttempts = 20; // 20 * 500ms = 10s
  for (let i = 0; i < maxAttempts; i++) {
    const res = http.get(`${httpBase}/rooms/code/${roomCode}`, {
      tags: { name: "rooms/check-ready" },
    });
    if (res.status === 200) {
      return true;
    }
    sleep(0.5);
  }
  return false;
}

// Poll until the room is IN_GAME (host finished START_MATCH) so drop-in
// spectators join as SPECTATOR rather than racing into a WAITING lobby.
// Default budget covers host warmup + START_MATCH + a small buffer.
export function waitForRoomInGame(
  httpBase,
  roomCode,
  { timeoutMs = 60000, intervalMs = 500 } = {},
) {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxAttempts; i++) {
    const res = http.get(`${httpBase}/rooms/code/${roomCode}`, {
      tags: { name: "rooms/check-in-game" },
    });
    if (res.status === 200) {
      try {
        const body = res.json();
        const status =
          (body && body.data && body.data.status) ||
          (body && body.status) ||
          null;
        if (status === "IN_GAME") return true;
      } catch (_e) {
        /* retry */
      }
    }
    sleep(intervalMs / 1000);
  }
  return false;
}
