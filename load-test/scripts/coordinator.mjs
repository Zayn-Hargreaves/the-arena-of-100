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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const readyMatch = url.pathname.match(/^\/ready\/([^/]+)$/);
  if (req.method === "POST" && readyMatch) {
    const runId = readyMatch[1];
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || e) }));
      return;
    }
    const vuId = body && body.vuId ? String(body.vuId) : null;
    if (!vuId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "vuId required" }));
      return;
    }
    try {
      await redis.sadd(setKey(runId), vuId);
      await redis.expire(setKey(runId), TTL_SECONDS);
      const size = await redis.scard(setKey(runId));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, size }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  const countMatch = url.pathname.match(/^\/count\/([^/]+)$/);
  if (req.method === "GET" && countMatch) {
    const runId = countMatch[1];
    const target = Number.parseInt(
      url.searchParams.get("target") || "0",
      10,
    );
    try {
      const size = await redis.scard(setKey(runId));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ size, target }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  const missingMatch = url.pathname.match(/^\/missing\/([^/]+)$/);
  if (req.method === "GET" && missingMatch) {
    const runId = missingMatch[1];
    const target = Number.parseInt(
      url.searchParams.get("target") || "0",
      10,
    );
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
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ missing, size: members.length }));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[coordinator] listening on 127.0.0.1:${PORT}`);
  console.log(`[coordinator] redis=${REDIS_URL.replace(/:[^@/]+@/, ":***@")}`);
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
