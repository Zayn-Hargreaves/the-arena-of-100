// ============================================================
// Redis Lease — Lua-script primitives (pure functions)
// ============================================================
// Distributed lease + fenced-state + failover recovery primitives.
// Implemented as pure functions over a RedisService so the facade
// `RedisService` can re-export them without circular DI dependency.

import { expectLuaOutcomes } from "./redis.internal";
import type { RedisService } from "./redis.service";

export interface RequeueDeadLetterKeys {
  tombstoneKey: string;
  stateKey: string;
  ownerKey: string;
  fenceKey: string;
  indexKey: string;
  deadLetterSet: string;
}

// Intention-revealing alias over SET NX EX so lease call sites read clearly.
// Returns true iff the lease key was created (i.e. not already held).
export async function acquireLease(
  redis: RedisService,
  key: string,
  value: string,
  ttlSec: number,
): Promise<boolean> {
  return redis.setIfAbsent(key, value, ttlSec);
}

// Atomic CAS renew: extend the lease TTL only if the stored value still
// equals `expected`. A node that lost the lease (value changed, or it
// expired then was taken) gets false and does NOT extend anyone's TTL.
export async function renewLease(
  redis: RedisService,
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
  const result = await redis.eval(
    script,
    [key],
    [expected, String(ttlSec * 1000)],
  );
  return result === 1;
}

// Atomic CAS delete: remove the lease only if the stored value still equals
// `expected`, so we never delete a lease another node has already taken.
export async function releaseLease(
  redis: RedisService,
  key: string,
  expected: string,
): Promise<boolean> {
  const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end`;
  const result = await redis.eval(script, [key], [expected]);
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
export async function acquireLeaseWithFence(
  redis: RedisService,
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
  const result = await redis.eval(
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
export async function releaseLeaseAndIndex(
  redis: RedisService,
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
  const result = await redis.eval(
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
export async function fencedStateSet(
  redis: RedisService,
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
  const result = await redis.eval(
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
  return expectLuaOutcomes(
    result,
    ["APPLIED", "RETRY"],
    `fencedStateSet: unexpected Lua reply for ${stateKey} (state may be inconsistent)`,
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
export async function fencedStateDelete(
  redis: RedisService,
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
  const result = await redis.eval(
    script,
    [ownerKey, fenceKey, stateKey, revisionKey],
    [opts.leaseValue, String(opts.expectedFence)],
  );
  return result === 1;
}

// ============================================================
// B3b — failover recovery primitives
// ============================================================

// Match-aware atomic lease-and-fence acquisition. Extends B0's
// acquireLeaseWithFence with a THIRD key: the canonical terminal marker
// `match:tombstone:<id>`, checked FIRST inside the same transaction so a
// finalized match can never be observed as acquirable between a separate read
// and the acquire. Three-way outcome — the two nil-ish cases mean OPPOSITE
// things to a caller and must never be collapsed:
//   - { fence, leaseValue } : acquired (fence advanced, lease claimed);
//   - null                  : a LIVE owner holds the lease (retryable — the
//                             next sweep re-checks after the TTL lapses);
//   - "TERMINAL"            : the match is tombstoned (permanent — stop
//                             retrying; fence untouched).
// Malformed / inconsistent payloads are THROWN (the script may already have
// written the lease), exactly as in B0.
export async function acquireMatchLease(
  redis: RedisService,
  ownerKey: string,
  fenceKey: string,
  tombstoneKey: string,
  nodeId: string,
  ttlSec: number,
): Promise<{ fence: number; leaseValue: string } | null | "TERMINAL"> {
  const script = `
if redis.call('EXISTS', KEYS[3]) == 1 then
  return 'TOMBSTONED'
end
local currentOwner = redis.call('GET', KEYS[1])
if currentOwner == false or currentOwner == nil or currentOwner == "" then
  local newFence = redis.call('INCR', KEYS[2])
  local leaseValue = ARGV[1] .. ":" .. tostring(newFence)
  redis.call('SET', KEYS[1], leaseValue, 'EX', ARGV[2])
  return {tostring(newFence), leaseValue}
else
  return nil
end`;
  const result = await redis.eval(
    script,
    [ownerKey, fenceKey, tombstoneKey],
    [nodeId, String(ttlSec)],
  );

  // Terminal marker hit — distinct from the live-owner nil below.
  if (result === "TOMBSTONED") return "TERMINAL";
  // Live-owner path: Lua returned nil → the fence was NOT advanced.
  if (result === null || result === undefined) return null;

  if (!Array.isArray(result) || result.length < 2) {
    throw new Error(
      `acquireMatchLease: malformed Lua payload for ${ownerKey} ` +
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
      `acquireMatchLease: inconsistent Lua payload for ${ownerKey} ` +
        `(fence=${String(fenceRaw)}, leaseValue=${String(leaseValue)})`,
    );
  }
  return { fence, leaseValue };
}

// Atomic conditional stale-index cleanup. Removes `member` from `indexKey`
// ONLY when `stateKey` is still absent, in one Redis operation, so a fresh
// match state recreated between a separate `EXISTS` read and `SREM` cannot
// lose its active-index entry. Returns:
//   - "REMOVED": state absent → member SREM'd from the index;
//   - "PRESENT": canonical state exists (or was recreated) → index untouched,
//                caller continues normal owner/state recovery.
export async function removeActiveIfStateAbsent(
  redis: RedisService,
  stateKey: string,
  indexKey: string,
  member: string,
): Promise<"REMOVED" | "PRESENT"> {
  const script = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 'PRESENT'
end
redis.call('SREM', KEYS[2], ARGV[1])
return 'REMOVED'`;
  const result = await redis.eval(script, [stateKey, indexKey], [member]);
  return expectLuaOutcomes(
    result,
    ["REMOVED", "PRESENT"],
    `removeActiveIfStateAbsent: unexpected Lua reply for ${member}`,
  );
}

