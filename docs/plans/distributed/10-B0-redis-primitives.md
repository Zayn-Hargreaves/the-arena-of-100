# B0 — Redis lease + pub/sub primitives

**Depends on:** Stage A. **Blast radius:** additive, LOW (new methods only).
**Commit:** `feat(distributed): B0 redis lease + subscribe primitives`.

## Goal

Add the low-level building blocks every later phase needs, on
`apps/api/src/modules/redis/redis.service.ts`. No behavior change to existing callers.

Node identity already exists (`ClusterService.nodeId`) — do NOT add it here.

## Add to `RedisService`

1. **`acquireLease(key, value, ttlSec): Promise<boolean>`** — thin wrapper over the
   existing `setIfAbsent(key, value, ttlSec)` (SET NX EX). Returns true iff created.
   (Exists as a named intention-revealing alias so lease call sites read clearly.)

2. **`renewLease(key, expected, ttlSec): Promise<boolean>`** — atomic CAS renew via the
   existing `eval`. Lua:

   ```lua
   if redis.call('GET', KEYS[1]) == ARGV[1] then
     return redis.call('PEXPIRE', KEYS[1], ARGV[2])
   else
     return 0
   end
   ```

   Call: `eval(script, [key], [expected, String(ttlSec*1000)])`; return `result === 1`.
   (PEXPIRE takes ms.) Only renews if the stored value still equals `expected` — a node
   that lost the lease (value changed / expired-then-taken) gets `false`.

3. **`releaseLease(key, expected): Promise<boolean>`** — atomic CAS delete via `eval`. Lua:

   ```lua
   if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end
   ```

   Return `result === 1`. Prevents deleting a lease another node has already taken.

4. **`acquireLeaseWithFence(ownerKey, fenceKey, nodeId, ttlSec): Promise<{ fence: number; leaseValue: string } | null>`**
   — atomic lease-and-fence acquisition via `eval`. This is the low-level primitive B2b and
   B3b call when they need to claim ownership without a caller-side `INCR` / `SET NX` race.
   Lua:

   ```lua
   local currentOwner = redis.call('GET', KEYS[1])
   if currentOwner == false or currentOwner == nil or currentOwner == "" then
     local newFence = redis.call('INCR', KEYS[2])
     local leaseValue = ARGV[1] .. ":" .. tostring(newFence)
     redis.call('SET', KEYS[1], leaseValue, 'EX', ARGV[2])
     return {tostring(newFence), leaseValue}
   else
     return nil
   end
   ```

   `KEYS[1] = ownerKey`, `KEYS[2] = fenceKey`, `ARGV[1] = nodeId`, `ARGV[2] = ttlSec`.
   The wrapper must map the Lua array result into the declared object shape
   `{ fence, leaseValue }` only after fully validating it: `null` is returned
   **only** when Redis returns the Lua live-owner response, both array elements
   must exist, `fence` must parse to a finite positive integer, and
   `leaseValue` must be exactly `${nodeId}:${fence}`. Missing, malformed, or
   inconsistent payloads are infrastructure errors and must be thrown (or routed
   through an explicit verified compensation result) rather than collapsed to
   `null`, because the script may already have incremented the fence and stored
   the lease. The strict TypeScript return shape stays
   `Promise<{ fence: number; leaseValue: string } | null>`; `null` remains
   reserved strictly for the live-owner path where another node already holds
   the lease and the fence is guaranteed unchanged.

