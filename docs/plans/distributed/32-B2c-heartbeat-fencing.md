# B2c — Heartbeat + fencing (`assertOwnership`)

**Depends on:** B2b. **Blast radius:** `MatchRoundRunner` (CRITICAL — B1a).
**Commit:** `feat(distributed): B2c ownership heartbeat + fencing`.

## Goal

Keep leases alive while a node runs a match, relinquish immediately on lease loss, and
**fence** the three mutating boundaries so a stale owner can't double-drive a match.

## Heartbeat — `match-ownership.service.ts`

- `onModuleInit`: start `setInterval(() => this.heartbeat(), HEARTBEAT_MS)` (`HEARTBEAT_MS = 5000`;
  renews the 15s lease 3× before expiry). Clear in `onModuleDestroy`.
- `heartbeat()`: for each `[matchId, {leaseValue}]` in `owned`, `renewLease(ownerKey(matchId),
leaseValue, LEASE_TTL_SEC)`. If it returns **false** (lease lost — expired then taken, or fence
  bumped), **relinquish**: call the injected `roundRunner.cancelMatchLoop(matchId)` (clears timers
  **without firing**), `this.owned.delete(matchId)`, log a warning. Do NOT `releaseLease` here —
  the new owner holds it now.
- Guard against overlapping ticks with an in-flight boolean (like `PresenceService.isSweeping`).

> Wiring note: `MatchRoundRunner` is `new`'d inside `GameLoopService` (~47), not DI. Give
> `MatchOwnershipService` a setter (`setRoundRunner(runner)`) that `GameLoopService` calls in
> its constructor/onModuleInit, OR expose `cancelMatchLoop` via `GameLoopService`. Avoid a DI
> cycle. `cancelMatchLoop` must already exist (used by admin terminate); reuse it.

## Fencing — `match-ownership.service.ts` + `match-round-runner.ts`

- Add `async assertOwnership(matchId): Promise<boolean>` to `MatchOwnershipService`: returns
  false if not in `owned`; else `renewLease(ownerKey, leaseValue, LEASE_TTL_SEC)` (a renew
  doubles as the fence check — a resurrected old owner whose fence was bumped gets false).
- In `match-round-runner.ts`, at the **top of each mutating boundary** — `endRound` (~275,
  right by the H1 `beginEndRound` guard), `checkMatchEnd` (~651), `finishMatchLoopInner` (~706):
  ```ts
  if (!(await this.ownership.assertOwnership(matchId))) {
    this.logger.warn(
      `assertOwnership failed for ${matchId} — not owner, aborting`,
    );
    return; // no state mutation, no broadcast
  }
  ```
  Inject `MatchOwnershipService` into `MatchRoundRunner` (constructor param, passed from
  `GameLoopService` where the runner is constructed).

## Why this is safe

DB idempotency alone is **not** sufficient to call the residual TOCTOU (pass assert → pause →
lose lease → resume → write) safe: `@@unique([matchId, roundNo])` stops a _duplicate row_, but a
stale owner could still write _different_ content for the current round or fire a broadcast a new
owner didn't. **The fenced Lua CAS on the canonical match:state write is the sole release guard required for shipping B2c.** `ownerFence` is maintained purely as an audit backstop. Guard layers:

