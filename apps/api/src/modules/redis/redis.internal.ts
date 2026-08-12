// ============================================================
// Redis internal — shared types and helpers (NOT public API)
// ============================================================
// Internal helpers shared across the redis sub-services. Anything
// exported here is NOT part of the public RedisService surface —
// do not import from outside `modules/redis/`.

/** Pub/sub message handler signature. */
export type MessageHandler = (msg: string) => void;

/**
 * A lifecycle op (subscribe/unsubscribe) registers a marker on entry so the
 * reset "writer" can drain already-admitted ops before rebuilding the
 * subscriber connection. The initiator of a reset is excluded from its own
 * drain set (handoff) to avoid a self-deadlock.
 */
export interface OpMarker {
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

/**
 * Validate Lua reply is a contract-conformant string outcome. Replaces the
 * 8 inline `if (result === X) ... if (result === Y) ... throw` blocks across
 * the lease primitives with a single typed assertion.
 *
 * Throws on contract violation (wrong script cached, Redis returned an error
 * object, partial write) — never silently collapses to a default outcome,
 * which would mask corruption and let the caller proceed as if the write
 * were merely contended.
 *
 * Callers MUST pass `as const` on the literal-string array so `T` is locked
 * to the literal union (e.g. `"APPLIED" | "RETRY"`), not widened to `string`.
 */
export function expectLuaOutcomes<T extends string>(
  result: unknown,
  valid: readonly T[],
  context: string,
): T {
  if ((valid as readonly unknown[]).includes(result)) {
    return result as T;
  }
  throw new Error(
    `${context}: unexpected Lua reply ${JSON.stringify(result)} ` +
      `(expected one of: ${valid.join(", ")})`,
  );
}
