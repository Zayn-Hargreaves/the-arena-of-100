// ============================================================
// C3 — failover chaos scenario. A trimmed full-match variant the
// chaos orchestrator (scripts/chaos-failover.mjs) drives while it kills
// the owner node mid-match.
//
//   RECONNECT=1 k6 run -e API_URL=http://localhost:8080 \
//     load-test/scenarios/failover-match.js
//
// Differences from full-match:
//   * fewer VUs (PLAYERS=40 SPECTATORS=20 by default) and a longer HOLD,
//     so the match spans the kill window;
//   * players/spectators use the C2 reconnect wrapper (config.reconnect)
//     so a node kill's dropped sockets reconnect to a live node and the
//     run measures reconnect_ms / reconnect_success. The orchestrator
//     sets RECONNECT=1; without it the reconnect coverage gate makes the
//     verdict INCONCLUSIVE (reconnect unproven), never a false PASS.
//   * points at the nginx LB (API_URL=:8080) so new connections reroute
//     to a surviving node.
// ============================================================

import { config } from "../config.js";
import { sharedSetup } from "../lib/scenario-common.js";

export { host, player, spectator } from "../lib/scenario-common.js";

// Failover-tuned population defaults (independent of full-match's 69/30).
function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
function strEnv(name, fallback) {
  const raw = __ENV[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

const PLAYERS = intEnv("PLAYERS", 40);
const SPECTATORS = intEnv("SPECTATORS", 20);
const RAMP_UP = strEnv("RAMP_UP", "20s");
// Longer than full-match so the match is still live when the orchestrator
// kills the owner ~40-50% through its rounds.
const HOLD = strEnv("HOLD", "6m");
const SPEC_RAMP_UP = strEnv("SPEC_RAMP_UP", "15s");

export const options = {
  setupTimeout: "30s",
  scenarios: {
    host: {
      executor: "shared-iterations",
      exec: "host",
      vus: 1,
      iterations: 1,
      maxDuration: "20m",
    },
    players: {
      executor: "ramping-vus",
      exec: "player",
      startTime: "2s",
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: RAMP_UP, target: PLAYERS },
        { duration: HOLD, target: PLAYERS },
      ],
    },
    spectators: {
      executor: "ramping-vus",
      exec: "spectator",
      startTime: `${Math.round(config.warmupMs / 1000) + 5}s`,
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: SPEC_RAMP_UP, target: SPECTATORS },
        { duration: HOLD, target: SPECTATORS },
      ],
    },
  },
  // Failover thresholds are intentionally lenient on the app-error side (a
  // node kill DOES drop sockets — that's the point) but surface reconnect
  // recovery so it lands in the summary the orchestrator/verdict read.
  thresholds: {
    // reconnect_success is the headline; keep it visible even if not gating.
    reconnect_success: ["rate>=0"],
    reconnect_ms: ["p(95)>=0"],
    answer_result_latency_ms: ["p(95)>=0"],
  },
};

export function setup() {
  if (!config.reconnect) {
    // Loud, non-fatal: the run still executes, but reconnect won't be
    // exercised and the C3 verdict will be INCONCLUSIVE.
    console.log(
      "WARN failover-match: RECONNECT is OFF — reconnect unproven; set RECONNECT=1",
    );
  }
  return sharedSetup();
}
