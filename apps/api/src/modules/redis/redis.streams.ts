// ============================================================
// Redis Streams — typed wrappers + blocking reader pool
// ============================================================
// Pure functions over the ioredis stream commands. Service-layer code MUST
// go through these — never getClient() — so call sites can't reach untyped
// raw replies. Each entry carries a single "data" field holding the JSON
// CommandEnvelope. The stream is capped with MAXLEN ~ so it can't grow
// unbounded (also trimmed/deleted with the match on finish).

import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import type { RedisService } from "./redis.service";

const STREAM_MAXLEN = 10_000;
const STREAM_FIELD = "data";

export interface StreamEntry {
  readonly id: string;
  readonly data: string;
}

export interface XPendingSummary {
  readonly count: number;
  readonly minId: string | null;
  readonly maxId: string | null;
  readonly consumers: ReadonlyArray<{ consumer: string; count: number }>;
}

export interface XPendingEntry {
  readonly id: string;
  readonly consumer: string;
  readonly idleMs: number;
  readonly deliveryCount: number;
}

export const BLOCKING_READER_POOL_MAX = 16;

interface BlockingReaderWaiter {
  resolve: (reader: Redis | null) => void;
  onAbort?: () => void;
}

export interface BlockingReaderPoolRefs {
  pool: Redis[];
  inUse: Set<Redis>;
  waiters: BlockingReaderWaiter[];
  isShuttingDown: () => boolean;
  setLastWaiterDepth: (n: number) => void;
  getLastWaiterDepth: () => number;
}

/**
 * Acquire a blocking reader. Idle first; mint only while idle+in-use is
 * below MAX; otherwise wait until a reader is released (or abort/shutdown).
 * Returns null when the request is cancelled or the service is tearing down.
 */
