// ============================================================
// Match ownership store (B2a) — the `match:active` index + key builders
//
// Recovery (B3b) needs to enumerate in-flight matches; today only per-key
// `match:state:<id>` exists with no index. This module owns the small set of
// Redis primitives for the ownership contract (index membership, fence
// counter, owner lease read), mirroring `game-loop.countdown-store.ts`.
//
// The key builders are exported so MatchOwnershipService (B2b) and
// ClusterService import the EXACT same contract strings instead of
// re-deriving them.
// ============================================================

import type { RedisService } from "../redis/redis.service";

/** SET of in-flight matchIds — the recovery index (no TTL). */
export const ACTIVE_SET = "match:active";
/** Monotonic fencing token per match — `INCR match:fence:<id>`. */
export const fenceKey = (id: string): string => `match:fence:${id}`;
/** Current owner lease per match — `match:owner:<id>` = `<nodeId>:<fence>`. */
export const ownerKey = (id: string): string => `match:owner:${id}`;

/** Add a match to the in-flight index. Idempotent (SADD). */
export async function addActiveMatch(
  redis: RedisService,
  matchId: string,
): Promise<void> {
  await redis.sadd(ACTIVE_SET, matchId);
}

/** Remove a match from the in-flight index. Idempotent (SREM). */
export async function removeActiveMatch(
  redis: RedisService,
  matchId: string,
): Promise<void> {
  await redis.srem(ACTIVE_SET, matchId);
}

/** List every in-flight matchId (SMEMBERS). */
export async function listActiveMatchIds(
  redis: RedisService,
): Promise<string[]> {
  return redis.smembers(ACTIVE_SET);
}

/** Advance and return the fence for a match (INCR). */
export async function nextFence(
  redis: RedisService,
  matchId: string,
): Promise<number> {
  return redis.incr(fenceKey(matchId));
}

/** Read the current owner lease value (`<nodeId>:<fence>`), or null. */
export async function readOwner(
  redis: RedisService,
  matchId: string,
): Promise<string | null> {
  return redis.get(ownerKey(matchId));
}