// Atomic conditional index cleanup. Removes `member` from `indexKey` ONLY when
// `valueKey` still reads `observedValue` (or is still missing), in one Redis
// operation, so a publisher that races between the read and the SREM cannot
// lose an updated entry. The Lua script reads the value, compares against the
// observed value, and SREM-only on match — `observedValue === null` encodes
// the "expected absent" case so the caller can use this as an index-cleanup
// primitive against missing-key members without a separate EXISTS round-trip.
// Returns:
//   - "REMOVED": value unchanged (or still absent) → member SREM'd from index.
//   - "CHANGED": value moved during the operation → index untouched, caller
//                keeps the current entry.
export async function removeIndexMemberIfValueUnchanged(
  redis: RedisService,
  valueKey: string,
  indexKey: string,
  member: string,
  observedValue: string | null,
): Promise<"REMOVED" | "CHANGED"> {
  const script = `
local current = redis.call('GET', KEYS[1])
local unchanged = (ARGV[2] == '1' and current == false)
  or (ARGV[2] == '0' and current == ARGV[3])
if not unchanged then
  return 'CHANGED'
end
redis.call('SREM', KEYS[2], ARGV[1])
return 'REMOVED'`;
  const result = await redis.eval(
    script,
    [valueKey, indexKey],
    [member, observedValue === null ? "1" : "0", observedValue ?? ""],
  );
  return expectLuaOutcomes(
    result,
    ["REMOVED", "CHANGED"],
    `removeIndexMemberIfValueUnchanged: unexpected Lua reply for ${member}`,
  );
}