export function acquireBlockingReader(
  refs: BlockingReaderPoolRefs,
  client: Redis,
  logger: Logger,
  signal?: AbortSignal,
): Promise<Redis | null> {
  if (refs.isShuttingDown() || signal?.aborted) {
    return Promise.resolve(null);
  }
  const idle = refs.pool.pop();
  if (idle) {
    refs.inUse.add(idle);
    return Promise.resolve(idle);
  }
  if (refs.inUse.size < BLOCKING_READER_POOL_MAX) {
    const minted = client.duplicate({ maxRetriesPerRequest: null });
    // Log-only error listener so a mid-BLOCK socket error on a fresh
    // duplicate does not surface as an unhandled EventEmitter warning. The
    // minted instance is added to inUse exactly once, after the listener is
    // attached, preserving the idle+in-use ≤ MAX invariant.
    // `maxRetriesPerRequest: null` keeps XREADGROUP BLOCK from being
    // aborted after the primary client's retry ceiling (default 3); a
    // blocking read can legitimately wait beyond that ceiling and must
    // not be torn down by the inherited retry policy.
    minted.on("error", (err) => {
      logger.warn(
        `blocking reader error (mid-XREADGROUP): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    refs.inUse.add(minted);
    return Promise.resolve(minted);
  }
  return new Promise<Redis | null>((resolve) => {
    let settled = false;
    const settle = (reader: Redis | null) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(reader);
    };
    const onAbort = () => {
      const idx = refs.waiters.indexOf(waiter);
      if (idx !== -1) refs.waiters.splice(idx, 1);
      refs.setLastWaiterDepth(refs.waiters.length);
      settle(null);
    };
    const waiter: BlockingReaderWaiter = {
      resolve: (reader) => settle(reader),
      onAbort,
    };
    refs.waiters.push(waiter);
    const depth = refs.waiters.length;
    // Warn once when the queue becomes non-empty (0→N), not on every enqueue.
    if (refs.getLastWaiterDepth() === 0 && depth > 0) {
      logger.warn(
        `blocking reader pool saturated (waiters=${depth}, max=${BLOCKING_READER_POOL_MAX})`,
      );
    }
    refs.setLastWaiterDepth(depth);
    if (signal) {
      /* c8 ignore next 4 */
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Return a reader: hand off to a waiting poller if any; otherwise re-pool
 * (when under max and not shutting down) or close. Never re-pools after
 * teardown starts.
 */
export function releaseBlockingReader(
  refs: BlockingReaderPoolRefs,
  reader: Redis,
): void {
  refs.inUse.delete(reader);
  if (refs.isShuttingDown()) {
    try {
      reader.disconnect();
    } catch {
      // best-effort
    }
    return;
  }
  const waiter = refs.waiters.shift();
  if (waiter) {
    refs.setLastWaiterDepth(refs.waiters.length);
    refs.inUse.add(reader);
    waiter.resolve(reader);
    return;
  }
  if (refs.pool.length < BLOCKING_READER_POOL_MAX) {
    refs.pool.push(reader);
    return;
  }
  try {
    reader.disconnect();
  } catch {
    void reader.quit().catch(() => undefined);
  }
}

/**
 * Remove a reader from in-use and close it. Used when the reader's last
 * XREADGROUP failed (e.g. NOGROUP or socket error) so a broken connection
 * is never re-pooled for the next poll.
 */
export function discardBlockingReader(
  refs: BlockingReaderPoolRefs,
  reader: Redis,
): void {
  refs.inUse.delete(reader);
  try {
    reader.disconnect();
  } catch {
    void reader.quit().catch(() => undefined);
  }
}

function parseStreamReply(
  reply: [string, [string, string[]][]][] | null,
  stream: string,
): StreamEntry[] {
  if (!Array.isArray(reply)) return [];
  const streamPart = reply.find(([s]) => s === stream) ?? reply[0];
  if (!streamPart) return [];
  return parseEntries(streamPart[1]);
}

function parseEntries(
  entries: [string, string[]][] | null | undefined,
): StreamEntry[] {
  if (!Array.isArray(entries)) return [];
  const out: StreamEntry[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    const [id, fields] = entry;
    let data = "";
    if (Array.isArray(fields)) {
      for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] === STREAM_FIELD) {
          data = fields[i + 1];
          break;
        }
      }
    }
    out.push({ id: String(id), data });
  }
  return out;
}

// --- Facade-friendly wrappers --------------------------------------------
// Each function takes a RedisService so the facade can re-export them.

/** Append an entry, return its id. Approximate-trims the stream to bound it. */
export async function xadd(
  redis: RedisService,
  stream: string,
  payload: string,
): Promise<string> {
  const id = await redis
    .getClient()
    .xadd(stream, "MAXLEN", "~", STREAM_MAXLEN, "*", STREAM_FIELD, payload);
  return String(id);
}

/**
 * Read up to `count` new (`>`) entries for this consumer, blocking up to
 * `blockMs`. Cancellable: if `signal` is already aborted the call resolves to
 * `[]` immediately without a blocked read, so ownership loss / shutdown does
 * not leave a read pinning the stream.
 *
 * The await is bounded by a grace window slightly longer than `blockMs` so
 * a disconnected Redis command eventually settles. If the grace window
 * elapses without a reply, the reader is discarded (NOT returned to the
 * idle pool) because its underlying socket is presumed broken.
 */
export async function xreadgroup(
  redis: RedisService,
  group: string,
  consumer: string,
  stream: string,
  count: number,
  blockMs: number,
  signal?: AbortSignal,
): Promise<StreamEntry[]> {
  const refs = redis.getBlockingReaderPoolRefs();
  if (signal?.aborted || refs.isShuttingDown()) return [];
  const reader = await acquireBlockingReader(
    refs,
    redis.getClient(),
    redis.getLogger(),
    signal,
  );
  if (!reader) return [];
  let failed = false;
  // Grace ceiling: enough headroom over `blockMs` for Redis to flush a
  // legitimate slow reply (network round-trip, etc.) but short enough to
  // bound how long a hung socket can pin a pooled reader.
  const graceMs = blockMs + 1000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const graceRejection = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("xreadgroup grace timeout"));
    }, graceMs);
  });
  try {
    const reply = (await Promise.race([
      reader.xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        count,
        "BLOCK",
        blockMs,
        "STREAMS",
        stream,
        ">",
      ),
      graceRejection,
    ])) as [string, [string, string[]][]][] | null;
    return parseStreamReply(reply, stream);
  } catch {
    failed = true;
    discardBlockingReader(refs, reader);
    return [];
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (!failed) releaseBlockingReader(refs, reader);
  }
}

/** Ack processed entries; returns the number actually acknowledged. */
export async function xack(
  redis: RedisService,
  stream: string,
  group: string,
  ...ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  return redis.getClient().xack(stream, group, ...ids);
}

/** Delete entries by id (used after a dead-lettered entry is persisted). */
export async function xdel(
  redis: RedisService,
  stream: string,
  ...ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  return redis.getClient().xdel(stream, ...ids);
}

/** Create the consumer group (MKSTREAM if absent). Idempotent — a BUSYGROUP
 *  error (group already exists) is swallowed. */
export async function xgroupCreate(
  redis: RedisService,
  stream: string,
  group: string,
  opts: { mkStream?: boolean; startId?: string } = {},
): Promise<void> {
  const args: (string | number)[] = [
    "CREATE",
    stream,
    group,
    opts.startId ?? "0",
  ];
  if (opts.mkStream !== false) args.push("MKSTREAM");
  try {
    await (redis.getClient().xgroup as (...a: unknown[]) => Promise<unknown>)(
      ...args,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BUSYGROUP")) throw err;
  }
}

/**
 * Atomically claim idle pending entries from failed consumers and reassign
 * them to `consumer`. Returns the next cursor (loop until it is "0-0") and the
 * entries transferred this call. Used on takeover so entries stranded in a
 * dead owner's PEL are picked up.
 */
export async function xautoclaim(
  redis: RedisService,
  stream: string,
  group: string,
  consumer: string,
  minIdleMs: number,
  startId: string,
  count: number,
): Promise<{ nextCursor: string; claimed: StreamEntry[] }> {
  const reply = (await (
    redis.getClient().xautoclaim as (...a: unknown[]) => Promise<unknown>
  )(stream, group, consumer, minIdleMs, startId, "COUNT", count)) as
    | [string, [string, string[]][], string[]?]
    | null;
  if (!Array.isArray(reply)) return { nextCursor: "0-0", claimed: [] };
  const [nextCursor, entries] = reply;
  return {
    nextCursor: String(nextCursor),
    claimed: parseEntries(entries),
  };
}

/** Group-wide pending summary (diagnostics only — NOT a dead-letter guard). */
export async function xpending(
  redis: RedisService,
  stream: string,
  group: string,
): Promise<XPendingSummary> {
  const reply = (await redis.getClient().xpending(stream, group)) as [
    number,
    string | null,
    string | null,
    [string, string][] | null,
  ];
  const [count, minId, maxId, consumers] = reply;
  return {
    count: Number(count) || 0,
    minId: minId ?? null,
    maxId: maxId ?? null,
    consumers: (consumers ?? []).map(([consumer, c]) => ({
      consumer,
      count: Number(c) || 0,
    })),
  };
}

/** Per-entry pending detail (id, consumer, idle ms, deliveries). */
export async function xpendingDetail(
  redis: RedisService,
  stream: string,
  group: string,
  opts: { start?: string; end?: string; count: number; minIdleMs?: number },
): Promise<XPendingEntry[]> {
  const args: (string | number)[] = [stream, group];
  if (opts.minIdleMs !== undefined) args.push("IDLE", opts.minIdleMs);
  args.push(opts.start ?? "-", opts.end ?? "+", opts.count);
  const reply = (await (
    redis.getClient().xpending as (...a: unknown[]) => Promise<unknown>
  )(...args)) as [string, string, number, number][] | null;
  if (!Array.isArray(reply)) return [];
  return reply.map(([id, consumer, idleMs, deliveries]) => ({
    id: String(id),
    consumer: String(consumer),
    idleMs: Number(idleMs) || 0,
    deliveryCount: Number(deliveries) || 0,
  }));
}

/** Explicitly claim specific pending ids for `consumer`. */
export async function xclaim(
  redis: RedisService,
  stream: string,
  group: string,
  consumer: string,
  minIdleMs: number,
  ...ids: string[]
): Promise<StreamEntry[]> {
  if (ids.length === 0) return [];
  const reply = (await (
    redis.getClient().xclaim as (...a: unknown[]) => Promise<unknown>
  )(stream, group, consumer, minIdleMs, ...ids)) as [string, string[]][] | null;
  return parseEntries(reply);
}

/** Delete a whole stream (match finish cleanup). */
export async function xdelStream(
  redis: RedisService,
  stream: string,
): Promise<void> {
  await redis.getClient().del(stream);
}
