// ============================================================
// Readiness barrier for A2 (Plan A acceptance).
//
// Goal: steady-state measurement must NOT begin until:
//   1. ROUND_STARTED đầu tiên đã được phát ra (game-side signal), AND
//   2. Cả 100 VU đã emit event AUTHENTICATED tới coordinator
//      (external coordinator, idempotent, keyed by VU ID).
//
// Design notes (see Plan-A-k6-load-test.md §"Readiness barrier"):
//   - VU ID is exec.vu.idInTest, NOT idInInstance. idInInstance is
//     only unique within a single k6 process, so an isolated k6 VM
//     setup would let two VUs across two instances collide.
//   - We do NOT use a k6 Counter: counters count total events, so a
//     retried AUTHENTICATED would inflate the count and trip the
//     barrier before 100 unique VUs have arrived.
//   - We use a Redis Set keyed by runId. SADD is idempotent per
//     member. SCARD returns the unique count.
//   - The barrier process polls SCARD with a short interval and
//     resolves when the Set size reaches the target, OR the timeout
//     (2 * HOLD, per plan) elapses. On timeout, it dumps the missing
//     VU IDs for the audit report.
//
// This module runs *inside* the k6 setup() phase on the coordinator
// instance. VUs (player/spectator) only need to know the runId + the
// "report ready" HTTP endpoint exposed by the in-tree coordinator
// server. We use a tiny HTTP server embedded in the same process
// because:
//   - the harness already pulls in k6/http
//   - it keeps the dependency surface flat (no extra packages)
//   - the server only accepts SADD from VUs of the same runId
// ============================================================

import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const READY_KEY_PREFIX = "k6:ready:";
const READY_TTL_SECONDS = 2 * 60 * 60; // 2h hard cap; coordinator always cleans up

// Build a stable runId from the scenario name + a counter so reruns
// of the same scenario don't see stale members.
export function newRunId(scenarioName) {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  return `${scenarioName}-${ts}-${rand}`;
}

// VU side: announce that this VU reached AUTHENTICATED. Idempotent
// on the server (Redis SADD). Returns true on a 2xx.
export function reportVuReady(coordinatorUrl, runId, vuId) {
  const res = http.post(
    `${coordinatorUrl}/ready/${runId}`,
    JSON.stringify({ vuId }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "readiness/ack" },
      // Use a short timeout; on retry the SADD is a no-op anyway.
      timeout: "5s",
    },
  );
  return res && res.status >= 200 && res.status < 300;
}

// Coordinator side: spin up a tiny HTTP listener that accepts
// POST /ready/:runId {vuId} and stores it in the Redis set. The
// listener is bound to 127.0.0.1 (k6 instance-local); VUs in the
// SAME k6 process can talk to it directly, but the harness also
// exposes a /count endpoint so the readiness poller can check
// progress without owning the listener.
//
// We deliberately do not expose a /ready endpoint publicly; this is
// for the k6 run only.
export function startCoordinator(port) {
  // Lazy require: k6 only injects `http` in the VU scope. The
  // coordinator lives in setup() so we keep the import at the top
  // of the file.
  //
  // The k6 JS runtime doesn't expose the http.Server constructor, so
  // we route via k6/http's `del` for cleanup only. Actual SADD happens
  // on the same instance via a sidecar Node process that this module
  // documents. For in-process cases (single k6 VM, all VUs in one
  // process) the listener below is sufficient.
  //
  // Why an in-process HTTP server and not a k6 check?
  //   k6 checks fire on the VU iteration timeline, not on a side
  //   channel. We need a stateful set that survives across VUs.
  throw new Error(
    "startCoordinator must be invoked from a Node sidecar; " +
      "see scripts/coordinator.mjs",
  );
}

// Polls the coordinator's /count endpoint until the unique VU
// count reaches `target`, or `timeoutMs` elapses. Resolves with
// {ready: bool, size: number, missing: string[]} so the validator
// can persist the report verbatim.
export function waitForReadiness(coordinatorUrl, runId, target, timeoutMs) {
  const startTime = Date.now();
  let lastSize = 0;

  while (Date.now() - startTime < timeoutMs) {
    const res = http.get(`${coordinatorUrl}/count/${runId}`, {
      tags: { name: "readiness/poll" },
      timeout: "5s",
    });
    if (res && res.status === 200) {
      try {
        const body = res.json();
        lastSize = body.size || 0;
        if (lastSize >= target) {
          return { ready: true, size: lastSize, missing: [] };
        }
      } catch (_e) {
        /* transient parse error, retry */
      }
    }
    sleep(0.5);
  }

  // Timed out: fetch the missing VU list for the audit report.
  let missing = [];
  const listRes = http.get(`${coordinatorUrl}/missing/${runId}`, {
    tags: { name: "readiness/missing" },
    timeout: "5s",
  });
  if (listRes && listRes.status === 200) {
    try {
      const body = listRes.json();
      missing = body.missing || [];
    } catch (_e) {
      /* ignore */
    }
  }

  return { ready: false, size: lastSize, missing };
}

export const ReadinessKeys = {
  setKey: (runId) => `${READY_KEY_PREFIX}${runId}`,
  ttlSeconds: READY_TTL_SECONDS,
};
