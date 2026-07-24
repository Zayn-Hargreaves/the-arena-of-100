// ============================================================
// C2 — client reconnect state machine (generation-token serialized).
//
// The chaos test (C3) kills a node; its sockets drop and must reconnect
// to a live node (nginx `proxy_next_upstream` reroutes the new
// connection). The hand-framed k6 client has no reconnect — this module
// adds one and measures client recovery.
//
// `createReconnectController` is a PLAIN dependency-injected module: the
// reconnect action, timer functions, clock, and metric recorders are all
// passed in. That keeps the generation-token state machine runnable under
// vitest in Node (fake timers + a stub attempt) with no k6 runtime — see
// reconnect.test.mjs. `buildFlowReconnect` is the thin k6-side glue that
// wires a real socket attempt to a controller.
//
// Serialization invariant: at most ONE reconnect loop
// (connect→AUTHENTICATE→JOIN_ROOM→REQUEST_SNAPSHOT) runs per socket at a
// time. Repeated unexpected closes during backoff (a flapping node, a
// half-open socket closing again) join the running loop instead of
// spawning a parallel one, so exactly one `reconnect_ms`/`reconnect_success`
// sample is recorded per outage and no duplicate JOIN_ROOM is emitted.
//
// Generation token: every socket the controller considers "live" carries a
// monotonic generation. A close is attributed to the generation of the
// socket that fired it:
//   * an unexpected close from the live generation, with no loop running,
//     starts exactly one loop;
//   * a close from an OLDER generation (a stale/half-open socket closing
//     late) is ignored — it can't start a second loop;
//   * an intentional close (the client meant to leave) aborts any in-flight
//     loop and records nothing further, so retries never re-join after
//     teardown.
// ============================================================

const DEFAULT_BACKOFF = {
  baseMs: 200, // first retry delay
  maxMs: 2000, // delay cap
  maxAttempts: 10, // give up after this many attempts
  budgetMs: 30000, // ...or after this wall-clock budget, whichever first
};

