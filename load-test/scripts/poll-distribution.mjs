// ============================================================
// C1 — sockets-per-node distribution poller (Node, outside k6).
//
// Proves the load actually SPREADS across the 3-node cluster: polls
// each node's ADMIN-protected `GET /api/v1/health/cluster` on its
// DIRECT port and records `.socketCount` as one JSONL line per sample
// per node. D1's "sockets-per-node over time" chart reads this file.
//
// Security (per the C1 plan):
//   * The cluster-health route requires a JWT carrying the ADMIN role.
//     Supply it via env `CLUSTER_HEALTH_ADMIN_JWT`, or let this script
//     mint one locally from `--jwt-secret` (same HS256 path the
//     sample-monitoring sampler uses). The token is NEVER written into
//     the JSONL artifact, the summary, or any log line.
//   * 401/403 responses are counted in a SEPARATE `auth_failures`
//     counter — an auth failure is a harness problem, not a
//     distribution sample, and must never be averaged into socketCount
//     data. Same for transport/parse errors (`poll_errors`).
//
// Distribution assertion: in at least one sample round, sockets must
// land on >= MIN_NODES distinct nodes (default 2), proving concurrent
// cross-node placement. PASS also requires zero auth/poll errors and
// coverage of every configured probe URL.
//
// CLI usage:
//   node load-test/scripts/poll-distribution.mjs \
//     --nodes http://localhost:3011,http://localhost:3012,http://localhost:3013 \
//     --duration 4m --interval 1000 \
//     --out-dir load-test/results --out-name multi-fullmatch-<commit>-<ts> \
//     --jwt-secret arena-100-secret-key   # or: env CLUSTER_HEALTH_ADMIN_JWT
//
// Writes:
//   - <out-name>-distribution.jsonl   one {ts, nodeId, socketCount} per sample
//   - <out-name>-distribution.summary.json   per-node split + assertion result
// Exit code: 0 when the assertion holds, 1 otherwise, 2 for config/fatal.
// ============================================================

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import nodeCrypto from "node:crypto";

// ----- args -----

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

const NODES = String(
  args.nodes ||
    "http://localhost:3011,http://localhost:3012,http://localhost:3013",
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

const DURATION_MS = parseDuration(args.duration || "4m");
const INTERVAL_MS = Number.parseInt(args.interval || "1000", 10);
const MIN_NODES = Number.parseInt(args["min-nodes"] || "2", 10);
const OUT_DIR = args["out-dir"] || "load-test/results";
const OUT_NAME = args["out-name"] || `multi-distribution-${nowTag()}`;
const JWT_SECRET = args["jwt-secret"] || "arena-100-secret-key";
const ADMIN_USERNAME = args["admin-username"] || "admin";

// Prefer a pre-minted token from the environment (never a CLI arg — a
// CLI arg lands in the process table / shell history). Fall back to
// minting locally from the shared dev secret for local docker runs.
const ADMIN_JWT = process.env.CLUSTER_HEALTH_ADMIN_JWT || null;

function parseDuration(s) {
  const m = String(s).match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return 4 * 60 * 1000;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return 4 * 60 * 1000;
}

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// Validate CLI config before creating any artifacts.
if (NODES.length === 0) {
  console.error("[distribution] --nodes must list at least one URL");
  process.exit(2);
}
if (!isPositiveInt(INTERVAL_MS)) {
  console.error(
    `[distribution] --interval must be a positive integer (ms), got: ${args.interval ?? "1000"}`,
  );
  process.exit(2);
}
if (!isPositiveInt(MIN_NODES)) {
  console.error(
    `[distribution] --min-nodes must be a positive integer, got: ${args["min-nodes"] ?? "2"}`,
  );
  process.exit(2);
}
if (MIN_NODES > NODES.length) {
  console.error(
    `[distribution] --min-nodes (${MIN_NODES}) cannot exceed node count (${NODES.length})`,
  );
  process.exit(2);
}

// ----- admin token (never logged / persisted) -----

function mintAdminToken(secret, username) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    userId: `seed:${username}`,
    username,
    role: "ADMIN",
    iat: now,
    exp: now + 2 * 60 * 60,
  };
  const enc = (o) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = nodeCrypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

let adminToken = ADMIN_JWT;
if (!adminToken) {
  try {
    adminToken = mintAdminToken(JWT_SECRET, ADMIN_USERNAME);
  } catch (err) {
    console.error(`[distribution] failed to mint admin token: ${err.message}`);
    process.exit(2);
  }
}

