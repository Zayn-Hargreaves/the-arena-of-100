// ============================================================
// Redis Service - Cache & Session Store
// ============================================================

import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

type MessageHandler = (msg: string) => void;

// A lifecycle op (subscribe/unsubscribe) registers a marker on entry so the
// reset "writer" can drain already-admitted ops before rebuilding the
// subscriber connection. The initiator of a reset is excluded from its own
// drain set (handoff) to avoid a self-deadlock.
interface OpMarker {
  promise?: Promise<void>;
  // Resolves when this op HANDS OFF to an in-progress reset barrier: at that
  // point its map mutation has already been rolled back and it is only awaiting
  // the barrier, so a running reset's drain must stop waiting on its full
  // completion. Without this, two ops on DIFFERENT channels that fail and reset
  // concurrently deadlock: the first reset's drain awaits the second op, while
  // the second op awaits the first reset's barrier.
  detached?: Promise<void>;
  detach?: () => void;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  // --- Pub/sub subscribe machinery (B0) ---
  // ioredis cannot SUBSCRIBE on the command connection, so a dedicated
  // subscriber connection is created lazily and cached. The single "message"
  // dispatch listener is registered ONCE per connection, before any subscribe
  // resolves, so no message can be missed right after SUBSCRIBE is confirmed.
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, MessageHandler[]>();
  // Per-channel serialization: subscribe/unsubscribe for the same channel run
  // through a promise chain so a final unsubscribe and a fresh subscribe can
  // never interleave their Redis calls.
  private readonly channelChains = new Map<string, Promise<void>>();
  // Global reset barrier. Every lifecycle op awaits this at its ENTRY point
  // (before mutating the handler map), so a reset that rebuilds the whole
  // connection never overlaps a map mutation from a new op.
  private resetInProgress: Promise<void> | null = null;
  private resetPending = false;
  // Already-admitted (past-barrier) lifecycle ops, for the reset drain.
  private readonly inFlight = new Set<OpMarker>();
  private static readonly RECONCILE_RETRIES = 3;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>(
      "REDIS_URL",
      "redis://localhost:6379",
    );
    const keyPrefix = this.configService.get<string>("REDIS_KEY_PREFIX");

    this.client = new Redis(redisUrl, {
      ...(keyPrefix ? { keyPrefix } : {}),
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });

    this.client.on("connect", () => {
      this.logger.log("✅ Redis connected");
    });

