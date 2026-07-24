// ============================================================
// C3 — failover chaos orchestrator (Node, OUTSIDE k6).
//
// Automated proof that a match survives its owner node being killed
// mid-flight. Drives the failover-match k6 scenario, kills the owner node
// (SIGKILL by default = honest chaos; lease-TTL expiry drives takeover),
// records the recovery timeline, and runs the pure C3 verdict
// (lib/failover-verdict.mjs) to print PASS / FAIL / INCONCLUSIVE.
//
// ONE CLOCK: every t_* and round_events[].t is stamped by THIS process's
// single monotonic clock (performance.now() anchored once at t_start), at
// the moment the orchestrator OBSERVES the event — never node clocks, Redis
// time, or k6 VU clocks — so every temporal comparison compares like-with-like.
//
// Round-event observation strategy: the orchestrator polls the canonical
// `match:state:<id>` (round index) and `match:owner:<id>` (`<nodeId>:<fence>`)
// from Redis. Each time it first observes a NEW round index it records one
// {t, eventId:`<matchId>:r<roundIndex>`, roundIndex, fence} — a single-source,
// single-clock observation. The verdict still dedupes by eventId, so mixing
// in client-sourced observations later stays safe.
//
// Requires: docker (compose multi up), a running k6, Redis reachable, and an
// ADMIN JWT for /health/cluster — supplied pre-minted via env
// CLUSTER_HEALTH_ADMIN_JWT, or minted here from the signing secret resolved as
// --jwt-secret > JWT_SECRET env > local-dev default (the default is for local
// docker runs only and triggers a loud warning). The ADMIN token is NEVER
// written into artifacts/logs; 401/403 are counted as harness auth failures,
// not health data.
//
// CLI:
//   node load-test/scripts/chaos-failover.mjs \
//     --api-lb http://localhost:8080 \
//     --nodes http://localhost:3011,http://localhost:3012,http://localhost:3013 \
//     --scenario load-test/scenarios/failover-match.js \
//     --kill-at-round 3 --kill-mode kill \
//     --steady-p95 28 --commit $(git rev-parse --short HEAD) \
//     --out-dir load-test/results
// ============================================================

import { spawn, execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import http from "node:http";
import https from "node:https";
import nodeCrypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  evaluateFailover,
  VERDICT,
  dedupeRoundEvents,
  deriveRecovery,
} from "../lib/failover-verdict.mjs";

const execFileP = promisify(execFile);
const apiNodeModules = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/node_modules",
);
const { default: Redis } = await import(
  path.join(apiNodeModules, "ioredis/built/index.js")
);

// ---- args + single clock ----

// Scan argv sequentially (NOT in fixed pairs) so a standalone boolean flag
// (e.g. --allow-dev-jwt-secret) doesn't swallow the following option as its
// value. Supports both `--key value` and `--key=value`; a flag with no value
// (end of argv, or immediately followed by another --flag) becomes boolean true.
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok || !tok.startsWith("--")) continue;
    const body = tok.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[body] = next;
      i++; // consume the value
    } else {
      out[body] = true; // standalone boolean flag
    }
  }
  return out;
}
const args = parseArgs(process.argv);

