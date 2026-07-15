# B3b — Boot + orphan takeover

**Depends on:** B3a. **Blast radius:** `MatchOwnershipService` (additive) + calls into
`MatchRoundRunner.resumeMatchLoop`. **Commit:** `feat(distributed): B3b failover takeover + boot recovery`.

## Goal

Make some live node actually pick up matches whose owner died — at boot AND continuously at
runtime — generalizing `LobbyCountdownService`'s recovery machinery.

## Canonical terminal marker (one marker, one guard)

All "finalized / tombstoned / dead-lettered" checks in this phase validate **one canonical
marker**, not three parallel stores:

- **`match:tombstone:<matchId>`** — string `"<reason>:<finalizedFence>"` where `reason ∈
{finished, dead-letter, cleaned}` and **`finalizedFence` is the fence held by the finalizing
  owner** (the `{ fence, leaseValue }` the atomic finalize primitive validated). TTL 7d (same
  retention as the dead-letter set). This key is written **only** by the single atomic fenced
  finalization primitive — the same Lua transaction that validates the caller's lease/fence,
  removes `matchId` from `match:active`, and (for the dead-letter reason) SADDs
  `match:recovery:dead-letter`. The set stays as the **ops-facing index** for requeue tooling;
  the tombstone key is the **authoritative in-transaction guard**.
- **Acquisition validates exactly this marker — through the primitive's own contract, not a
  side read.** B0's `acquireLeaseWithFence(ownerKey, fenceKey, nodeId, ttlSec)` takes no
  tombstone key, so **this phase extends the primitive**: add a match-aware acquisition variant
  `acquireMatchLease(ownerKey, fenceKey, tombstoneKey, nodeId, ttlSec)` (or extend
  `acquireLeaseWithFence` with a third key) whose Lua transaction receives
  `KEYS[3] = match:tombstone:<matchId>` and checks it **first**, rejecting whenever the
  tombstone exists — regardless of reason — before touching owner or fence. **The tombstone
  rejection is a DISTINCT terminal outcome, not the same nil/null used for an actively held
  lease** — the two mean opposite things to a caller (held = try again later; terminal = never
  try again):

  ```lua
  -- KEYS[1]=ownerKey  KEYS[2]=fenceKey  KEYS[3]=match:tombstone:<matchId>
  if redis.call('EXISTS', KEYS[3]) == 1 then
    return 'TOMBSTONED' -- terminal match: never acquirable, fence untouched
  end
  -- ...B0 acquireLeaseWithFence body unchanged from here (array on success, nil while held)...
  ```

  TypeScript contract:
  `acquireMatchLease(...): Promise<{ fence: number; leaseValue: string } | null | "TERMINAL">`
  — the object on success, **`null` strictly for "another live owner holds the lease"**
  (retryable: skip this tick, the next sweep re-checks), and **`"TERMINAL"` for the tombstone
  hit** (permanent: stop retrying this match). Malformed payloads still throw per the B0 rules.
  **Callers propagate the distinction** — B2b's `acquireOnLaunch`, the boot recovery, the orphan
  sweep, and the retry-path reacquisition all migrate to this contract in this phase:
  - `null` (held) → behave exactly as today: not our match this tick; the sweep may race for it
    again after the lease TTL.
  - `"TERMINAL"` → **stop retrying**: do not re-attempt acquisition on later sweeps/retries
    (drop any retry context for the match) and let the atomic conditional stale-index cleanup
    remove the `match:active` entry; `acquireOnLaunch` maps it to `false` after logging that the
    match is finalized (a launch against a tombstoned match is a bug worth surfacing).

  **Every versioned companion primitive** (e.g. an `acquireLeaseWithFenceV2`) must embed the
  same in-transaction `EXISTS KEYS[3]` check **and the same three-way outcome**. Finalization
  writes the tombstone through its own single Lua transaction (above), so atomicity between the
  two is preserved: whichever script runs first wins and the other observes its effect
  atomically — there is no interleaving in which a match is finalized and acquired at once.

