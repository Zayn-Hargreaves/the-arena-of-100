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

export function guestLogin(httpBase, username) {
  const res = http.post(
    `${httpBase}/auth/guest`,
    JSON.stringify({ username }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "auth/guest" },
    },
  );

  if (res.status !== 200) {
    return null;
  }

  let body;
  try {
    body = res.json();
  } catch (_e) {
    return null;
  }

  if (!body || !body.accessToken || !body.user) return null;

  return {
    token: body.accessToken,
    userId: body.user.id,
    username: body.user.username,
  };
}

// Create a PRIVATE room over REST as the host. Requires a Bearer token
// (JwtAuthGuard is global). Returns { roomId, code } or null.
export function createRoom(httpBase, hostToken, { maxPlayers, timeLimit }) {
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
  if (!body || !body.id || !body.code) return null;

  return { roomId: body.id, code: body.code };
}
