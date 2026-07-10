// ============================================================
// Phase A2 — full match under 100 concurrent WebSocket users.
//
//   k6 run load-test/scenarios/full-match.js
//   k6 run -e PLAYERS=70 -e SPECTATORS=30 load-test/scenarios/full-match.js
//
// Population (default 1 host + 70 players + 30 spectators = 101 WS):
//   host        1 VU  — creates the room (in setup) + fires start_match
//   players     ramp 0 -> PLAYERS over RAMP_UP, hold for HOLD; join then
//               answer every round.
//   spectators  ramp 0 -> SPECTATORS starting after the host has begun
//               the match; drop-in SPECTATOR, receive-only.
//
// Measures: answer->result latency (p50/p95/p99), disconnect rate,
// messages/sec, error rate. Pair with server-side CPU/mem + Redis
// `match:state:*` observation (see README "Server-side observation").
// ============================================================

import { config } from "../config.js";
import { sharedSetup } from "../lib/scenario-common.js";

export { host, player, spectator } from "../lib/scenario-common.js";

export const options = {
  setupTimeout: "30s",
  scenarios: {
    host: {
      executor: "shared-iterations",
      exec: "host",
      vus: 1,
      iterations: 1,
      maxDuration: "15m",
    },
    players: {
      executor: "ramping-vus",
      exec: "player",
      startTime: "2s",
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: config.rampUp, target: config.players },
        { duration: config.hold, target: config.players },
      ],
    },
    spectators: {
      executor: "ramping-vus",
      exec: "spectator",
      // Start after warmup+start_match so joiners land in an IN_GAME
      // room and are admitted as drop-in spectators.
      startTime: `${Math.round(config.warmupMs / 1000) + 5}s`,
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: config.spectatorRampUp, target: config.spectators },
        { duration: config.hold, target: config.spectators },
      ],
    },
  },
  thresholds: {
    app_error_rate: [`rate<${config.errorRateMax}`],
    answer_result_latency_ms: [
      `p(95)<${config.latencyP95Ms}`,
      `p(99)<${config.latencyP99Ms}`,
    ],
    ws_connect_errors: ["count<5"],
    setup_flow_errors: ["count<10"],
  },
};

export function setup() {
  return sharedSetup();
}
