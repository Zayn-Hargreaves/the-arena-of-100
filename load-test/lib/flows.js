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

// Wire the counters every flow shares: message volume, server errors,
// unexpected disconnects.
function wireCommon(client) {
  M.wsConnected.add(1);
  client.onAny(() => M.wsMessagesReceived.add(1));
  client.on(ServerEvent.ERROR, () => {
    M.serverErrors.add(1);
    M.appErrorRate.add(true);
  });
}

function createAndWireClient() {
  let hasConnected = false;
  let connectErrorLogged = false;

  const client = createSocketIOClient(config.wsBase, {
    onClose: (intentional) => {
      if (!intentional) {
        if (hasConnected) {
          M.wsDisconnectErrors.add(1);
        } else if (!connectErrorLogged) {
          connectErrorLogged = true;
          M.wsConnectErrors.add(1);
        }
        M.appErrorRate.add(true);
      }
    },
    onError: () => {
      if (!hasConnected && !connectErrorLogged) {
        connectErrorLogged = true;
        M.wsConnectErrors.add(1);
        M.appErrorRate.add(true);
      }
    },
  });

  client.ready.then(
    () => {
      hasConnected = true;
    },
    () => {
      if (!connectErrorLogged) {
        connectErrorLogged = true;
        M.wsConnectErrors.add(1);
        M.appErrorRate.add(true);
      }
    },
  );

  wireCommon(client);
  return client;
}

// Shared handshake: authenticate, then (optionally) join a room.
// Returns true on success, false if a step failed/timed out.
async function handshake(client, token, roomCode) {
  try {
    await client.ready;
    client.emit(ClientEvent.AUTHENTICATE, { token });
    await client.waitFor(ServerEvent.AUTHENTICATED, config.authTimeoutMs);
    M.appErrorRate.add(false);

    if (roomCode) {
      client.emit(ClientEvent.JOIN_ROOM, { roomCode });
      await client.waitFor(ServerEvent.ROOM_JOINED, config.joinTimeoutMs);
      M.appErrorRate.add(false);
    }
    return true;
  } catch (e) {
    console.log(
      "Handshake error detail:",
      e.message || String(e),
      e.stack || "",
    );
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    return false;
  }
}

// A registered player: joins before the match starts, answers each round.
export async function playerFlow({ token, roomCode, vu, lifetimeMs }) {
  const client = createAndWireClient();

  const pending = {}; // submissionId -> sentAt (ms)
  let matchId = null;
  let finished = false;

  client.on(ServerEvent.MATCH_STARTED, (p) => {
    if (p && p.matchId) matchId = p.matchId;
  });

  client.on(ServerEvent.ROUND_STARTED, (p) => {
    M.roundStarted.add(1);
    const mid = (p && p.matchId) || matchId;
    if (!mid || finished || !p) return;

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

  const ok = await handshake(client, token, roomCode);
  if (!ok) {
    client.close();
    return;
  }

  await sleepMs(lifetimeMs);
  client.close();
}

// The host: created the room over REST, so it already has a RoomPlayer
// row. It authenticates, waits for players to join, then fires
// start_match. It does not answer (times out each round) — its job is
// to drive the match and hold a connection.
export async function hostFlow({ token, roomId, warmupMs, lifetimeMs }) {
  const client = createAndWireClient();

  client.on(ServerEvent.MATCH_FINISHED, () => M.matchFinished.add(1));

  const ok = await handshake(client, token, null);
  if (!ok) {
    client.close();
    return;
  }

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
  client.close();
}

// A drop-in spectator: joins after the match is IN_GAME, so the server
// admits it as SPECTATOR (receive-only). Never submits answers.
export async function spectatorFlow({ token, roomCode, lifetimeMs }) {
  const client = createAndWireClient();

  client.on(ServerEvent.ROUND_STARTED, () => M.roundStarted.add(1));
  client.on(ServerEvent.MATCH_FINISHED, () => M.matchFinished.add(1));

  const ok = await handshake(client, token, roomCode);
  if (!ok) {
    client.close();
    return;
  }

  await sleepMs(lifetimeMs);
  client.close();
}