    this.client.on("error", (err) => {
      this.logger.error("❌ Redis error:", err.message);
    });
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
    await this.client.quit();
    this.logger.log("🔌 Redis disconnected");
  }

  getClient(): Redis {
    return this.client;
  }

  // Key-value operations
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.set(key, value, "EX", ttl);
    } else {
      await this.client.set(key, value);
    }
  }

  // Atomic "create-only" write. Uses Redis SET ... NX so the key is
  // created iff it does NOT already exist. A concurrent writer that
  // won the race is preserved; we never overwrite a fresher value.
  // Returns true if the key was created, false if it already existed.
  async setIfAbsent(
    key: string,
    value: string,
    ttl?: number,
  ): Promise<boolean> {
    const result = ttl
      ? await this.client.set(key, value, "EX", ttl, "NX")
      : await this.client.set(key, value, "NX");
    return result === "OK";
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // JSON operations
  async getJSON<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async setJSON(key: string, value: unknown, ttl?: number): Promise<void> {
    const json = JSON.stringify(value);
    await this.set(key, json, ttl);
  }

  // Set operations (for player lists, etc.)
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  // Atomic counter
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  // Pub/Sub
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  // Lua script execution
  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  // Check if a key exists
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // ============================================================
  // Distributed lease primitives (B0)
  // ============================================================

  // Intention-revealing alias over SET NX EX so lease call sites read clearly.
  // Returns true iff the lease key was created (i.e. not already held).
  async acquireLease(
    key: string,
    value: string,
    ttlSec: number,
  ): Promise<boolean> {
    return this.setIfAbsent(key, value, ttlSec);
  }

  // Atomic CAS renew: extend the lease TTL only if the stored value still
  // equals `expected`. A node that lost the lease (value changed, or it
  // expired then was taken) gets false and does NOT extend anyone's TTL.
  async renewLease(
    key: string,
    expected: string,
    ttlSec: number,
  ): Promise<boolean> {
    const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
  return 0
end`;
    const result = await this.eval(
      script,
      [key],
      [expected, String(ttlSec * 1000)],
    );
    return result === 1;
  }

  // Atomic CAS delete: remove the lease only if the stored value still equals
  // `expected`, so we never delete a lease another node has already taken.
  async releaseLease(key: string, expected: string): Promise<boolean> {
    const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end`;
    const result = await this.eval(script, [key], [expected]);
    return result === 1;
  }

  // Atomic lease-and-fence acquisition. Increments the fence and claims the
  // owner key in one Lua transaction, so there is no caller-side INCR/SET NX
  // race. Returns:
  //   - { fence, leaseValue } when the lease was acquired;
  //   - null ONLY on the live-owner path (another node holds it; fence UNCHANGED).
  // A missing / malformed / inconsistent payload is an infrastructure error and
  // is THROWN — never collapsed to null — because the script may already have
  // incremented the fence and stored the lease.
  async acquireLeaseWithFence(
    ownerKey: string,
    fenceKey: string,
    nodeId: string,
    ttlSec: number,
  ): Promise<{ fence: number; leaseValue: string } | null> {
    const script = `
local currentOwner = redis.call('GET', KEYS[1])
if currentOwner == false or currentOwner == nil or currentOwner == "" then
  local newFence = redis.call('INCR', KEYS[2])
  local leaseValue = ARGV[1] .. ":" .. tostring(newFence)
  redis.call('SET', KEYS[1], leaseValue, 'EX', ARGV[2])
  return {tostring(newFence), leaseValue}
else
  return nil
end`;
    const result = await this.eval(
      script,
      [ownerKey, fenceKey],
      [nodeId, String(ttlSec)],
    );

    // Live-owner path: Lua returned nil → the fence was NOT advanced.
    if (result === null || result === undefined) {
      return null;
    }

    // Any non-null response MUST be a well-formed [fenceStr, leaseValue] pair.
    // If it is not, the script may already have written the lease, so we cannot
    // silently treat it as "not acquired" — surface it as an infra error.
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error(
        `acquireLeaseWithFence: malformed Lua payload for ${ownerKey} ` +
          `(may have written the lease): ${JSON.stringify(result)}`,
      );
    }
    const [fenceRaw, leaseValue] = result as unknown[];
    const fence = Number(fenceRaw);
    if (
      !Number.isInteger(fence) ||
      fence <= 0 ||
      typeof leaseValue !== "string" ||
      leaseValue !== `${nodeId}:${fence}`
    ) {
      throw new Error(
        `acquireLeaseWithFence: inconsistent Lua payload for ${ownerKey} ` +
          `(fence=${String(fenceRaw)}, leaseValue=${String(leaseValue)})`,
      );
    }
    return { fence, leaseValue };
  }

  // Atomic release-and-deindex (B2b). In ONE Lua transaction: if the owner
  // key still equals `expected`, DEL it AND SREM `member` from `indexKey`,
  // returning true. Otherwise touch nothing and return false. This closes the
  // race a two-step (releaseLease then SREM) flow opens, where the B3b orphan
  // sweep could see an owner-less matchId still in match:active and adopt a
  // finished match. A false result means ownership already moved on — the new
  // owner's lease and the index entry are both left intact.
  async releaseLeaseAndIndex(
    ownerKey: string,
    expected: string,
    indexKey: string,
    member: string,
  ): Promise<boolean> {
    const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[2])
  return 1
else
  return 0
end`;
    const result = await this.eval(
      script,
      [ownerKey, indexKey],
      [expected, member],
    );
    return result === 1;
  }

  // Fenced compare-and-set on the canonical match:state write (B2c). In ONE
  // Lua transaction, validate the caller's ownership token AND the fence AND
  // the state revision, then write both the state blob and the next revision.
  // Returns:
  //   - "APPLIED": ownership + fence + revision all matched; state written.
  //   - "RETRY":   the caller's owner/fence/revision snapshot is stale or the
  //                revision key is missing for a non-initial write (a
  //                resurrected owner whose lease expired, or a post-takeover
  //                fence bump, is rejected here — no state mutation).
  // Revision bootstrap: a missing revision key is accepted ONLY when
  // expectedRevision is "0" (INITIAL_STATE_REVISION); the first write creates
  // it atomically. (eventId / submissionId dedup outcomes are added in B4.)
  async fencedStateSet(
    ownerKey: string,
    fenceKey: string,
    stateKey: string,
    revisionKey: string,
    opts: {
      leaseValue: string;
      expectedFence: number;
      blob: string;
      ttlSec: number;
      expectedRevision: number;
      nextRevision: number;
    },
  ): Promise<"APPLIED" | "RETRY"> {
    const script = `
local currentOwner = redis.call('GET', KEYS[1])
if currentOwner == false or currentOwner ~= ARGV[1] then
  return 'RETRY'
