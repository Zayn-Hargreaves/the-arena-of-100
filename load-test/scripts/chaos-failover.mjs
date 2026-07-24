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
// ADMIN JWT for /health/cluster (env CLUSTER_HEALTH_ADMIN_JWT or minted from
// --jwt-secret). The ADMIN token is NEVER written into artifacts/logs; 401/403
// are counted as harness auth failures, not health data.
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
import { evaluateFailover, VERDICT } from "../lib/failover-verdict.mjs";

const execFileP = promisify(execFile);
const apiNodeModules = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/node_modules",
);
const { default: Redis } = await import(
  path.join(apiNodeModules, "ioredis/built/index.js")
);

// ---- args + single clock ----

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !k.startsWith("--")) continue;
    out[k.slice(2)] = v;
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
const STEADY_P95 = Number.parseFloat(args["steady-p95"] || "NaN");
const REDIS_URL = args["redis-url"] || "redis://localhost:6379";
const OUT_DIR = args["out-dir"] || "load-test/results";
const COMMIT = args.commit || "dev";
const JWT_SECRET = args["jwt-secret"] || "arena-100-secret-key";
const POLL_MS = Number.parseInt(args["poll-ms"] || "500", 10);
const OWNER_POLL_MS = Number.parseInt(args["owner-poll-ms"] || "1000", 10);
const RECOVER_TIMEOUT_MS = Number.parseInt(
  args["recover-timeout-ms"] || "60000",
  10,
);

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
const adminToken =
  process.env.CLUSTER_HEALTH_ADMIN_JWT || mintAdminToken(JWT_SECRET);
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