// ----- HTTP -----

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
        timeout: opts.timeoutMs || 4000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.end();
  });
}

// ----- state -----

fs.mkdirSync(OUT_DIR, { recursive: true });
const jsonlPath = path.join(OUT_DIR, `${OUT_NAME}-distribution.jsonl`);
const summaryPath = path.join(OUT_DIR, `${OUT_NAME}-distribution.summary.json`);
const jsonlStream = fs.createWriteStream(jsonlPath, { flags: "w" });

// Convert async write failures into main()'s controlled exit-2 path.
let resolveJsonlDone;
let rejectJsonlDone;
const jsonlDone = new Promise((resolve, reject) => {
  resolveJsonlDone = resolve;
  rejectJsonlDone = reject;
});
jsonlStream.on("error", (err) => {
  rejectJsonlDone(err);
  stopping = true;
});
jsonlStream.once("close", () => {
  resolveJsonlDone();
});

// nodeId -> aggregate; keyed by the node's SELF-REPORTED nodeId (not the
// probe URL), so a rename/relabel can't split one node into two buckets.
const perNode = new Map();
// Per-round snapshots for concurrent-spread assertion + peak-round split.
// Each entry: { ts, nodes: [{ nodeId, socketCount }] }
const roundSnapshots = [];
// Probe URL that produced at least one successful sample.
const coveredUrls = new Set();
let authFailures = 0;
let pollErrors = 0;
let samples = 0;
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

function recordNode(nodeId, socketCount, ts) {
  let agg = perNode.get(nodeId);
  if (!agg) {
    agg = { nodeId, samples: 0, peakSockets: 0, lastSockets: 0, sumSockets: 0 };
    perNode.set(nodeId, agg);
  }
  agg.samples += 1;
  agg.lastSockets = socketCount;
  agg.sumSockets += socketCount;
  if (socketCount > agg.peakSockets) agg.peakSockets = socketCount;
  jsonlStream.write(`${JSON.stringify({ ts, nodeId, socketCount })}\n`);
  samples += 1;
}

async function pollNode(nodeUrl) {
  const ts = new Date().toISOString();
  let res;
  try {
    res = await request(`${nodeUrl}/api/v1/health/cluster`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeoutMs: 3000,
    });
  } catch (_err) {
    // Transport-level failure (node down / timeout) — not a distribution
    // sample. NOTE: never echo the error object; it could carry the URL
    // but must never carry the token (it doesn't, but stay defensive).
    pollErrors += 1;
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    // Auth problem, not distribution data. Never write the token.
    authFailures += 1;
    return null;
  }
  if (res.status !== 200) {
    pollErrors += 1;
    return null;
  }
  let nodeId = null;
  let socketCount = null;
  try {
    // Production wraps via TransformInterceptor ({ success, message, data }).
    // Integration inject / some proxies may return the payload at the root.
    const parsed = JSON.parse(res.body);
    const body =
      parsed && typeof parsed === "object" && parsed.data != null
        ? parsed.data
        : parsed;
    nodeId = body && body.nodeId;
    socketCount = body && body.socketCount;
  } catch (_err) {
    pollErrors += 1;
    return null;
  }
  if (typeof nodeId !== "string" || !Number.isFinite(socketCount)) {
    pollErrors += 1;
    return null;
  }
  recordNode(nodeId, socketCount, ts);
  coveredUrls.add(nodeUrl);
  return { nodeId, socketCount, ts, nodeUrl };
}

async function sampleOnce() {
  // Poll every node concurrently so the row shares a near-identical wall
  // clock — the distribution chart compares nodes at the same instant.
  const results = await Promise.all(NODES.map((n) => pollNode(n)));
  const nodes = [];
  let roundTs = null;
  for (const r of results) {
    if (!r) continue;
    if (!roundTs) roundTs = r.ts;
    nodes.push({ nodeId: r.nodeId, socketCount: r.socketCount });
  }
  if (nodes.length > 0) {
    roundSnapshots.push({ ts: roundTs, nodes });
  }
}

function pickPeakRound(snapshots) {
  let best = null;
  let bestTotal = -1;
  let bestSpread = -1;
  for (const snap of snapshots) {
    const total = snap.nodes.reduce((s, n) => s + n.socketCount, 0);
    const spread = snap.nodes.filter((n) => n.socketCount > 0).length;
    // Align with maxConcurrentNodesWithSockets: highest spread first,
    // then total sockets, then first-seen order.
    if (
      spread > bestSpread ||
      (spread === bestSpread && total > bestTotal)
    ) {
      best = snap;
      bestTotal = total;
      bestSpread = spread;
    }
  }
  return best;
}