end
local currentFence = redis.call('GET', KEYS[2])
if currentFence == false or currentFence ~= ARGV[2] then
  return 'RETRY'
end
local currentRevision = redis.call('GET', KEYS[4])
if currentRevision == false then
  if ARGV[5] ~= '0' then return 'RETRY' end
elseif currentRevision ~= ARGV[5] then
  return 'RETRY'
end
-- The revision must advance by exactly one. A nextRevision that is not
-- expectedRevision + 1 is a malformed / stale request; reject it before
-- writing so a gap or rewind can never be persisted.
if tonumber(ARGV[6]) ~= tonumber(ARGV[5]) + 1 then
  return 'RETRY'
end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
redis.call('SET', KEYS[4], ARGV[6], 'EX', ARGV[4])
return 'APPLIED'`;
    const result = await this.eval(
      script,
      [ownerKey, fenceKey, stateKey, revisionKey],
      [
        opts.leaseValue,
        String(opts.expectedFence),
        opts.blob,
        String(opts.ttlSec),
        String(opts.expectedRevision),
        String(opts.nextRevision),
      ],
    );
    // The script returns exactly "APPLIED" or "RETRY". Any other reply is a
    // contract violation (wrong script cached, Redis returned an error object,
    // a partial write) — do NOT silently collapse it to "RETRY" (a CAS miss),
    // which would mask corruption and let the caller proceed as if the write
    // were merely contended. Surface it as an infrastructure error instead.
    if (result === "APPLIED") return "APPLIED";
    if (result === "RETRY") return "RETRY";
    throw new Error(
      `fencedStateSet: unexpected Lua reply for ${stateKey} ` +
        `(state may be inconsistent): ${JSON.stringify(result)}`,
    );
  }

  // Fenced cleanup of the canonical match:state + revision (B2c). In ONE Lua
  // transaction, verify the caller still owns the match (owner == leaseValue
  // AND fence == expectedFence), then DEL both the state and revision keys.
  // Returns:
  //   - true:  ownership matched; both keys removed.
  //   - false: ownership already moved on (owner/fence mismatch) → NO-OP, so a
  //            superseded owner's late finish can never delete the state a NEW
  //            owner has since written. Non-owned / admin-force cleanup (no
  //            ownership snapshot) uses an unconditional del at the call site.
  async fencedStateDelete(
    ownerKey: string,
    fenceKey: string,
    stateKey: string,
    revisionKey: string,
    opts: { leaseValue: string; expectedFence: number },
  ): Promise<boolean> {
    const script = `
local currentOwner = redis.call('GET', KEYS[1])
if currentOwner == false or currentOwner ~= ARGV[1] then
  return 0
end
local currentFence = redis.call('GET', KEYS[2])
if currentFence == false or currentFence ~= ARGV[2] then
  return 0
