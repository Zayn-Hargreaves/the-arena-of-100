// ============================================================
// C3 — chaos-failover CLI argument validation (PURE).
//
// The chaos orchestrator (scripts/chaos-failover.mjs) parses a wall of CLI
// flags (thresholds, timeouts, multipliers) and must reject misconfiguration
// BEFORE any orchestration work begins — a NaN/0/negative timeout silently
// becomes a useless "within NaNms" abort; a > 1 reconnect rate would only
// surface later as an oracle invalid_artifact instead of failing fast at the
// CLI. This helper holds that single source of truth so the test suite can
// assert the validation order without importing the script (which
// unconditionally imports ioredis and connects to Redis at module load —
// not testable in unit-test isolation).
//
// `rows` is an array of [name, val, required, integer, max]:
//   * name     — flag string, e.g. "--reconnect-min" (used in error messages)
//   * val      — the already-Number()-coerced value (NaN if invalid CLI arg)
//   * required — when true, missing/NaN emits a "required and must be ..."
//                message; when false, just "must be ..."
//   * integer  — when true, requires `Number.isInteger(val)`
//   * max      — inclusive upper bound; `Infinity` means "no upper bound"
//
// The check order is deliberate and stable: positive → integer → max. A
// negative reconnect-min should report the positive-number error first
// (more fundamental invariant), not the upper-bound error. Tests below
// assert this ordering explicitly.
//
// Returns an array of failure strings (empty = pass). The script calls
// `fatal()` on the first entry; tests assert the full list to lock the
// check-order contract.
// ============================================================

export function validateCliThresholds(rows) {
  const reasons = [];
  for (const [name, val, required, integer, max] of rows) {
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
      reasons.push(
        required
          ? `${name} is required and must be a finite positive number (got ${val})`
          : `${name} must be a finite positive number (got ${val})`,
      );
    }
    if (integer && !Number.isInteger(val)) {
      reasons.push(`${name} must be a positive integer (got ${val})`);
    }
    if (val > max) {
      reasons.push(`${name} must be <= ${max} (got ${val})`);
    }
  }
  return reasons;
}