- The `match:tombstone:<matchId>` row is added to the `01-REFERENCE.md` key schema (done — see
  that table).

## Edits — `apps/api/src/modules/match/match-ownership.service.ts`

1. **Server injection + buffering (C4 pattern).** `afterInit`/`setServer(server)` runs AFTER
   `onModuleInit` (Nest lifecycle). So buffer recovered matches discovered at boot until the
   server is wired, then drain — copy `lobby-countdown.service.ts` `pendingRecovery` (~65,
   87-134) + `drainPendingRecovery`. `GameLoopService.setServer` already fans out to sub-services;
   add `matchOwnership.setServer(server)` there.

2. **`onModuleInit` boot recovery:** `listActiveMatchIds()` (SMEMBERS `match:active`); for each:
   - First run an atomic conditional stale-index cleanup primitive rather than a separate
     `matchStateExists` read followed by `removeActiveMatch`. The primitive must revalidate the
     canonical terminal/tombstone condition in the same Redis operation that removes `matchId`
     from `match:active` (for example: remove only if `match:state:<id>` is still absent, or if a
     fenced terminal/tombstone marker is still present). If the operation reports `REMOVED`, stop
     there for that match — do **not** `readOwner`, do **not** attempt `acquireLease`. If it reports
     that canonical state exists or was concurrently recreated, continue through normal owner/state
     recovery so a fresh match state cannot lose its active entry because of two unfenced reads.
   - Before any owner/state recovery beyond that cleanup check, if the socket server is not yet wired,
     enqueue **only `matchId`** into the pending buffer and return for that match. Do **not**
     `readOwner`, `acquireMatchLease`, or hydrate state until buffer draining runs with a
     live server instance.
   - Only for an existing state blob with a wired server: `readOwner(matchId)` — if a live owner already holds it,
     skip.
   - else try takeover: call **`acquireMatchLease`** (the match-aware atomic lease-and-fence
     acquisition variant defined in "Canonical terminal marker" above — NOT the bare B0
     `acquireLeaseWithFence`; the fence is not incremented on failure). Its Lua transaction
     receives and checks `match:tombstone:<matchId>` alongside `match:owner` and `match:fence`
     — never as a separate pre-read followed by acquire, which would race cleanup finalization —
     and maps the Lua `'TOMBSTONED'` response to the TypeScript **`"TERMINAL"`** outcome, with
     `null` reserved strictly for a live competing owner. A `"TERMINAL"` result here stops the
     recovery for that match permanently (no retry context; the conditional stale-index cleanup
     removes its `match:active` entry). The same in-transaction validation and three-way outcome
     apply to **any versioned companion primitive** orphan recovery uses (e.g. an
     `acquireLeaseWithFenceV2`). On success,
     **hydrate the state machine from the canonical `match:state:<id>` blob under
     `matchService.getStateMachine(matchId)`** (B3a) — this is the authoritative
     server-side read, not a stale SCAN. Then perform a **final state revalidation**
     against that exact hydrated snapshot by carrying a revision/hash from the blob read
     (or by using an atomic read-and-validate helper), proving the canonical blob still
     matches the hydrated bytes/state, not merely that `match:state:<id>` still exists
     and parses.
     - If the final revalidation proves the canonical blob is gone, empty, unparseable,
       or already terminal/cleaned, finalize recovery through a **single server-authoritative
       atomic primitive** (ownership-fenced finalize, or a fenced tombstone write) rather than
       separate owner verification / `removeActiveMatch` / dead-letter writes. That finalize
       primitive must validate the captured lease/fence, mark the match unrecoverable or cleaned,
       and remove it from `match:active` in one authoritative step. `acquireMatchLease`
       (and any versioned companion) checks the same tombstone/finalized state inside the
       acquisition transaction so a new owner cannot reacquire while cleanup is finalizing.
       If fencing fails or the owner key now belongs to a different lease, abort finalization,
       log the unresolved takeover, and preserve `match:active` for the new owner.
     - If `getStateMachine` / `matchStateExists` fails with a Redis timeout, connection
       failure, or another recoverable hydration error before we can prove the canonical
       blob is absent/terminal, treat it as a retryable/dead-letter recovery outcome instead
       of stale-index cleanup: log a warning with the matchId, do **not** record ownership,
       do **not** call `resumeMatchLoop`, do **not** `removeActiveMatch`, and do **not**
       use `releaseLease` as if the match were finished. Preserve the acquired fencing context
       (`fence`, `leaseValue`) separately from `this.owned` so the retry/dead-letter path can
       later `renewLease`, verify takeover, or safely release the lease; if that context cannot
       be retained, perform the same B2b confirmed-release flow before returning the match to
       the retry queue. Hand the match to the same B3b
       retry/dead-letter machinery (or at minimum preserve `match:active` discoverability)
       so a later retry/re-owner can continue from the canonical state.
       Only when hydration succeeds AND the final revalidation confirms the state blob is
       still present: revalidate ownership immediately before recording ownership or calling `resumeMatchLoop`
       (confirming the lease is still valid for the acquired fence, and renewing it when necessary). Do not buffer
       an acquired lease or hydrated state across missing server wiring: if the socket server is not
       wired yet, buffer **only `matchId`** and perform the complete acquisition, hydration, final revalidation,
       ownership recording, and `resumeMatchLoop` flow during buffer draining with the wired server, preserving
       server-authoritative fencing for all distributed writes. **Before** recording ownership,
       if this hydrate backfilled or materialized a v1 `ROUND_RESULT` deadline from the dedicated
       `roundResultStartedAt` anchor, fenced-persist that canonical v2 state blob after the final
       lease revalidation and before `this.owned.set` / `resumeMatchLoop`; every later retry must
       re-read that persisted v2 blob / anchor, not re-derive the deadline from `Date.now()`. Record ownership
       and pass the **already-hydrated state machine** into `resumeMatchLoop(matchId, hydratedSm, roomId, server)`
       (the new signature carries the hydrated state in; `resumeMatchLoop` does NOT re-`getStateMachine` —
       that closes the TOCTOU between the boot-recovery check and the timer arm).
   - `roomId` comes from the hydrated state (`sm.getState().roomId`) or `MatchService.getRoomIdByMatchId`.

