// ============================================================
// Daily Challenge - Question DTOs
// GET /daily/today response shape.
// ============================================================

import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import {
  DATE_KEY_PATTERN,
  isRealUtcDate,
} from "../../../common/date/calendar-date";

/** Number of questions in every daily set. Fixed by the Phase 1 spec (§5.1). */
export const DAILY_QUESTION_COUNT = 5;

/** `YYYY-MM-DD` in UTC. Used as the natural key for a day's question set. */
export const dateKeySchema = z
  .string()
  .regex(DATE_KEY_PATTERN, "dateKey must be YYYY-MM-DD")
  .refine(isRealUtcDate, "dateKey must be a real calendar date")
  .describe("UTC calendar day of the challenge (YYYY-MM-DD)");

export type DateKey = z.infer<typeof dateKeySchema>;

/**
 * A stored daily question. `correctAnswer` and `explanation` live here but are
 * stripped before the set is handed to a client that has not submitted yet —
 * see `publicQuestionSchema`.
 *
 * The cross-field check matters because grading compares the submitted answer
 * against `correctAnswer`: if that value is not one of the offered options,
 * the question is unanswerable and every player fails it. Rejecting it here
 * stops such a set from being persisted by the seed or read back by the API.
 */
export const storedDailyQuestionFieldsSchema = z.object({
  content: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctAnswer: z.string().min(1),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  category: z.string().min(1),
  explanation: z.string().optional(),
});

export const storedDailyQuestionSchema = storedDailyQuestionFieldsSchema.refine(
  (question) => question.options.includes(question.correctAnswer),
  {
    message: "correctAnswer must be one of the options",
    path: ["correctAnswer"],
  },
);

export type StoredDailyQuestion = z.infer<typeof storedDailyQuestionSchema>;

/** The full stored payload of `DailyQuestion.questions`. */
export const storedDailyQuestionsSchema = z
  .array(storedDailyQuestionSchema)
  .length(DAILY_QUESTION_COUNT);

/**
 * Client-facing question: never carries `correctAnswer`. Derived from the
 * unrefined field schema because `.omit()` is only available on a ZodObject —
 * and the cross-field rule is meaningless here anyway, since the field it
 * validates is exactly the one being dropped.
 */
export const publicQuestionSchema = storedDailyQuestionFieldsSchema.omit({
  correctAnswer: true,
  explanation: true,
});

export type PublicDailyQuestion = z.infer<typeof publicQuestionSchema>;

export const dailyTodayResponseSchema = z.object({
  dateKey: dateKeySchema,
  /** Version of the question set being served (see DailyQuestion). */
  version: z.number().int().positive(),
  questions: z.array(publicQuestionSchema),
  /**
   * Signed, short-lived token binding this delivery to the submit that
   * follows, carrying the exact question-set version served.
   *
   * Session duration is measured from a server-pinned start — written on the
   * FIRST fetch of the day and held in the session store — NOT from the
   * token's own issue time: every fetch mints a new token, so an `iat`-based
   * clock would reset by simply re-fetching before submitting. When no pin
   * exists (anonymous fetch, or the session store was unavailable) the speed
   * bonus is forfeited rather than falling back to that resettable clock.
   * The client never reports its own timing for scoring
   * (server-authoritative; see memory-bank/codingGuidelines.md §1).
   */
  sessionToken: z.string(),
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

  @ApiProperty({ example: 1, description: "Question-set version being served" })
  version!: number;

  @ApiProperty({ type: [PublicDailyQuestionDto] })
  questions!: PublicDailyQuestionDto[];

  @ApiProperty({
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    description:
      "Signed session token. Must be sent back with POST /daily/submit.",
  })
  sessionToken!: string;

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
