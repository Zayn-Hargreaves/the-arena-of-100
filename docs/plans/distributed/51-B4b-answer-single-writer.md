# B4b — SUBMIT_ANSWER owner-single-writer

**Depends on:** B4a. **Blast radius:** `MatchHandler.handleSubmitAnswer` (CRITICAL — B1a).
**Commit:** `feat(distributed): B4b owner-single-writer answer path`.

## Goal

Route the authoritative answer apply to the match owner while keeping the submitter's UX
instant. Fixes the lost-update hazard (two answers on two nodes both blind-`redis.set`).

## Edits — `apps/api/src/gateways/handlers/match.handler.ts` `handleSubmitAnswer` (~76)

Keep the local guards (spectator/disconnected, ~88-105). Then branch on ownership:

- **If this node is the owner** (`ownership.isOwner(matchId)`): fast path — but `isOwner` is an
  in-memory hint that can be stale (the lease may have been taken over between the check and the
  write). So the local check is **not the sole guard**: route the apply through the same shared
  authoritative routine `MatchCommandService.apply` uses, but **through the same per-match
  consumer path as forwarded commands**. Concretely, `MatchHandler` still `XADD`s the durable
  envelope to `match:cmd:<matchId>` (preserving the original `eventId`), but the owner-local
  path must not call `applySubmitAnswer` directly after the append. Instead, it lets the
  existing match-scoped consumer drain that already-enqueued command so local and forwarded
  submissions share one stream ordering, one consumer/ack path, and one authoritative single-writer
  apply path behind `MatchCommandService.apply`.
  The routine first runs `currentFence()` (the current ownership snapshot, including
  `{ fence, leaseValue }` — abort as `RETRY` if the lease is no longer ours; do NOT conflate
  this with a boolean `assertOwnership` check, which is the cheap renew at the three mutating
  boundaries), then calls `submitAnswer`, then **re-asserts the same ownership snapshot at the
  persistence mutation** (`persistStateMachine` with `{ fence, leaseValue }` → fenced Lua CAS on
  `match:owner` + `match:fence` + `match:state`; see B2c) so a lease takeover
  that races the apply cannot let a demoted ex-owner write `match:state`, and only then
  runs `checkEarlyTermination`. (Concretely: the owner-local path and the forwarded-command
  path share one authoritative apply routine guarded by `currentFence` + fenced CAS, rather
  than two divergent code paths.)
- **If NOT the owner:**
  1. **Do NOT compute or emit a local `ANSWER_RESULT`**, and do NOT `persistStateMachine`. A
     non-owner's local copy can disagree with the owner's authoritative decision (late arrival vs.
     the round deadline, duplicate `submissionId`, elimination state), so an optimistic echo can
     tell the player something the server then contradicts. Forward first; let the **owner** emit
     the canonical `ANSWER_RESULT` after server-side validation.
  2. `await matchCommand.forward({ /* envelope */ body: { type: "submit_answer", userId, answer,
submissionId, clientTs } })` (durable `XADD` — see B4a). The forward `await` resolving means
     the command is durably queued for the owner.
  3. Optionally ack the client with a lightweight **pending** state (e.g. `answer_received`) so the
     UI can show "submitted…" until the owner's `ANSWER_RESULT` arrives — but never a _result_.
  4. The owner emits `ANSWER_RESULT` to the submitter after it applies the answer. Since the
     submitter's socket may be on a different node, the emit is a room/targeted broadcast that the
     Redis adapter delivers cross-node (or target the specific socket id via the adapter).

## Owner-side apply — `MatchCommandService.apply` → `applyAnswerAuthoritative`