3. **Periodic orphan sweep:** a periodic interval `setInterval(ORPHAN_SWEEP_MS)` (e.g. 5000; can share the
   heartbeat interval). Retain the timer handle (e.g. `this.sweepInterval`) and call `clearInterval(this.sweepInterval)`
   during `onModuleDestroy`. Ensure an in-progress sweep check prevents overlapping runs (using an in-flight sweep
   guard boolean like `PresenceService.isSweeping`). The sweep re-scans `match:active` for **owner-less** matches (owner key
   absent/expired) and attempts takeover via `acquireMatchLease` (all nodes race; `SET NX` / Lua CAS picks one,
   so takeover load spreads; a `"TERMINAL"` result drops the match from this node's retry
   consideration for good, while `null` — live competing owner — is simply re-checked on a later
   tick). This is what catches a crashed owner **between** boots — the
   centerpiece of the chaos test. **The periodic sweep follows the same close-the-TOCTOU
   pattern:** after a successful `acquireMatchLease`, hydrate the state machine under
   `matchService.getStateMachine(matchId)`, perform a final revalidation, and either pass
   the hydrated state into `resumeMatchLoop`, treat recoverable hydrate/Redis failures as
   retryable while preserving `match:active`, or (only when the canonical blob is confirmed
   absent/terminal) use the same atomic conditional cleanup/finalization primitive to remove the
   active match and skip the resume — never arm a timer on a state blob that may have vanished
   between scan and resume. **Skip dead-lettered matches atomically:** the dead-letter /
   tombstone check happens inside the same Lua transaction as `acquireMatchLease`
   (or against the same fenced finalized marker it validates) so a terminal match can never
   be observed as acquirable between a separate `SISMEMBER` and lease acquisition.

