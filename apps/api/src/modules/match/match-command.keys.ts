/** Owner-scoped set of applied transport eventIds (dedup). */
export const appliedSetKey = (matchId: string): string =>
  `match:applied:${matchId}`;