On the owner, for a `submit_answer` command, both the owner-local stream consumer (draining the
node's own `XADD`) and the forwarded-command consumer call the same authoritative routine:

```ts
// Used by BOTH the owner-local stream consumer (draining the node's own XADD)
// and the forwarded-command consumer (MatchCommandService.apply itself).
//
// OUTCOME CONTRACT: every branch must return a valid B4a outcome
// (`"APPLIED" | "DUPLICATE_EVENT" | "DUPLICATE_SUBMISSION" | "RETRY"`). A bare `return` or a missing return would
// make `consume` unable to decide ack-vs-retry, so a lease-lost entry would get
// acked (lost command) or a successful apply would never ack the stream entry
// (entry stuck in PEL forever).
// Serialize answer application per matchId across BOTH owner-local and forwarded
// paths. Fencing prevents stale owners from writing, but it does not by itself stop
// two concurrent requests under the SAME current owner from racing each other. Use
// the existing match-scoped serialization primitive (or add one shared by every
// path into MatchCommandService.apply) so snapshot → submitAnswer →
// persistStateMachine → commitStateMachine executes as one critical section.
return await this.matchSerializers.run(env.matchId, async () => {
  // Bind EVERY authoritative-apply input to the envelope — env.matchId and
  // env.body are the durable record the owner is processing; free-floating
  // identifiers from the enclosing scope could silently reference the wrong
  // match/user when this routine is reached from the shared consumer.
  const owner = await this.ownership.currentFence(env.matchId);
  if (owner == null) return "RETRY"; // lease lost → do NOT ack; next owner reprocesses

  // Retry safety (RETRY branches): the in-memory mutation in `freshSm` MUST NOT
  // be retained across a failed `persistStateMachine`. We snapshot the canonical
  // `match:state` blob into a working copy that is owned by THIS apply (it
  // never escapes the function), mutate the snapshot, and commit via the
  // fenced Lua CAS. If the persist fails or the lease is lost at write time,
  // the snapshot is discarded and the next attempt re-reads the canonical
  // store — the in-memory `stateMachines` map's instance is NEVER mutated, so
  // no other code path (resumed timer, B3a `resumeMatchLoop`, B5 presence
  // leader sweep) can see a half-applied answer. This is the snapshot-restore
  // invariant: mutations live on a per-attempt working copy, and the canonical
  // store is the only authoritative state.
  const freshSm = await matchService.getStateMachine(env.matchId);
  if (!freshSm) return "RETRY"; // state machine not hydrated (cold path) —
  // next owner reprocesses after it loads match:state.

  // snapshot the working copy: this is the instance we mutate, the canonical
  // state machine is left untouched until persist succeeds.
  const workingSm = freshSm.snapshot();
  // Server-authoritative timing: serverTs is minted on the BACKEND at apply
  // time. env.body.clientTs is advisory telemetry only — it must never feed
  // the authoritative round-deadline / anti-cheat timing check, because the
  // client controls it.
  const serverTs = Date.now();
  const answerResult = workingSm.submitAnswer(
    env.body.userId,
    env.body.answer,
    serverTs,
    env.body.submissionId,
  ); // env.body.submissionId => idempotent, returns the authoritative per-submit result
  const roomId = workingSm.getState().roomId ?? freshSm.getState().roomId;

  // Fenced CAS: the canonical `match:state` SET + dedup/event-result record commit
  // as one Lua call (B2c/B4a), or all are rejected. The typed CAS result
  // distinguishes a genuine stale-owner retry from a valid-current-owner duplicate.
  // The persist ALSO atomically records the `eventId` (the transport-level dedup
  // key) and the canonical `ANSWER_RESULT` payload (or a deterministic
  // reconstruction anchor for it) — see "eventId contract" below.
  const persisted = await matchService.persistStateMachine(env.matchId, {
    fence: owner.fence,
    leaseValue: owner.leaseValue,
    expectedRevision: freshSm.getState().revision,
    nextRevision: workingSm.getState().revision,
    eventId: env.eventId,
    answerResult,
    state: workingSm.getState(), // normalized canonical state payload persisted to Redis
  });
  if (persisted === "DUPLICATE_EVENT") return "DUPLICATE_EVENT"; // already applied under the current valid owner; B4a duplicate-recovery runs before XACK.
  if (persisted === "DUPLICATE_SUBMISSION") return "DUPLICATE_SUBMISSION"; // business-level replay; caller XACKs with no recovery side effects.
  if (persisted === "RETRY") return "RETRY"; // stale fence / lease lost at the write; no broadcast.
  // On success, atomically apply the working copy to the canonical in-memory
  // state machine so subsequent code paths see the new state. (This is the
  // "commit" half of snapshot-restore: persist succeeded → promote.)
  matchService.commitStateMachine(env.matchId, workingSm);

  // Post-persist side effects must stay fenced too. Promotion alone is not enough:
  // a lease can move after the durable CAS succeeds. Route `ANSWER_RESULT` publish and
  // follow-up termination work through an owner-scoped durable outbox (or equivalent
  // fenced publish primitive) that re-validates `{ fence, leaseValue }` immediately
  // before each side effect and refuses to run for ex-owners. If a crash or lease loss
  // occurs after the durable persist but before the fenced side effects complete, the
  // command is redelivered as `DUPLICATE_EVENT`; the current valid owner then heals via the
  // duplicate-recovery path using the persisted state + stored answerResult before the caller XACKs.
  await fencedSideEffects.publishAnswerResult(
    env.matchId,
    owner,
    roomId,
    answerResult,
    server,
  );
  await fencedSideEffects.checkEarlyTermination(
    env.matchId,
    owner,
    roomId,
    server,
  );
  return "APPLIED"; // explicit success outcome → consume XACKs
});
```

`submissionId` idempotency (already in `AnswerState`) means a duplicate/optimistic replay is a
no-op, but the authoritative persist/CAS path must detect duplicate `submissionId` values
atomically and return `"DUPLICATE_SUBMISSION"`
independently of `eventId`. A different `eventId` carrying the same `submissionId` must not
store another answer mutation, must not emit/replay `ANSWER_RESULT`, and must be covered by
tests that replay the same `submissionId` under distinct `eventId` values.

**Apply contract.** `persistStateMachine` only persists the canonical Redis state plus
dedup/recovery payload and returns `"APPLIED" | "DUPLICATE_EVENT" | "DUPLICATE_SUBMISSION" | "RETRY"`,
`commitStateMachine` promotes the already-persisted working copy into the
canonical in-memory map, and the side-effect publisher runs afterward through an owner-scoped
durable outbox / fenced publish contract. The `DUPLICATE_EVENT` recovery path first
reconciles/promotes in-memory state from Redis as needed, then B4a calls
`enqueueRecoveredAuthoritativeResult` and `checkEarlyTermination` under the same fenced
side-effect contract before XACK. `DUPLICATE_SUBMISSION` is an ackable no-op with no replay or
early-termination side effects. `RETRY` remains reserved for stale fence, lost lease, missing
state, or persistence failures and is never XACKed.

**Snapshot-restore invariant (RETRY branches).** The fenced Lua CAS in
`persistStateMachine` (B2c) is the atomicity boundary: it atomically persists the serialized Redis state, the ownership snapshot validation, the `eventId` record, and the stored answer-result recovery data, not the in-memory `workingSm.submitAnswer` mutation itself. The `workingSm` is a per-attempt snapshot —
`MatchStateMachine.snapshot()` returns a deep clone the apply owns and mutates.
The canonical in-memory instance in `stateMachines` is NEVER mutated by `workingSm.submitAnswer`;
it is only promoted via `matchService.commitStateMachine(env.matchId, workingSm)` (the envelope
is the identifier source for every mutation, here as everywhere in the apply) after
the fenced persist returns `"APPLIED"`. If promotion fails or a `RETRY` occurs (lease lost before, during, or after
the write), `workingSm` is discarded without promoting — the next attempt re-reads/reloads
a fresh canonical state from Redis under `getStateMachine` and starts from a fresh snapshot. This
guarantees:

- A retried submission cannot write a stale in-memory answer under a new fence —
  the in-memory state machine never carries a mutation that was not persisted.
- No code path (resumed timer, B3a `resumeMatchLoop`, B5 presence leader sweep,
  `getStateMachine` from any caller) observes a half-applied answer.
- The `submissionId` idempotency is preserved (already in `AnswerState`) so a
  duplicate retry is a no-op against the canonical state; the snapshot never
  diverges from the canonical.

**eventId contract and atomic Lua CAS deduplication.** To prevent TOCTOU races where multiple nodes or concurrent commands read and write `alreadyApplied(env)` simultaneously, the eventId deduplication check MUST be performed inside the Lua CAS script itself.
The Lua CAS script must:

1. Atomically validate the caller's current `leaseValue` and `fence` snapshot **before** consulting the applied-event set.
2. If that ownership/fence validation fails, return `"RETRY"` immediately; a stale or lease-less caller must never observe `"DUPLICATE_EVENT"` / `"DUPLICATE_SUBMISSION"` or run answer-result recovery side effects.
3. Only after ownership/fence validation succeeds, check whether the transport-level `eventId` (from `CommandEnvelope.eventId`) is already present in the `match:applied:<matchId>` set.
4. If the `eventId` is already present, return the distinct `"DUPLICATE_EVENT"` outcome, which the caller propagates up so B4a runs duplicate-event recovery before acknowledging the stream entry (ensuring recovery side effects are reserved to the current valid owner).
5. If not present, write the match state, store the canonical `ANSWER_RESULT` payload (or the exact data needed to reconstruct it deterministically), and add the `eventId` to the `match:applied:<matchId>` set in the same atomic call.
   Only genuine ownership/persistence failures produce a `RETRY` outcome, while an eventId duplicate check hit under a valid current owner returns `DUPLICATE_EVENT`. If persistence fails and returns `"RETRY"`, the `eventId` is NOT recorded in Redis, allowing the command to remain unapplied so that its redelivery is processed fully. A later redelivery is classified as `DUPLICATE_EVENT` only when a previous attempt succeeded in atomically persisting the state write, the `eventId` record, and the stored answer-result recovery data, but crashed before XACK or delivery completion. This ensures that a failed apply never causes `alreadyApplied(env)` to return `true` on redelivery.

**Retry safety (RETRY branches) — no broadcast on stale fence.**
`persistStateMachine` only persists canonical state + dedup/recovery data. It does
**not** commit the in-memory state machine and does **not** broadcast. The canonical
`ANSWER_RESULT` is buffered during answer processing and emitted only after
`persistStateMachine` returns `"APPLIED"`, `matchService.commitStateMachine` succeeds,
and the fenced side-effect publisher validates the same owner snapshot.
A `RETRY` return path (lease lost at any point, including during the Lua
CAS) MUST NOT call `checkEarlyTermination`, MUST NOT call
`matchService.commitStateMachine`, and MUST NOT emit or broadcast any
`PLAYER_ELIMINATED` / `ROUND_ENDED` / `MATCH_FINISHED` / `ANSWER_RESULT` event.
The owner-local and forwarded RETRY paths may emit only a non-authoritative pending
acknowledgement (e.g. `answer_received`) to the submitting client. That pending ack
MUST NEVER include `ANSWER_RESULT`, `PLAYER_ELIMINATED`, `ROUND_ENDED`, or
`MATCH_FINISHED` data, and MUST NOT trigger authoritative side effects or broadcasts.
The canonical `ANSWER_RESULT` is only broadcast after the state is atomically persisted to the canonical store.

## Invariants to preserve / document in commit

- **At-most-once round end:** only the owner arms/fires timers and runs `endRound`
  (H1 guard + assertOwnership + DB unique). A non-owner never ends a round.
- **Delivery of a forwarded answer must be reliable — it is NOT safe to drop.** A lost answer
  makes the owner miss a valid submission, so the player is eliminated incorrectly at round end.
  That is why B4a uses a **durable stream with ack + pending re-read on takeover** (not
  fire-and-forget Pub/Sub): every forwarded answer is `XADD`-persisted and only `XACK`ed after
  the owner applies it, so a subscriber gap or crash re-delivers it. `submissionId` + `eventId`
  dedup make the retried delivery idempotent. (What _is_ safe to lose is only the separate
  early-termination _nudge_: if that were missed, the round still ends at the owner's 15s timer.)
- The submitter's `ANSWER_RESULT` is the owner's canonical result; the small extra latency vs. a
  local optimistic echo is the price of correctness (masked by an optional "submitted…" pending state).

## Tests — `match.handler.spec.ts`

- Owner path uses only the authoritative consumer flow: it `XADD`s the envelope durably, the
  match consumer processes it, and then the command is `XACK`ed.
- Owner-local and forwarded commands both traverse the same consumer path; assert the owner-local
  gateway/handler does **not** call `applySubmitAnswer` (or equivalent authoritative apply)
  directly.
- Non-owner path: does **not** emit `ANSWER_RESULT` and does **not** call `persistStateMachine`;
  it calls `matchCommand.forward` with the right envelope (optionally emits a `pending` state).
- Owner emits the canonical `ANSWER_RESULT` after applying a forwarded answer (targeted at the
  submitter, delivered cross-node via the adapter).
- Owner apply: two forwarded answers with distinct submissionIds both land (single writer);
  a duplicate submissionId is a no-op.
- Duplicate recovery: if persistence succeeded but the first owner crashes or loses the lease before
  broadcasting, redelivery returns `DUPLICATE_EVENT`; before the caller XACKs, B4a publishes the
  persisted/reconstructed `ANSWER_RESULT` idempotently, syncs in-memory state from Redis, and
  re-runs `checkEarlyTermination`.
- Duplicate submission: replay the same `submissionId` under a different `eventId`; it returns
  `DUPLICATE_SUBMISSION`, is XACKed, and does not enqueue recovered results or run
  `checkEarlyTermination`.
- Lease loss after persist: if ownership is lost after `persistStateMachine` succeeds but before
  `commitStateMachine` / broadcast / `checkEarlyTermination`, the stale owner returns `RETRY` and
  produces no side effects; the new owner heals via the duplicate-command path.
- Early-termination: all surviving answer via the non-owner → owner runs `checkEarlyTermination`
  one or more times if duplicate recovery replays, but only one observable `ROUND_ENDED`
  is emitted and the associated termination side effect remains idempotent.

## Verify / done

- Specs green; full suite green.
- `docker:multi`: 3 players on 3 different nodes, all answer → correct eliminations, single
  `ROUND_ENDED`, `match:state` not clobbered (owner is sole writer). Compare answer p95 vs
  Stage A cross-node run (should stay low).