end
redis.call('DEL', KEYS[3])
redis.call('DEL', KEYS[4])
return 1`;
    const result = await this.eval(
      script,
      [ownerKey, fenceKey, stateKey, revisionKey],
      [opts.leaseValue, String(opts.expectedFence)],
    );
    return result === 1;
  }

  // Redis server clock in epoch ms (from the TIME command). Used by the
  // clock-skew measurement (B2c): each node publishes its offset from this
  // common reference so synchronized nodes report ~0 skew regardless of when
  // their heartbeats last fired.
  async serverTimeMs(): Promise<number> {
    const [sec, micros] = (await this.client.time()) as unknown as [
      string,
      string,
    ];
    return Number(sec) * 1000 + Math.floor(Number(micros) / 1000);
  }

  // ============================================================
  // Pub/sub subscribe (B0) — fire-and-forget only (safe-to-lose nudges).
  // The B4 command channel is a durable Redis Stream, NOT this pub/sub.
  // ============================================================

  // Register `handler` for `channel`. Multiple handlers per channel are
  // reference-counted; the underlying Redis SUBSCRIBE is issued once. The
  // dispatch listener + handler-map entry are live BEFORE the SUBSCRIBE
  // confirmation, so a message published immediately after subscribe() resolves
  // is not missed.
  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    await this.awaitResetBarrier();
    const marker = this.newMarker();
    const op = this.chain(channel, () =>
      this.runInFlight(marker, () =>
        this.doSubscribe(channel, handler, marker),
      ),
    );
    marker.promise = op;
    return op;
  }

  // Remove ONLY this specific handler from the channel (reference-counting).
  // Other consumers' handlers are preserved; only when the list becomes empty
  // is the map entry dropped AND `subscriber.unsubscribe(channel)` issued.
  async unsubscribe(channel: string, handler: MessageHandler): Promise<void> {
    await this.awaitResetBarrier();
    const marker = this.newMarker();
    const op = this.chain(channel, () =>
      this.runInFlight(marker, () =>
        this.doUnsubscribe(channel, handler, marker),
      ),
    );
    marker.promise = op;
    return op;
  }

  private async doSubscribe(
    channel: string,
    handler: MessageHandler,
    self: OpMarker,
  ): Promise<void> {
    const sub = this.ensureSubscriber();
    const list =
      this.handlers.get(channel) ??
      this.handlers.set(channel, []).get(channel)!;
    const alreadyLive = list.length > 0;
    list.push(handler);
    if (alreadyLive) {
      // The channel already has a live Redis subscription; a second handler
      // needs no new SUBSCRIBE (and must not tear anything down on failure).
      return;
    }
    try {
      await sub.subscribe(channel);
    } catch (err) {
      // Roll back the handler we just added so a retried subscribe() cannot
      // accumulate a duplicate handler.
      this.removeHandler(channel, handler);
      // The SUBSCRIBE may have been ACCEPTED before the reply was dropped,
      // leaving the connection subscribed with no local dispatch target.
      // Reconcile the channel state before rethrowing the original error.
      await this.reconcileAfterFailedSubscribe(channel, self);
      throw err;
    }
  }

  private async doUnsubscribe(
    channel: string,
    handler: MessageHandler,
    self: OpMarker,
  ): Promise<void> {
    const list = this.handlers.get(channel);
    if (!list) return;
    const removed = this.removeHandler(channel, handler);
    if (!removed || list.length > 0 || !this.subscriber) {
      // Not the last handler (or unknown handler / no connection): keep the
      // channel's live subscription in place.
      return;
    }
    try {
      await this.subscriber.unsubscribe(channel);
    } catch (err) {
      // Handlers may have been re-added meanwhile; if so, the still-active
      // Redis subscription is now wanted again — leave it.
      if ((this.handlers.get(channel)?.length ?? 0) > 0) {
        return;
      }
      // The final unsubscribe failed and the handler list is now empty. If we
      // simply threw, the local state would say "no handlers" while the Redis
      // connection may still be SUBSCRIBED — and no future unsubscribe would
      // retry (there is no handler left to remove). Reconcile by rebuilding the
      // subscriber from the handler map (source of truth): the now-empty
      // channel is not re-subscribed, so the orphaned subscription cannot
      // survive. The initiator is handed off to avoid a self-deadlock in the
      // reset drain. If the reset itself fails, surface the original error.
      try {
        await this.resetSubscriber(self);
      } catch {
        throw err;
      }
    }
  }

  // On a failed subscribe whose Redis SUBSCRIBE may have been accepted:
  //   - if other handlers remain, the subscription is wanted → keep it;
  //   - else bounded-retry unsubscribe; if every retry fails, escalate to a
  //     full subscriber reset behind the global barrier (rebuild wanted set
  //     from the handler map) so no orphaned subscription survives.
  private async reconcileAfterFailedSubscribe(
    channel: string,
    self: OpMarker,
  ): Promise<void> {
    if ((this.handlers.get(channel)?.length ?? 0) > 0) return;
    const sub = this.subscriber;
    if (!sub) return;
    for (let attempt = 0; attempt < RedisService.RECONCILE_RETRIES; attempt++) {
      try {
        await sub.unsubscribe(channel);
        return; // no orphaned subscription remains
      } catch {
        // retry
      }
    }
    // Every retry failed → escalate to a subscriber reset. The initiator (self)
    // is handed off (excluded from the drain set) so the reset cannot deadlock
    // waiting on the very op that triggered it.
    await this.resetSubscriber(self);
  }

  // Rebuild the subscriber connection and re-subscribe every channel whose
  // handler list is non-empty. Runs behind the global barrier so no new
  // lifecycle op mutates the handler map mid-rebuild.
  private resetSubscriber(self?: OpMarker): Promise<void> {
    if (this.resetInProgress) {
      // A reset is already running and `self` is about to await this barrier.
      // Detach it so the running reset's drain does not wait on an op that is
      // itself blocked on the barrier — the cycle that deadlocks two concurrent
      // cross-channel resets. `self` is quiescent here (handler already rolled
      // back / removed), so its remaining work never mutates the handler map.
      if (self) self.detach?.();
      return this.resetInProgress;
    }
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const barrier = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Set synchronously BEFORE any await so new ops entering the barrier block.
    this.resetInProgress = barrier;
    this.resetPending = false;

    void (async () => {
      try {
        // Handoff: the initiator is quiescent (handler already rolled back, no
        // further map mutation), so exclude it from the drain to avoid a cycle.
        if (self) this.inFlight.delete(self);
        // Drain already-admitted ops so no handler-map mutation overlaps the
        // rebuild snapshot. An op that hands off to this barrier resolves its
        // `detached` signal; race against it so the drain stops waiting on an
        // op blocked on the very reset it is draining (cross-channel deadlock),
        // while still fully awaiting ops that are actively mutating the map.
        await Promise.allSettled(
          [...this.inFlight].map((m) => {
            const settled = (m.promise ?? Promise.resolve()).catch(
              () => undefined,
            );
            return m.detached ? Promise.race([settled, m.detached]) : settled;
          }),
        );
        try {
          this.subscriber?.disconnect();
        } catch {
          // best-effort
        }
        this.subscriber = null;
        const sub = this.ensureSubscriber();
        // Rebuild the wanted set from the handler map (the source of truth).
        for (const [ch, list] of this.handlers) {
          if (list.length > 0) await sub.subscribe(ch);
        }
        resolve();
      } catch (err) {
        // Do NOT leave the barrier permanently pending: record a retryable
        // failure so the next lifecycle op starts a fresh reset attempt.
        this.resetPending = true;
        this.logger.error(
          `Subscriber reset failed; will retry on next op: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        reject(err);
      } finally {
        this.resetInProgress = null;
      }
    })();

    return barrier;
  }

  // Every lifecycle op awaits this at entry. If a reset is running, wait for it;
  // if a prior reset failed (resetPending), start a fresh one before proceeding.
  //
  // A reset failure is NOT swallowed: it propagates to the caller so the caller
  // can apply retry/backoff rather than this method spinning forever on a
  // permanently-failing reset. `resetPending`/`resetInProgress` bookkeeping is
  // preserved, so a later lifecycle op still starts a fresh reset attempt.
  private async awaitResetBarrier(): Promise<void> {
    for (;;) {
      if (this.resetInProgress) {
        await this.resetInProgress;
        continue;
      }
      if (this.resetPending) {
        await this.resetSubscriber();
        continue;
      }
      return;
    }
  }

  private ensureSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();
      // Register the single dispatch listener ONCE, before any subscribe()
      // resolves, so no message is missed after a SUBSCRIBE confirmation.
      this.subscriber.on("message", (ch: string, msg: string) => {
        const list = this.handlers.get(ch);
        if (!list) return;
        // Isolate every handler: a synchronous throw (or a rejected promise
        // from an async handler) must not stop dispatch to the remaining
        // handlers on the channel. Each failure is logged and swallowed.
        for (const h of [...list]) {
          try {
            const result = h(msg) as unknown;
            if (
              result &&
              typeof (result as { then?: unknown }).then === "function"
            ) {
              void (result as Promise<unknown>).catch((err) => {
                this.logger.error(
                  `Async message handler for channel ${ch} rejected: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
            }
          } catch (err) {
            this.logger.error(
              `Message handler for channel ${ch} threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      });
    }
    return this.subscriber;
  }

  // Serialize lifecycle ops for one channel through a promise chain. The stored
  // tail never rejects (so it can't produce an unhandled rejection); the
  // returned promise still surfaces the op's real outcome to the caller.
  private chain(channel: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.channelChains.get(channel) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.channelChains.set(
      channel,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  // Register `marker` in the reset-drain set only for the duration its chain
  // callback is actually running. Adding it at enqueue time (as the previous
  // `track` did) let a reset triggered by the op AHEAD of it on the same
  // channel chain wait on this still-queued op, which could not start until the
  // triggering op finished — a deadlock. Adding it here, at callback entry,
  // means an op still blocked behind the failing op is invisible to that op's
  // reset drain.
  private runInFlight(
    marker: OpMarker,
    fn: () => Promise<void>,
  ): Promise<void> {
    this.inFlight.add(marker);
    return fn().finally(() => {
      this.inFlight.delete(marker);
    });
  }

  // Build a lifecycle-op marker with its detach signal wired up. `detached`
  // resolves only when `detach()` is called (on handoff to an in-progress
  // reset), so a normal op that never resets is fully awaited by any drain.
  private newMarker(): OpMarker {
    const marker: OpMarker = {};
    marker.detached = new Promise<void>((resolve) => {
      marker.detach = resolve;
    });
    return marker;
  }

  private removeHandler(channel: string, handler: MessageHandler): boolean {
    const list = this.handlers.get(channel);
    if (!list) return false;
    const i = list.indexOf(handler);
    if (i === -1) return false;
    list.splice(i, 1);
    if (list.length === 0) this.handlers.delete(channel);
    return true;
  }
}
