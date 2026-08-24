// ============================================================
// Daily Challenge - Shared Types & Zod Schemas
// GET /daily/today contracts shared across API and Web client.
// ============================================================

import { z } from "zod";

export const dailyDifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export type DailyDifficulty = z.infer<typeof dailyDifficultySchema>;

export const publicDailyQuestionSchema = z.object({
  content: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  difficulty: dailyDifficultySchema,
  category: z.string().min(1),
});
export type PublicDailyQuestion = z.infer<typeof publicDailyQuestionSchema>;
export type DailyQuestionPublic = PublicDailyQuestion;

export const dailyTodayResponseSchema = z.object({
  dateKey: z.string(),
  version: z.number().int().positive(),
  questions: z.array(publicDailyQuestionSchema),
  sessionToken: z.string(),
  serverTime: z.string(),
  nextResetAt: z.string(),
  alreadyAttempted: z.boolean(),
  currentStreak: z.number().int().nonnegative().optional(),
});
export type DailyTodayResponse = z.infer<typeof dailyTodayResponseSchema>;
