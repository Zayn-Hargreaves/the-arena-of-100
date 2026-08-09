// ============================================================
// Calendar-date helpers — dependency-free on purpose.
//
// Kept out of the DTO modules so the Prisma seed scripts (run under plain
// `tsx`, without the NestJS decorator/metadata runtime) can import them
// without dragging in @nestjs/swagger.
// ============================================================

/** Matches the `YYYY-MM-DD` shape. Shape only — see `isRealUtcDate`. */
export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a real UTC calendar day, not just a well-shaped string.
 *
 * The pattern alone accepts `2026-02-30` and `2026-13-01`, which `Date.parse`
 * then silently rolls forward (to Mar 2 and Jan 2027 respectively). Round-
 * tripping the parsed date back through UTC getters is what catches that: a
 * rolled-over date no longer matches the components it was built from.
 */
export function isRealUtcDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