5. **`subscribe(channel, handler: (msg: string) => void): Promise<void>`** — ioredis cannot
   `subscribe` on the command connection, so lazily create and cache a dedicated subscriber:

   ```ts
   if (!this.subscriber) {
     this.subscriber = this.getClient().duplicate();
     // Register the single dispatch listener ONCE, up front — before any
     // subscribe() resolves — so no message published right after the
     // SUBSCRIBE confirmation can be missed.
     this.subscriber.on("message", (ch, msg) => {
       for (const h of this.handlers.get(ch) ?? []) h(msg);
     });
   }
   const list =
     this.handlers.get(channel) ?? this.handlers.set(channel, []).get(channel)!;
   list.push(handler);
   try {
     await this.subscriber.subscribe(channel);
   } catch (err) {
     // Roll back the handler we just added so a retried subscribe() cannot
     // accumulate duplicate handlers for the same (channel, handler).
     const i = list.indexOf(handler);
     if (i !== -1) list.splice(i, 1);
     if (list.length === 0) this.handlers.delete(channel);
     throw err;
   }
   ```

   Keep `subscriber` + `handlers: Map<channel, handler[]>` as private fields. The `"message"`
   listener is attached at connection creation (not per-subscribe), and the handler is added to
   the map **before** awaiting `subscribe()`, so the dispatch path is live the instant the
   subscription is confirmed. **If `subscribe()` rejects, remove the just-added handler** (as
   above) so a retry does not leave a duplicate behind.
   **`unsubscribe(channel, handler): Promise<void>` is a required deliverable of this phase
   alongside `subscribe`** (not an optional nicety — B4/B5 consumers release per-match/per-room
   subscriptions on lease loss). It must remove **only that specific handler** from the channel's
   list (reference-counting semantics), preserving other consumers' handlers; only when the list
   becomes empty does it drop the map entry **and** `await subscriber.unsubscribe(channel)`. Never
   tear down a channel that still has live handlers.
   **Lifecycle operations are serialized per channel:** `subscribe`/`unsubscribe` for the same
   channel run through a per-channel promise chain (a simple `Map<channel, Promise<void>>` tail
   each operation appends to), so a final unsubscribe and a fresh subscribe can never interleave
   their Redis calls. This is what protects a handler added **during** an in-flight final
   unsubscribe: the new `subscribe()` is queued behind the pending `subscriber.unsubscribe`, and
   once that settles the queued subscribe re-issues `subscriber.subscribe(channel)`, so the new
   handler ends up live regardless of the interleaving.
   **Rejection handling keeps the local map consistent with Redis — on BOTH lifecycle
   operations:**
   - If `subscriber.unsubscribe(channel)` rejects on the final removal, the handler stays removed
     locally (the caller asked for that) but the operation must reconcile the channel state —
     either retry the Redis unsubscribe, or, if handlers have been re-added meanwhile, leave the
     still-active Redis subscription in place (it is now wanted again) — and then rethrow/log so
     the caller sees the failure.
   - If `subscriber.subscribe(channel)` **rejects**, the handler rollback above runs first, but
     the rejection may have raced an **already-accepted** SUBSCRIBE (e.g. a timeout or dropped
     reply after Redis processed the command), leaving the connection subscribed with no local
     dispatch target. So after the rollback, reconcile against the channel's **current** handler
     list (still inside the same per-channel chain): if handlers remain (other consumers), the
     Redis subscription is wanted regardless — keep it and retry nothing; if the list is now
     empty, issue `subscriber.unsubscribe(channel)` with a **bounded verified retry** (e.g. 3
     attempts). Reconciliation is complete only when one of these holds:
     1. the unsubscribe (or a retry) **succeeds** — no orphaned subscription remains; or
     2. every retry failed → **escalate to a subscriber reset behind a GLOBAL barrier**. A reset
        touches every channel on the connection, so the per-channel chains are not enough: keep
        a shared `resetInProgress: Promise<void> | null` field that **every** channel's
        lifecycle operation (subscribe and unsubscribe, on all channels) awaits **at its entry
        point — BEFORE mutating the handler map, not merely before its Redis call**. The map
        mutation happens ahead of the awaited Redis command in the normal flow (the handler is
        pushed before `subscriber.subscribe`), so a barrier that only gates Redis calls would
        let the map change mid-rebuild and leave the rebuilt set stale. **The entry barrier
        alone is still not enough:** an operation **admitted before the reset started** can be
        mid-flight when the reset begins — its map mutation lands while the rebuild is
        snapshotting or replaying the map. Coordinate both directions, in one of two ways:
        - **Serialize mutations with the reset (reader/writer discipline):** every lifecycle op
          registers as in-flight on entry and deregisters when settled; the reset (the writer)
          first sets `resetInProgress` (blocking NEW entries), then **awaits the drain of every
          already-admitted op** before disconnecting — no handler-map mutation can then overlap
          the rebuild.
        - **Or keep the barrier active until admitted ops finish, then reconcile last:** run the
          disconnect + rebuild, let the previously-admitted ops settle while the barrier still
          holds, and finish with the **post-rebuild reconciliation pass** that re-diffs the
          just-rebuilt subscriptions against the **latest** handler map,
          subscribing/unsubscribing the delta. **The reset resolves only after this
          reconciliation finds no remaining delta** (re-run the diff whenever a delta was
          applied).
          **Reset handoff — the initiator must not deadlock itself.** The reset is triggered from
          INSIDE a lifecycle operation (this escalation branch of a failed `subscribe()`
          reconciliation), and that operation is itself registered as in-flight / admitted. A
          naive "drain every admitted op" would wait on the initiator, which is waiting on the
          reset — a self-deadlock. Define the handoff explicitly: **before the reset starts
          draining (or settle-waiting), the initiating operation deregisters from the in-flight
          set and becomes quiescent** — its map work is already done (handler rolled back), it
          performs **no further map mutations or Redis calls of its own**, and the remainder of
          the operation is only awaiting the reset's outcome to decide what to rethrow.
          Equivalently, the reset may **explicitly exclude the initiator** from its drain set —
          but then the initiator must be barred from any further mutation from the moment it
          initiated the reset. Either form removes the cycle: the reset drains everyone else,
          rebuilds, and only then settles the initiator.
          Both variants preserve the retryable-failure handling below for incomplete rebuilds.
          Under the barrier the reset itself does:
          `subscriber.disconnect()` (or `quit()`), drop the cached connection, then **recreate the
          subscriber via the same lazy-create path — including re-registering the single
          `"message"` dispatch listener on the NEW connection before any re-subscribe resolves**
          (a rebuilt connection without the dispatch listener would silently drop every message),
          then rebuild the wanted set from the handler map — re-`subscribe` every channel whose
          list is non-empty (the map is the source of truth). **The reset counts as successful
          ONLY when every channel with a non-empty handler list has been re-subscribed** (and the
          post-rebuild reconciliation, if used, found no remaining delta). If any rebuild
          subscribe fails, the reconciliation is NOT complete — but the barrier must never be
          left **permanently pending or rejected** (that would deadlock every future lifecycle
          op): settle the failed barrier by recording a retryable failure state (e.g. clear
          `resetInProgress` and set `resetPending = true`), log the rebuild failure at error
          level, and reject the pending operation with the reconciliation failure. The **next
          lifecycle operation** (or a bounded background retry) must then start a **fresh reset
          attempt** — replacing the failed one and re-running the full rebuild — before doing its
          own work; do **not** complete any operation by merely rethrowing the original subscribe
          error over a partially rebuilt wanted set.
          Only **after** outcome 1, or a reset whose **full** wanted-set rebuild completed, confirms
          no orphaned subscription remains does the operation rethrow the **original** subscribe
          error (the reconciliation/reset failure, if any, is logged as its own error). Never
          rethrow-and-return while a possibly-accepted subscription is unaccounted for or the rebuild
          is incomplete.

   The invariant after any settled operation: the channel has a live
   Redis subscription **iff** its handler list is non-empty (transient divergence only while an
   operation is in flight, never after it settles). In `onModuleDestroy` (add if absent)
   `await this.subscriber?.quit()` (retain this connection-level cleanup unchanged).