1. **Atomic Lease-and-Fence Acquisition and Fenced CAS — the release guards.** The canonical
   runtime store is `match:state:<matchId>` in Redis (see `01-REFERENCE.md` §"Match state
   persistence"). To ensure the lease value and the fence counter never drift and failed
   takeover/launch attempts leave the current owner's fence unchanged, lease acquisition (both
   on launch and takeover) uses an **atomic lease-and-fence acquisition** Lua script.

   ```lua
   -- KEYS[1] = match:owner:<matchId>
   -- KEYS[2] = match:fence:<matchId>
   -- ARGV[1] = nodeId
   -- ARGV[2] = leaseTTLSec
   local currentOwner = redis.call('GET', KEYS[1])
   if currentOwner == false or currentOwner == nil or currentOwner == "" then
     -- No owner or lease expired. Safe to acquire and advance the fence.
     local newFence = redis.call('INCR', KEYS[2])
     local leaseValue = ARGV[1] .. ":" .. tostring(newFence)
     redis.call('SET', KEYS[1], leaseValue, 'EX', ARGV[2])
     return {tostring(newFence), leaseValue}
   else
     -- Already owned by another active node. Fail and keep fence unchanged.
     return nil
   end
   ```

   `RedisService.acquireLeaseWithFence(ownerKey, fenceKey, nodeId, ttlSec): Promise<{ fence: number; leaseValue: string } | null>`
   wraps this atomic operation. It is used during both launch and takeover instead of a separate caller-side `nextFence` (INCR) and `acquireLease` sequence.

   For subsequent state updates, a **fenced CAS** guards the canonical Redis write itself.
   The script uses **strict CAS** semantics (the "no-advance" contract) and must validate both the
   caller's ownership token **and** the fence at write time, so a lease that expired moments ago is
   rejected even before another node increments the fence. From B4a/B4b onward, this same primitive
   must also cover exactly-once command persistence by atomically writing `match:state`, the
   transport-level `eventId` / dedup record, and the stored `ANSWER_RESULT` recovery payload while
   returning a typed outcome: `APPLIED`, `DUPLICATE_EVENT`, `DUPLICATE_SUBMISSION`, or `RETRY`.

   ```lua
   -- KEYS[1] = match:owner:<matchId>
   -- KEYS[2] = match:fence:<matchId>
   -- KEYS[3] = match:state:<matchId>
   -- KEYS[4] = match:applied:<matchId>      (dedup set or equivalent)
   -- KEYS[5] = match:answer-result:<matchId>:<eventId> (or versioned recovery key)
   -- KEYS[6] = match:state-revision:<matchId>
   -- KEYS[7] = match:submissions:<matchId>          (business-level submissionId dedup set)
   -- ARGV[1] = expectedLeaseValue
   -- ARGV[2] = expectedFence (numeric string)
   -- ARGV[3] = serialized state blob
   -- ARGV[4] = state TTL seconds (86400)
   -- ARGV[5] = eventId (optional for pre-B4 callers)
   -- ARGV[6] = serialized answer-result / recovery payload (optional for pre-B4 callers)
   -- ARGV[7] = recovery payload TTL seconds
   -- ARGV[8] = expected state revision/version
   -- ARGV[9] = next state revision/version
   -- ARGV[10] = submissionId (optional; business dedup key, B4b submit_answer callers)
   local currentOwner = redis.call('GET', KEYS[1])
   if currentOwner == false or currentOwner ~= ARGV[1] then
     -- Lease expired, moved, or no longer belongs to this owner. Reject.
     return 'RETRY'
   end
   local currentFence = redis.call('GET', KEYS[2])
   if currentFence == false then
     -- fence counter missing. Reject.
     return 'RETRY'
   end
   if currentFence ~= ARGV[2] then
     -- STRICT CAS: reject unless current fence equals the expected fence.
     return 'RETRY'
   end
   if ARGV[5] ~= false and ARGV[5] ~= nil and ARGV[5] ~= '' then
     if redis.call('SISMEMBER', KEYS[4], ARGV[5]) == 1 then
       return 'DUPLICATE_EVENT'
     end
   end
   if ARGV[10] ~= false and ARGV[10] ~= nil and ARGV[10] ~= '' then
     -- Business-level dedup, checked AFTER ownership + fence validation and
     -- AFTER the transport-level eventId check: a different eventId carrying
     -- an already-applied submissionId is a typed no-op, decided atomically
     -- BEFORE any canonical match:state write or ANSWER_RESULT record.
     if redis.call('SISMEMBER', KEYS[7], ARGV[10]) == 1 then
       return 'DUPLICATE_SUBMISSION'
     end
   end
   local currentRevision = redis.call('GET', KEYS[6])
   if currentRevision == false then
     -- Bootstrap only the first canonical write. The caller must pass the
     -- defined initialization revision (`0`) as ARGV[8]; missing revision keys
     -- are not accepted for ordinary updates.
     if ARGV[8] ~= '0' then
       return 'RETRY'
     end
   elseif currentRevision ~= ARGV[8] then
     return 'RETRY'
   end
   redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
   redis.call('SET', KEYS[6], ARGV[9], 'EX', ARGV[4])
   if ARGV[5] ~= false and ARGV[5] ~= nil and ARGV[5] ~= '' then
     local appliedTtl = redis.call('TTL', KEYS[4])
     redis.call('SADD', KEYS[4], ARGV[5])
     if appliedTtl == -2 or appliedTtl == -1 then
       redis.call('EXPIRE', KEYS[4], ARGV[4])
     end
     if ARGV[6] ~= false and ARGV[6] ~= nil and ARGV[6] ~= '' then
       redis.call('SET', KEYS[5], ARGV[6], 'EX', ARGV[7])
     end
   end
   if ARGV[10] ~= false and ARGV[10] ~= nil and ARGV[10] ~= '' then
     local subTtl = redis.call('TTL', KEYS[7])
     redis.call('SADD', KEYS[7], ARGV[10])
     if subTtl == -2 or subTtl == -1 then
       redis.call('EXPIRE', KEYS[7], ARGV[4])
     end
   end
   return 'APPLIED'
   ```

   `matchService.persistStateMachine(matchId, { fence, leaseValue, expectedRevision, nextRevision, eventId?, submissionId?, answerResult? })` calls this Lua via
   either an extended `RedisService.fencedStateSet(...)` or an explicitly versioned companion such as
   `RedisService.fencedStateSetV2(...)`. Either form must return the typed CAS outcome
   `"APPLIED" | "DUPLICATE_EVENT" | "DUPLICATE_SUBMISSION" | "RETRY"`. The fenced `persistStateMachine` is what every canonical
   write path uses, and each caller must
   supply the same ownership snapshot it already obtained from `currentFence()` / the in-memory
   ownership entry: **both `fence` and `leaseValue`**, plus the working state's
   **expected revision/version** (unless every caller is already routed through one shared per-match serializer).
   A resurrected owner whose lease expired
   between `currentFence()` and `persistStateMachine` fails the owner-key check even if no takeover
   has happened yet; if a takeover already happened it also fails the owner-value and/or fence check.
   The revision bootstrap contract is explicit: `INITIAL_STATE_REVISION = 0`, and a missing
   `match:state-revision:<matchId>` key is accepted only when `ARGV[8]` is that initialization
   value; the first canonical state write atomically creates the revision key with `ARGV[9]`.
   Any later write that finds the revision key missing returns `RETRY` instead of silently
   recreating state from partial Redis data.
   `RETRY` means the caller's owner/fence snapshot or expected revision is stale or missing,
   `DUPLICATE_EVENT` means the current owner re-delivered an already-applied eventId under the
   same valid fence, `DUPLICATE_SUBMISSION` is the B4b business-level same-submission no-op, and
   `APPLIED` means the state write, dedup record, and recovery payload were committed atomically.
   The dedup key has a
   non-sliding lifecycle: the first APPLIED write sets `match:applied:<matchId>` to the same TTL as
   `match:state`, and later APPLIED writes preserve the existing positive TTL instead of resetting
   it. If the key exists without a TTL because of older data or manual repair, the Lua path applies
   the bounded TTL once so dedup metadata is never retained indefinitely.
   **Rollout contract:** the fenced Lua CAS is the **sole
   release guard**. The previous draft required `Match.ownerFence` to exist and
   be validated everywhere; that requirement is removed (see item 2 below). The
   verification guidance at the bottom of this plan is the canonical contract.

