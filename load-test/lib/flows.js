// ============================================================
// Player / host / spectator flows over the socket.io client.
//
// Each flow is an async function that resolves when its socket has
// lived out `lifetimeMs` (or failed the handshake early). k6 awaits
// the returned promise AND drains the event loop, so the socket keeps
// receiving broadcasts — that fan-out is the load we're measuring.
//
// End-to-end flow (mirrors apps/web + the gateway handlers):
//   connect ws  -> Engine.IO handshake -> namespace connect (ready)
//   emit authenticate {token} -> await AUTHENTICATED
//   [player/spectator] emit join_room {roomCode} -> await ROOM_JOINED
//   [host] wait warmup, emit start_match {roomId}
//   on ROUND_STARTED -> emit submit_answer -> ANSWER_RESULT (latency)
// ============================================================

import { createSocketIOClient } from "./socketio.js";
import { ClientEvent, ServerEvent } from "./protocol.js";
import { config } from "../config.js";
import * as M from "./metrics.js";
import { reportVuReady } from "./readiness.js";

const COORDINATOR_URL = __ENV.COORDINATOR_URL || null;
const READINESS_RUN_ID = __ENV.READINESS_RUN_ID || null;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickAnswer(question) {
  const opts =
    question && Array.isArray(question.options) ? question.options : null;
  if (opts && opts.length > 0) {
    return String(opts[Math.floor(Math.random() * opts.length)]);
  }
  // Fallback: the seed's questions use single-letter answers.
  return ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];
}

function newSubmissionId(vu, roundNo) {
  // idSchema caps this at 64 chars.
  return `lt-${vu}-${roundNo}-${Math.floor(Math.random() * 1e9)}`;
}

// Mirrors apps/web's socket-store heartbeat (every 10s — comfortably under
// the server's 20s presence TTL). Without this, a socket that joins and
// then just waits (e.g. the host during warmup) has its presence key
// expire and gets swept as "stale" — disbanding the room out from under
// the rest of the test. `getRoomId` is a thunk because for player/spectator
// the room id is only known after ROOM_JOINED resolves.
function startHeartbeat(client, getRoomId) {
  const interval = setInterval(() => {
    const roomId = getRoomId();
    if (roomId && client.connected) {
      client.emit(ClientEvent.HEARTBEAT, { roomId, sentAt: Date.now() });
    }
  }, 10000);
  return () => clearInterval(interval);
}

// Wire the counters every flow shares: message volume, server errors,
// unexpected disconnects.
function wireCommon(client) {
  M.wsConnected.add(1);
  client.onAny(() => M.wsMessagesReceived.add(1));
  client.on(ServerEvent.ERROR, (p) => {
    M.serverErrors.add(1);
    M.appErrorRate.add(true);
    // Diagnostic for the multi-room bottleneck investigation: the payload
    // tells us WHY the server rejected something (e.g. rate limit, stale
    // presence) instead of just counting that it happened.
    console.log(`server_error: ${JSON.stringify(p)}`);
  });
}

// `countConnectErrors: false` is used for non-final retry attempts: a
// browser that fails its first connect and silently reconnects a second
// later never surfaces an error to anyone, so a retried-and-recovered
// attempt shouldn't trip ws_connect_errors thresholds either. Errors on
// the FINAL attempt (and all post-handshake disconnects) still count.
function createAndWireClient({ countConnectErrors = true, wsBase } = {}) {
  let connectErrorLogged = false;

  const client = createSocketIOClient(wsBase || config.wsBase, {
    onClose: (intentional, detail) => {
      if (!intentional) {
        if (client && client.handshakeCompleted) {
          M.wsUnexpectedDisconnect.add(1);
          M.wsDisconnectErrors.add(1);
          M.appErrorRate.add(true);
          // Diagnostic for the multi-room bottleneck investigation:
          // distinguishes a presence-sweep/app-level kick (sioReason set,
          // clean WS close) from a raw transport drop (no sioReason —
          // ping timeout, event-loop stall, process restart).
          console.log(`unexpected_disconnect: ${JSON.stringify(detail)}`);
        } else if (countConnectErrors) {
          // Pre-handshake: only the final retry attempt counts a
          // ws_connect_error. Do NOT set app_error_rate or
          // ws_disconnect_errors — connectWithRetry records the single
          // application error after all retries are exhausted.
          if (!connectErrorLogged) {
            connectErrorLogged = true;
            M.wsConnectErrors.add(1);
          }
        }
      }
    },
    onError: () => {
      if (
        !client.handshakeCompleted &&
        countConnectErrors &&
        !connectErrorLogged
      ) {
        connectErrorLogged = true;
        M.wsConnectErrors.add(1);
      }
    },
  });

  client.handshakeCompleted = false;

  client.ready.then(
    () => {
      /* Engine.IO open only — app handshake is not done yet. */
    },
    () => {
      if (countConnectErrors && !connectErrorLogged) {
        connectErrorLogged = true;
        M.wsConnectErrors.add(1);
      }
    },
  );

  wireCommon(client);
  return client;
}

