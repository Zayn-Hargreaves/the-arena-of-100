// ============================================================
// Multi-room capacity test — N concurrent PRIVATE rooms, each at the
// server's per-room cap (GAME_CONFIG.MAX_PLAYERS = 100), running the
// full-match flow in parallel.
//
// full-match.js proved a single room handles exactly 100 concurrent
// WS connections cleanly (0% error) — that's a hard per-room cap
// (room.service.ts), not a capacity ceiling. This scenario answers a
// different question: how many of those 100-seat rooms can the server
// run at once before *something* (CPU, DB pool, event loop, Redis)
// becomes the real bottleneck.
//
//   k6 run load-test/scenarios/multi-room.js
//   k6 run -e ROOMS=4 -e PLAYERS_PER_ROOM=69 -e SPECTATORS_PER_ROOM=30 \
//     load-test/scenarios/multi-room.js
//
// Room assignment: each role uses a scenario-local slot
// (vu.idInScenario / iterationInTest), NOT global idInTest. That keeps
// room fill deterministic under mixed per-vu-iterations + ramping-vus
// executors and guarantees exactly PLAYERS_PER_ROOM /
// SPECTATORS_PER_ROOM participants per room for each role.
// ============================================================

import exec from "k6/execution";
import { config } from "../config.js";
import {
  guestLogin,
  createRoom,
  verifyRoomExists,
  waitForRoomInGame,
} from "../lib/auth.js";
import { hostFlow, playerFlow, spectatorFlow } from "../lib/flows.js";
import * as M from "../lib/metrics.js";

// Strict positive integer env: reject non-integer, non-positive, negative,
// and partially-parsed values (e.g. "4abc"). Fail immediately so options
// and modulo math never run on invalid config.
function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const trimmed = String(raw).trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(
      `multi-room: ${name}=${JSON.stringify(raw)} must be a positive integer`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  // isSafeInteger rejects values outside MAX_SAFE_INTEGER that parseInt
  // still accepts as finite numbers (e.g. 16+ digit strings), so options
  // / modulo math never initialize on oversized config.
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(
      `multi-room: ${name}=${JSON.stringify(raw)} must be a positive integer`,
    );
  }
  return n;
}

const ROOMS = intEnv("ROOMS", 4);
const PLAYERS_PER_ROOM = intEnv("PLAYERS_PER_ROOM", 69);
const SPECTATORS_PER_ROOM = intEnv("SPECTATORS_PER_ROOM", 30);

// Host is always one seat; player roster cannot exceed the server cap.
const MAX_PLAYERS = 100;
if (PLAYERS_PER_ROOM > MAX_PLAYERS) {
  throw new Error(
    `multi-room: PLAYERS_PER_ROOM=${PLAYERS_PER_ROOM} exceeds maxPlayers ${MAX_PLAYERS}`,
  );
}

