// ============================================================
// Phase A1 smoke — 2 clients complete 1 match end-to-end.
//
//   k6 run load-test/scenarios/smoke.js
//
// One host + one player. Verifies the whole chain works before
// scaling to 100 VU: guest-login -> ws handshake -> authenticate ->
// join -> start_match -> round_started -> submit_answer ->
// answer_result. A green run (no setup errors, answers submitted,
// error rate ~0) means the protocol/auth wiring is correct.
// ============================================================

import exec from "k6/execution";
import { config } from "../config.js";
import { guestLogin, createRoom } from "../lib/auth.js";
import { hostFlow, playerFlow } from "../lib/flows.js";
import * as M from "../lib/metrics.js";

// Short, fixed timings for a fast smoke — independent of the big-run env.
const SMOKE_WARMUP_MS = 6000;
const SMOKE_LIFETIME_MS = 45000;

export const options = {
  setupTimeout: "30s",
  scenarios: {
    host: {
      executor: "shared-iterations",
      exec: "host",
      vus: 1,
      iterations: 1,
      maxDuration: "90s",
    },
    player: {
      executor: "shared-iterations",
      exec: "player",
      vus: 1,
      iterations: 1,
      startTime: "1s",
      maxDuration: "90s",
    },
  },
  thresholds: {
    app_error_rate: [`rate<${config.errorRateMax}`],
    setup_flow_errors: ["count<1"],
    answers_submitted: ["count>0"],
  },
};

export function setup() {
  const host = guestLogin(config.httpBase, `lt_smh_${uniq()}`);
  if (!host) throw new Error("smoke setup: host guest-login failed");

  const room = createRoom(config.httpBase, host.token, {
    maxPlayers: 4,
    timeLimit: config.roundTimeLimitS,
  });
  if (!room) throw new Error("smoke setup: createRoom failed");

  return { roomCode: room.code, roomId: room.roomId, hostToken: host.token };
}

export function host(data) {
  return hostFlow({
    token: data.hostToken,
    roomId: data.roomId,
    warmupMs: SMOKE_WARMUP_MS,
    lifetimeMs: SMOKE_LIFETIME_MS,
  });
}

export function player(data) {
  const acct = guestLogin(
    config.httpBase,
    `lt_smp_${exec.vu.idInTest}_${uniq()}`,
  );
  if (!acct) {
    M.authErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  return playerFlow({
    token: acct.token,
    userId: acct.userId,
    roomCode: data.roomCode,
    vu: exec.vu.idInTest,
    lifetimeMs: SMOKE_LIFETIME_MS,
  });
}

// Cheap unique suffix for the host username (setup runs once).
function uniq() {
  return `${Date.now() % 100000}${Math.floor(Math.random() * 1000)}`;
}
