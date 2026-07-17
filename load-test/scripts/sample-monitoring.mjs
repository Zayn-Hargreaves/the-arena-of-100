// ============================================================
// Plan A monitoring sampler (Node).
//
// Samples:
//   - GET /health/monitoring  ->  CPU/RSS/roomCount  (CPU + RSS JSONL)
//   - SCAN match:state:*      ->  keyCount
//   - INFO memory             ->  usedMemoryBytes
//   - INFO clients            ->  connectedClients
//
// Per Plan A: sampling rate 1Hz, anchor samples on demand, raw
// JSONL output, REDIS_URL redaction enforced.
//
// CLI usage:
//   node scripts/sample-monitoring.mjs \
//     --scenario full-match \
//     --duration 6m \
//     --anchor cleanup_window_end \
//     --api-url http://localhost:3001 \
//     --jwt-secret ... \
//     --admin-username admin \
//     --out-dir load-test/results \
//     --out-name full-match-abcd1234
//
// The script writes:
//   - <out-name>.cpu.jsonl
//   - <out-name>.redis.jsonl
//   - <out-name>.anchor.json  (anchor timestamps + chosen samples)
// ============================================================

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodeCrypto from "node:crypto";

const apiNodeModules = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/node_modules",
);
const { default: Redis } = await import(
  path.join(apiNodeModules, "ioredis/built/index.js")
);

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
const SCENARIO = args.scenario || "unknown";
const DURATION_MS = parseDuration(args.duration || "6m");
const INTERVAL_MS = Number.parseInt(args.interval || "1000", 10);
const API_URL = args["api-url"] || "http://localhost:3001";
const JWT_SECRET = args["jwt-secret"] || "arena-100-secret-key";
const ADMIN_USERNAME = args["admin-username"] || "admin";
const ADMIN_JWT = args["admin-jwt"]; // optional pre-minted token
const REDIS_URL = args["redis-url"] || "redis://localhost:6379";
const REDIS_KEY_PREFIX = args["redis-key-prefix"] || "";
const PATTERN = args.pattern || `${REDIS_KEY_PREFIX ? REDIS_KEY_PREFIX + ":" : ""}match:state:*`;
const OUT_DIR = args["out-dir"] || "load-test/results";
const OUT_NAME = args["out-name"] || `${SCENARIO}-${Date.now()}`;
const ANCHOR = args.anchor || null;

function parseDuration(s) {
  const m = String(s).match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return 6 * 60 * 1000;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2];
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  return 6 * 60 * 1000;
}

function parseRedisUrl(rawUrl) {
  const m = String(rawUrl || "").match(
    /^(rediss?):\/\/(?:[^@/]+@)?([^:/]+)(?::(\d+))?(?:\/(\d+))?/i,
  );
  if (!m) return { scheme: null, host: null, port: null, db: null, tls: false };
  const scheme = m[1].toLowerCase();
  const port = m[3] ? Number.parseInt(m[3], 10) : null;
  const tls = scheme === "rediss" || (port !== null && port === 6380);
  const db = m[4] !== undefined ? Number.parseInt(m[4], 10) : null;
  return { scheme, host: m[2], port, db, tls };
}

const redisParts = parseRedisUrl(REDIS_URL);
const redactedUrl = redisParts.scheme && redisParts.host
  ? `${redisParts.scheme}://${redisParts.host}${redisParts.port ? `:${redisParts.port}` : ""}${redisParts.db != null ? `/${redisParts.db}` : ""}`
  : null;

// ----- HTTP (admin monitoring) -----

let adminToken = ADMIN_JWT || null;

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
        timeout: opts.timeoutMs || 5000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body });
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Mint a JWT for the seeded admin user using the same secret the
// API signs with. This is a read-only sampling path; it never writes.
function mintAdminToken(secret, username) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    userId: `seed:${username}`,
    username,
    role: "ADMIN",
    iat: now,
    exp: now + 60 * 60,
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

if (!adminToken) {
  try {
    adminToken = mintAdminToken(JWT_SECRET, ADMIN_USERNAME);
  } catch (err) {
    console.error(`[sampler] failed to mint admin token: ${err.message}`);
    process.exit(1);
  }
}

// ----- redis -----

const redis = new Redis(REDIS_URL, {
  ...(REDIS_KEY_PREFIX ? { keyPrefix: REDIS_KEY_PREFIX } : {}),
  lazyConnect: false,
  maxRetriesPerRequest: 2,
});
redis.on("error", (err) => {
  console.error(`[sampler] redis error: ${err.message}`);
});

