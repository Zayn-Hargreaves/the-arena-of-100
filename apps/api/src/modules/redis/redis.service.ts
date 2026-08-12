// ============================================================
// Redis Service - Cache & Session Store
// ============================================================

import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { OpMarker, MessageHandler } from "./redis.internal";
import * as core from "./redis.core";
import * as lease from "./redis.lease";
import * as streams from "./redis.streams";
import * as pubsub from "./redis.pubsub";
import type { RequeueDeadLetterKeys } from "./redis.lease";

export type { RequeueDeadLetterKeys } from "./redis.lease";
export type { OpMarker, MessageHandler } from "./redis.internal";
export type {
  StreamEntry,
  XPendingSummary,
  XPendingEntry,
} from "./redis.streams";

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
  // Pool of dedicated connections for blocking XREADGROUP. Concurrent match
  // polls must not share one connection (ioredis serializes commands on a
  // single socket). MAX covers idle + in-use; excess polls wait in a queue.
  // All non-trivial coordination lives in redis.streams.* — these fields are
  // kept here so existing tests can drive the pool directly.
  private readonly blockingReaderPool: Redis[] = [];
  private readonly blockingReadersInUse = new Set<Redis>();
  private readonly blockingReaderWaiters: Array<{
    resolve: (reader: Redis | null) => void;
    onAbort?: () => void;
  }> = [];
  private blockingReadersShuttingDown = false;
  /** Last observed waiter depth used to warn only on 0→non-empty transitions. */
  private lastBlockingReaderWaiters = 0;
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

  constructor(private readonly configService: ConfigService) {
    this.client = core.createRedisClient(this.configService);
    this.client.on("connect", () => {
      this.logger.log("✅ Redis connected");
    });
    this.client.on("error", (err) => {
      this.logger.error("❌ Redis error:", err.message);
    });
  }

  /** Internal accessor for cross-module helpers (e.g. redis.streams logger). */
  getLogger(): Logger {
    return this.logger;
  }

  async onModuleDestroy() {
    this.blockingReadersShuttingDown = true;
    // Unblock waiters so pending acquire() does not hang past teardown.
    while (this.blockingReaderWaiters.length > 0) {
      const waiter = this.blockingReaderWaiters.shift()!;
      waiter.resolve(null);
    }
    this.lastBlockingReaderWaiters = 0;
    // Close every allocated reader (idle + currently blocked). Prefer
    // disconnect() so sockets mid-XREADGROUP BLOCK drop immediately.
    const allocated = [
      ...this.blockingReaderPool.splice(0),
      ...this.blockingReadersInUse,
    ];
    this.blockingReadersInUse.clear();
    for (const reader of allocated) {
      try {
        reader.disconnect();
      } catch {
        // best-effort
      }
    }
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
    await core.quitRedisClient(this.client, this.logger);
  }

  // Internal accessor for the streams module. Returns a refs object the
  // streams functions use to read/write the pool state without copying.
  getBlockingReaderPoolRefs(): streams.BlockingReaderPoolRefs {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      pool: self.blockingReaderPool,
      inUse: self.blockingReadersInUse,
      waiters: self.blockingReaderWaiters,
      isShuttingDown: () => self.blockingReadersShuttingDown,
      setLastWaiterDepth: (n) => {
        self.lastBlockingReaderWaiters = n;
      },
      getLastWaiterDepth: () => self.lastBlockingReaderWaiters,
    };
  }

  getClient(): Redis {
    return this.client;
  }

  // Key-value operations
  get(key: string): Promise<string | null> {
    return core.get(this.client, key);
  }

  set(key: string, value: string, ttl?: number): Promise<void> {
    return core.set(this.client, key, value, ttl);
  }

  // Atomic "create-only" write. Uses Redis SET ... NX so the key is
  // created iff it does NOT already exist. A concurrent writer that
  // won the race is preserved; we never overwrite a fresher value.
  // Returns true if the key was created, false if it already existed.
  setIfAbsent(key: string, value: string, ttl?: number): Promise<boolean> {
    return core.setIfAbsent(this.client, key, value, ttl);
  }

  del(key: string): Promise<void> {
    return core.del(this.client, key);
  }

  // JSON operations
  getJSON<T>(key: string): Promise<T | null> {
    return core.getJSON<T>(this.client, key);
  }

  setJSON(key: string, value: unknown, ttl?: number): Promise<void> {
    return core.setJSON(this.client, key, value, ttl);
  }

  // Set operations (for player lists, etc.)
  sadd(key: string, ...members: string[]): Promise<number> {
    return core.sadd(this.client, key, ...members);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    return core.srem(this.client, key, ...members);
  }

  smembers(key: string): Promise<string[]> {
    return core.smembers(this.client, key);
  }

  sismember(key: string, member: string): Promise<boolean> {
    return core.sismember(this.client, key, member);
  }

  // Atomic counter
  incr(key: string): Promise<number> {
    return core.incr(this.client, key);
  }

  // Pub/Sub
  publish(channel: string, message: string): Promise<number> {
    return core.publish(this.client, channel, message);
  }

  // Lua script execution
  eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return core.luaEval(this.client, script, keys, args);
  }

  // Check if a key exists
  exists(key: string): Promise<boolean> {
    return core.exists(this.client, key);
  }

  // ============================================================
  // Distributed lease primitives (B0) — delegated to redis.lease
  // ============================================================

  acquireLease(key: string, value: string, ttlSec: number): Promise<boolean> {
    return lease.acquireLease(this, key, value, ttlSec);
  }

  renewLease(key: string, expected: string, ttlSec: number): Promise<boolean> {
    return lease.renewLease(this, key, expected, ttlSec);
  }

  releaseLease(key: string, expected: string): Promise<boolean> {
    return lease.releaseLease(this, key, expected);
  }

  acquireLeaseWithFence(
    ownerKey: string,
    fenceKey: string,
    nodeId: string,
    ttlSec: number,
  ): Promise<{ fence: number; leaseValue: string } | null> {
    return lease.acquireLeaseWithFence(
      this,
      ownerKey,
      fenceKey,
      nodeId,
      ttlSec,
    );
  }

  releaseLeaseAndIndex(
    ownerKey: string,
    expected: string,
    indexKey: string,
    member: string,
  ): Promise<boolean> {
    return lease.releaseLeaseAndIndex(
      this,
      ownerKey,
      expected,
      indexKey,
      member,
    );
  }

  fencedStateSet(
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
    return lease.fencedStateSet(
      this,
      ownerKey,
      fenceKey,
      stateKey,
      revisionKey,
      opts,
    );
  }

  fencedStateDelete(
    ownerKey: string,
    fenceKey: string,
    stateKey: string,
    revisionKey: string,
    opts: { leaseValue: string; expectedFence: number },
  ): Promise<boolean> {
    return lease.fencedStateDelete(
      this,
      ownerKey,
      fenceKey,
      stateKey,
      revisionKey,
      opts,
    );
  }

  // ============================================================
  // B3b — failover recovery primitives (delegated to redis.lease)
  // ============================================================

  acquireMatchLease(
    ownerKey: string,
    fenceKey: string,
    tombstoneKey: string,
    nodeId: string,
    ttlSec: number,
  ): Promise<{ fence: number; leaseValue: string } | null | "TERMINAL"> {
    return lease.acquireMatchLease(
      this,
      ownerKey,
      fenceKey,
      tombstoneKey,
      nodeId,
      ttlSec,
    );
  }

  removeActiveIfStateAbsent(
    stateKey: string,
    indexKey: string,
    member: string,
  ): Promise<"REMOVED" | "PRESENT"> {
    return lease.removeActiveIfStateAbsent(this, stateKey, indexKey, member);
  }

  removeIndexMemberIfValueUnchanged(
    valueKey: string,
    indexKey: string,
    member: string,
    observedValue: string | null,
  ): Promise<"REMOVED" | "CHANGED"> {
    return lease.removeIndexMemberIfValueUnchanged(
      this,
      valueKey,
      indexKey,
      member,
      observedValue,
    );
  }

  removeActiveIfTombstoned(
    tombstoneKey: string,
    indexKey: string,
    member: string,
  ): Promise<"REMOVED" | "ABSENT"> {
    return lease.removeActiveIfTombstoned(this, tombstoneKey, indexKey, member);
  }

  finalizeMatchTombstone(
    ownerKey: string,
    fenceKey: string,
    tombstoneKey: string,
    indexKey: string,
    deadLetterSet: string,
    member: string,
    opts: {
      leaseValue: string;
      expectedFence: number;
      reason: "finished" | "dead-letter" | "cleaned";
      ttlSec: number;
    },
  ): Promise<"FINALIZED" | "STALE"> {
    return lease.finalizeMatchTombstone(
      this,
      ownerKey,
      fenceKey,
      tombstoneKey,
      indexKey,
      deadLetterSet,
      member,
      opts,
    );
  }

  requeueDeadLetter(
    keys: RequeueDeadLetterKeys,
    member: string,
    opts: { force: boolean },
  ): Promise<
    | "REQUEUED"
    | "NOT_TERMINAL"
    | "INVALID_TOMBSTONE"
    | "FINALIZED"
    | "NO_STATE"
    | "CONFLICT"
  > {
    return lease.requeueDeadLetter(this, keys, member, opts);
  }

  // ============================================================
  // B4a — Redis Stream wrappers (delegated to redis.streams)
  //
  // Typed wrappers over the ioredis stream commands. Service-layer code MUST
  // go through these — never getClient() — so call sites can't reach untyped
  // raw replies. Each entry carries a single "data" field holding the JSON
  // CommandEnvelope. The stream is capped with MAXLEN ~ so it can't grow
  // unbounded (also trimmed/deleted with the match on finish).
  // ============================================================

  xadd(stream: string, payload: string): Promise<string> {
    return streams.xadd(this, stream, payload);
  }

  xreadgroup(
    group: string,
    consumer: string,
    stream: string,
    count: number,
    blockMs: number,
    signal?: AbortSignal,
  ): Promise<streams.StreamEntry[]> {
    return streams.xreadgroup(
      this,
      group,
      consumer,
      stream,
      count,
      blockMs,
      signal,
    );
  }

  // Internal pool coordination — thin delegates to streams module. Kept as
  // public methods so the existing test suite can drive the pool directly.
  acquireBlockingReader(signal?: AbortSignal): Promise<Redis | null> {
    return streams.acquireBlockingReader(
      this.getBlockingReaderPoolRefs(),
      this.client,
      this.logger,
      signal,
    );
  }

  releaseBlockingReader(reader: Redis): void {
    streams.releaseBlockingReader(this.getBlockingReaderPoolRefs(), reader);
  }

  discardBlockingReader(reader: Redis): void {
    streams.discardBlockingReader(this.getBlockingReaderPoolRefs(), reader);
  }

  xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    return streams.xack(this, stream, group, ...ids);
  }

  xdel(stream: string, ...ids: string[]): Promise<number> {
    return streams.xdel(this, stream, ...ids);
  }

  xgroupCreate(
    stream: string,
    group: string,
    opts: { mkStream?: boolean; startId?: string } = {},
  ): Promise<void> {
    return streams.xgroupCreate(this, stream, group, opts);
  }

  xautoclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    startId: string,
    count: number,
  ): Promise<{ nextCursor: string; claimed: streams.StreamEntry[] }> {
    return streams.xautoclaim(
      this,
      stream,
      group,
      consumer,
      minIdleMs,
      startId,
      count,
    );
  }

  xpending(stream: string, group: string): Promise<streams.XPendingSummary> {
    return streams.xpending(this, stream, group);
  }

  xpendingDetail(
    stream: string,
    group: string,
    opts: { start?: string; end?: string; count: number; minIdleMs?: number },
  ): Promise<streams.XPendingEntry[]> {
    return streams.xpendingDetail(this, stream, group, opts);
  }

  xclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ...ids: string[]
  ): Promise<streams.StreamEntry[]> {
    return streams.xclaim(this, stream, group, consumer, minIdleMs, ...ids);
  }

  xdelStream(stream: string): Promise<void> {
    return streams.xdelStream(this, stream);
  }

  // Redis server clock in epoch ms (from the TIME command). Used by the
  // clock-skew measurement (B2c): each node publishes its offset from this
  // common reference so synchronized nodes report ~0 skew regardless of when
  // their heartbeats last fired.
  serverTimeMs(): Promise<number> {
    return core.serverTimeMs(this.client);
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
  subscribe(channel: string, handler: MessageHandler): Promise<void> {
    return pubsub.subscribe(this.getPubSubContext(), channel, handler);
  }

  // Remove ONLY this specific handler from the channel (reference-counting).
  // Other consumers' handlers are preserved; only when the list becomes empty
  // is the map entry dropped AND `subscriber.unsubscribe(channel)` issued.
  unsubscribe(channel: string, handler: MessageHandler): Promise<void> {
    return pubsub.unsubscribe(this.getPubSubContext(), channel, handler);
  }

  // Returns the refs the pubsub module needs to read/write state. The facade
  // exposes its fields through these refs instead of via direct field access.
  private getPubSubContext(): pubsub.PubSubContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      subscriber: {
        get current() {
          return self.subscriber;
        },
        set current(v: Redis | null) {
          self.subscriber = v;
        },
      },
      handlers: self.handlers,
      channelChains: self.channelChains,
      resetInProgress: {
        get current() {
          return self.resetInProgress;
        },
        set current(v: Promise<void> | null) {
          self.resetInProgress = v;
        },
      },
      resetPending: {
        get current() {
          return self.resetPending;
        },
        set current(v: boolean) {
          self.resetPending = v;
        },
      },
      inFlight: self.inFlight,
      client: self.client,
      logger: self.logger,
      ensureSubscriber: () => self.ensureSubscriber(),
      removeHandler: (ch, h) => self.removeHandler(ch, h),
    };
  }

  // Lazily mint the subscriber connection. The dispatch listener is registered
  // ONCE so no message is missed after a SUBSCRIBE confirmation.
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
        for (const h of list) {
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