2. **`Match.ownerFence` (Postgres) — forensic / audit backstop, NOT the primary guard.**
   Keep the `ownerFence` column on the `Match` table for forensic queries
   (debugging "who wrote last"). A **best-effort update** is performed after the fenced persist
   to record the current owner fence in Postgres. Because this audit update runs asynchronously
   after the Redis state write, it is **non-atomic and may become stale**. The Redis Lua CAS remains
   the canonical guard. The schema migration that adds the column still defaults to `0` (NOT NULL,
   `@default(0)`) and a one-time backfill sets pre-existing rows to `0` — but the migration is
   no longer a hard blocking prerequisite for shipping B2c's fenced write. Land the migration in
   this phase as a non-blocking cleanup task.
3. **Broadcast only after Redis CAS returns `APPLIED`.** Emit `ROUND_ENDED` /
   `PLAYER_ELIMINATED` / `MATCH_FINISHED` only when the canonical Redis fenced CAS returns
   `APPLIED`, never before — so a rejected stale write or duplicate replay produces no new
   broadcast. Postgres `ownerFence` / audit updates are best-effort observability only: log or
   metric failures, but do not include them in the atomic success condition and do not block the
   broadcast once Redis returned `APPLIED`.

The in-memory H1/B1 guards + `assertOwnership` (renew) shrink the race window; the
**fenced Lua CAS on `match:state`** + post-persist broadcast is what makes it correct.
**`Match.ownerFence` is NOT a release guard and the schema migration is NOT a
shipping blocker** — it is a forensic / audit backstop, not in the canonical write
path. DB `@@unique` / `updateMany({status:{not:FINISHED}})` remain a backstop, not
the primary guarantee. Document the two layers (in-memory H1/B1 + fenced Lua CAS)
in the commit body; the canonical contract for what "ship B2c" requires is:
**`fencedStateSet` (or its versioned successor) is implemented and every canonical `match:state`
write goes through `persistStateMachine` with `{ fence, leaseValue }`, returning the typed
`APPLIED` / `DUPLICATE_EVENT` / `DUPLICATE_SUBMISSION` / `RETRY` outcome when dedup metadata is present** — the Postgres `ownerFence`
column is not validated anywhere in the canonical write path.

