// ============================================================
// Daily Challenge - Question DTOs
// GET /daily/today response shape.
// ============================================================

import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

/** Number of questions in every daily set. Fixed by the Phase 1 spec (§5.1). */
export const DAILY_QUESTION_COUNT = 5;

/** `YYYY-MM-DD` in UTC. Used as the natural key for a day's question set. */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dateKey must be YYYY-MM-DD")
  .describe("UTC calendar day of the challenge (YYYY-MM-DD)");

export type DateKey = z.infer<typeof dateKeySchema>;

/**
 * A stored daily question. `correctAnswer` and `explanation` live here but are
 * stripped before the set is handed to a client that has not submitted yet —
 * see `publicQuestionSchema`.
 */
export const storedDailyQuestionSchema = z.object({
  content: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctAnswer: z.string().min(1),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  category: z.string().min(1),
  explanation: z.string().optional(),
});

export type StoredDailyQuestion = z.infer<typeof storedDailyQuestionSchema>;

/** The full stored payload of `DailyQuestion.questions`. */
export const storedDailyQuestionsSchema = z
  .array(storedDailyQuestionSchema)
  .length(DAILY_QUESTION_COUNT);

/** Client-facing question: never carries `correctAnswer`. */
export const publicQuestionSchema = storedDailyQuestionSchema.omit({
  correctAnswer: true,
  explanation: true,
});

export type PublicDailyQuestion = z.infer<typeof publicQuestionSchema>;

export const dailyTodayResponseSchema = z.object({
  dateKey: dateKeySchema,
  questions: z.array(publicQuestionSchema),
  /** Server clock at response time — lets the client render a reset countdown. */
  serverTime: z.string(),
  /** Start of the next UTC day; the moment a new set becomes available. */
  nextResetAt: z.string(),
  /** True when the authenticated caller already submitted for `dateKey`. */
  alreadyAttempted: z.boolean(),
});

export type DailyTodayResponse = z.infer<typeof dailyTodayResponseSchema>;

export class PublicDailyQuestionDto implements PublicDailyQuestion {
  @ApiProperty({ example: "Which planet is closest to the Sun?" })
  content!: string;

  @ApiProperty({ example: ["Mercury", "Venus", "Earth", "Mars"] })
  options!: string[];

  @ApiProperty({ enum: ["EASY", "MEDIUM", "HARD"], example: "EASY" })
  difficulty!: "EASY" | "MEDIUM" | "HARD";

  @ApiProperty({ example: "SCIENCE" })
  category!: string;
}

export class DailyTodayResponseDto implements DailyTodayResponse {
  @ApiProperty({ example: "2026-08-09" })
  dateKey!: string;

  @ApiProperty({ type: [PublicDailyQuestionDto] })
  questions!: PublicDailyQuestionDto[];

  @ApiProperty({ example: "2026-08-09T10:15:00.000Z" })
  serverTime!: string;

  @ApiProperty({ example: "2026-08-10T00:00:00.000Z" })
  nextResetAt!: string;

  @ApiProperty({
    example: false,
    description: "true when the caller already submitted today",
  })
  alreadyAttempted!: boolean;
}
