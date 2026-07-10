// ============================================================
// Phase A2 — spectator flood.
//
//   k6 run load-test/scenarios/spectator-flood.js
//   k6 run -e SPECTATORS=95 -e PLAYERS=5 load-test/scenarios/spectator-flood.js
//
// Stresses the read-only broadcast fan-out specifically: a small
// player pool runs a match while a large wave of drop-in spectators
// (default 95) pile onto the room channel and only receive events.
//
// This is the direct evidence for the P2 decision — if p95/p99 answer
// latency and error rate stay healthy while ~95 receive-only sockets
// take the same ROUND_STARTED/ROUND_ENDED fan-out as players, the
// current single-transport design holds; if they degrade, a spectator
// transport split is justified.
// ============================================================

import { config } from "../config.js";
import { sharedSetup } from "../lib/scenario-common.js";

export { host, player, spectator } from "../lib/scenario-common.js";

// Flood-specific defaults: many spectators, few players. Still env
// overridable (SPECTATORS / PLAYERS take precedence via config).
const PLAYERS = config.players; // default 70 -> override with -e PLAYERS=5
const SPECTATORS = config.spectators; // default 30 -> override with -e SPECTATORS=95

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
        { duration: "10s", target: PLAYERS },
        { duration: config.hold, target: PLAYERS },
      ],
    },
    spectators: {
      executor: "ramping-vus",
      exec: "spectator",
      startTime: `${Math.round(config.warmupMs / 1000) + 5}s`,
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: config.spectatorRampUp, target: SPECTATORS },
        { duration: config.hold, target: SPECTATORS },
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