4. **Retry + dead-letter:** wrap `resumeMatchLoop` in exponential-backoff retry (reuse the
   `scheduleRecoveryRetry` shape, **`RECOVERY_MAX_RETRIES = 5`**). `resumeMatchLoop` /
   `GameLoopService` may surface recoverable hydrate/deadline failures, but **`MatchOwnershipService`
   is the only layer that owns retry exhaustion and dead-letter side effects**. **Rehydrate and
   revalidate ownership before every retry:** before
   each retry attempt, first cancel and **await** any in-flight async recovery task for that match
   (not just its timer) using a per-match generation token or `AbortController`, so stale work
   cannot resume or arm timers after a new retry context is created. Only after the prior task has
   fully quiesced do we discard stale `hydratedSm`, room/timer references, and ownership context
   before backoff so at most one timer / recovery callback can exist per match. Re-check the lease using the retained standalone
   fencing context and `renewLease` it. If the lease
   has lapsed, call `acquireMatchLease` to re-acquire with a **new fence** (a `"TERMINAL"`
   result here — the match was finalized while we were backing off — aborts the retry chain and
   drops the retry context). On reacquisition, we must
   rehydrate a fresh state machine from the canonical `match:state` in Redis and perform the final server-authoritative
   ownership and state validation against that same blob revision/hash before resuming. If ownership cannot be established (or is held by another node),
   **abort this node's retry immediately** (the stale node must not keep resuming a match it no longer owns). On exhaustion of retries, keep the verified
   fenced lease while running a **single atomic fenced finalization primitive** that records the
   dead-letter/tombstone outcome and removes `matchId` from `match:active` in one step; only after
   that finalization succeeds should the service release the lease. An equivalent single
   finalize-and-release Lua primitive is also acceptable, but it must validate the same
   `{ fence, leaseValue }` before dead-lettering, removing `match:active`, and releasing. If the
   owner/finalized check fails because a newer lease already took over, abort dead-letter/cleanup,
   log the unresolved takeover, and preserve `match:active` for the new owner. If the lease or
   finalization cannot be verified at all, abort the final cleanup, log loudly, and preserve
   `match:active` discoverability rather than dead-lettering a match whose lease may still be
   unresolved.
   (**Requeue contract** — requeuing a dead-lettered match is a manual/ops action, but it must
   undo the FULL terminal state in **one authorized atomic operation** (a single Lua script /
   ops command) structured as **validate everything first, mutate last**. The script runs three
   **read-only gates, in order, before touching ANY key**:
   1. **Reason gate:** first `EXISTS match:tombstone:<matchId>` — a **missing** tombstone means
      the match is not terminal at all (never finalized, already requeued, or the marker's TTL
      lapsed): abort with a distinct **`NOT_TERMINAL`** result (there is nothing to requeue; a
      genuinely stuck match is a recovery/ops problem, not a requeue). Then parse the value
      against the strict `"<reason>:<finalizedFence>"` shape: a **malformed** value (missing
      separator, empty parts, a fence violating the canonical grammar below) or an **unknown
      reason** (anything outside `{finished, dead-letter, cleaned}`) aborts with a distinct
      **`INVALID_TOMBSTONE`** result — a corrupted marker needs manual inspection and is
      deliberately left in place, never auto-requeued. Of the valid reasons, only
      `reason === dead-letter` may proceed; a `finished` or `cleaned` tombstone marks a match
      that terminated legitimately — "requeuing" it would resurrect a completed match — so the
      script aborts with a distinct **`FINALIZED`** result.

      **Canonical `finalizedFence` grammar — one definition, shared verbatim by the Lua gate
      and every TypeScript parser of the tombstone value:** the fence substring must match
      `^[1-9][0-9]*$` — ASCII digits only, **no** sign (`+1`/`-1`), **no** whitespace
      (`" 1"`/`"1 "`), **no** decimal point (`"1.0"`), **no** exponent (`"1e3"`), **no**
      leading zeros (`"01"`) — and its numeric value must lie in **`[1, 9007199254740991]`**
      (`Number.MAX_SAFE_INTEGER`; the stricter of the JS-safe-integer and Redis INCR int64
      ranges, chosen so Lua and TypeScript parse the same string to the same number —
      INCR-minted fences never approach it in practice). Any other string — including digit
      runs that exceed the range or overflow int64 — is malformed → `INVALID_TOMBSTONE`. Do
      not use bare `tonumber()` / `Number()` acceptance as the check (both accept signs,
      whitespace, decimals, and exponents); validate against this grammar first.

   2. **State gate:** `EXISTS match:state:<matchId>` — an adopting node must have something to
      hydrate; requeuing a stateless match would only bounce straight into stale-index cleanup.
      When the blob is gone the script aborts with a distinct **`NO_STATE`** result (the ops
      path for that is data restoration, not requeue).
   3. **Owner precondition:** inspect `match:owner:<matchId>`. Absent/expired passes; a live
      lease passes **only** on an explicitly **forced** requeue — otherwise abort with
      **`CONFLICT`**.
      **Only after all three gates pass does the mutation phase run**, still inside the same
      transaction: first (on a forced call with a live lease) atomically invalidate the existing
      lease (`DEL match:owner:<matchId>`) and advance the fencing counter
      (`INCR match:fence:<matchId>`) so the old lease value can never renew or pass a fenced CAS
      again; then delete the canonical `match:tombstone:<matchId>` marker, re-add `matchId` to
      `match:active`, and SREM the `match:recovery:dead-letter` entry. **Every rejection
      (`CONFLICT`, `FINALIZED`, `NO_STATE`, `NOT_TERMINAL`, `INVALID_TOMBSTONE`) — including on a
      forced call — leaves every key unchanged**: tombstone intact (or still absent), `match:active`
      unchanged, dead-letter entry retained, and the owner key + fence counter untouched (a forced
      requeue that fails any gate must NOT have invalidated the lease or advanced the fence,
      because the gates ran before any write). Clearing only the dead-letter set while the
      tombstone survives would leave the match permanently terminal — every `acquireMatchLease`
      would keep returning `"TERMINAL"` and no node could ever adopt the requeued match.)

