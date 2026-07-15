# C2 — Reconnect in the k6 client

**Depends on:** C1. **Blast radius:** load-test harness only.
**Commit:** `test(distributed): C2 reconnect + metrics in k6 client`.

## Why

The chaos test (C3) kills a node; its sockets drop and must reconnect to a live node (nginx
`proxy_next_upstream` reroutes the new connection). The current hand-framed client
(`load-test/lib/socketio.js` / `flows.js`) has no reconnect — add one so the failover run can
measure client recovery.

## New file — `load-test/lib/reconnect.js` (or extend `flows.js`)

A wrapper around the existing connect→AUTHENTICATE→JOIN_ROOM sequence that, on a **non-intentional**
close (`onClose(intentional=false)` in `flows.js` — the `wsUnexpectedDisconnect` path already
detects this), retries:

1. reconnect the socket (new Engine.IO handshake to `wsBase` — nginx routes to a live node),
2. re-`AUTHENTICATE {token}` → AUTHENTICATED,
3. re-`JOIN_ROOM {roomCode}` → ROOM_JOINED,
4. `REQUEST_SNAPSHOT {matchId, lastSeenSeqNo}` (the gateway path exists — this resyncs the
   client mid-match; `lastSeenSeqNo` is already tracked in the delta-replay contract),
   with capped exponential backoff (e.g. 200ms → 2s, max ~10 attempts / 30s).

**Serialize reconnect attempts per socket/player.** A per-client guard ensures at most **one**
reconnect loop (connect→AUTHENTICATE→JOIN_ROOM→REQUEST_SNAPSHOT) runs at a time — repeated
`onClose` events during backoff (a flapping node, a half-open socket closing again) must **not**
spawn parallel loops. Implement it with a monotonic **generation token** (or equivalent
cancellation flag) captured at loop start:

- any event from an older generation (a stale socket's close/open, a late backoff timer) is
  ignored — stale attempts are invalidated rather than raced;
- an **intentional close** bumps the generation, so in-flight retries abort and never re-join
  after the client meant to leave;
- one unexpected close starts exactly one measurement: a close observed while a reconnect loop
  for the same socket is already running joins that loop instead of starting a duplicate — this
  is what keeps `reconnect_ms` / `reconnect_success` from double-counting and prevents duplicate
  `JOIN_ROOM`s.

Record two metrics (`load-test/lib/metrics.js`):

- `reconnect_ms` (Trend) — time from unexpected-close to ROOM_JOINED again.
- `reconnect_success` (Rate) — fraction of unexpected closes that recovered within the budget.

## Tests / validation

**Deterministic unit tests for the generation/cancellation logic** (this part is NOT exempt
from testing): write the reconnect wrapper as a plain dependency-injected module (socket
factory, timer functions, and metric recorders passed in), so the generation-token state
machine runs under vitest in Node — no k6 runtime needed. Using **fake timers** and a **socket
stub / injected events**:

- emit repeated `onClose` events while a backoff timer is pending → exactly **one** reconnect
  loop runs, exactly **one** `reconnect_ms`/`reconnect_success` sample is recorded for the
  outage, and the stub saw **no duplicate `JOIN_ROOM`** frames;
- emit an **intentional close** while retries are pending → the generation bump invalidates
  them: advancing all timers produces **no** further connect/AUTHENTICATE/JOIN_ROOM attempts
  and no metric sample after teardown;
- a stale socket's late event (old generation) arriving after a new loop started is ignored.

k6-level validation stays as the integration check: `k6 inspect
load-test/scenarios/failover-match.js` parses (C3 file), and a dry run against `docker:multi`
where you `docker restart` one node — **twice in quick succession** for the flapping case —
confirms `reconnect_success` > 0, `reconnect_ms` populated, and one loop/sample per outage.

## Done

- Reconnect wrapper wired into player/spectator flows behind a flag/env (so the steady-state
  scenarios are unaffected). `reconnect_ms` / `reconnect_success` show up in a run summary.
