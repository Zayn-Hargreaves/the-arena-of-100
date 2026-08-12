// ============================================================
// Redis Pub/Sub — subscribe/unsubscribe + reset barrier
// ============================================================
// Pure functions over the handler map + subscriber connection. The facade
// `RedisService` keeps the fields visible to its existing test suite; this
// module owns the coordination logic. The B4 command channel is a durable
// Redis Stream, NOT this pub/sub — fire-and-forget only (safe-to-lose nudges).

import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import type { OpMarker, MessageHandler } from "./redis.internal";

export const RECONCILE_RETRIES = 3;

export interface PubSubStateRefs {
  subscriber: { current: Redis | null };
  handlers: Map<string, MessageHandler[]>;
  channelChains: Map<string, Promise<void>>;
  resetInProgress: { current: Promise<void> | null };
  resetPending: { current: boolean };
  inFlight: Set<OpMarker>;
}

export interface PubSubContext extends PubSubStateRefs {
  client: Redis;
  logger: Logger;
  ensureSubscriber: () => Redis;
  removeHandler: (channel: string, handler: MessageHandler) => boolean;
}

function newMarker(): OpMarker {
  const marker: OpMarker = {};
  marker.detached = new Promise<void>((resolve) => {
    marker.detach = resolve;
  });
  return marker;
}

function runInFlight(
  refs: PubSubStateRefs,
  marker: OpMarker,
  fn: () => Promise<void>,
): Promise<void> {
  refs.inFlight.add(marker);
  return fn().finally(() => {
    refs.inFlight.delete(marker);
  });
}

function chain(
  refs: PubSubStateRefs,
  channel: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = refs.channelChains.get(channel) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tracked = next.then(
    () => undefined,
    () => undefined,
  );
  refs.channelChains.set(channel, tracked);
  // After this chain settles, drop the map entry IF AND ONLY IF it
  // still points at this chain. A newer operation may have replaced
  // `tracked` with its own promise (e.g. another subscribe raced in
  // before we settled); in that case the newer chain is responsible
  // for its own cleanup, and deleting here would lose per-channel
  // ordering. The handlers map + removeHandler flow is the source of
  // truth for channel liveness — the chain map only sequences ops.
  // The cleanup is fire-and-forget: it must not block `chain()`'s
  // caller or surface as an unhandled rejection. The finally callback
  // itself never throws, so swallowing the promise with `void` is the
  // correct way to mark it intentionally unobserved.
  void tracked.finally(() => {
    if (refs.channelChains.get(channel) === tracked) {
      refs.channelChains.delete(channel);
    }
  });
  return next;
}

// Register `handler` for `channel`. Multiple handlers per channel are
// reference-counted; the underlying Redis SUBSCRIBE is issued once. The
// dispatch listener + handler-map entry are live BEFORE the SUBSCRIBE
// confirmation, so a message published immediately after subscribe() resolves
// is not missed.
export async function subscribe(
  ctx: PubSubContext,
  channel: string,
  handler: MessageHandler,
): Promise<void> {
  await awaitResetBarrier(ctx);
  const marker = newMarker();
  const op = chain(ctx, channel, () =>
    runInFlight(ctx, marker, () => doSubscribe(ctx, channel, handler, marker)),
  );
  marker.promise = op;
  return op;
}

// Remove ONLY this specific handler from the channel (reference-counting).
// Other consumers' handlers are preserved; only when the list becomes empty
// is the map entry dropped AND `subscriber.unsubscribe(channel)` issued.
export async function unsubscribe(
  ctx: PubSubContext,
  channel: string,
  handler: MessageHandler,
): Promise<void> {
  await awaitResetBarrier(ctx);
  const marker = newMarker();
  const op = chain(ctx, channel, () =>
    runInFlight(ctx, marker, () =>
      doUnsubscribe(ctx, channel, handler, marker),
    ),
  );
  marker.promise = op;
  return op;
}

async function doSubscribe(
  ctx: PubSubContext,
  channel: string,
  handler: MessageHandler,
  self: OpMarker,
): Promise<void> {
  const sub = ctx.ensureSubscriber();
  const list =
    ctx.handlers.get(channel) ?? ctx.handlers.set(channel, []).get(channel)!;
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
    ctx.removeHandler(channel, handler);
    // The SUBSCRIBE may have been ACCEPTED before the reply was dropped,
    // leaving the connection subscribed with no local dispatch target.
    // Reconcile the channel state before rethrowing the original error.
    await reconcileAfterFailedSubscribe(ctx, channel, self);
    throw err;
  }
}