`publish(channel, msg)` already exists. Note the transport split: the **B4 command channel is a
Redis Stream** (`match:cmd:<matchId>`, `XADD`/`XREADGROUP`/`XACK` — see `01-REFERENCE.md` key
schema and `50-B4a`), so B4 does **not** reuse `publish`; B4a adds its own typed stream wrappers.
`publish`/`subscribe` stay reserved for fire-and-forget pub/sub only (safe-to-lose nudges — a
dropped message must never be a correctness loss). B5's leader election is lease-based
(`acquireLease`/`renewLease`) and its IN_GAME disconnect forwarding rides the B4 stream, not
pub/sub.

## Tests — `redis.service.spec.ts` (extend, or a focused new describe)

Prefer a real Redis (compose `redis` on :6389) or `ioredis-mock`. Assert:

- `acquireLease` returns true first time, false while held.
- `renewLease` returns true when value matches; **false when value differs** (simulate a
  different owner) and does not extend TTL.
- `releaseLease` deletes only when value matches; false + key intact when it differs.
- `acquireLeaseWithFence` returns `{ fence, leaseValue }` on the first acquisition, returns `null`
  while a lease is held, and does **not** advance the fence on the failed path.
- `acquireLeaseWithFence` surfaces an infrastructure error (or verified compensation result)
  when the Lua response is malformed/truncated after the script may already have written the
  lease. Simulate `INCR` + `SET ownerKey nodeId:fence` succeeding before Redis returns a
  truncated payload (for example `["1"]`): the wrapper must not return `null`, the caller must
  see either an infrastructure error or an explicit verified-compensation result, and Redis must
  remain internally consistent (`fenceKey` contains that fence and `ownerKey` contains
  `${nodeId}:${fence}` unless compensation proves it safely removed only that exact lease).
  If compensation is implemented, add a race test where a newer owner takes the lease before
  cleanup; compensation must not delete the newer owner's `ownerKey` value.
