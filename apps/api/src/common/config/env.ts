// ============================================================
// Strict env parsing helpers.
// ============================================================

/**
 * Strict positive-integer env read. A malformed value falls back to the
 * provided default rather than silently misconfiguring the caller (e.g.
 * Number.parseInt("abc") -> NaN would turn the throttler into a no-op, and
 * parseInt("100abc") -> 100 would silently accept a typo'd value). The whole
 * trimmed string must be plain digits — suffixes, decimals, signs, and
 * exponent notation all fall back.
 */
export function positiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
