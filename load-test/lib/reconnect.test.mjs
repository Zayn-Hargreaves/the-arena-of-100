// ============================================================
// C2 — deterministic unit tests for the reconnect generation/cancellation
// state machine. Pure Node (no k6 runtime): a manual fake scheduler drives
// time, a stub `reconnectAttempt` counts attempts (each attempt == one
// connect→AUTHENTICATE→JOIN_ROOM sequence). No real socket involved.
//
//   node_modules/.bin/vitest run --config load-test/vitest.config.mjs
// ============================================================

import { describe, it, expect } from "vitest";
import { createReconnectController } from "./reconnect.js";

// A deterministic timer scheduler: setTimeout/clearTimeout/now are handed to
// the controller; advance() fires due timers in time order, flushing
// microtasks between each so the async attempt continuation runs.
function makeScheduler() {
  let t = 0;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn }

  async function flush(rounds = 8) {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
  }

  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    pending: () => timers.size,
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, tm] of timers) {
          if (tm.at <= target && tm.at < nextAt) {
            nextAt = tm.at;
            nextId = id;
          }
        }
        if (nextId === null) break;
        const tm = timers.get(nextId);
        timers.delete(nextId);
        t = tm.at;
        tm.fn();
        await flush();
      }
      t = target;
      await flush();
    },
    async settle() {
      await flush();
    },
  };
}