// Shared handshake: authenticate, then (optionally) join a room.
// Returns true on success, false if a step failed/timed out.
async function handshake(client, token, roomCode, vuId) {
  try {
    await client.ready;
    client.emit(ClientEvent.AUTHENTICATE, { token });
    await client.waitFor(ServerEvent.AUTHENTICATED, config.authTimeoutMs);
    M.appErrorRate.add(false);

    // Plan A readiness barrier: report this VU as AUTHENTICATED to
    // the coordinator. Idempotent on the server (SADD), so retries
    // do not inflate the count. Only active when the workflow has
    // spawned the coordinator sidecar.
    if (COORDINATOR_URL && READINESS_RUN_ID && vuId != null) {
      let ok;
      try {
        ok = reportVuReady(COORDINATOR_URL, READINESS_RUN_ID, String(vuId));
      } catch (_e) {
        ok = false;
      }
      if (!ok) {
        M.appErrorRate.add(true);
      }
    }

    if (roomCode) {
      client.emit(ClientEvent.JOIN_ROOM, { roomCode });
      await client.waitFor(ServerEvent.ROOM_JOINED, config.joinTimeoutMs);
      M.appErrorRate.add(false);
    }
    client.handshakeCompleted = true;
    M.wsConnectSuccess.add(1);
    return true;
  } catch (e) {
    // Error accounting (setup_flow_errors / app_error_rate) lives in
    // connectWithRetry — only an EXHAUSTED retry budget is a real failure.
    console.log(
      "Handshake error detail:",
      e.message || String(e),
      e.stack || "",
    );
    return false;
  }
}

// Mirrors the real web client's self-healing (socket.io-client defaults:
// reconnection true, infinite attempts, 1-5s backoff; apps/web re-runs
// connect() ~5s after an auth timeout via AppShellLayout). The k6 socket
// client is one-shot, so without this a single failed handshake
// permanently killed the VU — which is exactly how one unlucky host
// connection nuked a whole 100-seat room in the 8-room runs. Bounded
// (unlike the browser) so a genuinely down server still fails the test
// loudly instead of retrying forever.
//
// `wire(client)` re-registers the flow's event handlers on each fresh
// client — handlers like ROOM_JOINED must be attached BEFORE the
// handshake, so they can't be added once outside the loop.
const HANDSHAKE_ATTEMPTS = 4;
const HANDSHAKE_BACKOFF_MS = 2000;

async function connectWithRetry({ token, roomCode, vu, wire, wsBase }) {
  for (let attempt = 1; attempt <= HANDSHAKE_ATTEMPTS; attempt++) {
    const isFinal = attempt === HANDSHAKE_ATTEMPTS;
    const client = createAndWireClient({
      countConnectErrors: isFinal,
      wsBase,
    });
    if (wire) wire(client);

    const ok = await handshake(client, token, roomCode, vu);
    if (ok) return client;

    client.close();
    if (!isFinal) {
      M.handshakeRetries.add(1);
      console.log(
        `handshake attempt ${attempt}/${HANDSHAKE_ATTEMPTS} failed (vu=${vu}), retrying in ${HANDSHAKE_BACKOFF_MS}ms`,
      );
      await sleepMs(HANDSHAKE_BACKOFF_MS);
    }
  }

  M.setupErrors.add(1);
  M.appErrorRate.add(true);
  return null;
}