// Multi-node mode: API_URLS="http://localhost:3001,http://localhost:3002"
// spreads VUs across N API instances that share Redis + Postgres. Without
// it, everything goes to the single config.httpBase/wsBase as before.
//
// Node assignment MUST NOT reuse the same modulus as room assignment:
// room = slot % ROOMS, so node = slot % N would sync up with it
// (e.g. ROOMS=8, N=2 → every member of room r lands on node r%2) and no
// room would ever span nodes — silently skipping the cross-node fan-out
// path this mode exists to exercise. floor(slot/ROOMS) % N interleaves
// instead: room r's members are slots r, r+ROOMS, r+2*ROOMS, ... which
// alternate node 0, 1, 0, 1...
const NODES = (__ENV.API_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((raw) => {
    const httpOrigin = raw.replace(/\/$/, "");
    return {
      httpBase: `${httpOrigin}/api/v1`,
      wsBase: httpOrigin.replace(/^http/, "ws"),
    };
  });
if (NODES.length === 0) {
  NODES.push({ httpBase: config.httpBase, wsBase: config.wsBase });
}

// 0-based role-local slot → room index. Independent of global VU IDs.
function roomIndexForSlot(slot) {
  return slot % ROOMS;
}

// Interleaved node assignment from the same role-local slot.
function nodeForSlot(slot) {
  return NODES[Math.floor(slot / ROOMS) % NODES.length];
}

// Prefer k6's per-scenario VU id (1-based). Fall back to iterationInTest
// for older k6 builds that lack idInScenario.
function roleSlot() {
  const idInScenario = exec.vu && exec.vu.idInScenario;
  if (typeof idInScenario === "number" && idInScenario >= 1) {
    return idInScenario - 1;
  }
  return exec.scenario.iterationInTest;
}

const TOTAL_PLAYERS = ROOMS * PLAYERS_PER_ROOM;
if (!Number.isSafeInteger(TOTAL_PLAYERS) || TOTAL_PLAYERS <= 0) {
  throw new Error(
    `multi-room: TOTAL_PLAYERS=${String(TOTAL_PLAYERS)} must be a positive integer`,
  );
}
const TOTAL_SPECTATORS = ROOMS * SPECTATORS_PER_ROOM;
if (!Number.isSafeInteger(TOTAL_SPECTATORS) || TOTAL_SPECTATORS <= 0) {
  throw new Error(
    `multi-room: TOTAL_SPECTATORS=${String(TOTAL_SPECTATORS)} must be a positive integer`,
  );
}

// Spectators poll until the room is actually IN_GAME (host START_MATCH
// succeeded). Budget: host warmup + START_MATCH wait + buffer.
const SPECTATOR_IN_GAME_TIMEOUT_MS = config.warmupMs + 20000;

export const options = {
  setupTimeout: "120s",
  scenarios: {
    hosts: {
      executor: "per-vu-iterations",
      exec: "host",
      vus: ROOMS,
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
        { duration: config.rampUp, target: TOTAL_PLAYERS },
        { duration: config.hold, target: TOTAL_PLAYERS },
      ],
    },
    spectators: {
      executor: "ramping-vus",
      exec: "spectator",
      // Modest delay so setup finishes; actual join is gated on IN_GAME
      // via waitForRoomInGame (not this fixed clock).
      startTime: "5s",
      startVUs: 0,
      gracefulStop: "20s",
      stages: [
        { duration: config.spectatorRampUp, target: TOTAL_SPECTATORS },
        { duration: config.hold, target: TOTAL_SPECTATORS },
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

function uniq() {
  return `${Date.now() % 100000}${Math.floor(Math.random() * 1000)}`;
}

// Creates all ROOMS rooms sequentially over REST before any VU connects —
// mirrors sharedSetup()'s single-room version. Sequential (not parallel)
// on purpose: setup() runs once, outside the measured window, so there's
// no need to add REST concurrency risk to the part of the run that isn't
// being measured.
export function setup() {
  const rooms = [];
  for (let i = 0; i < ROOMS; i++) {
    // Round-robin room creation across nodes so REST setup exercises
    // every instance (the rooms themselves live in shared Postgres/Redis).
    const node = NODES[i % NODES.length];
    const host = guestLogin(node.httpBase, `lt_mrh_${i}_${uniq()}`);
    if (!host) throw new Error(`setup: host guest-login failed for room ${i}`);

    const room = createRoom(node.httpBase, host.token, {
      maxPlayers: 100,
      timeLimit: config.roundTimeLimitS,
    });
    if (!room) throw new Error(`setup: createRoom failed for room ${i}`);

    rooms.push({
      roomCode: room.code,
      roomId: room.roomId,
      hostToken: host.token,
    });
  }
  return { rooms };
}

export function host(data) {
  // Hosts must map to rooms 1:1 — iterationInTest is 0..ROOMS-1 exactly
  // once each for a per-vu-iterations executor with vus=ROOMS, iterations=1.
  const roomIndex = exec.scenario.iterationInTest % ROOMS;
  const room = data.rooms[roomIndex];
  // Hosts get their own spread (roomIndex % N): their VU ids are a single
  // 1..ROOMS sequence, so nodeForSlot would park them all on node 0.
  const node = NODES[roomIndex % NODES.length];
  return hostFlow({
    token: room.hostToken,
    roomId: room.roomId,
    warmupMs: config.warmupMs,
    lifetimeMs: config.lifetimeMs,
    vu: exec.vu.idInTest,
    wsBase: node.wsBase,
  });
}

export function player(data) {
  const slot = roleSlot();
  const roomIndex = roomIndexForSlot(slot);
  const room = data.rooms[roomIndex];
  const node = nodeForSlot(slot);
  const uid = exec.vu.idInTest;

  if (!verifyRoomExists(node.httpBase, room.roomCode)) {
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  const acct = guestLogin(node.httpBase, `lt_mrp_${uid}`);
  if (!acct) {
    M.authErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  return playerFlow({
    token: acct.token,
    userId: acct.userId,
    roomCode: room.roomCode,
    vu: uid,
    lifetimeMs: config.lifetimeMs,
    wsBase: node.wsBase,
  });
}

export function spectator(data) {
  const slot = roleSlot();
  const roomIndex = roomIndexForSlot(slot);
  const room = data.rooms[roomIndex];
  const node = nodeForSlot(slot);
  const uid = exec.vu.idInTest;

  if (!verifyRoomExists(node.httpBase, room.roomCode)) {
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  // Gate join on host START_MATCH: room must be IN_GAME so the server
  // admits this VU as SPECTATOR (drop-in), not as a late lobby player.
  if (
    !waitForRoomInGame(node.httpBase, room.roomCode, {
      timeoutMs: SPECTATOR_IN_GAME_TIMEOUT_MS,
    })
  ) {
    M.setupErrors.add(1);
    M.appErrorRate.add(true);
    console.log(
      `spectator: room ${room.roomCode} never reached IN_GAME (vu=${uid})`,
    );
    return;
  }
  const acct = guestLogin(node.httpBase, `lt_mrs_${uid}`);
  if (!acct) {
    M.authErrors.add(1);
    M.appErrorRate.add(true);
    return;
  }
  return spectatorFlow({
    token: acct.token,
    roomCode: room.roomCode,
    vu: uid,
    lifetimeMs: config.lifetimeMs,
    wsBase: node.wsBase,
  });
}