// SCAN over the pattern. Avoids KEYS (production-safe).
async function countKeys(pattern) {
  let cursor = "0";
  let count = 0;
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      500,
    );
    cursor = next;
    count += batch.length;
  } while (cursor !== "0");
  return count;
}

async function readRedisInfo() {
  const memoryInfo = await redis.info("memory");
  const clientsInfo = await redis.info("clients");
  const usedMemoryBytes = parseInfoNumber(memoryInfo, "used_memory");
  const connectedClients = parseInfoNumber(clientsInfo, "connected_clients");
  return { usedMemoryBytes, connectedClients };
}

function parseInfoNumber(infoText, key) {
  if (!infoText) return null;
  const m = infoText.match(new RegExp(`^${key}:(\\d+)$`, "m"));
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

// ----- main loop -----

fs.mkdirSync(OUT_DIR, { recursive: true });
const cpuPath = path.join(OUT_DIR, `${OUT_NAME}.cpu.jsonl`);
const redisPath = path.join(OUT_DIR, `${OUT_NAME}.redis.jsonl`);
const anchorPath = path.join(OUT_DIR, `${OUT_NAME}.anchor.json`);

const cpuStream = fs.createWriteStream(cpuPath, { flags: "w" });
const redisStream = fs.createWriteStream(redisPath, { flags: "w" });

const anchors = {};
let stopping = false;
let anchorTriggered = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function sampleOnce() {
  const ts = new Date().toISOString();
  // CPU/RSS
  let cpuSample = {
    ts,
    cpu: null,
    eventLoopLagMaxMs: null,
    eventLoopLagMeanMs: null,
    eventLoopLagP99Ms: null,
    rssBytes: null,
    totalMemBytes: null,
    roomCount: null,
    error: null,
  };
  try {
    const res = await request(`${API_URL}/api/v1/health/monitoring`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeoutMs: 4000,
    });
    if (res.status === 200) {
      // The API wraps every response in { success, message, data } via
      // its global TransformInterceptor — the payload fields live under
      // `.data`, not at the top level.
      const body = JSON.parse(res.body).data;
      cpuSample.cpu = body.cpuUsage;
      cpuSample.eventLoopLagMaxMs = body.eventLoopLagMaxMs;
      cpuSample.eventLoopLagMeanMs = body.eventLoopLagMeanMs;
      cpuSample.eventLoopLagP99Ms = body.eventLoopLagP99Ms;
      cpuSample.rssBytes = body.rssBytes;
      cpuSample.totalMemBytes = body.totalMemBytes;
      cpuSample.roomCount = body.roomCount;
    } else {
      cpuSample.error = `http_status_${res.status}`;
    }
  } catch (err) {
    cpuSample.error = String(err.message || err);
  }
  cpuStream.write(`${JSON.stringify(cpuSample)}\n`);

  // Redis
  let redisSample = {
    ts,
    usedMemoryBytes: null,
    connectedClients: null,
    keyCount: null,
    pattern: PATTERN,
    db: redisParts.db,
    redisUrl: redactedUrl,
    error: null,
  };
  try {
    const info = await readRedisInfo();
    const keyCount = await countKeys(PATTERN);
    redisSample.usedMemoryBytes = info.usedMemoryBytes;
    redisSample.connectedClients = info.connectedClients;
    redisSample.keyCount = keyCount;
  } catch (err) {
    redisSample.error = String(err.message || err);
  }
  redisStream.write(`${JSON.stringify(redisSample)}\n`);
}

async function runAnchor() {
  if (anchorTriggered) return;
  anchorTriggered = true;
  const ts = new Date().toISOString();
  console.log(`[sampler] anchor=${ANCHOR} ts=${ts}`);
  // Collect an immediate extra sample to satisfy "active anchor".
  await sampleOnce();
  anchors[ANCHOR] = { ts };
}

async function main() {
  const start = Date.now();
  // Initial baseline sample.
  await sampleOnce();
  while (!stopping && Date.now() - start < DURATION_MS) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    if (stopping) break;
    await sampleOnce();
  }
  if (ANCHOR) {
    await runAnchor();
  }
  cpuStream.end();
  redisStream.end();
  await new Promise((r) => cpuStream.on("close", r));
  await new Promise((r) => redisStream.on("close", r));
  fs.writeFileSync(anchorPath, JSON.stringify(anchors, null, 2));
  console.log(`[sampler] done. cpu=${cpuPath} redis=${redisPath} anchors=${anchorPath}`);
  await redis.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error(`[sampler] fatal: ${err.message}`);
  process.exit(1);
});