Constants: `LEASE_TTL_SEC=15`, `HEARTBEAT_MS=5000`, `ORPHAN_SWEEP_MS=5000`, `RECOVERY_MAX_RETRIES=5`.

## Tests — `match-ownership.service.spec.ts` (recovery)

- Boot: seed `match:active` with an owner-less matchId + a `match:state` blob → `onModuleInit`
  acquires + calls `resumeMatchLoop` (mock the runner; assert called with right ids).
- Boot before server wiring: queue only `matchId`; no `readOwner`, no `acquireMatchLease`,
  no hydration until buffer draining runs with a wired server.
- Stale index: matchId in `match:active` but no `match:state` → removed from index only by the
  atomic conditional cleanup primitive. Add a race case where `match:state` is recreated between a
  stale scan and cleanup; the primitive must preserve `match:active` and normal recovery continues.
- Recoverable hydrate failure: `getStateMachine`/`matchStateExists` times out or throws a
  retryable Redis error after lease acquisition → warning logged, no ownership recorded,
  no `resumeMatchLoop`, and `match:active` is preserved for retry/dead-letter discovery.
- Buffering before server wiring: boot discovery buffers only `matchId`; the drain path acquires the
  lease, hydrates the state, and performs final revalidation immediately before `owned.set` /
  `resumeMatchLoop`.
- Orphan sweep: a matchId whose owner key expired → a peer takes it over exactly once (two
  instances, one Redis; assert only one `resumeMatchLoop`).
- Dead-letter: `resumeMatchLoop` always throws → after max retries, while the verified fenced lease
  is still held, the service atomically writes `match:recovery:dead-letter` and removes
  `matchId` from `match:active`, then releases the lease; no infinite loop.
- Release verification distinguishes absence from takeover: if the owner key contains a different
  lease during cleanup/dead-letter, no `removeActiveMatch`, no dead-letter write, and the match stays discoverable.