const API_LB = (args["api-lb"] || "http://localhost:8080").replace(/\/$/, "");
const NODES = String(
  args.nodes ||
    "http://localhost:3011,http://localhost:3012,http://localhost:3013",
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
const SCENARIO = args.scenario || "load-test/scenarios/failover-match.js";
const KILL_AT_ROUND = Number.parseInt(args["kill-at-round"] || "3", 10);
const KILL_MODE = args["kill-mode"] === "stop" ? "stop" : "kill"; // SIGKILL default
// Verdict thresholds. All must be finite positive numbers — a NaN here reaches
// the oracle and makes it compare against NaN (see failover-verdict.mjs), which
// is a silent false FAIL. --steady-p95 is REQUIRED: without a steady-state
// baseline the answer-p95 spike gate has nothing to multiply, so we refuse to
// run rather than default it to 0 and fabricate a verdict.
const STEADY_P95 = Number.parseFloat(args["steady-p95"] ?? "");
const ANSWER_P95_MULT = Number.parseFloat(args["answer-p95-mult"] || "5");
const RECOVER_MAX_MS = Number.parseInt(args["recover-max-ms"] || "20000", 10);
const RECONNECT_MIN = Number.parseFloat(args["reconnect-min"] || "0.99");
const MIN_CLOSES = Number.parseInt(args["min-closes"] || "1", 10);
for (const [name, val, required] of [
  ["--steady-p95", STEADY_P95, true],
  ["--answer-p95-mult", ANSWER_P95_MULT, false],
  ["--recover-max-ms", RECOVER_MAX_MS, false],
  ["--reconnect-min", RECONNECT_MIN, false],
  ["--min-closes", MIN_CLOSES, false],
]) {
  if (!Number.isFinite(val) || val <= 0) {
    fatal(
      required
        ? `${name} is required and must be a finite positive number (got ${val})`
        : `${name} must be a finite positive number (got ${val})`,
    );
  }
}
const REDIS_URL = args["redis-url"] || "redis://localhost:6379";
const OUT_DIR = args["out-dir"] || "load-test/results";
const COMMIT = args.commit || "dev";
// ADMIN-token signing secret. A pre-minted CLUSTER_HEALTH_ADMIN_JWT needs no
// secret at all. Otherwise the secret MUST be supplied explicitly — via
// --jwt-secret or the container-injected JWT_SECRET env (the SAME value the API
// nodes run with). There is NO silent fallback: minting an ADMIN token from a
// hard-coded literal is a credential-in-source hazard, so the well-known
// local-dev secret is used ONLY when --allow-dev-jwt-secret is passed to opt in.
// With no source and no opt-in we refuse to mint or send any ADMIN token.
const DEV_JWT_SECRET = "arena-100-secret-key";
const preMintedAdminToken = process.env.CLUSTER_HEALTH_ADMIN_JWT || null;
const explicitJwtSecret = args["jwt-secret"] || process.env.JWT_SECRET || null;
// Opt-in ONLY on a truthy value: bare `--allow-dev-jwt-secret` (boolean true)
// or `--allow-dev-jwt-secret=true|1|yes`. An explicit `=false|0|no` must NOT
// enable the hard-coded dev secret just because the key is present.
const allowDevRaw = args["allow-dev-jwt-secret"];
const allowDevJwtSecret =
  allowDevRaw === true ||
  (typeof allowDevRaw === "string" && /^(true|1|yes)$/i.test(allowDevRaw));
let JWT_SECRET = explicitJwtSecret;
if (!preMintedAdminToken && !explicitJwtSecret) {
  if (!allowDevJwtSecret) {
    fatal(
      "no ADMIN token source: provide a pre-minted CLUSTER_HEALTH_ADMIN_JWT, or a " +
        "signing secret via --jwt-secret / JWT_SECRET env. For a local docker cluster " +
        "on the default secret, pass --allow-dev-jwt-secret to opt in explicitly.",
    );
  }
  JWT_SECRET = DEV_JWT_SECRET; // explicit local-dev opt-in only
}
const POLL_MS = Number.parseInt(args["poll-ms"] || "500", 10);
const OWNER_POLL_MS = Number.parseInt(args["owner-poll-ms"] || "1000", 10);
const RECOVER_TIMEOUT_MS = Number.parseInt(
  args["recover-timeout-ms"] || "60000",
  10,
);
// The recover window above only bounds owner recovery + new-fence progress; a
// correct match can legitimately run far longer, so match-finish detection gets
// its own, longer deadline aligned with the scenario/k6 run duration.
const MATCH_FINISH_TIMEOUT_MS = Number.parseInt(
  args["match-finish-timeout-ms"] || "300000",
  10,
);
// How long 3b waits for the match to reach the kill round (its OWN deadline,
// not the match-find deadline). If the match finishes or never reaches the kill
// round in this window the run is INCONCLUSIVE, not a mis-timed kill.
const KILL_ROUND_TIMEOUT_MS = Number.parseInt(
  args["kill-round-timeout-ms"] || "120000",
  10,
);
// How long to wait for k6 to exit so its summary export exists. MUST cover the
// whole scenario (ramp + HOLD + teardown); the failover scenario HOLDs 6m by
// default, so this defaults well above that. Raise it (or lower HOLD) together.
const K6_WAIT_MS = Number.parseInt(args["k6-wait-ms"] || "600000", 10);

// The single monotonic clock. t_start == 0 by definition.
const t0 = performance.now();
const T = () => Math.round(performance.now() - t0);

function log(msg) {
  console.log(`[chaos +${T()}ms] ${msg}`);
}
function fatal(msg) {
  console.error(`[chaos] FATAL: ${msg}`);
  process.exit(2);
}

// ---- admin token (never logged/persisted) ----

function mintAdminToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const data = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({
    userId: "seed:admin",
    username: "admin",
    role: "ADMIN",
    iat: now,
    exp: now + 2 * 60 * 60,
  })}`;
  const sig = nodeCrypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}
const adminToken = preMintedAdminToken || mintAdminToken(JWT_SECRET);
// True only when the operator explicitly opted into the built-in dev literal
// (--allow-dev-jwt-secret) to mint the token. Real/CI runs never trip this.
const usingDevJwtSecret = !preMintedAdminToken && JWT_SECRET === DEV_JWT_SECRET;
let authFailures = 0;

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: opts.headers || {},
        timeout: opts.timeoutMs || 3000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.end();
  });
}

// Probe a node's ADMIN-protected /health/cluster. Returns the parsed data or
// null (auth failure / transport error), never throwing and never logging the
// token.
async function clusterHealth(nodeUrl) {
  let res;
  try {
    res = await request(`${nodeUrl}/api/v1/health/cluster`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  } catch (_e) {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    authFailures += 1;
    return null;
  }
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.body).data;
  } catch (_e) {
    return null;
  }
}

// ---- redis ----

const redis = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
redis.on("error", (e) => console.error(`[chaos] redis error: ${e.message}`));

async function scanStateKeys() {
  let cursor = "0";
  const keys = [];
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "match:state:*", "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

const ROUND_STATES = new Set(["ROUND_ACTIVE", "ROUND_EVALUATING", "ROUND_RESULT"]);

// Atomically read `match:state:<id>` and `match:owner:<id>` in ONE round-trip
// (MGET) so a recorded round's fence comes from the SAME snapshot as its round
// index — never a stale fence from a separate poll or an owner fallback.
async function readMatchSnapshot(matchId) {
  const [stateBlob, ownerRaw] = await redis.mget(
    `match:state:${matchId}`,
    `match:owner:${matchId}`,
  );
  let state = null;
  if (stateBlob) {
    try {
      const parsed = JSON.parse(stateBlob);
      const st = parsed.state || {};
      state = { status: st.status, currentRoundNo: st.currentRoundNo };
    } catch (_e) {
      state = null;
    }
  }
  let owner = null;
  if (ownerRaw) {
    const idx = ownerRaw.lastIndexOf(":");
    if (idx >= 0) {
      const nodeId = ownerRaw.slice(0, idx);
      const fence = Number.parseInt(ownerRaw.slice(idx + 1), 10);
      if (nodeId && Number.isFinite(fence)) owner = { nodeId, fence };
    }
  }
  return { state, owner };
}

// `match:owner:<id>` = "<nodeId>:<fence>".
async function readOwner(matchId) {
  const raw = await redis.get(`match:owner:${matchId}`);
  if (!raw) return null;
  const idx = raw.lastIndexOf(":");
  if (idx < 0) return null;
  const nodeId = raw.slice(0, idx);
  const fence = Number.parseInt(raw.slice(idx + 1), 10);
  if (!nodeId || !Number.isFinite(fence)) return null;
  return { nodeId, fence };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- docker: resolve node -> container dynamically, verify before kill ----

async function dockerPs() {
  // name + published ports, e.g. "arena-api-1  0.0.0.0:3011->3001/tcp"
  const { stdout } = await execFileP("docker", [
    "ps",
    "--format",
    "{{.Names}}\t{{.Ports}}",
  ]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, ports = ""] = l.split("\t");
      return { name, ports };
    });
}

// Map a direct node URL's port to its container name via published ports, then
// VERIFY by probing that container's port for its self-reported nodeId.
async function resolveNodeContainers() {
  const ps = await dockerPs();
  const out = [];
  for (const url of NODES) {
    const port = new URL(url).port;
    const match = ps.find((c) => c.ports.includes(`:${port}->`));
    const health = await clusterHealth(url);
    out.push({
      url,
      port,
      container: match ? match.name : null,
      nodeId: health ? health.nodeId : null,
    });
  }
  return out;
}

async function dockerKill(container, mode) {
  const cmd = mode === "stop" ? ["stop", container] : ["kill", container];
  await execFileP("docker", cmd);
}

// ---- child processes (samplers + k6) ----

const children = [];
function spawnChild(cmd, argv, opts = {}) {
  const child = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  // A spawn failure (e.g. ENOENT: binary not on PATH) emits 'error'. With no
  // listener that becomes an uncaught EventEmitter exception that crashes the
  // orchestrator with no artifact. Always attach one; callers that need to
  // react (k6) add their own listener too.
  child.on("error", (e) => {
    log(`child '${cmd}' failed: ${e.code || ""} ${e.message}`.trim());
  });
  children.push(child);
  return child;
}
function killChildren() {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch (_e) {
      /* already gone */
    }
  }
}
process.on("SIGINT", () => {
  killChildren();
  process.exit(130);
});

// ---- main orchestration ----

async function main() {
  if (usingDevJwtSecret) {
    log(
      "WARN: --allow-dev-jwt-secret is set — minting the ADMIN /health/cluster token " +
        "with the built-in LOCAL-DEV secret. This is safe ONLY against a local docker " +
        "cluster started with the same default. For any shared/CI/prod cluster, inject " +
        "the real secret via JWT_SECRET or pass a pre-minted CLUSTER_HEALTH_ADMIN_JWT.",
    );
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `failover-${COMMIT}-${ts}`;
  const summaryPath = path.join(OUT_DIR, `${base}.summary.json`);
  const artifactPath = path.join(OUT_DIR, `${base}.failover.json`);

  log(`resolving node<->container topology`);
  const topo = await resolveNodeContainers();
  for (const n of topo) {
    log(`  ${n.url} -> container=${n.container || "?"} nodeId=${n.nodeId || "?"}`);
  }

  // 1. Spawn per-node + redis samplers (best-effort; failures are non-fatal).
  const samplerDir = path.dirname(fileURLToPath(import.meta.url));
  for (const n of topo) {
    if (!n.nodeId) continue;
    spawnChild("node", [
      path.join(samplerDir, "sample-monitoring.mjs"),
      "--scenario", "failover",
      "--duration", "20m",
      "--api-url", n.url,
      "--redis-url", REDIS_URL,
      "--out-dir", OUT_DIR,
      "--out-name", `${base}.node-${n.nodeId}`,
    ]);
  }

  // 2. Spawn k6 with RECONNECT on, pointed at the LB. --summary-export gives us
  //    reconnect + answer p95 after the run.
  const k6SummaryPath = path.join(OUT_DIR, `${base}.k6-summary.json`);
  log(`spawning k6 ${SCENARIO} (RECONNECT=1, API_URL=${API_LB})`);
  const k6 = spawnChild(
    "k6",
    ["run", "-e", `API_URL=${API_LB}`, `--summary-export=${k6SummaryPath}`, SCENARIO],
    { env: { ...process.env, RECONNECT: "1" } },
  );
  let k6Done = false;
  let k6Exit = null;
  let k6SpawnError = null;
  k6.on("exit", (code) => {
    k6Done = true;
    k6Exit = code;
    log(`k6 exited code=${code}`);
  });
  // k6 failing to spawn (e.g. k6 not installed) must not hang the wait loop for
  // the full K6_WAIT_MS: mark it done and remember the reason so step 7 aborts.
  k6.on("error", (e) => {
    k6Done = true;
    k6Exit = k6Exit ?? -1;
    k6SpawnError = e.message;
    log(`k6 spawn error: ${e.message}`);
  });
  k6.stdout.on("data", (d) => process.stdout.write(`[k6] ${d}`));
  k6.stderr.on("data", (d) => process.stderr.write(`[k6] ${d}`));

  // 3. Timeline state.
  const roundEvents = []; // {t, eventId, roundIndex, fence}
  const seenRound = new Set();
  let matchId = null;
  let tMatchStarted = null;
  let ownerBefore = null;
  let tKill = null;
  let ownerAfter = null;
  let tOwnerFlip = null;
  let killedContainer = null;
  let matchFinished = false;
  let aborted = null; // harness-error reason (not a FAIL verdict)

  function recordRound(roundNo, owner) {
    if (roundNo == null || seenRound.has(roundNo)) return;
    // A round event is evidence ONLY with the fence that emitted it — a
    // null-fence entry is missing evidence the verdict would drop anyway. Do
    // NOT mark the round seen yet: a later poll that observes ownership can
    // still record this round once a valid fence is available.
    if (!owner || !Number.isFinite(owner.fence)) return;
    seenRound.add(roundNo);
    roundEvents.push({
      t: T(),
      eventId: `${matchId}:r${roundNo}`,
      roundIndex: roundNo,
      fence: owner.fence,
    });
  }

  // 3a. Find a live IN_GAME match.
  log(`waiting for a live match (IN_GAME)`);
  const findDeadline = Date.now() + 3 * 60 * 1000;
  while (!matchId && Date.now() < findDeadline && !k6Done) {
    const keys = await scanStateKeys();
    for (const key of keys) {
      const id = key.replace(/^match:state:/, "");
      const { state: st, owner } = await readMatchSnapshot(id);
      if (st && ROUND_STATES.has(st.status)) {
        matchId = id;
        tMatchStarted = T();
        ownerBefore = owner;
        recordRound(st.currentRoundNo, owner);
        log(`live match ${id} @ round ${st.currentRoundNo}, owner=${owner?.nodeId}:${owner?.fence}`);
        break;
      }
    }
    if (!matchId) await sleep(POLL_MS);
  }
  if (!matchId) fatal("no live IN_GAME match observed within the window");

  // 3b. Poll the round index until we reach the kill round, on this phase's OWN
  // deadline (NOT the match-find deadline, which 3a already partly consumed).
  // Reaching KILL_AT_ROUND is the only outcome that lets us kill; the match
  // finishing first, or the deadline expiring, is an INCONCLUSIVE run — never a
  // kill at the wrong round.
  log(`polling rounds until round >= ${KILL_AT_ROUND} to kill the owner`);
  const killRoundDeadline = Date.now() + KILL_ROUND_TIMEOUT_MS;
  let reachedKillRound = false;
  while (Date.now() < killRoundDeadline && !k6Done) {
    const { state: st, owner } = await readMatchSnapshot(matchId);
    if (st) recordRound(st.currentRoundNo, owner);
    if (st && st.status === "FINISHED") {
      aborted = `match ${matchId} FINISHED before reaching kill round ${KILL_AT_ROUND}`;
      break;
    }
    if (st && st.currentRoundNo >= KILL_AT_ROUND) {
      reachedKillRound = true;
      break;
    }
    await sleep(POLL_MS);
  }
  if (!reachedKillRound && !aborted) {
    aborted = k6Done
      ? `k6 ended before reaching kill round ${KILL_AT_ROUND}`
      : `kill round ${KILL_AT_ROUND} not reached within ${KILL_ROUND_TIMEOUT_MS}ms`;
  }

  // 4 + 5. Resolve, verify, and kill the owner — ONLY if 3b reached the kill
  // round. Any abort above skips the kill entirely (tKill stays null).
  if (!aborted) {
    ownerBefore = (await readOwner(matchId)) || ownerBefore;
    if (!ownerBefore) fatal(`no match:owner for ${matchId} at kill time`);

    // Cross-check /health/cluster.ownedMatches and resolve the container.
    const ownerNode = topo.find((n) => n.nodeId === ownerBefore.nodeId);
    if (!ownerNode || !ownerNode.container) {
      aborted = `cannot resolve container for owner nodeId=${ownerBefore.nodeId}`;
    } else {
      // VERIFY the resolved container still reports the owner nodeId, THEN kill.
      const verify = await clusterHealth(ownerNode.url);
      if (!verify || verify.nodeId !== ownerBefore.nodeId) {
        aborted = `container ${ownerNode.container} reports nodeId=${verify?.nodeId}, expected ${ownerBefore.nodeId} — aborting (bystander safety)`;
      } else {
        log(`killing owner container ${ownerNode.container} (nodeId=${ownerBefore.nodeId}, mode=${KILL_MODE})`);
        // A rejected docker kill (daemon down, container already gone, docker
        // not on PATH) must become an INCONCLUSIVE abort, not an uncaught
        // rejection that escapes to main().catch with no artifact. tKill /
        // killedContainer are assigned ONLY after the kill actually succeeds.
        try {
          await dockerKill(ownerNode.container, KILL_MODE);
          tKill = T();
          killedContainer = ownerNode.container;
        } catch (e) {
          aborted = `docker ${KILL_MODE} ${ownerNode.container} failed: ${e.message}`;
        }
      }
    }
  }

  if (aborted) {
    log(`ABORT (harness error, not a FAIL): ${aborted}`);
  }

  // 6. Measure recovery. First establish which nodes are alive AFTER the kill by
  // RE-PROBING them now, not by trusting nodeIds captured during startup
  // topology discovery — a node whose startup health failed, or that has since
  // gone unreachable, must not be silently counted alive or dead. Any survivor
  // we cannot resolve (transport error or ADMIN auth failure, which
  // clusterHealth() counts) makes the run INCONCLUSIVE: we cannot establish
  // liveness, so we stop short of the owner_not_alive verdict rather than record
  // the failure only in _meta.
  const aliveAfter = [];
  for (const n of topo) {
    if (n.container === killedContainer) continue; // the node we just killed
    const health = await clusterHealth(n.url);
    if (health && health.nodeId) {
      aliveAfter.push(health.nodeId);
    } else if (!aborted) {
      aborted = `cannot confirm survivor ${n.url} liveness post-kill (auth or transport failure)`;
      log(`ABORT (harness error, not a FAIL): ${aborted}`);
    }
  }

  if (tKill != null) {
    // Phase A — RECOVER_TIMEOUT_MS bounds ONLY owner recovery + new-fence
    // progress: within this window we expect the lease to flip to a new
    // (nodeId, higher fence) and post-kill rounds to advance.
    const recoverDeadline = Date.now() + RECOVER_TIMEOUT_MS;
    let lastOwnerPoll = 0;
    while (Date.now() < recoverDeadline) {
      const { state: st, owner } = await readMatchSnapshot(matchId);
      if (st) recordRound(st.currentRoundNo, owner);

      // Periodic owner poll: t_owner_flip = first time the lease moved to a
      // new (nodeId, higher fence) AFTER the kill. This may LAG the first
      // new-fence round event (poll gap) — recorded as separate evidence.
      if (Date.now() - lastOwnerPoll >= OWNER_POLL_MS) {
        lastOwnerPoll = Date.now();
        if (owner && ownerAfter == null && owner.fence > ownerBefore.fence && owner.nodeId !== ownerBefore.nodeId) {
          ownerAfter = owner;
          tOwnerFlip = T();
          log(`owner flip observed: ${owner.nodeId}:${owner.fence}`);
        }
      }

      if (st && st.status === "FINISHED") {
        matchFinished = true;
        break;
      }
      if (!st) {
        // state key gone: match ended + cleaned. Treat as finished if we saw
        // a post-kill new-fence round event.
        matchFinished = roundEvents.some(
          (e) => e.t > tKill && ownerAfter && e.fence === ownerAfter.fence,
        );
        break;
      }
      await sleep(POLL_MS);
    }

    // Phase B — match COMPLETION is not bounded by the recovery window: a
    // healthy match can run far longer than RECOVER_TIMEOUT_MS. If it hasn't
    // reached a terminal state yet, keep polling for FINISHED / cleanup on a
    // longer, run-aligned deadline so a slow-but-correct match isn't recorded
    // as unfinished. Owner-flip detection stays in Phase A only.
    if (!matchFinished) {
      const finishDeadline = Date.now() + MATCH_FINISH_TIMEOUT_MS;
      while (Date.now() < finishDeadline) {
        const { state: st, owner } = await readMatchSnapshot(matchId);
        if (st) recordRound(st.currentRoundNo, owner);
        if (st && st.status === "FINISHED") {
          matchFinished = true;
          break;
        }
        if (!st) {
          matchFinished = roundEvents.some(
            (e) => e.t > tKill && ownerAfter && e.fence === ownerAfter.fence,
          );
          break;
        }
        await sleep(POLL_MS);
      }
    }
  }

  // 7. Wait for k6 to finish, then read the summary for reconnect + answer p95.
  // The deadline MUST cover the whole scenario (K6_WAIT_MS defaults well above
  // the 6m HOLD); if k6 outlives it we have no complete summary, so the run is
  // INCONCLUSIVE rather than silently reporting partial reconnect data.
  log(`waiting for k6 to finish for the summary export (<= ${K6_WAIT_MS}ms)`);
  const k6Deadline = Date.now() + K6_WAIT_MS;
  while (!k6Done && Date.now() < k6Deadline) await sleep(1000);
  killChildren();
  if (k6SpawnError && !aborted) {
    aborted = `k6 failed to spawn (${k6SpawnError}) — no reconnect/answer data`;
    log(`ABORT (harness error, not a FAIL): ${aborted}`);
  } else if (!k6Done && !aborted) {
    aborted = `k6 did not finish before deadline (${K6_WAIT_MS}ms) — summary incomplete`;
    log(`ABORT (harness error, not a FAIL): ${aborted}`);
  }

  let reconnect = { successes: 0, unexpected_closes: 0, rate: 1.0, p95_ms: 0 };
  let answerP95 = null;
  if (fs.existsSync(k6SummaryPath)) {
    try {
      const sum = JSON.parse(fs.readFileSync(k6SummaryPath, "utf8"));
      const m = sum.metrics || {};
      const succ = m.reconnect_success?.values || {};
      const rm = m.reconnect_ms?.values || {};
      const al = m.answer_result_latency_ms?.values || {};
      const closes = m.ws_unexpected_disconnect?.values?.count ?? 0;
      // reconnect_success Rate: passes = successes, fails = failures; k6 gives
      // rate + counts. Derive successes from rate*(passes+fails) when present.
      const passes = succ.passes ?? null;
      const fails = succ.fails ?? null;
      const successes = passes != null ? passes : Math.round((succ.rate ?? 0) * closes);
      const unexpected = passes != null && fails != null ? passes + fails : closes;
      reconnect = {
        successes,
        unexpected_closes: unexpected,
        rate: unexpected > 0 ? successes / unexpected : 1.0,
        p95_ms: rm["p(95)"] ?? 0,
      };
      answerP95 = al["p(95)"] ?? null;
    } catch (e) {
      log(`could not parse k6 summary: ${e.message}`);
    }
  }

  // 8. Assemble the artifact (single-clock timestamps throughout). Derive
  // recovery with the SAME canonical helpers the oracle uses (dedupe by eventId,
  // then first post-kill event carrying owner_after.fence) so the recorded
  // t_recover / time_to_recover_ms are byte-identical to what evaluateFailover
  // recomputes — no parallel find() that could disagree and trip invalid_artifact.
  const canonicalEvents = dedupeRoundEvents(roundEvents);
  const recovery =
    ownerAfter != null && tKill != null
      ? deriveRecovery(canonicalEvents, tKill, ownerAfter.fence)
      : { tRecoverDerived: null };
  const tRecoverDerived = recovery.tRecoverDerived;

  const artifact = {
    t_start: 0,
    t_match_started: tMatchStarted ?? 0,
    t_kill: tKill ?? 0,
    t_owner_flip: tOwnerFlip ?? 0,
    t_recover: tRecoverDerived ?? 0,
    time_to_recover_ms:
      tRecoverDerived != null && tKill != null ? tRecoverDerived - tKill : 0,
    owner_before: ownerBefore || { nodeId: null, fence: null },
    owner_after: ownerAfter || { nodeId: null, fence: null },
    nodes_alive_after: aliveAfter,
    rounds_before: canonicalEvents.filter((e) => tKill != null && e.t <= tKill).length,
    rounds_after: canonicalEvents.filter((e) => tKill != null && e.t > tKill).length,
    round_events: roundEvents,
    duplicate_round_check: { passed: true, deduped_event_count: roundEvents.length, violations: [] },
    match_finished: matchFinished,
    answer_p95_failover_ms: answerP95 ?? 0,
    steady_state_p95_ms: STEADY_P95, // validated finite > 0 at startup
    reconnect: {
      successes: reconnect.successes,
      unexpected_closes: reconnect.unexpected_closes,
      rate: reconnect.rate,
      p95_ms: reconnect.p95_ms,
    },
    // All validated finite > 0 at startup, so the oracle never sees NaN.
    thresholds: {
      answer_p95_multiplier_max: ANSWER_P95_MULT,
      time_to_recover_max_ms: RECOVER_MAX_MS,
      reconnect_success_min: RECONNECT_MIN,
      min_unexpected_closes: MIN_CLOSES,
    },
    // Harness metadata (not read by the verdict).
    _meta: {
      matchId,
      killedContainer,
      killMode: KILL_MODE,
      authFailures,
      k6Exit,
      aborted,
    },
  };

  // 9. Run the pure verdict + fill duplicate_round_check from the oracle.
  const result = evaluateFailover(artifact);
  if (result.oracle) {
    artifact.duplicate_round_check = {
      passed: result.oracle.passed,
      deduped_event_count: result.oracle.deduped_event_count,
      violations: result.oracle.violations,
    };
  }
  artifact.verdict = aborted ? VERDICT.INCONCLUSIVE : result.verdict;

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ verdict: artifact.verdict, reasons: result.reasons, derived: result.derived, aborted }, null, 2),
  );

  log(`VERDICT: ${artifact.verdict}`);
  if (result.reasons.length) {
    for (const r of result.reasons) log(`  - ${r.code}: ${r.detail}`);
  }
  if (aborted) log(`  (harness aborted: ${aborted})`);
  log(`wrote ${artifactPath}`);

  await redis.quit();
  // PASS -> 0; INCONCLUSIVE (including a harness abort, which forces the
  // verdict to INCONCLUSIVE above) -> 3; only a real FAIL verdict -> 1.
  process.exit(
    artifact.verdict === VERDICT.PASS ? 0 : artifact.verdict === VERDICT.INCONCLUSIVE ? 3 : 1,
  );
}

main().catch((err) => {
  killChildren();
  console.error(`[chaos] fatal: ${err.stack || err.message}`);
  process.exit(2);
});
