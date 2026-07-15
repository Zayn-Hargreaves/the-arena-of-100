# B4a — Owner command channel

**Depends on:** B0 (lease + subscribe primitives on `RedisService`; B4a adds the stream wrappers
`XADD`/`XREADGROUP`/`XACK`/`XGROUP` itself on top of that), B2 (ownership).
**Blast radius:** additive service.
**Commit:** `feat(distributed): B4a owner command channel`.

## Why

A SUBMIT_ANSWER can arrive on ANY node (whichever the player's socket is on). The authoritative
mutation of `match:state` must happen on the **owner** only (blind `redis.set` clobbers under
concurrency). B4a builds the transport that carries answers/disconnects to the owner.

**Use a durable Redis Stream, NOT fire-and-forget Pub/Sub.** A dropped answer is a correctness
bug (owner never sees the submission → player eliminated wrongly), so the channel must survive a
missed message, a momentary lack of subscriber (during a failover gap), and give at-least-once
delivery with ack. A per-match **stream** `match:cmd:<matchId>` (`XADD` → owner
`XREADGROUP` + `XACK`) gives durability, ordering, retry of un-acked entries, and replay for
audit — Pub/Sub gives none of those.

## Immutable command envelope

Every command (incl. `player_disconnect`) is wrapped in an envelope so consumers deduplicate,
audit, and replay instead of trusting raw JSON:

```ts
// Discriminated union of every body type that can travel through the
// command channel. Each variant is a separate, narrow type so the
// compiler refuses to mix them at the public façade boundary (see
// `applySubmitAnswer` below — it accepts ONLY `CommandEnvelope<SubmitAnswerBody>`,
// never the broad `OwnerCommandBody`).
type SubmitAnswerBody = {
  readonly type: "submit_answer";
  readonly userId: string;
  readonly answer: string;
  readonly submissionId: string;
  readonly clientTs: number;
};
type PlayerDisconnectBody = {
  readonly type: "player_disconnect";
  readonly userId: string;
};
type OwnerCommandBody = SubmitAnswerBody | PlayerDisconnectBody;

interface CommandEnvelope<T extends OwnerCommandBody = OwnerCommandBody> {
  readonly eventId: string; // unique id (uuid) — dedup key
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly emittedByNodeId: string;
  readonly emittedAt: number; // epoch ms
  readonly body: T;
}
```

Dedup uses `eventId` (transport-level) AND `submissionId` (business-level, already in `AnswerState`).
The envelope is **the durable record** — the `XADD` persists it before any apply/broadcast.

## New file — `apps/api/src/modules/match/match-command.service.ts`

```ts
@Injectable()
export class MatchCommandService {
  streamKey(matchId) {
    return `match:cmd:${matchId}`;
  }

  // sender (any node): durable append. Returns after the XADD is persisted.
  async forward(env: CommandEnvelope): Promise<void> {
    await this.redis.xadd(this.streamKey(env.matchId), JSON.stringify(env)); // XADD * payload ...
  }

  // owner: consumer-group processing. Do NOT dedicate one permanently blocked
  // XREADGROUP task/connection per owned match — an owner running N matches
  // would pin N blocked reads/connections for the whole match lifetime. Use a
  // BOUNDED WORKER POOL (or a single multiplexed poll loop) over the owned
  // matches' streams instead: each iteration issues XREADGROUP with a short
  // finite BLOCK/timeout over a batch of owned streams and dispatches the
  // returned entries onto per-match serial queues. Ordering stays sequential
  // WITHIN a matchId (one in-flight apply per match, entries in stream order)
  // while different matches progress concurrently up to the pool bound.
  // Workers re-check ownership each iteration and stop PROMPTLY — via the
  // AbortSignal on the xreadgroup wrapper (below) — when the owner loses the
  // match's lease, the match is released, or the service shuts down; a lost
  // lease must not leave a blocked read holding the stream.
  // On takeover the new owner CLAIMS the failed consumer's idle pending entries
  // first — `XREADGROUP ... 0` only returns THIS consumer's own PEL, so entries
  // still pending under the dead owner's consumer name would otherwise never be
  // seen. Use `XAUTOCLAIM <stream> <group> <newConsumer> <min-idle> 0` (or
  // `XCLAIM` over `XPENDING` ids) to reassign them to the new owner's consumer,
  // THEN read/process/ack — so an answer that arrived during the failover gap
  // is picked up rather than stranded in the previous owner's PEL.
  private async consume(matchId, server): Promise<void> {
    // takeover: XAUTOCLAIM idle pending entries from the failed consumer → this consumer
    // then for each entry:
    //   1. JSON.parse and perform runtime schema validation: verify schemaVersion === 1, required envelope fields (eventId, matchId, emittedByNodeId, emittedAt) exist, env.matchId === the consumer's stream matchId, body.type exists, and variant-specific fields are valid.
    //   2. If validation fails or env.matchId does not match the stream's matchId, first persist the dead-letter record (using the existing dead-letter mechanism). XACK only after that persistence succeeds; if dead-letter persistence fails or times out, leave the entry in the PEL for retry and never acknowledge it from a finally path. If these invalid entries must never be replayed, explicitly `XDEL` them after successful dead-letter persistence; otherwise document the retention/replay policy for leaving the stream entry behind.
    //   3. Run the authoritative apply path. The Lua CAS / dispatcher returns
    //      APPLIED, DUPLICATE_EVENT, DUPLICATE_SUBMISSION, or RETRY; XACK only
    //      the first three outcomes.
  }

  // Internal façade used by the forwarded-command consumer in `consume` after
  // an entry has been read from `match:cmd:<matchId>`. B4b's owner-local path
  // also performs only `XADD` and then lets this same consumer drain the entry;
  // it must not call `applySubmitAnswer` directly after append. That keeps local
  // and forwarded submissions on one stream ordering path and avoids double-apply.
  // `apply` stays private so all authoritative mutation still passes through the
  // consumer's ack/retry decision point.
  //
  // NARROW BOUNDARY: this façade accepts ONLY `CommandEnvelope<SubmitAnswerBody>`.
  // The TypeScript signature rejects a `player_disconnect` envelope at compile
  // time (a `player_disconnect` envelope has `body.type === "player_disconnect"`,
  // which does not extend `SubmitAnswerBody` whose `type` is the literal
  // `"submit_answer"`). The forwarded `apply` is private and accepts the broad
  // `CommandEnvelope<OwnerCommandBody>` for the consumer's `player_disconnect`
  // dispatch; only the submit-answer façade accepts submit-answer envelopes, so a
  // `player_disconnect` envelope can NEVER reach `applySubmitAnswer`. This is a compile-time
  // guard, not a runtime check — the alternative (a runtime `if (body.type
  // !== "submit_answer")` branch) would be redundant given the type narrowing.
  async applySubmitAnswer(
    env: CommandEnvelope<SubmitAnswerBody>,
    server,
  ): Promise<"APPLIED" | "DUPLICATE_EVENT" | "DUPLICATE_SUBMISSION" | "RETRY"> {
    return this.apply(env, server);
  }

  // apply returns an explicit outcome so consume knows whether the entry was
  // actually handled — a void return can't distinguish "processed" from "lease
  // lost", which would let consume XACK a command the owner never applied.
  private async apply(
    env: CommandEnvelope<OwnerCommandBody>,
    server,
  ): Promise<"APPLIED" | "DUPLICATE_EVENT" | "DUPLICATE_SUBMISSION" | "RETRY"> {
    // `alreadyApplied` is allowed only as a best-effort optimization (metrics,
    // short-circuit hints). It MUST NOT decide correctness because a concurrent
    // owner could win the write between this read and the persist. If retained,
    // it is advisory only and never bypasses the authoritative Lua CAS below.
    // Acquire the CURRENT ownership snapshot (not just a boolean "am I owner?")
    // and carry it through the whole apply. currentFence returns the live
    // `{ fence, leaseValue }` pair or null if the lease is lost.
    const owner = await this.ownership.currentFence(env.matchId);
    if (owner == null) return "RETRY"; // lease lost → do NOT ack; next owner reprocesses
    // dispatch: submit_answer → applyAnswerAuthoritative (B4b); player_disconnect → handlePlayerDisconnect (B5)
    // The authoritative Lua CAS / dispatcher decides APPLIED vs DUPLICATE_EVENT
    // vs DUPLICATE_SUBMISSION vs RETRY atomically: it validates `eventId`,
    // persists the state, validates the same `{ fence, leaseValue }`, records
    // dedup, and preserves the distinction between transport replay and
    // business-level duplicate submission. A stale owner or racing duplicate
    // cannot bypass that guard.
    const outcome = await this.dispatchAuthoritative(env, owner, server);
    if (outcome === "DUPLICATE_SUBMISSION") return outcome;
    if (outcome !== "DUPLICATE_EVENT") return outcome;
    // Duplicate reconciliation remains owner-scoped, but split by duplicate type:
    // only a duplicate eventId runs answer-result recovery. player_disconnect must
    // follow its own duplicate/no-op path and MUST NOT invoke answer recovery or
    // checkEarlyTermination.
    const reconcileOwner = await this.ownership.currentFence(env.matchId);
    if (reconcileOwner == null) return "RETRY";
    await this.matchService.syncInMemoryStateFromRedis(env.matchId);
    if (env.body.type === "submit_answer") {
      const roomId =
        (await this.matchService.getRoomIdByMatchId(env.matchId)) ||
        (await this.matchService.getStateMachine(env.matchId))?.getState()
          ?.roomId;
      // Recovered results must enqueue through the SAME fenced outbox / publish
      // primitive as the APPLIED path. Do not rely on a separate `currentFence`
      // read before publishing; the enqueue itself must atomically validate the
      // captured fence + lease snapshot so an ex-owner cannot publish after takeover.
      await this.enqueueRecoveredAuthoritativeResult(
        env,
        reconcileOwner,
        server,
      );
      await this.fencedSideEffects.checkEarlyTermination(
        env.matchId,
        reconcileOwner,
        roomId,
        server,
      );
      return "DUPLICATE_EVENT";
    }
    if (env.body.type === "player_disconnect") {
      return await this.handleDuplicatePlayerDisconnect(
        env,
        reconcileOwner,
        server,
      );
    }
    return "DUPLICATE_EVENT";
  }
}
```

`consume` uses the outcome to decide acking: **XACK only on `APPLIED`, `DUPLICATE_EVENT`, or `DUPLICATE_SUBMISSION`**; leave a
`RETRY` entry **un-acked** so it stays in the PEL and the next owner (or the same owner after
re-acquiring the lease) reprocesses it. Never XACK a `RETRY`.

For `submit_answer`, `dispatchAuthoritative` must return typed, deterministic duplicate metadata
or the distinct outcomes above so the caller can tell `eventId` duplication apart from
`submissionId` duplication. `enqueueRecoveredAuthoritativeResult` and `checkEarlyTermination`
run only for `DUPLICATE_EVENT`; `DUPLICATE_SUBMISSION` is an ackable no-op with no replay or
side effects.

## Wiring

- The owner **registers the match with the shared bounded consumer pool** (creating the group
  with `XGROUP CREATE ... MKSTREAM` if absent) when it acquires a lease (fresh launch in
  `acquireOnLaunch` and takeover in `resumeMatchLoop`), and **deregisters it on release / lease
  loss** — registration adds the stream to the pool's poll set rather than spawning a dedicated
  permanently blocked reader task per match. Deregistration (or shutdown) aborts any in-flight
  blocked read for that stream via the wrapper's `AbortSignal` so workers quiesce promptly.
  **On the takeover path, before the first `XREADGROUP`, `XAUTOCLAIM` (or `XPENDING` + `XCLAIM`)
  the idle entries left pending under the previous owner's consumer** so they are reassigned to
  this node's consumer and processed — otherwise they stay stranded in the dead consumer's PEL.
- Register `MatchCommandService` in `match.module.ts` (providers + exports).
- Add a thin set of typed, mockable wrappers on `RedisService` (extends B0). The full
  surface B4a needs (every operation in this list is a method on `RedisService` —
  service-layer code MUST go through these wrappers, never `getClient()`):
  - `xadd(stream, payload): Promise<string>` — append an entry, return its id.
  - `xreadgroup(group, consumer, stream, count, blockMs, signal?: AbortSignal): Promise<StreamEntry[]>`
    — read up to `count` new entries for this consumer. To prevent indefinite resource holds and guarantee clean shutdown or ownership release, the wrapper must support cancellation via `AbortSignal` (or internally poll with a finite timeout checking a stop signal) to gracefully unblock when ownership is lost or service is destroyed.
  - `xack(stream, group, ...ids): Promise<number>` — ack processed entries.
  - `xgroupCreate(stream, group, opts: { mkStream?: boolean; startId?: string }): Promise<void>`
    — `XGROUP CREATE ... MKSTREAM` if absent; idempotent.
  - **`xautoclaim(stream, group, consumer, minIdleMs, startId, count): Promise<{ nextCursor: string; claimed: StreamEntry[] }>`**
    — atomically claim idle pending entries from failed consumers and reassign them
    to this consumer. The `nextCursor` lets `consume` loop through all pending
    entries; the `claimed` array is the entries actually transferred this iteration.
  - **`xpending(stream, group): Promise<XPendingSummary>`** — total count of pending
    entries, plus the min/max ids, for stream diagnostics only. This is **not** the
    dead-letter guard for B3b orphan recovery. Do not add a standalone
    `sismember(match:recovery:dead-letter, matchId)` guard before acquisition; the
    finalized/dead-letter condition must be inspected atomically inside the same Redis
    transaction/Lua primitive that grants `acquireLeaseWithFence` (or by comparing the
    same fenced finalized version), preserving the dead-letter marker as the source of truth
    without a separate check-then-acquire race.
  - **`xpendingDetail(stream, group, opts: { start, end, count }): Promise<XPendingEntry[]>`**
    — per-entry pending info (id, consumer, idle ms, deliveries) for fine-grained
    `xclaim` targeting.
  - **`xclaim(stream, group, consumer, minIdleMs, ...ids): Promise<StreamEntry[]>`**
    — explicit claim of specific pending entries by id (alternative to
    `xautoclaim` when the caller already knows the ids via `xpendingDetail`).
    Every wrapper takes typed arguments and returns typed results so the call sites
    can't reach into untyped raw clients. **`getClient()` is restricted to internal
    `RedisService` wrapper implementations and MUST NOT be called from service-layer
    code.** The B0 plan establishes the lease + subscribe wrappers using the same
    `getClient()`-internal pattern; B4a's stream wrappers follow it. (Existing
    service-layer callers of `getClient()` predate this convention and are not
    changed in this phase — they are a separate refactor.) The `StreamEntry` /
    `XPendingSummary` / `XPendingEntry` types are exported from `RedisService` (or
    re-exported from `@arena/shared`) so call sites can name them.
- The stream is trimmed (`XADD ... MAXLEN ~`) or deleted with the match
  on `finishMatch` so it doesn't grow unbounded.

## Tests — `match-command.service.spec.ts`

- `forward` `XADD`s the envelope to `match:cmd:<id>` (durable — readable back after the call).
- `apply` re-checks the current ownership snapshot (`currentFence()` / `{ fence, leaseValue }`) and
  **aborts without ack** when the lease is lost (entry stays pending for the next owner), and
  dispatches + `XACK`s when still owner.
- **Dedup:** replaying the same `eventId` is applied at most once. The authoritative duplicate
  decision comes from the Lua CAS, not from the `alreadyApplied` pre-check; the pre-check is only
  a non-authoritative optimization. Same-`eventId` replay after a persisted write returns
  `DUPLICATE_EVENT`, is `XACK`ed, and runs duplicate-event recovery before ack.
- **Duplicate typing:** when two different `eventId` values carry the same `submissionId`, the
  first event returns `APPLIED`; the second returns `DUPLICATE_SUBMISSION`, is `XACK`ed, and does
  **not** call `enqueueRecoveredAuthoritativeResult` or `checkEarlyTermination`.
- **Failover gap:** an entry `XADD`ed and left pending under a dead owner's consumer is
  **`XAUTOCLAIM`ed** (reassigned to the new owner's consumer) and then processed by the node that
  takes over — not lost (a plain `XREADGROUP ... 0` on a fresh consumer would miss it).
- Round-trip with real/mock Redis: `forward` on node A (non-owner) → owner node B consumes +
  dispatches exactly once.
- Recovery broadcast: if the first owner persists a `submit_answer` but crashes before
  emitting `ANSWER_RESULT`, the duplicate redelivery path re-publishes the persisted or
  deterministically reconstructed result idempotently before returning, and the submitter
  still receives the canonical outcome.
- **Typed wrapper coverage — `redis.service.spec.ts` (extend, or a focused new describe):**
  - `xautoclaim` claims idle pending entries from a previous consumer and returns
    `{ nextCursor, claimed }` with the right entries reassigned. The `nextCursor`
    loop terminates when the returned cursor is `0-0`.
  - `xpending` returns the total count + min/max ids for a group with N pending
    entries; assert exact counts and ids.
  - `xpendingDetail` returns per-entry idle ms + deliveries; assert a stale
    entry (`min-idle-ms` larger than the threshold) is reported with the right
    idle value.
  - `xclaim` transfers the requested ids to the new consumer and returns the
    claimed entries; a second claim by the same consumer must consistently return
    the same claimed entries (normalizing any Redis-version differences inside the wrapper).
  - **No-`getClient()`-leak invariant:** grep the service-layer test sources to
    confirm no test imports `getClient` from `RedisService` for the
    `xadd`/`xreadgroup`/`xack`/`xgroupCreate`/`xautoclaim`/`xpending`/
    `xpendingDetail`/`xclaim` operations — every test mocks the typed wrapper
    instead. (Mocks on `getClient` are allowed in tests for the wrapper
    implementations themselves, since they exercise the wrappers' internal
    call sites; the constraint applies to _consumer_ tests, not the
    wrappers' own tests.)

## Verify / done

- Spec green; build + lint clean. (No SUBMIT_ANSWER behavior change yet — that's B4b.)