- Retry timer hygiene: repeated `resumeMatchLoop` failures call `cancelMatchLoop` / clear timers
  before each backoff, await any already-started recovery callback, and the next retry rehydrates
  from fresh state without leaving multiple timers or stale async recovery tasks running for the
  same match.
- **Dead-letter is not reacquired:** with a matchId already tombstoned (`match:tombstone:<id>`
  set, entry left in `match:active` for the test), the acquisition primitive returns
  **`"TERMINAL"`** (not `null`), the sweep stops retrying that match (no re-attempt on the next
  sweep tick, no `resumeMatchLoop`), and its retry context is dropped. Additionally assert the
  **conditional cleanup**: the TERMINAL path removes the tombstoned matchId from `match:active`
  via the atomic conditional stale-index primitive (which re-validates the tombstone is still
  present inside the same Redis operation) — after the sweep settles, `match:active` no longer
  contains the id.
- **Held vs. terminal are distinct outcomes:** with a **live owner** holding the lease, the
  primitive returns `null` and the sweep **does** re-check the match on a later tick (retryable
  — after the owner's TTL lapses the takeover proceeds). Assert the null path **preserves both
  the `match:active` entry AND the retry context** (the later tick actually issues another
  acquisition attempt — keep the acquisition-count assertions: N ticks with a live owner → N
  attempts, then takeover succeeds once the TTL lapses). With a **tombstone** present it returns
  `"TERMINAL"`: no later tick re-attempts acquisition (acquisition count stays flat after the
  TERMINAL tick), the retry context is dropped, and the entry leaves `match:active` per the
  bullet above. Assert both branches explicitly so a regression collapsing them back into one
  `null` fails the suite.
- **Requeue clears the tombstone:** dead-letter a match (tombstone written with reason
  `dead-letter`, `match:state` blob still present, `match:active` removed, dead-letter entry
  present), then run the requeue operation. Assert afterwards that
  `match:tombstone:<matchId>` is **absent**, `matchId` is back in `match:active`, and the
  dead-letter entry is gone — and that a subsequent `acquireMatchLease` **succeeds** (returns
  `{ fence, leaseValue }`, not `"TERMINAL"`), proving a requeued match is actually adoptable.
  A negative variant that clears only the dead-letter set but leaves the tombstone must keep
  returning `"TERMINAL"` (documents why the requeue must be the single atomic operation).
- **Requeue gates — reason, state, and tombstone validity:** each rejection case asserts the
  operation **touches nothing** (tombstone value unchanged — or still absent, `match:active`
  unchanged, dead-letter set unchanged, owner key and `match:fence` counter untouched):
  - tombstone reason `finished` → requeue returns **`FINALIZED`**;
  - tombstone reason `cleaned` → requeue returns **`FINALIZED`**;
  - tombstone reason `dead-letter` but `match:state:<matchId>` deleted → requeue returns
    **`NO_STATE`** (a stateless match must go through data restoration, not requeue);
  - tombstone **missing** entirely → requeue returns **`NOT_TERMINAL`** (nothing to requeue);
  - tombstone value **malformed** (e.g. `"garbage"`, `"dead-letter:"`, `"dead-letter:NaN"`) →
    requeue returns **`INVALID_TOMBSTONE`**, and the corrupted value is byte-identical
    afterwards (left in place for manual inspection);
  - tombstone with an **unknown reason** (e.g. `"paused:12"`) → **`INVALID_TOMBSTONE`**.
- **Fence-grammar boundaries (drive both the Lua gate and the TypeScript parser with the same
  vectors):** accepted — `"dead-letter:1"`, `"dead-letter:9007199254740991"`
  (`MAX_SAFE_INTEGER`), and a typical INCR value like `"dead-letter:42"`. Rejected as
  `INVALID_TOMBSTONE` — `"dead-letter:0"`, `"dead-letter:+1"`, `"dead-letter:-1"`,
  `"dead-letter: 1"` / trailing space, `"dead-letter:1.0"`, `"dead-letter:1e3"`,
  `"dead-letter:01"`, `"dead-letter:9007199254740992"` (`MAX_SAFE_INTEGER + 1`), and
  `"dead-letter:9223372036854775808"` (int64 overflow). Each rejected vector preserves the
  existing `NOT_TERMINAL` / `INVALID_TOMBSTONE` / `FINALIZED` outcomes elsewhere and asserts
  touch-nothing.
  **Repeat the `FINALIZED`, `NO_STATE`, `NOT_TERMINAL`, and `INVALID_TOMBSTONE` cases with
  `force = true` and a still-live `match:owner:<id>` lease seeded.** For each forced case,
  snapshot before the call and compare afterwards — but compare each store by its own
  semantics, because `SMEMBERS` has **no guaranteed iteration order** and a serialized
  order-sensitive comparison of a Redis SET is flaky by construction:
  - `match:tombstone:<id>` (a plain string): **byte-for-byte** equality — including its
    **absence** for the `NOT_TERMINAL` case (absent before ⇒ still absent after);
  - `match:active` and `match:recovery:dead-letter` (SETs): **set equality** — sort the
    members before serializing the snapshot, or compare as sets (`new Set(...)` /
    `expect(...).toEqual(expect.arrayContaining(...))` with matching sizes) — never compare
    raw `SMEMBERS` output positionally.
    All three must be unchanged. Keep the existing assertions on top: each forced call still
    returns the same rejection result, the owner key still holds the original lease value, the
    `match:fence` counter is unchanged, and the live holder's `renewLease(liveLeaseValue)` still
    succeeds. This proves the gates run **before** any forced lease invalidation, so the
    touch-nothing invariant holds even in forced mode.
- **Requeue vs. live owner lease (owner precondition):**
  - **Conflict without force:** seed a still-live `match:owner:<id>` lease alongside the
    tombstone; a non-forced requeue returns the **CONFLICT** result and touches nothing —
    tombstone still present, `match:active` still missing the id, dead-letter entry retained
    (the existing owner was not invalidated, so the requeue is explicitly rejected).
  - **Forced requeue invalidates the stale owner:** with the live lease present, a forced
    requeue deletes the owner key and `INCR`s `match:fence` in the same transaction. Assert the
    old lease holder is fully fenced out afterwards: its `renewLease(oldLeaseValue)` returns
    `false` and its fenced `persistStateMachine` with the old `{ fence, leaseValue }` returns
    `"RETRY"` — a stale owner can neither resume nor write after the requeue.
  - **Concurrent acquisition after requeue:** race two nodes' `acquireMatchLease` immediately
    after a successful requeue; exactly one wins, and the winner's `fence` is **strictly
    greater** than both the `finalizedFence` recorded in the (now deleted) tombstone and any
    pre-requeue fence — the new owner holds the newest valid fence. The loser observes `null`
    (live owner), never `"TERMINAL"`.
- **Finalization vs. acquisition race:** run the fenced cleanup-finalization concurrently with an
  `acquireMatchLease` takeover for the same match; exactly one side wins atomically. Either
  the finalize commits (tombstone/dead-letter written + `match:active` removed) and the
  acquisition is rejected **inside the acquisition Lua transaction**, or the acquisition wins and
  the finalize aborts, preserving `match:active` for the new owner. Assert no interleaving where
  a new owner holds a lease on a finalized match, and cover the same assertion against any
  versioned companion acquisition primitive used by orphan recovery.

## Verify / done — the real failover moment

- `docker:multi` up; start a match (host START_MATCH); confirm `match:owner:<id>` = owner node.
- `docker kill arena-api-<owner>` mid-match.
- Within ~lease TTL, a peer's orphan sweep acquires the lease (`match:owner` flips to a live
  node) and the match keeps advancing (next `ROUND_STARTED` observed; eventually `MATCH_FINISHED`).
- **No duplicate round numbers** (single-writer + DB unique). Full suite green.
- This is the pass/fail the C3 chaos test automates.