// A registered player: joins before the match starts, answers each round.
export async function playerFlow({
  token,
  userId,
  roomCode,
  vu,
  lifetimeMs,
  wsBase,
}) {
  const pending = {}; // submissionId -> sentAt (ms)
  let matchId = null;
  let roomId = null;
  let finished = false;
  let eliminated = false;

  const wire = (client) => {
    client.on(ServerEvent.ROOM_JOINED, (p) => {
      if (p && p.roomId) roomId = p.roomId;
    });

    client.on(ServerEvent.MATCH_STARTED, (p) => {
      if (p && p.matchId) matchId = p.matchId;
    });

    // An eliminated player is not allowed to answer future rounds — the
    // server correctly rejects it (SPECTATOR_CANNOT_ANSWER / ROUND_NOT_ACTIVE),
    // but a real client stops answering once eliminated, so the harness
    // should too instead of counting an expected rejection as an app error.
    client.on(ServerEvent.PLAYER_ELIMINATED, (p) => {
      if (p && p.playerId === userId) eliminated = true;
    });

    client.on(ServerEvent.ROUND_STARTED, (p) => {
      M.roundStarted.add(1);
      const mid = (p && p.matchId) || matchId;
      if (!mid || finished || eliminated || !p) return;

      const sid = newSubmissionId(vu, p.roundNo);
      pending[sid] = Date.now();
      client.emit(ClientEvent.SUBMIT_ANSWER, {
        matchId: mid,
        roundNo: p.roundNo,
        answer: pickAnswer(p.question),
        submissionId: sid,
        clientTimestamp: Date.now(),
      });
      M.answersSubmitted.add(1);
    });

    client.on(ServerEvent.ANSWER_RESULT, (p) => {
      const sid = p && p.submissionId;
      if (sid && pending[sid] != null) {
        M.answerLatency.add(Date.now() - pending[sid]);
        delete pending[sid];
      }
    });

    client.on(ServerEvent.MATCH_FINISHED, () => {
      if (!finished) {
        finished = true;
        M.matchFinished.add(1);
      }
    });
  };

  const client = await connectWithRetry({ token, roomCode, vu, wire, wsBase });
  if (!client) return;

  const stopHeartbeat = startHeartbeat(client, () => roomId);
  await sleepMs(lifetimeMs);
  stopHeartbeat();
  client.close();
}

// The host: created the room over REST, so it already has a RoomPlayer
// row. It authenticates, waits for players to join, then fires
// start_match. It does not answer (times out each round) — its job is
// to drive the match and hold a connection.
export async function hostFlow({
  token,
  roomId,
  warmupMs,
  lifetimeMs,
  vu,
  wsBase,
}) {
  const wire = (client) => {
    client.on(ServerEvent.MATCH_FINISHED, () => M.matchFinished.add(1));
  };

  const client = await connectWithRetry({
    token,
    roomCode: null,
    vu,
    wire,
    wsBase,
  });
  if (!client) return;

  const stopHeartbeat = startHeartbeat(client, () => roomId);

  // Give players time to JOIN_ROOM before locking the roster.
  await sleepMs(warmupMs);
  client.emit(ClientEvent.START_MATCH, { roomId });

  try {
    await client.waitFor(ServerEvent.MATCH_STARTED, 10000);
  } catch (_e) {
    // start_match failed (e.g. not enough players joined) — record it,
    // but keep the socket alive so the run still exercises connections.
    M.setupErrors.add(1);
  }

  await sleepMs(lifetimeMs);
  stopHeartbeat();
  client.close();
}

// A drop-in spectator: joins after the match is IN_GAME, so the server
// admits it as SPECTATOR (receive-only). Never submits answers.
export async function spectatorFlow({
  token,
  roomCode,
  lifetimeMs,
  vu,
  wsBase,
}) {
  let roomId = null;

  const wire = (client) => {
    client.on(ServerEvent.ROOM_JOINED, (p) => {
      if (p && p.roomId) roomId = p.roomId;
    });
    client.on(ServerEvent.ROUND_STARTED, () => M.roundStarted.add(1));
    client.on(ServerEvent.MATCH_FINISHED, () => M.matchFinished.add(1));
  };

  const client = await connectWithRetry({ token, roomCode, vu, wire, wsBase });
  if (!client) return;

  const stopHeartbeat = startHeartbeat(client, () => roomId);
  await sleepMs(lifetimeMs);
  stopHeartbeat();
  client.close();
}