async function doUnsubscribe(
  ctx: PubSubContext,
  channel: string,
  handler: MessageHandler,
  self: OpMarker,
): Promise<void> {
  const list = ctx.handlers.get(channel);
  if (!list) return;
  const removed = ctx.removeHandler(channel, handler);
  if (!removed || list.length > 0 || !ctx.subscriber.current) {
    // Not the last handler (or unknown handler / no connection): keep the
    // channel's live subscription in place.
    return;
  }
  try {
    await ctx.subscriber.current.unsubscribe(channel);
  } catch (err) {
    // Handlers may have been re-added meanwhile; if so, the still-active
    // Redis subscription is now wanted again — leave it.
    if ((ctx.handlers.get(channel)?.length ?? 0) > 0) {
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
      await resetSubscriber(ctx, self);
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
async function reconcileAfterFailedSubscribe(
  ctx: PubSubContext,
  channel: string,
  self: OpMarker,
): Promise<void> {
  if ((ctx.handlers.get(channel)?.length ?? 0) > 0) return;
  const sub = ctx.subscriber.current;
  if (!sub) return;
  for (let attempt = 0; attempt < RECONCILE_RETRIES; attempt++) {
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
  await resetSubscriber(ctx, self);
}

// Rebuild the subscriber connection and re-subscribe every channel whose
// handler list is non-empty. Runs behind the global barrier so no new
// lifecycle op mutates the handler map mid-rebuild.
function resetSubscriber(ctx: PubSubContext, self?: OpMarker): Promise<void> {
  if (ctx.resetInProgress.current) {
    // A reset is already running and `self` is about to await this barrier.
    // Detach it so the running reset's drain does not wait on an op that is
    // itself blocked on the barrier — the cycle that deadlocks two concurrent
    // cross-channel resets. `self` is quiescent here (handler already rolled
    // back / removed), so its remaining work never mutates the handler map.
    if (self) self.detach?.();
    return ctx.resetInProgress.current;
  }
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const barrier = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Set synchronously BEFORE any await so new ops entering the barrier block.
  ctx.resetInProgress.current = barrier;
  ctx.resetPending.current = false;

  void (async () => {
    try {
      // Handoff: the initiator is quiescent (handler already rolled back, no
      // further map mutation), so exclude it from the drain to avoid a cycle.
      if (self) ctx.inFlight.delete(self);
      // Drain already-admitted ops so no handler-map mutation overlaps the
      // rebuild snapshot. An op that hands off to this barrier resolves its
      // `detached` signal; race against it so the drain stops waiting on an
      // op blocked on the very reset it is draining (cross-channel deadlock),
      // while still fully awaiting ops that are actively mutating the map.
      await Promise.allSettled(
        [...ctx.inFlight].map((m) => {
          const settled = (m.promise ?? Promise.resolve()).catch(
            () => undefined,
          );
          return m.detached ? Promise.race([settled, m.detached]) : settled;
        }),
      );
      try {
        ctx.subscriber.current?.disconnect();
      } catch {
        // best-effort
      }
      ctx.subscriber.current = null;
      const sub = ctx.ensureSubscriber();
      // Rebuild the wanted set from the handler map (the source of truth).
      for (const [ch, list] of ctx.handlers) {
        if (list.length > 0) await sub.subscribe(ch);
      }
      resolve();
    } catch (err) {
      // Do NOT leave the barrier permanently pending: record a retryable
      // failure so the next lifecycle op starts a fresh reset attempt.
      ctx.resetPending.current = true;
      ctx.logger.error(
        `Subscriber reset failed; will retry on next op: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      reject(err);
    } finally {
      ctx.resetInProgress.current = null;
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
async function awaitResetBarrier(ctx: PubSubContext): Promise<void> {
  for (;;) {
    if (ctx.resetInProgress.current) {
      await ctx.resetInProgress.current;
      continue;
    }
    if (ctx.resetPending.current) {
      await resetSubscriber(ctx);
      continue;
    }
    return;
  }
}
