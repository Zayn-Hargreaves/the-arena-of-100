// ============================================================
// Centralized cache TTL constants (in seconds).
// Add new entries here whenever a module needs its own Redis
// cache lifetime — keep them in one place so ops can audit
// cache pressure and TTL regressions in a single diff.
// ============================================================

export const CACHE_TTL = {
  /** Leaderboard endpoint — short-lived; 60s balances freshness vs. DB load. */
  LEADERBOARD: 60,
} as const;
