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

function getActiveCsrfToken(httpBase) {
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(httpBase);
  const val = cookies.csrf_token;
  return val && val.length > 0 ? val[0] : null;
}

export function guestLogin(httpBase, username) {
  const csrfRes = http.get(`${httpBase}/auth/csrf-token`, {
    tags: { name: "auth/csrf-token" },
  });

  if (csrfRes.status !== 200) {
    return null;
  }

  let csrfToken;
  try {
    csrfToken = csrfRes.json().data?.csrfToken;
  } catch (_e) {
    return null;
  }

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
      tags: { name: "auth/guest" },
    },
  );

  console.log("guestLogin status:", res.status, "body:", res.body);
  if (res.status !== 200) {
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

  return {
    token: body.data.accessToken,
    userId: body.data.user.id,
    username: body.data.user.username,
  };
}

// Create a PRIVATE room over REST as the host. Requires a Bearer token
// (JwtAuthGuard is global). Returns { roomId, code } or null.
export function createRoom(httpBase, hostToken, { maxPlayers, timeLimit }) {
  const csrfToken = getActiveCsrfToken(httpBase);
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
