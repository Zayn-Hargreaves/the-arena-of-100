# B2b — MatchOwnershipService: acquire on launch

**Depends on:** B0, B2a. **Blast radius:** touches `GameLoopService.launchRoomMatch`
(CRITICAL-adjacent — B1a covers). **Commit:** `feat(distributed): B2b match ownership acquire`.

## Goal

Introduce `MatchOwnershipService` that claims a Redis lease when a match launches, tracks
owned matches in-memory, and supersedes `ClusterService.getOwnedMatchIds`. **No heartbeat /
fencing yet** (B2c) — this phase just establishes single-owner-at-launch.

## New file — `apps/api/src/modules/match/match-ownership.service.ts`

```ts
@Injectable()
export class MatchOwnershipService {
  private readonly owned = new Map<
    string,
    { roomId: string; fence: number; leaseValue: string }
  >();
  constructor(
    private readonly redis: RedisService,
    private readonly cluster: ClusterService,
  ) {}

  // Called by GameLoopService.launchRoomMatch AFTER the match row exists.
  async acquireOnLaunch(matchId: string, roomId: string): Promise<boolean> {
    const res = await this.redis.acquireLeaseWithFence(
      ownerKey(matchId),
      fenceKey(matchId),
      this.cluster.nodeId,
      LEASE_TTL_SEC,
    );
    if (!res) return false;
    const { fence, leaseValue } = res;
    // Indexing into match:active must not silently fail — a match absent from
    // the index is invisible to recovery. Retry a bounded number of times. Do
    // not record local ownership until the lease is revalidated immediately
    // before returning success; an expired/taken-over lease must not start a
    // stale owner loop.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await addActiveMatch(this.redis, matchId); // SADD match:active
        const stillHeld = await this.redis.renewLease(
          ownerKey(matchId),
          leaseValue,
          LEASE_TTL_SEC,
        );
        if (!stillHeld) {
          this.logger.warn(
            `acquireOnLaunch: lease for ${matchId} no longer held after active-index write`,
          );
          return false;
        }
        this.owned.set(matchId, { roomId, fence, leaseValue });
        return true;
      } catch (err) {
        this.logger.warn(
          `addActiveMatch failed (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // COMPENSATE with a single, well-defined failure contract: atomic rollback.
    // The match never entered match:active, so recovery could not see it anyway
    // — therefore we must fully release the lease (not leave a half-owned match
    // that is unrecoverable). releaseLease is a CAS; a failed/uncertain release
    // is retried and its result VERIFIED (lease gone, or confirmed re-taken by
    // another node) before we return — otherwise we would strand a live lease
    // no one owns in memory. Only once the lease is provably gone do we drop
    // local ownership and report failure so the caller aborts the launch.
    let released = false;
    for (let attempt = 0; attempt < 3 && !released; attempt++) {
      try {
        released = await this.redis.releaseLease(ownerKey(matchId), leaseValue);
        // false means the value no longer matches (already expired/re-taken) —
        // the lease is not ours to hold, which is also an acceptable terminal
        // state. Confirm with a read before trusting a thrown-then-retried path.
        if (!released) {
          const cur = await this.redis.get(ownerKey(matchId));
          released = cur !== leaseValue; // no longer ours ⇒ safely relinquished
        }
      } catch (err) {
        this.logger.warn(
          `releaseLease retry ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!released) {
      // Could not prove the lease was relinquished. Hand the match to B3b's
      // EXISTING recovery path instead of dropping it or writing a marker no one
      // consumes: ensure it is in `match:active` so the orphan sweep adopts it
      // once our un-released lease hits its LEASE_TTL_SEC TTL (the sweep already
      // scans `match:active` for owner-less matches — no separate marker store,
      // no B3b changes). Do NOT swallow a failure with an empty catch: if even
      // this handoff fails, the match is neither running nor discoverable, so
      // surface it at error level for ops.
      const handedOff = await addActiveMatch(this.redis, matchId)
        .then(() => true)
        .catch((err) => {
          this.logger.error(
            `acquireOnLaunch: recovery handoff for ${matchId} FAILED (match not discoverable): ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        });
      if (handedOff) {
        this.logger.error(
          `acquireOnLaunch: lease for ${matchId} unresolved; left in match:active for recovery (lease self-expires in ${LEASE_TTL_SEC}s)`,
        );
      }
    }
    this.owned.delete(matchId);
    return false;
  }

  getOwnedMatchIds(): string[] {
    return [...this.owned.keys()];
  }
  isOwner(matchId: string): boolean {
    return this.owned.has(matchId);
  }
  getLeaseValue(matchId: string): string | undefined {
    return this.owned.get(matchId)?.leaseValue;
  }

  async release(matchId: string): Promise<void> {
    const entry = this.owned.get(matchId);
    this.owned.delete(matchId); // always drop local ownership
    if (!entry) return;
    // ATOMIC release: deleting the owner key and removing the match:active
    // entry must be ONE Redis operation. A two-step flow (releaseLease, then
    // removeActiveMatch) opens a race: after the owner key is deleted but
    // before the index removal lands, the B3b orphan sweep sees an owner-less
    // matchId still in match:active and can ACQUIRE the finished match. A
    // single Lua CAS closes that window — it validates the expected
    // leaseValue and, only when it still matches, deletes the owner key AND
    // SREMs match:active in the same script (so no observer can ever see
    // "owner gone, index present" for a lease WE released):
    //
    //   -- KEYS[1]=ownerKey  KEYS[2]=match:active
    //   -- ARGV[1]=expected leaseValue  ARGV[2]=matchId
    //   if redis.call('GET', KEYS[1]) == ARGV[1] then
    //     redis.call('DEL', KEYS[1])
    //     redis.call('SREM', KEYS[2], ARGV[2])
    //     return 1
    //   else
    //     return 0
    //   end
    //
    // Exposed as `RedisService.releaseLeaseAndIndex(ownerKey, expected,
    // indexKey, member): Promise<boolean>` — a B0-style `eval` wrapper added
    // in this phase next to `releaseLease`. CAS fail (0) means ownership has
    // already moved to another node → the script touched NOTHING: the new
    // owner's lease survives and match:active stays intact so the match
    // remains discoverable to recovery.
    let outcome: boolean | undefined;
    for (let attempt = 0; attempt < 3 && outcome === undefined; attempt++) {
      try {
        outcome = await this.redis.releaseLeaseAndIndex(
          ownerKey(matchId),
          entry.leaseValue,
          ACTIVE_MATCHES_KEY,
          matchId,
        );
      } catch (err) {
        this.logger.warn(
          `release: releaseLeaseAndIndex retry ${attempt + 1} failed for ${matchId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (outcome === undefined)
      // All attempts threw: lease + index state unknown. The un-renewed lease
      // self-expires within LEASE_TTL_SEC and the entry stays in match:active,
      // so B3b's sweep (with its conditional stale-index cleanup validating
      // canonical state) adopts or drops it — surface for ops either way.
      this.logger.error(
        `release: releaseLeaseAndIndex for ${matchId} failed after retries; lease will self-expire, entry left for B3b recovery/cleanup`,
      );
    else if (!outcome)
      this.logger.warn(
        `release: lease for ${matchId} no longer ours; keeping match:active`,
      );
  }
}
```

Constants: `LEASE_TTL_SEC = 15`. Import key builders from `match-ownership.store.ts` (B2a).
`acquireLeaseWithFence` itself is a B0 `RedisService` primitive; B2b preserves this call site and
is simply the first ownership-flow consumer of that lower-layer API.

**Exception contract for `acquireOnLaunch`.** `redis.acquireLeaseWithFence` may **throw** — B0
defines malformed/truncated Lua payloads as infrastructure errors, and the script may already
have INCR'd the fence and written the lease before the failure surfaced (a post-write failure).
A thrown acquire must never escape `acquireOnLaunch` with a possibly-written lease that is
invisible to recovery.

- **Error contract (extends B0):** the wrapper throws a typed
  `LeaseAcquireError extends Error` carrying `writtenLease?: { fence: number; leaseValue:
string }` — populated **only** when the wrapper could verify (by re-reading `ownerKey` /
  `fenceKey` during its own compensation attempt) exactly what the script wrote. A generic
  thrown error (timeout, connection reset) has `writtenLease` undefined: it is unknown whether
  anything was written. B0's `acquireLeaseWithFence` section must define this error type; B2b
  consumes it.
- **Handling:** wrap the call in try/catch and route through the **same compensation/handoff
  path as the retry-exhaustion branch above**: when `writtenLease` is present, run the verified
  `releaseLease` flow against that exact `leaseValue`; when it is absent (or release cannot be
  verified), fall back to the recovery handoff — ensure `matchId` is in `match:active` so B3b's
  orphan sweep adopts whatever lease may exist once its `LEASE_TTL_SEC` TTL lapses (the TTL is
  the hard backstop: an un-renewed lease always self-expires). Then return `false`.
- **Alerting:** every failure of `releaseLease` (unverifiable release) and of the
  `addActiveMatch` handoff logs at **error** level (ops-visible), as in the retry-exhaustion
  branch — never a swallowed warning.
- **Invariant is best-effort, not absolute.** "No lease remains live without the `match:active`
  recovery index" holds **only when at least one of (verified release | `match:active` handoff)
  succeeds**. If BOTH fail (release unverifiable AND the handoff `addActiveMatch` also throws —
  e.g. Redis fully unreachable), the guarantee degrades to: the lease self-expires within
  `LEASE_TTL_SEC`, the match is not driven by anyone, and the double failure is logged at error
  level for manual recovery. State it that way — do not claim the index is always present.

Consequently `launchRoomMatch` only ever observes the boolean result and handles `false` via its
existing launch rollback, whether the acquire failed by returning `null`, by retry exhaustion,
or by throwing.

## Wiring

- **`match.module.ts`**: add `MatchOwnershipService` to providers + exports.
- **`game-loop.service.ts`** `launchRoomMatch` (~222): after the match row / `currentMatchId`
  is committed and before `roundRunner.startMatchLoop`, call
  `const acquired = await this.matchOwnership.acquireOnLaunch(matchId, roomId)`. **If it returns
  false, DO NOT call `startMatchLoop`** — that would break the single-owner invariant (two nodes
  could drive the loop). `acquireOnLaunch` has already applied its own compensation before
  returning false (atomic lease rollback, preserving the already-written active index when the
  lease is no longer ours, or — if the release could not be proven — re-indexing the match into
  `match:active` so B3b's orphan sweep adopts it after the lease TTL, see above),
  so the caller's job is only to **roll back the launch state**: log the
  failed acquisition and clear `currentMatchId` / revert room status (the same rollback the
  `SELECT ... FOR UPDATE` path already uses on abort). Do NOT additionally touch `match:active`
  here — ownership state was already fully reconciled inside `acquireOnLaunch`, so the recovery
  handoff (when it happens) is driven from there, not by the caller. A fresh
  launch should normally acquire; a false here means a race or a leftover lease and must be
  treated as "not our match to run".
- **`finishMatch` / `stopRoomRuntime` / `cancelMatchLoop`** paths: call
  `matchOwnership.release(matchId)` so the lease + `match:active` entry are cleaned up.
- **`/health/cluster.ownedMatches`**: have the **health controller inject `MatchOwnershipService`
  directly** and read `getOwnedMatchIds()`. **Do NOT inject `MatchOwnershipService` into
  `ClusterService`** — `MatchOwnershipService` already depends on `ClusterService` (for `nodeId`),
  so the reverse edge would create a cycle. `ClusterService` stays responsible only for `nodeId`
  and the socket-count metric; **remove** its `getOwnedMatchIds` SCAN placeholder (superseded).

## Tests — `match-ownership.service.spec.ts`

- `acquireOnLaunch` returns true and records ownership; a **second instance** (new service
  with a different `INSTANCE_ID`, same mock/real Redis) `acquireOnLaunch` on the same matchId
  returns **false** (lease already held).
- `release` removes owner key + `match:active` entry **atomically and only when** the
  `releaseLeaseAndIndex` CAS matches; when the CAS fails (ownership moved) it drops local
  ownership but leaves both the new owner's lease and `match:active` untouched.
- `release` with `releaseLeaseAndIndex` **throwing**: retried; on exhaustion an error is logged
  and the entry is left for B3b recovery/cleanup (lease self-expires) — never silently swallowed.
- **Regression — no owner-less-but-indexed window on release:** with a real/mock Redis, race a
  concurrent `acquireLeaseWithFence` (simulating the B3b orphan sweep) against `release`. Because
  release is one Lua script, the acquirer can only observe either (a) the lease still held → its
  acquisition fails, or (b) owner key gone AND `match:active` already cleaned → nothing to adopt.
  Assert it can never acquire a lease for a match that release has just finalized (the failure
  mode of the old two-step `releaseLease` → `removeActiveMatch` flow).
- `acquireOnLaunch` with `acquireLeaseWithFence` **throwing** (post-write infrastructure error):
  returns false and runs the same compensation/handoff as retry exhaustion — verified release
  when `LeaseAcquireError.writtenLease` is present, else `match:active` handoff. Cover the three
  degradation branches explicitly: (a) **release fails** (unverifiable) but the handoff
  succeeds → `matchId` is in `match:active`, error logged; (b) release succeeds but the
  **handoff path is never needed**; and (c) **both fail** (release unverifiable AND
  `addActiveMatch` throws) → returns false, both failures logged at error level, no ownership
  recorded, and the test documents that the lease self-expires via TTL (best-effort invariant).
- **acquireOnLaunch failure paths:** `acquireLeaseWithFence` returns `null` → returns false, no `match:active` index write;
  `addActiveMatch` fails all retries → lease is released, `owned` cleared, returns false;
  `addActiveMatch` succeeds but the immediate fenced `renewLease` check fails → returns false,
  does not record `owned`, and leaves `match:active` discoverable for the current/future owner.
- **Unverified release after active-index retry exhaustion:** keep the existing test where
  `releaseLease` succeeds, and add branches where `releaseLease` throws repeatedly or cannot be
  verified after all `addActiveMatch` retries. The service must not silently drop the match: it
  clears local `owned`, returns false, preserves or re-adds `matchId` in `match:active` for B3b
  recovery, and must not delete a lease that a newer owner has already taken.
- `getOwnedMatchIds`/`isOwner` reflect state.

(Add a `private readonly logger = new Logger(MatchOwnershipService.name)` — used above.)

## Verify / done

- Focused spec green; `game-loop.service.spec.ts` still green (mock `MatchOwnershipService`).
- **Defer the multi-node runtime check to B2c.** B2b has no heartbeat, so the 15s lease
  **expires mid-match** — probing `/health/cluster` after ~15s would show ownership vanish (a
  false negative) and a peer could then re-acquire a still-running match. In B2b, verify only:
  (a) the owner's `ownedMatches` shows the matchId **immediately** after launch, and (b) a
  second node's `acquireOnLaunch` for the same match returns false **within the TTL window**.
  Full end-to-end multi-node ownership (stable across a whole match) is validated in **B2c**
  once heartbeat + fencing keep the lease alive.
- Full suite green.
