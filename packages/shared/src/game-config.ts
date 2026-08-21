// ============================================================
// Game Configuration Constants
// ============================================================
//
// This file is the single source of truth for runtime game
// constants. It is intentionally separate from `index.ts` so
// `schemas.ts` can import from it without creating a circular
// dependency (schemas are exported as part of the index barrel,
// and the index file references GAME_CONFIG for code generation
// and helper functions like `generateRoomCode`).
//
// Any caller that needs MAX_PLAYERS, MAX_ROUNDS, or the
// timing/scoring constants should import GAME_CONFIG from
// `@arena/shared` rather than hardcoding the values — that way
// the validation schemas (SubmitAnswerPayloadSchema, etc.) and
// the runtime guards (game-loop checkMatchEnd) stay in sync.

import type { QuestionCategory } from "./index";

export const GAME_CONFIG = {
  MAX_PLAYERS: 100,
  MIN_PLAYERS_TO_START: 2,
  ROUND_DURATION_MS: 15_000, // 15 seconds per round
  COUNTDOWN_DURATION_MS: 5_000, // 5 seconds countdown
  RESULT_DISPLAY_MS: 3_000, // 3 seconds to show result
  MAX_ROUNDS: 50, // Safety limit
  ROOM_CODE_LENGTH: 6,
  // Scoring: each correct answer grants base + speed bonus
  // total = SCORE_BASE_CORRECT + max(0, (WINDOW - responseTimeMs) / DIVISOR)
  // Max bonus: 50 (when responseTime = 0)
  // Min bonus: 0  (when responseTime >= WINDOW)
  SCORE_BASE_CORRECT: 100,
  SCORE_SPEED_BONUS_WINDOW_MS: 10_000,
  SCORE_SPEED_BONUS_DIVISOR: 200,
  // Topic Ban Voting (Pre-match Crowd Draft)
  TOPIC_VOTING_DURATION_MS: 10_000, // 10 seconds for crowd ban voting
  TOPIC_VOTING_BANNED_COUNT: 2, // Top 2 voted topics get banned
  TOPIC_VOTING_CANDIDATE_POOL: [
    "SCIENCE",
    "HISTORY",
    "GEOGRAPHY",
    "TECHNOLOGY",
    "SPORTS",
    "CULTURE",
    "LOGIC",
  ] as const satisfies readonly QuestionCategory[],
} as const;

export const BOT_GUEST_ID_PREFIX = "bot_";

export const MATCHMAKING_CONFIG = {
  TICK_INTERVAL_MS: 2_000,
  MAX_WAIT_TIME_MS: 60_000,
  MIN_PLAYERS_TO_MATCH: 1,
  TARGET_PLAYERS_PER_MATCH: 100,
  INITIAL_ELO_WINDOW: 150,
  ELO_EXPANSION_STEP: 50,
  ELO_EXPANSION_INTERVAL_MS: 5_000,
  AUTO_FILL_BOTS: true,
  MIN_BOT_ANSWER_DELAY_MS: 2_000,
  MAX_BOT_ANSWER_DELAY_MS: 12_000,
} as const;
