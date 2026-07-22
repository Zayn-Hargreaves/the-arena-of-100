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
/**
 * Canonical terminal marker (B3b) — `match:tombstone:<id>` = `"<reason>:<fence>"`.
 * Written ONLY by the atomic fenced finalize primitive; `acquireMatchLease`
 * rejects (`"TERMINAL"`) whenever it exists. 7d TTL (matches the dead-letter
 * retention). This is the authoritative in-transaction guard; the dead-letter
 * SET below is the ops-facing index.
 */
export const tombstoneKey = (id: string): string => `match:tombstone:${id}`;
/** Ops-facing SET of unrecoverable matchIds (requeue tooling reads it). */
export const DEAD_LETTER_SET = "match:recovery:dead-letter";
/** Tombstone / dead-letter retention (7 days), same as the lobby dead-letter. */
export const TOMBSTONE_TTL_SEC = 604_800;

/** Legal tombstone reasons. Only `dead-letter` is requeue-eligible. */
export type TombstoneReason = "finished" | "dead-letter" | "cleaned";
const TOMBSTONE_REASONS = new Set<TombstoneReason>([
  "finished",
  "dead-letter",
  "cleaned",
]);

/**
 * Canonical `finalizedFence` grammar — ONE definition, shared verbatim by the
 * Lua requeue gate and this TypeScript parser so both accept the exact same
 * strings. ASCII digits only: no sign, whitespace, decimal point, exponent, or
 * leading zeros; numeric value in `[1, Number.MAX_SAFE_INTEGER]` (the stricter
 * of the JS-safe-integer and Redis int64 ranges). Bare `Number()`/`tonumber()`
 * must NOT be used — both accept signs/whitespace/decimals/exponents.
 */
export function isValidFinalizedFence(raw: string): boolean {
  if (!/^[1-9][0-9]*$/.test(raw)) return false;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1;
}

/** Parsed, validated tombstone value, or null when malformed / unknown reason. */
export function parseTombstone(
  value: string,
): { reason: TombstoneReason; fence: number } | null {
  const sep = value.indexOf(":");
  if (sep <= 0 || sep === value.length - 1) return null;
  const reason = value.slice(0, sep);
  const fenceStr = value.slice(sep + 1);
  if (!TOMBSTONE_REASONS.has(reason as TombstoneReason)) return null;
  if (!isValidFinalizedFence(fenceStr)) return null;
  return { reason: reason as TombstoneReason, fence: Number(fenceStr) };
}

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