// Atomic conditional removal for the TERMINAL path: SREM `member` from
// `indexKey` ONLY when the tombstone still exists, re-validated in the same
// operation so a match that was concurrently requeued (tombstone deleted, id
// re-added to match:active) is not stripped from the index again. Returns
// "REMOVED" (tombstone present → member SREM'd) or "ABSENT" (no tombstone →
// index untouched).
export async function removeActiveIfTombstoned(
  redis: RedisService,
  tombstoneKey: string,
  indexKey: string,
  member: string,
): Promise<"REMOVED" | "ABSENT"> {
  const script = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'ABSENT'
end
redis.call('SREM', KEYS[2], ARGV[1])
return 'REMOVED'`;
  const result = await redis.eval(script, [tombstoneKey, indexKey], [member]);
  return expectLuaOutcomes(
    result,
    ["REMOVED", "ABSENT"],
    `removeActiveIfTombstoned: unexpected Lua reply for ${member}`,
  );
}

// Atomic fenced finalization. In ONE transaction: validate the caller still
// owns the match (owner == leaseValue AND fence == expectedFence); then write
// the canonical tombstone `"<reason>:<expectedFence>"`, SREM the match from
// `match:active`, and (for the dead-letter reason) SADD it to the ops-facing
// dead-letter set. The tombstone's fence is the finalizing owner's fence, so
// the requeue gate can later validate it. Returns:
//   - "FINALIZED": ownership matched; tombstone written, index cleaned.
//   - "STALE":     owner/fence moved on (a newer lease took over) → NO-OP, so
//                  a superseded owner can never tombstone a match a new owner
//                  now drives. Caller must preserve match:active for the new owner.
export async function finalizeMatchTombstone(
  redis: RedisService,
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
  const script = `
local currentOwner = redis.call('GET', KEYS[1])
if currentOwner == false or currentOwner ~= ARGV[1] then
  return 'STALE'
end
local currentFence = redis.call('GET', KEYS[2])
if currentFence == false or currentFence ~= ARGV[2] then
  return 'STALE'
end
redis.call('SET', KEYS[3], ARGV[3] .. ':' .. ARGV[2], 'EX', ARGV[4])
redis.call('SREM', KEYS[4], ARGV[5])
if ARGV[3] == 'dead-letter' then
  redis.call('SADD', KEYS[5], ARGV[5])
end
return 'FINALIZED'`;
  const result = await redis.eval(
    script,
    [ownerKey, fenceKey, tombstoneKey, indexKey, deadLetterSet],
    [
      opts.leaseValue,
      String(opts.expectedFence),
      opts.reason,
      String(opts.ttlSec),
      member,
    ],
  );
  return expectLuaOutcomes(
    result,
    ["FINALIZED", "STALE"],
    `finalizeMatchTombstone: unexpected Lua reply for ${member} (state may be inconsistent)`,
  );
}

// Requeue a dead-lettered match — a manual/ops action, structured as
// "validate everything first, mutate last". Three read-only gates run IN
// ORDER before any key is touched, so every rejection leaves ALL keys
// unchanged (tombstone byte-identical, match:active/dead-letter set members
// unchanged, owner key + fence counter untouched — even in forced mode):
//   1. Reason gate:  tombstone missing → "NOT_TERMINAL"; malformed value or
//                    unknown reason → "INVALID_TOMBSTONE"; reason finished /
//                    cleaned → "FINALIZED"; only dead-letter proceeds.
//   2. State gate:   match:state absent → "NO_STATE".
//   3. Owner gate:   a live owner lease → "CONFLICT" unless force=1.
// Only after all three pass does the mutation run (still atomic): on a forced
// call with a live lease, DEL owner + INCR fence (fence out the stale owner);
// then DEL tombstone, SADD match:active, SREM dead-letter. Returns "REQUEUED".
// The finalizedFence grammar is validated in-Lua identically to
// isValidFinalizedFence (see match-ownership.store.ts).
export async function requeueDeadLetter(
  redis: RedisService,
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
  const {
    tombstoneKey,
    stateKey,
    ownerKey,
    fenceKey,
    indexKey,
    deadLetterSet,
  } = keys;
  const script = `
-- Gate 1: reason
local tomb = redis.call('GET', KEYS[1])
if tomb == false then return 'NOT_TERMINAL' end
local sep = string.find(tomb, ':', 1, true)
if sep == nil or sep == 1 or sep == string.len(tomb) then
  return 'INVALID_TOMBSTONE'
end
local reason = string.sub(tomb, 1, sep - 1)
local fenceStr = string.sub(tomb, sep + 1)
if string.match(fenceStr, '^[1-9][0-9]*$') == nil then
  return 'INVALID_TOMBSTONE'
end
-- Range guard [1, 9007199254740991]. No leading zeros (grammar above), so
-- same-length digit strings compare lexicographically == numerically.
local flen = string.len(fenceStr)
if flen > 16 or (flen == 16 and fenceStr > '9007199254740991') then
  return 'INVALID_TOMBSTONE'
end
if reason ~= 'finished' and reason ~= 'dead-letter' and reason ~= 'cleaned' then
  return 'INVALID_TOMBSTONE'
end
if reason ~= 'dead-letter' then return 'FINALIZED' end
-- Gate 2: state
if redis.call('EXISTS', KEYS[2]) == 0 then return 'NO_STATE' end
-- Gate 3: owner precondition
local owner = redis.call('GET', KEYS[3])
local ownerLive = owner ~= false and owner ~= nil and owner ~= ''
if ownerLive and ARGV[1] ~= '1' then return 'CONFLICT' end
-- Mutation phase (all gates passed)
if ownerLive then
  redis.call('DEL', KEYS[3])
  redis.call('INCR', KEYS[4])
end
redis.call('DEL', KEYS[1])
redis.call('SADD', KEYS[5], ARGV[2])
redis.call('SREM', KEYS[6], ARGV[2])
return 'REQUEUED'`;
  const result = await redis.eval(
    script,
    [tombstoneKey, stateKey, ownerKey, fenceKey, indexKey, deadLetterSet],
    [opts.force ? "1" : "0", member],
  );
  return expectLuaOutcomes(
    result,
    [
      "REQUEUED",
      "NOT_TERMINAL",
      "INVALID_TOMBSTONE",
      "FINALIZED",
      "NO_STATE",
      "CONFLICT",
    ],
    `requeueDeadLetter: unexpected Lua reply for ${member}`,
  );
}