async function readMatchState(matchId) {
  const blob = await redis.get(`match:state:${matchId}`);
  if (!blob) return null;
  try {
    const parsed = JSON.parse(blob);
    const st = parsed.state || {};
    return { status: st.status, currentRoundNo: st.currentRoundNo };
  } catch (_e) {
    return null;
  }
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
  k6.on("exit", (code) => {
    k6Done = true;
    k6Exit = code;
    log(`k6 exited code=${code}`);
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
    seenRound.add(roundNo);
    roundEvents.push({
      t: T(),
      eventId: `${matchId}:r${roundNo}`,
      roundIndex: roundNo,
      fence: owner ? owner.fence : null,
    });
  }

  // 3a. Find a live IN_GAME match.
  log(`waiting for a live match (IN_GAME)`);
  const findDeadline = Date.now() + 3 * 60 * 1000;
  while (!matchId && Date.now() < findDeadline && !k6Done) {
    const keys = await scanStateKeys();
    for (const key of keys) {
      const id = key.replace(/^match:state:/, "");
      const st = await readMatchState(id);
      if (st && ROUND_STATES.has(st.status)) {
        matchId = id;
        tMatchStarted = T();
        ownerBefore = await readOwner(id);
        recordRound(st.currentRoundNo, ownerBefore);
        log(`live match ${id} @ round ${st.currentRoundNo}, owner=${ownerBefore?.nodeId}:${ownerBefore?.fence}`);
        break;
      }
    }
    if (!matchId) await sleep(POLL_MS);
  }
  if (!matchId) fatal("no live IN_GAME match observed within the window");

  // 3b. Poll the round index until we reach the kill round.
  log(`polling rounds until round >= ${KILL_AT_ROUND} to kill the owner`);
  while (Date.now() < findDeadline && !k6Done) {
    const st = await readMatchState(matchId);
    const owner = await readOwner(matchId);
    if (st) recordRound(st.currentRoundNo, owner || ownerBefore);
    if (st && st.currentRoundNo >= KILL_AT_ROUND) break;
    if (st && st.status === "FINISHED") break;
    await sleep(POLL_MS);
  }

  // 4. Owner just before the kill.
  ownerBefore = (await readOwner(matchId)) || ownerBefore;
  if (!ownerBefore) fatal(`no match:owner for ${matchId} at kill time`);

  // Cross-check /health/cluster.ownedMatches and resolve the container.
  const ownerNode = topo.find((n) => n.nodeId === ownerBefore.nodeId);
  if (!ownerNode || !ownerNode.container) {
    aborted = `cannot resolve container for owner nodeId=${ownerBefore.nodeId}`;
  } else {
    // 5. VERIFY the resolved container still reports the owner nodeId, THEN kill.
    const verify = await clusterHealth(ownerNode.url);
    if (!verify || verify.nodeId !== ownerBefore.nodeId) {
      aborted = `container ${ownerNode.container} reports nodeId=${verify?.nodeId}, expected ${ownerBefore.nodeId} — aborting (bystander safety)`;
    } else {
      log(`killing owner container ${ownerNode.container} (nodeId=${ownerBefore.nodeId}, mode=${KILL_MODE})`);
      await dockerKill(ownerNode.container, KILL_MODE);
      tKill = T();
      killedContainer = ownerNode.container;
    }
  }

  if (aborted) {
    log(`ABORT (harness error, not a FAIL): ${aborted}`);
  }

  // 6. Measure recovery: keep observing rounds + watch for the owner flip.
  const aliveAfter = topo
    .filter((n) => n.container !== killedContainer && n.nodeId)
    .map((n) => n.nodeId);

  if (tKill != null) {
    const recoverDeadline = Date.now() + RECOVER_TIMEOUT_MS;
    let lastOwnerPoll = 0;
    while (Date.now() < recoverDeadline) {
      const st = await readMatchState(matchId);
      const owner = await readOwner(matchId);
      if (st) recordRound(st.currentRoundNo, owner || ownerBefore);

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
  }

  // 7. Wait for k6 to finish, then read the summary for reconnect + answer p95.
  log(`waiting for k6 to finish for the summary export`);
  const k6Deadline = Date.now() + 5 * 60 * 1000;
  while (!k6Done && Date.now() < k6Deadline) await sleep(1000);
  killChildren();

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

  // 8. Assemble the artifact (single-clock timestamps throughout).
  const tRecoverEvent =
    ownerAfter != null
      ? roundEvents.find((e) => e.t > (tKill ?? Infinity) && e.fence === ownerAfter.fence)
      : null;

  const artifact = {
    t_start: 0,
    t_match_started: tMatchStarted ?? 0,
    t_kill: tKill ?? 0,
    t_owner_flip: tOwnerFlip ?? 0,
    t_recover: tRecoverEvent ? tRecoverEvent.t : 0,
    time_to_recover_ms: tRecoverEvent && tKill != null ? tRecoverEvent.t - tKill : 0,
    owner_before: ownerBefore || { nodeId: null, fence: null },
    owner_after: ownerAfter || { nodeId: null, fence: null },
    nodes_alive_after: aliveAfter,
    rounds_before: roundEvents.filter((e) => tKill != null && e.t <= tKill).length,
    rounds_after: roundEvents.filter((e) => tKill != null && e.t > tKill).length,
    round_events: roundEvents,
    duplicate_round_check: { passed: true, deduped_event_count: roundEvents.length, violations: [] },
    match_finished: matchFinished,
    answer_p95_failover_ms: answerP95 ?? 0,
    steady_state_p95_ms: Number.isFinite(STEADY_P95) ? STEADY_P95 : 0,
    reconnect: {
      successes: reconnect.successes,
      unexpected_closes: reconnect.unexpected_closes,
      rate: reconnect.rate,
      p95_ms: reconnect.p95_ms,
    },
    thresholds: {
      answer_p95_multiplier_max: Number.parseFloat(args["answer-p95-mult"] || "5"),
      time_to_recover_max_ms: Number.parseInt(args["recover-max-ms"] || "20000", 10),
      reconnect_success_min: Number.parseFloat(args["reconnect-min"] || "0.99"),
      min_unexpected_closes: Number.parseInt(args["min-closes"] || "1", 10),
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
  // PASS -> 0, INCONCLUSIVE -> 3, FAIL/abort -> 1.
  process.exit(
    artifact.verdict === VERDICT.PASS ? 0 : artifact.verdict === VERDICT.INCONCLUSIVE ? 3 : 1,
  );
}

main().catch((err) => {
  killChildren();
  console.error(`[chaos] fatal: ${err.stack || err.message}`);
  process.exit(2);
});