// deps:
//   reconnectAttempt({ generation, isActive }) => Promise<boolean>
//     Performs one connect→AUTHENTICATE→JOIN_ROOM→REQUEST_SNAPSHOT against
//     a fresh socket, wiring that socket's onClose to
//     controller.handleClose(generation, intentional). Resolves true iff
//     ROOM_JOINED was reached. SHOULD poll isActive() between steps to
//     abort a superseded attempt early.
//   setTimeout / clearTimeout — timer fns (injectable for fake timers).
//   now() => ms — monotonic clock (injectable).
//   recordReconnectMs(ms) — Trend recorder (success only).
//   recordReconnectResult(bool) — Rate recorder (once per outage).
//   backoff — { baseMs, maxMs, maxAttempts, budgetMs }.
//   log(msg) — optional diagnostic sink.
export function createReconnectController(deps) {
  const {
    reconnectAttempt,
    setTimeout: setT = globalThis.setTimeout,
    clearTimeout: clearT = globalThis.clearTimeout,
    now = () => Date.now(),
    recordReconnectMs = () => {},
    recordReconnectResult = () => {},
    backoff = {},
    log = () => {},
  } = deps;

  if (typeof reconnectAttempt !== "function") {
    throw new Error("createReconnectController: reconnectAttempt is required");
  }

  const baseMs = backoff.baseMs ?? DEFAULT_BACKOFF.baseMs;
  const maxMs = backoff.maxMs ?? DEFAULT_BACKOFF.maxMs;
  const maxAttempts = backoff.maxAttempts ?? DEFAULT_BACKOFF.maxAttempts;
  const budgetMs = backoff.budgetMs ?? DEFAULT_BACKOFF.budgetMs;

  // Monotonic generation of every socket the controller has minted.
  let gen = 0;
  // Generation currently considered the live socket (0 = none live).
  let liveGen = 0;
  // Whether a reconnect loop is in flight, and an identity token for it so
  // superseded/aborted loops can detect they are no longer current.
  let running = false;
  let loopToken = null;
  let pendingTimer = null;
  let disposed = false;

  // Register the primary socket (the one the flow connected before any
  // outage). Returns its generation; the caller wires the primary socket's
  // onClose to handleClose(thatGeneration, intentional).
  function registerPrimary() {
    gen += 1;
    liveGen = gen;
    return gen;
  }

  function clearPending() {
    if (pendingTimer != null) {
      clearT(pendingTimer);
      pendingTimer = null;
    }
  }

  function abortLoop() {
    loopToken = null;
    running = false;
    clearPending();
  }

  // Called by every socket's close hook.
  function handleClose(sourceGen, intentional) {
    if (disposed) return;

    if (intentional) {
      // Teardown signal for the CURRENT live socket: abort any in-flight loop
      // and record nothing more. A stale/superseded socket (an older
      // generation closing itself — e.g. a failed or discarded reconnect
      // attempt) must NOT abort the loop that is still trying to recover, so
      // only honour it when it matches the live generation (or when nothing is
      // live, i.e. a teardown while mid-backoff).
      if (liveGen !== 0 && sourceGen !== liveGen) return;
      liveGen = 0;
      abortLoop();
      return;
    }

    // Unexpected close. Attribute it to the live generation; a close from an
    // older socket generation is stale and must not start a second loop.
    if (sourceGen !== liveGen) return;
    liveGen = 0; // the live socket is gone
    if (running) return; // already reconnecting for this outage
    startLoop();
  }

  function startLoop() {
    running = true;
    const token = {};
    loopToken = token;
    const startedAt = now();
    let attempt = 0;

    const finish = (success) => {
      if (loopToken !== token) return; // superseded / aborted
      running = false;
      loopToken = null;
      clearPending();
      if (success) recordReconnectMs(now() - startedAt);
      recordReconnectResult(success);
      log(
        `reconnect ${success ? "recovered" : "gave up"} after ${attempt} attempt(s), ${now() - startedAt}ms`,
      );
    };

    const runAttempt = async () => {
      if (loopToken !== token) return; // aborted before this attempt fired
      attempt += 1;
      const myGen = ++gen;
      liveGen = myGen;

      let joined = false;
      try {
        joined = await reconnectAttempt({
          generation: myGen,
          isActive: () => loopToken === token,
        });
      } catch (_e) {
        joined = false;
      }

      if (loopToken !== token) return; // aborted during the await -> no metric
      if (joined) {
        finish(true);
        return;
      }

      // Attempt failed: the socket it minted (if any) is not live.
      liveGen = 0;
      const elapsed = now() - startedAt;
      if (attempt >= maxAttempts || elapsed >= budgetMs) {
        finish(false);
        return;
      }
      const delay = Math.min(maxMs, Math.round(baseMs * 2 ** (attempt - 1)));
      pendingTimer = setT(() => {
        pendingTimer = null;
        if (loopToken !== token) return;
        runAttempt();
      }, delay);
    };

    runAttempt();
  }

  // Explicit teardown (flow lifetime ended): behaves like an intentional
  // close of whatever is live, so a loop mid-backoff never re-joins.
  function dispose() {
    disposed = true;
    liveGen = 0;
    abortLoop();
  }

  return {
    registerPrimary,
    handleClose,
    dispose,
    get running() {
      return running;
    },
    get generation() {
      return gen;
    },
    get liveGeneration() {
      return liveGen;
    },
  };
}

// k6-side glue: build the `reconnectAttempt` thunk from a flow's
// connect+wire machinery. Kept out of the pure controller so the state
// machine stays testable without a socket. `connectAndJoin` must create a
// fresh client (wiring its onClose to `onSocketClose(generation, intentional)`),
// re-attach the flow's event handlers, run AUTHENTICATE→JOIN_ROOM, emit
// REQUEST_SNAPSHOT, and resolve the live client (or null on failure).
export function buildFlowReconnect({ connectAndJoin, onControllerReady }) {
  let controller = null;

  const reconnectAttempt = async ({ generation, isActive }) => {
    const client = await connectAndJoin({
      generation,
      isActive,
      onClose: (intentional) =>
        controller && controller.handleClose(generation, intentional),
    });
    if (!client) return false;
    // A superseded attempt (newer loop / intentional close) discards its
    // freshly-joined client so it doesn't race the live one.
    if (!isActive()) {
      try {
        client.close();
      } catch (_e) {
        /* already closing */
      }
      return false;
    }
    if (onControllerReady) onControllerReady(client, generation);
    return true;
  };

  const bind = (c) => {
    controller = c;
  };

  return { reconnectAttempt, bind };
}