// Build a controller + a metric spy + an attempt stub whose per-call outcome
// comes from `outcomes` (a function attempt# -> boolean, true == joined). If
// `outcomes(n)` returns an Error, the attempt promise REJECTS with it instead
// of resolving — mirroring a real network/handshake failure that throws. The
// controller catches such rejections and treats them exactly like a false
// (not-joined) outcome, so the same retry/give-up/metrics expectations apply.
function setup({ outcomes, backoff }) {
  const sched = makeScheduler();
  const metrics = { ms: [], results: [] };
  let attemptCount = 0;

  const controller = createReconnectController({
    reconnectAttempt: async () => {
      attemptCount += 1;
      const n = attemptCount;
      // resolve on a microtask, mimicking a real async handshake
      await Promise.resolve();
      const outcome = outcomes(n);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    setTimeout: sched.setTimeout,
    clearTimeout: sched.clearTimeout,
    now: sched.now,
    recordReconnectMs: (v) => metrics.ms.push(v),
    recordReconnectResult: (v) => metrics.results.push(v),
    backoff,
  });

  return {
    controller,
    sched,
    metrics,
    attempts: () => attemptCount,
  };
}

describe("reconnect controller — generation/cancellation", () => {
  it("serializes: repeated unexpected closes during backoff run exactly one loop / one sample", async () => {
    // attempt 1 fails, attempt 2 succeeds.
    const { controller, sched, metrics, attempts } = setup({
      outcomes: (n) => n >= 2,
      backoff: { baseMs: 200, maxMs: 2000, maxAttempts: 10, budgetMs: 30000 },
    });

    const primary = controller.registerPrimary();
    // Primary drops unexpectedly -> starts the loop; attempt 1 runs & fails.
    controller.handleClose(primary, false);
    await sched.settle();
    expect(attempts()).toBe(1);
    expect(controller.running).toBe(true);
    expect(sched.pending()).toBe(1); // backoff timer armed

    // Flapping: many more unexpected closes WHILE the backoff timer is
    // pending. They must NOT start parallel loops or extra attempts.
    for (let i = 0; i < 5; i++) controller.handleClose(primary, false);
    controller.handleClose(999, false); // an unrelated/stale gen too
    await sched.settle();
    expect(attempts()).toBe(1); // still just the one in-flight attempt

    // Advance past the backoff -> attempt 2 fires and succeeds.
    await sched.advance(200);
    expect(attempts()).toBe(2);
    expect(controller.running).toBe(false);

    // Exactly one outage => exactly one success sample + one ms sample.
    expect(metrics.results).toEqual([true]);
    expect(metrics.ms.length).toBe(1);
    expect(metrics.ms[0]).toBeGreaterThanOrEqual(200);
  });

  it("intentional close during backoff aborts: no further attempts, no metric sample", async () => {
    const { controller, sched, metrics, attempts } = setup({
      outcomes: () => false, // never joins
      backoff: { baseMs: 200, maxMs: 2000, maxAttempts: 10, budgetMs: 30000 },
    });

    const primary = controller.registerPrimary();
    controller.handleClose(primary, false); // unexpected -> loop, attempt 1 fails
    await sched.settle();
    expect(attempts()).toBe(1);
    expect(sched.pending()).toBe(1);

    // Client intends to leave while retries are pending.
    controller.handleClose(primary, true);
    expect(controller.running).toBe(false);

    // Advancing ALL timers must produce no further attempts and no sample.
    await sched.advance(60000);
    expect(attempts()).toBe(1);
    expect(metrics.results).toEqual([]);
    expect(metrics.ms).toEqual([]);
  });

  it("ignores a stale (older-generation) close after a new loop already recovered", async () => {
    // attempt 1 succeeds immediately -> the loop mints a newer live gen.
    const { controller, sched, metrics, attempts } = setup({
      outcomes: () => true,
      backoff: { baseMs: 200 },
    });

    const primary = controller.registerPrimary(); // gen 1
    controller.handleClose(primary, false); // unexpected -> loop; attempt 1 joins (gen 2 live)
    await sched.settle();
    expect(attempts()).toBe(1);
    expect(controller.running).toBe(false);
    expect(controller.liveGeneration).toBe(2);
    expect(metrics.results).toEqual([true]);

    // A late close from the OLD primary socket (gen 1) arrives after the new
    // socket (gen 2) is live. It must be ignored — no second loop.
    controller.handleClose(primary, false);
    await sched.settle();
    expect(attempts()).toBe(1);
    expect(controller.running).toBe(false);
    expect(metrics.results).toEqual([true]); // unchanged
  });

  it("records failure once when the attempt budget is exhausted", async () => {
    const { controller, sched, metrics, attempts } = setup({
      outcomes: () => false,
      backoff: { baseMs: 100, maxMs: 400, maxAttempts: 3, budgetMs: 30000 },
    });

    const primary = controller.registerPrimary();
    controller.handleClose(primary, false);
    await sched.settle(); // attempt 1
    await sched.advance(100); // attempt 2
    await sched.advance(200); // attempt 3 -> maxAttempts reached
    await sched.advance(5000); // nothing left to fire

    expect(attempts()).toBe(3);
    expect(controller.running).toBe(false);
    expect(metrics.results).toEqual([false]); // one give-up sample
    expect(metrics.ms).toEqual([]); // no success -> no latency sample
  });

  it("a rejected attempt is handled like a failed one (retries, one give-up sample)", async () => {
    // Every attempt REJECTS with a realistic transport/handshake error rather
    // than resolving false. The controller's try/catch must swallow it and
    // follow the identical retry -> give-up path, metrics, and scheduling as
    // the false-outcome budget-exhaustion case above.
    const { controller, sched, metrics, attempts } = setup({
      outcomes: () => new Error('connect_error: {"message":"ECONNREFUSED"}'),
      backoff: { baseMs: 100, maxMs: 400, maxAttempts: 3, budgetMs: 30000 },
    });

    const primary = controller.registerPrimary();
    controller.handleClose(primary, false);
    await sched.settle(); // attempt 1 rejects
    await sched.advance(100); // attempt 2 rejects
    await sched.advance(200); // attempt 3 rejects -> maxAttempts reached
    await sched.advance(5000); // nothing left to fire; no unhandled rejection

    expect(attempts()).toBe(3);
    expect(controller.running).toBe(false);
    expect(metrics.results).toEqual([false]); // one give-up sample, same as false
    expect(metrics.ms).toEqual([]); // no success -> no latency sample
  });

  it("recovers after a rejected attempt (rejection then join)", async () => {
    // Attempt 1 rejects (transient network error), attempt 2 joins — the
    // rejection must not abort the loop; recovery proceeds like a false->true.
    const { controller, sched, metrics, attempts } = setup({
      outcomes: (n) =>
        n >= 2 ? true : new Error("websocket error during handshake"),
      backoff: { baseMs: 200, maxMs: 2000, maxAttempts: 10, budgetMs: 30000 },
    });

    const primary = controller.registerPrimary();
    controller.handleClose(primary, false);
    await sched.settle();
    expect(attempts()).toBe(1); // attempt 1 rejected
    expect(controller.running).toBe(true);
    expect(sched.pending()).toBe(1); // backoff timer armed

    await sched.advance(200); // attempt 2 fires and joins
    expect(attempts()).toBe(2);
    expect(controller.running).toBe(false);
    expect(metrics.results).toEqual([true]); // one recovery sample
    expect(metrics.ms.length).toBe(1);
  });

  it("a fresh unexpected outage after a recovery starts a new measurement", async () => {
    const { controller, sched, metrics, attempts } = setup({
      outcomes: () => true, // every attempt joins
    });

    const primary = controller.registerPrimary(); // gen 1
    controller.handleClose(primary, false); // outage 1 -> gen 2 live
    await sched.settle();
    expect(controller.liveGeneration).toBe(2);

    // A second, independent outage on the now-live socket. Read the live
    // generation from the controller instead of hardcoding it, so the test
    // tracks whatever generation the recovery actually minted.
    controller.handleClose(controller.liveGeneration, false);
    await sched.settle();
    expect(controller.liveGeneration).toBe(3);

    expect(attempts()).toBe(2);
    expect(metrics.results).toEqual([true, true]); // two outages, two samples
    expect(metrics.ms.length).toBe(2);
  });
});