function buildSummary() {
  const nodes = [...perNode.values()].map((n) => ({
    nodeId: n.nodeId,
    samples: n.samples,
    peakSockets: n.peakSockets,
    lastSockets: n.lastSockets,
    avgSockets: n.samples > 0 ? n.sumSockets / n.samples : 0,
  }));
  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  // Concurrent spread: max over rounds of how many nodes held sockets
  // in the SAME sample (not independent lifetime peaks).
  let maxConcurrentNodesWithSockets = 0;
  for (const snap of roundSnapshots) {
    const spread = snap.nodes.filter((n) => n.socketCount > 0).length;
    if (spread > maxConcurrentNodesWithSockets) {
      maxConcurrentNodesWithSockets = spread;
    }
  }

  const peakRound = pickPeakRound(roundSnapshots);
  const peakRoundNodes = peakRound ? peakRound.nodes : [];
  const totalPeakRound = peakRoundNodes.reduce(
    (s, n) => s + n.socketCount,
    0,
  );
  // peakSplit / peakSharePct from one snapshot (the peak round), not
  // each node's independent lifetime peakSockets.
  const splitMap = new Map(
    peakRoundNodes.map((n) => [n.nodeId, n.socketCount]),
  );
  // Include every node ever seen so the summary still lists them at 0
  // if they were quiet during the peak round.
  for (const n of nodes) {
    if (!splitMap.has(n.nodeId)) splitMap.set(n.nodeId, 0);
  }
  const split = [...splitMap.entries()]
    .map(([nodeId, sockets]) => ({
      nodeId,
      peakSockets: sockets,
      peakSharePct:
        totalPeakRound > 0
          ? Number(((sockets / totalPeakRound) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  const allUrlsCovered = NODES.every((u) => coveredUrls.has(u));
  const assertionPassed =
    maxConcurrentNodesWithSockets >= MIN_NODES &&
    authFailures === 0 &&
    pollErrors === 0 &&
    allUrlsCovered;

  return {
    outName: OUT_NAME,
    probedUrls: NODES,
    durationMs: DURATION_MS,
    intervalMs: INTERVAL_MS,
    totalSamples: samples,
    // Harness-health counters — separate from distribution data.
    authFailures,
    pollErrors,
    minNodes: MIN_NODES,
    distinctNodesSeen: nodes.length,
    nodesWithSockets: maxConcurrentNodesWithSockets,
    coveredUrls: [...coveredUrls],
    expectedNodeCount: NODES.length,
    allUrlsCovered,
    assertion: {
      rule:
        `in one sample round sockets on >= ${MIN_NODES} nodes, ` +
        `authFailures=0, pollErrors=0, all ${NODES.length} probe URLs covered`,
      passed: assertionPassed,
    },
    perNode: nodes,
    peakSplit: split,
    peakRoundTs: peakRound ? peakRound.ts : null,
    jsonl: jsonlPath,
  };
}

async function main() {
  const start = Date.now();
  await sampleOnce();
  while (!stopping && Date.now() - start < DURATION_MS) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    if (stopping) break;
    await sampleOnce();
  }

  jsonlStream.end();
  await jsonlDone;

  const summary = buildSummary();
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const splitStr = summary.peakSplit
    .map((s) => `${s.nodeId}=${s.peakSockets}(${s.peakSharePct}%)`)
    .join(" ");
  console.log(
    `[distribution] ${summary.assertion.passed ? "PASS" : "FAIL"} — ` +
      `${summary.nodesWithSockets}/${summary.distinctNodesSeen} nodes carried sockets ` +
      `in one round (min=${MIN_NODES}); peak-round split: ${splitStr}`,
  );
  if (authFailures > 0 || pollErrors > 0 || !summary.allUrlsCovered) {
    console.log(
      `[distribution] harness health: auth_failures=${authFailures} poll_errors=${pollErrors} ` +
        `urls_covered=${summary.coveredUrls.length}/${NODES.length} ` +
        `(excluded from distribution data when failed)`,
    );
  }
  console.log(
    `[distribution] wrote ${jsonlPath} + ${summaryPath} (${samples} samples)`,
  );
  process.exit(summary.assertion.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`[distribution] fatal: ${err.message}`);
  process.exit(2);
});
