// ============================================================
// k6 load-test config — Đấu Trường 100
//
// All knobs are env-driven so the same scripts run against local
// docker, CI, or a staging box without edits. See README.md.
// ============================================================

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

// Base URL of the running API (NestJS, default port 3001). REST calls
// go to `${API_URL}/api/...` (the server sets a global `api` prefix),
// WebSocket (socket.io) connects to the same host.
const RAW_HTTP = strEnv("API_URL", "http://localhost:3001").replace(/\/$/, "");

// socket.io lives on the same origin. http -> ws, https -> wss.
const RAW_WS = strEnv("WS_URL", RAW_HTTP).replace(/\/$/, "");

export const config = {
  // REST base including the server's global `api` prefix.
  httpBase: `${RAW_HTTP}/api`,
  // WebSocket origin (the socket.io path is appended by the client).
  wsBase: RAW_WS.replace(/^http/, "ws"),

  // Population sizing (per scenario). Overridable per run.
  players: intEnv("PLAYERS", 70),
  spectators: intEnv("SPECTATORS", 30),

  // Ramp / hold windows (k6 stage strings).
  rampUp: strEnv("RAMP_UP", "30s"),
  hold: strEnv("HOLD", "4m"),
  spectatorRampUp: strEnv("SPEC_RAMP_UP", "15s"),

  // How long the host waits (after auth) before START_MATCH, giving
  // players time to JOIN_ROOM. Players who join after this become
  // drop-in spectators — which is exactly the mix we want to measure.
  warmupMs: intEnv("WARMUP_MS", 35000),

  // Per-socket lifetime. Deliberately large: the ramping-vus stage
  // window (rampUp + hold) governs the real test length, and each VU
  // is gracefully stopped at the end, so one long-lived socket == one
  // iteration (no reconnect churn skewing the numbers).
  lifetimeMs: intEnv("LIFETIME_MS", 900000),

  // Client-side timeouts for the handshake steps.
  authTimeoutMs: intEnv("AUTH_TIMEOUT_MS", 8000),
  joinTimeoutMs: intEnv("JOIN_TIMEOUT_MS", 8000),

  // Room round time limit (seconds) passed to createRoom.
  roundTimeLimitS: intEnv("ROUND_TIME_LIMIT_S", 15),

  // Answer-latency SLOs (answer -> answer_result echo, round trip).
  latencyP95Ms: intEnv("LATENCY_P95_MS", 1000),
  latencyP99Ms: intEnv("LATENCY_P99_MS", 2500),

  // Acceptance: app-level error rate ceiling (Plan A proposes < 1%).
  errorRateMax: Number.parseFloat(strEnv("ERROR_RATE_MAX", "0.01")),
};