- `subscribe` + `publish` round-trips a message to the handler; a second channel on the
  same subscriber connection is isolated.
- **No-miss race:** publish on `channel` **immediately after** `await subscribe(channel)`
  resolves → the handler still receives it (proves the dispatch listener + handler-map entry
  were live before the SUBSCRIBE confirmation). Use a real Redis (or ioredis-mock) with an
  `await`ed subscribe, then `publish` on the next line and assert delivery within a short poll.
- **`unsubscribe` — partial removal:** two handlers on one channel; `unsubscribe(channel, h1)`
  removes only `h1` — a subsequent `publish` still reaches `h2`, and
  `subscriber.unsubscribe(channel)` was **not** called (channel stays live).
- **`unsubscribe` — final removal / teardown:** unsubscribing the last handler drops the map
  entry and calls `subscriber.unsubscribe(channel)`; a message published afterwards is delivered
  to no handler.
- **Retry / re-subscribe without duplicate delivery:** after a rejected `subscribe()` (handler
  rolled back per above), a retried `subscribe(channel, handler)` that succeeds delivers each
  published message **exactly once** to that handler; likewise `unsubscribe` + fresh `subscribe`
  of the same handler never results in double delivery.
- **Interleaved final-unsubscribe + new subscribe:** start `unsubscribe(channel, lastHandler)`
  but hold its `subscriber.unsubscribe` un-settled (mock or slow Redis); call
  `subscribe(channel, newHandler)` while it is in flight. After both settle, a published message
  **is delivered to `newHandler`** (the per-channel serialization re-subscribed or preserved the
  channel), the handler map contains exactly `newHandler`, and no operation left the map and the
  Redis subscription disagreeing. Also cover the rejection branch: `subscriber.unsubscribe`
  rejects on final removal → the error surfaces to the caller and a subsequent
  `subscribe(channel, h)` still yields exactly-once delivery.
- **Accepted SUBSCRIBE + failed reconciliation unsubscribe (escalation path):** simulate a
  `subscribe()` whose Redis SUBSCRIBE was **accepted** but whose reply is dropped (the wrapper
  sees a rejection), with a second live channel subscribed on the same connection; make the
  reconciliation `subscriber.unsubscribe(channel)` fail on **every** bounded retry. Assert the
  wrapper escalates to the subscriber reset: the connection is dropped/recreated, the wanted set
  is rebuilt from the handler map (the second channel's handler still receives published
  messages afterwards), **no message is ever dispatched for the orphaned channel** (no live
  subscription without handlers survives the reset), and the error surfaced to the caller is the
  **original** subscribe error. Also assert the **barrier**: a `subscribe()` on a third channel
  issued while the reset is in flight does not reach Redis until the rebuild completes.
- **Reset handoff — no self-deadlock from the initiating op:** drive the same escalation path
  (failed `subscribe()` reconciliation triggers the reset) under the reader/writer discipline
  with the initiator still formally "in flight". Assert the reset **completes** (does not hang
  waiting for its own initiator): the initiator deregistered/was excluded from the drain set
  before the drain began, performed **no further map mutations or Redis calls** after
  initiating the reset, and only after the reset settled did it reject with the original
  subscribe error. Guard the test with a timeout so a reintroduced drain-on-initiator cycle
  fails fast instead of hanging the suite.
- **Rejected SUBSCRIBE on a channel that already has a live handler:** channel has an active
  `h1` (subscribed and receiving); a new `subscribe(channel, h2)` is rejected **before** Redis
  accepts it. Assert `h1` remains registered in the handler map and **continues receiving
  published messages afterwards** — the channel's existing Redis subscription is untouched
  (reconciliation must not tear down a channel whose handler list is non-empty); `h2` is rolled
  back and the caller sees the subscribe error. If the implementation escalates to a reset in
  this scenario, the rebuild must restore the channel so `h1` still receives — this test is
  separate from (and preserves) the orphan-channel assertions above.

Unit-level (no real Redis): mock `eval` and assert the exact Lua + args are passed
(KEYS/ARGV order), and the boolean mapping (`1 → true`, `0 → false`).

## Verify / done

- `pnpm --filter @arena/api exec vitest run src/modules/redis/redis.service.spec.ts` green.
- `pnpm --filter @arena/api build` + `lint` clean.
- Existing RedisService callers unaffected (full suite still 984+ green).
