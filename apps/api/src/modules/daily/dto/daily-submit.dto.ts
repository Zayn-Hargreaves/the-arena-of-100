// ============================================================
// Daily Challenge - Submit DTOs
// POST /daily/submit request + response shape.
// ============================================================

import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { DAILY_QUESTION_COUNT, dateKeySchema } from "./daily-question.dto";

/**
 * Upper bound on a single answer's reported response time. The value is
 * client-reported and only feeds tie-breaks/among-stats, never scoring
 * correctness, but it is still clamped so a hostile client cannot inject an
 * absurd number into aggregate queries.
 */
export const MAX_RESPONSE_TIME_MS = 5 * 60_000; // 5 minutes

export const dailyAnswerInputSchema = z.object({
  /** Selected option text. Empty string = deliberately skipped. */
  answer: z.string().max(500),
  responseTimeMs: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_RESPONSE_TIME_MS)
    .describe("Client-reported answer latency in ms (clamped, stats only)"),
});

export type DailyAnswerInput = z.infer<typeof dailyAnswerInputSchema>;

export const dailySubmitSchema = z.object({
  answers: z
    .array(dailyAnswerInputSchema)
    .length(DAILY_QUESTION_COUNT)
    .describe(`Exactly ${DAILY_QUESTION_COUNT} answers, in question order`),
});

export type DailySubmitInput = z.infer<typeof dailySubmitSchema>;

/** Per-question outcome. Revealed only in the submit response (Wordle-style). */
export const dailyAnswerResultSchema = z.object({
  answer: z.string(),
  isCorrect: z.boolean(),
  correctAnswer: z.string(),
  explanation: z.string().optional(),
  responseTimeMs: z.number().int().nonnegative(),
});

export type DailyAnswerResult = z.infer<typeof dailyAnswerResultSchema>;

export const dailySubmitResponseSchema = z.object({
  dateKey: dateKeySchema,
  score: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  totalQuestions: z.number().int().positive(),
  streakBefore: z.number().int().nonnegative(),
  streakAfter: z.number().int().nonnegative(),
  results: z.array(dailyAnswerResultSchema),
  completedAt: z.string(),
});

export type DailySubmitResponse = z.infer<typeof dailySubmitResponseSchema>;

export class DailyAnswerInputDto implements DailyAnswerInput {
  @ApiProperty({ example: "Mercury", description: "Selected option text" })
  answer!: string;

  @ApiProperty({ example: 4200, description: "Answer latency in ms" })
  responseTimeMs!: number;
}

export class DailySubmitDto implements DailySubmitInput {
  @ApiProperty({
    type: [DailyAnswerInputDto],
    description: `Exactly ${DAILY_QUESTION_COUNT} answers, in question order`,
  })
  answers!: DailyAnswerInputDto[];
}

export class DailyAnswerResultDto implements DailyAnswerResult {
  @ApiProperty({ example: "Mercury" })
  answer!: string;

  @ApiProperty({ example: true })
  isCorrect!: boolean;

  @ApiProperty({ example: "Mercury" })
  correctAnswer!: string;

  @ApiProperty({ required: false, example: "Mercury orbits closest." })
  explanation?: string;

  @ApiProperty({ example: 4200 })
  responseTimeMs!: number;
}

export class DailySubmitResponseDto implements DailySubmitResponse {
  @ApiProperty({ example: "2026-08-09" })
  dateKey!: string;

  @ApiProperty({ example: 850 })
  score!: number;

  @ApiProperty({ example: 4 })
  correctCount!: number;

  @ApiProperty({ example: DAILY_QUESTION_COUNT })
  totalQuestions!: number;

  @ApiProperty({ example: 3, description: "Streak before this attempt" })
  streakBefore!: number;

  @ApiProperty({
    example: 0,
    description: "Streak after this attempt (resets unless all correct)",
  })
  streakAfter!: number;

  @ApiProperty({ type: [DailyAnswerResultDto] })
  results!: DailyAnswerResultDto[];

  @ApiProperty({ example: "2026-08-09T10:15:00.000Z" })
  completedAt!: string;
}
