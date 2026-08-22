import type { UnlockableCardVariantKey } from "@arena/shared";

export type DailyDifficulty = "EASY" | "MEDIUM" | "HARD";

export interface DailyQuestionPublic {
  content: string;
  options: string[];
  difficulty: DailyDifficulty;
  category: string;
}

export interface DailyTodayResponse {
  dateKey: string;
  version: number;
  questions: DailyQuestionPublic[];
  sessionToken: string;
  serverTime: string;
  nextResetAt: string;
  alreadyAttempted: boolean;
}

export interface DailyAnswerInput {
  answer: string;
  responseTimeMs: number;
}

export interface DailySubmitInput {
  sessionToken: string;
  answers: DailyAnswerInput[];
}

export interface DailyAnswerResult {
  answer: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation?: string;
  responseTimeMs: number;
}

export interface DailySubmitResponse {
  dateKey: string;
  version: number;
  score: number;
  correctCount: number;
  totalQuestions: number;
  elapsedMs: number | null;
  streakBefore: number;
  streakAfter: number;
  results: DailyAnswerResult[];
  completedAt: string;
  // `variantKey` is restricted to the unlockable subset (NEON / GOLD) —
  // `DEFAULT` is implicit and never returned by an unlock.
  unlockedVariant?: {
    cardId: string;
    variantKey: UnlockableCardVariantKey;
  };
}

export interface DailyLeaderboardItem {
  rank: number;
  userId: string;
  username: string;
  avatar: string;
  score: number;
  correctCount: number;
  streakAfter: number;
  completedAt: string;
  cardsPlayedThisWeek: number;
}

export interface DailyLeaderboardResponse {
  dateKey: string;
  generatedAt: string;
  cached: boolean;
  items: DailyLeaderboardItem[];
}

export interface DailyLeaderboardQuery {
  dateKey?: string;
  limit?: number;
}