## Tests

- Heartbeat: owner renews successfully; simulate a lost lease (mock `renewLease→false`) →
  `cancelMatchLoop` called + ownership dropped.
- `assertOwnership`: true for owner, false after fence bump / when not owner.
- `match-round-runner.spec.ts`: with a mock ownership returning false, `endRound` /
  `checkMatchEnd` / `finishMatchLoopInner` early-return with **no** persist / no broadcast.
- Integration (two service instances, one Redis):
  - Node A owns + heartbeats; stop A's heartbeat; after TTL, node B takeover succeeds. Old owner A then calls `matchService.persistStateMachine` using its old fence; assert it returns `"RETRY"`, leaves the canonical Redis state blob unchanged, and emits no broadcasts.
  - Node A owns; let its lease expire **without** allowing node B to take over yet. Old owner A then calls `matchService.persistStateMachine` with the stale `{ fence, leaseValue }`; assert the owner-key validation returns `"RETRY"` even though the fence has not been incremented yet.
  - Current owner replays the same `eventId` after a successful write; assert the Lua CAS returns `"DUPLICATE_EVENT"` without rewriting state, and only the valid current owner is eligible to run recovery side effects.
  - Revision bootstrap: with no pre-existing `match:state-revision:<matchId>`, an initial write using `expectedRevision = 0` succeeds and atomically creates the revision key; the same missing key with any non-initial expected revision returns `"RETRY"` and does not write state.
  - Dedup retention: after a successful applied write, assert `match:applied:<matchId>` receives bounded retention; after a later APPLIED write for a different eventId, assert the existing positive TTL is not increased/reset. With a short test TTL, finish the match and prove the dedup key expires within that retention contract (or, if an implementation chooses explicit finish cleanup instead, assert `finishMatch` atomically deletes `match:applied:<matchId>`).
  - Node A's next `assertOwnership` check returns `false`.

## Verify / done

- Specs green; full api suite green; lint clean.
- `docker:multi` up: kill -STOP the owner container's node process (or `docker pause`), watch
  `match:owner:<id>` TTL expire and a peer able to acquire; unpause → old owner self-fences.
