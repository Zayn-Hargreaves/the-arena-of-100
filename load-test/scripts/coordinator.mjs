// ============================================================
// Readiness coordinator sidecar (Node).
//
// Runs OUTSIDE the k6 process. Exposes a tiny HTTP surface on
// 127.0.0.1:<port> that the k6 harness talks to:
//
//   POST /ready/:runId    { vuId }   -> SADD k6:ready:<runId> vuId
//                                      (idempotent; counts as 1)
//   GET  /count/:runId               -> { size, target }
//   GET  /missing/:runId?target=N    -> { missing: [vuId...] }
//   GET  /healthz                    -> 200 OK
//
// The set TTL is bounded by ReadinessKeys.ttlSeconds; a noop
// coordinator that exits without cleanup is bounded by that.
//
// Why a sidecar (and not an in-process k6 check)?
//   - k6 checks fire on the VU iteration timeline. There is no
//     shared mutable state between VUs inside one scenario.
//   - The set must be observable to the run's "poller" VU and to
//     the post-run validator (Node) — both need a network endpoint.
//   - Redis is the simplest store already available in the runtime.
//
// Required env: REDIS_URL, REDIS_KEY_PREFIX (optional).
// Optional: COORDINATOR_PORT (default 7171), READY_TTL_SECONDS.
// ============================================================

import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve ioredis through the @arena/api package so we share a
// single dependency with the API process. If the path moves, the
// failure mode is an explicit "Cannot find module" at start.
const apiNodeModules = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/api/node_modules",
);
const { default: Redis } = await import(
  path.join(apiNodeModules, "ioredis/built/index.js")
);

const PORT = Number.parseInt(process.env.COORDINATOR_PORT || "7171", 10);
const TTL_SECONDS = Number.parseInt(
  process.env.READY_TTL_SECONDS || String(2 * 60 * 60),
  10,
);
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || "";

function setKey(runId) {
  return `${KEY_PREFIX ? KEY_PREFIX + ":" : ""}k6:ready:${runId}`;
}

const REDIS_URL =
  process.env.REDIS_URL ||
  process.env.LOAD_TEST_REDIS_URL ||
  "redis://localhost:6379";

const redis = new Redis(REDIS_URL, {
  // NOTE: do NOT pass `keyPrefix` here. `setKey()` already composes
  // the full key as `${prefix}:k6:ready:${runId}`; layering the
  // library-level `keyPrefix` on top would double the prefix and
  // make the readiness set invisible to /count and /missing.
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  console.error(`[coordinator] redis error: ${err.message}`);
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const READY_ROUTE = /^\/ready\/([^/]+)$/;
const COUNT_ROUTE = /^\/count\/([^/]+)$/;
const MISSING_ROUTE = /^\/missing\/([^/]+)$/;

async function handleReady(req, res, runId) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) });
    return;
  }
  const vuId = body?.vuId ? String(body.vuId) : null;
  if (!vuId) {
    sendJson(res, 400, { error: "vuId required" });
    return;
  }
  try {
    const key = setKey(runId);
    await redis.sadd(key, vuId);
    await redis.expire(key, TTL_SECONDS);
    const size = await redis.scard(key);
    sendJson(res, 200, { ok: true, size });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

async function handleCount(res, runId, url) {
  const target = Number.parseInt(url.searchParams.get("target") || "0", 10);
  try {
    const size = await redis.scard(setKey(runId));
    sendJson(res, 200, { size, target });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

async function handleMissing(res, runId, url) {
  const target = Number.parseInt(url.searchParams.get("target") || "0", 10);
  try {
    const members = await redis.smembers(setKey(runId));
    const present = new Set(members);
    const missing = [];
    // VU IDs are 1-based (k6 `exec.vu.idInTest` starts at 1), so
    // the expected range is `1..target` inclusive. Walking
    // `0..target-1` would treat the host VU (id 0) as expected and
    // miss VU id `target`, which is exactly the failure mode the
    // readiness check is supposed to catch.
    for (let i = 1; i <= target; i += 1) {
      if (!present.has(String(i))) missing.push(String(i));
    }
    sendJson(res, 200, { missing, size: members.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

function maskRedisUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "***";
      const result = parsed.toString();
      return !rawUrl.endsWith("/") && result.endsWith("/")
        ? result.slice(0, -1)
        : result;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const readyMatch = READY_ROUTE.exec(url.pathname);
  if (req.method === "POST" && readyMatch) {
    await handleReady(req, res, readyMatch[1]);
    return;
  }

  const countMatch = COUNT_ROUTE.exec(url.pathname);
  if (req.method === "GET" && countMatch) {
    await handleCount(res, countMatch[1], url);
    return;
  }

  const missingMatch = MISSING_ROUTE.exec(url.pathname);
  if (req.method === "GET" && missingMatch) {
    await handleMissing(res, missingMatch[1], url);
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[coordinator] listening on 127.0.0.1:${PORT}`);
  console.log(`[coordinator] redis=${maskRedisUrl(REDIS_URL)}`);
});

function shutdown(signal) {
  console.log(`[coordinator] received ${signal}, shutting down`);
  server.close(() => {
    redis.quit().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
