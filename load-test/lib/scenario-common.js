// ============================================================
// Shared setup + exec functions for the multi-VU scenarios
// (full-match, spectator-flood). Both scenarios drive the same
// three roles against one shared PRIVATE room; only the population
// mix and the k6 `options` differ, so they live in the scenario files.
// ============================================================

import exec from "k6/execution";
import { config } from "../config.js";
import { guestLogin, createRoom, verifyRoomExists } from "./auth.js";
import { hostFlow, playerFlow, spectatorFlow } from "./flows.js";
import * as M from "./metrics.js";

// Runs once. Creates the host account + the shared PRIVATE room over
// REST and hands the room code / host token to every VU.
export function sharedSetup() {
  const host = guestLogin(config.httpBase, `lt_host_${uniq()}`);
  if (!host) throw new Error("setup: host guest-login failed");

  const room = createRoom(config.httpBase, host.token, {
    maxPlayers: 100,
    timeLimit: config.roundTimeLimitS,
  });
  if (!room) throw new Error("setup: createRoom failed");

  return { roomCode: room.code, roomId: room.roomId, hostToken: host.token };
}

export function host(data) {
  return hostFlow({
    token: data.hostToken,
    roomId: data.roomId,
    warmupMs: config.warmupMs,
    lifetimeMs: config.lifetimeMs,
    vu: exec.vu.idInTest,
  });
}

export function player(data) {
  if (!verifyRoomExists(config.httpBase, data.roomCode)) {
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  // idInTest is unique across the whole test (and across scenarios), so
  // usernames never collide -> no single-session self-kicks.
  const uid = exec.vu.idInTest;
  const acct = guestLogin(config.httpBase, `lt_p_${uid}`);
  if (!acct) {
    M.authErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  return playerFlow({
    token: acct.token,
    roomCode: data.roomCode,
    vu: uid,
    lifetimeMs: config.lifetimeMs,
  });
}

export function spectator(data) {
  if (!verifyRoomExists(config.httpBase, data.roomCode)) {
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  const uid = exec.vu.idInTest;
  const acct = guestLogin(config.httpBase, `lt_s_${uid}`);
  if (!acct) {
    M.authErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  return spectatorFlow({
    token: acct.token,
    roomCode: data.roomCode,
    // Pass the VU identifier so spectatorFlow can forward it to
    // handshake() and the coordinator readiness report. Without
    // this, the readiness barrier would undercount spectators and
    // fail the manifest gate (size < target).
    vu: uid,
    lifetimeMs: config.lifetimeMs,
  });
}

function uniq() {
  return `${Date.now() % 100000}${Math.floor(Math.random() * 1000)}`;
}
