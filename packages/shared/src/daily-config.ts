// ============================================================
// Daily Challenge Configuration Constants
// ============================================================
//
// Single source of truth for the Daily Challenge's fixed shape,
// shared by the API (question-set validation, seeding) and the web
// client (leaderboard denominators, share cards).
//
// Kept in its own file — not in `index.ts` — so the API's Zod DTOs
// can import it without pulling the whole barrel, matching the
// pattern already used by `game-config.ts`.

/**
 * Number of questions in a daily set.
 *
 * The API enforces this exactly (`dailyQuestionSetSchema` uses
 * `.length(DAILY_QUESTION_COUNT)`), so a stored attempt always has
 * this many answers.
 *
 * NOTE: surfaces that receive a per-response count from the server —
 * `DailySubmitResponse.totalQuestions`, `DailyTodayResponse.questions`
 * — must prefer that value over this constant. Use this only where no
 * server-supplied count exists, such as the leaderboard row, whose
 * payload carries `correctCount` without a denominator.
 */
export const DAILY_QUESTION_COUNT = 5;
