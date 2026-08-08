// ============================================================
// Daily Challenge Service - Phase 1
//
// Owns three read/write paths:
//   - getToday       : today's question set, correct answers stripped
//   - submit         : one attempt per user per UTC day, full result returned
//   - getLeaderboard : per-day ranking, Redis cache-aside (60s)
//
// Deliberately self-contained: no @arena/game-core import, so the Phase 1
// blast radius on the match engine stays at zero (spec §5.1).
// ============================================================

import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { CACHE_TTL } from "../../common/config/cache-ttl";
import {
  DAILY_QUESTION_COUNT,
  storedDailyQuestionsSchema,
  type DailyLeaderboardItem,
  type DailyLeaderboardQuery,
  type DailyLeaderboardResponse,
  type DailySubmitInput,
  type DailySubmitResponse,
  type DailyTodayResponse,
  type StoredDailyQuestion,
} from "./dto";

/**
 * Scoring mirrors the in-match formula shape (base + speed bonus) but is
 * defined locally on purpose: importing @arena/game-core would couple the
 * Daily Challenge to the match engine and break the "blast radius = 0"
 * constraint of Phase 1. If the two ever need to stay in lockstep, promote
 * the constants to @arena/shared rather than importing game-core here.
 */
export const DAILY_SCORE_BASE_CORRECT = 100;
export const DAILY_SPEED_BONUS_WINDOW_MS = 15_000;
export const DAILY_SPEED_BONUS_DIVISOR = 100;

/** Bonus applied once, on a fully-correct set, scaled by the new streak. */
export const DAILY_STREAK_BONUS_PER_DAY = 50;
export const DAILY_STREAK_BONUS_CAP = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface RawLeaderboardRow {
  user_id: string;
  username: string;
  avatar: string;
  score: number | bigint;
  correct_count: number | bigint;
  streak_after: number | bigint;
  completed_at: Date;
}

@Injectable()
export class DailyService {
  private readonly logger = new Logger(DailyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------
  // Date helpers — every boundary is UTC so the reset is global.
  // ---------------------------------------------------------

  /** `YYYY-MM-DD` for the UTC day containing `at`. */
  toDateKey(at: Date = new Date()): string {
    return at.toISOString().slice(0, 10);
  }

  /** Start of the next UTC day — when the current set expires. */
  nextResetAt(at: Date = new Date()): Date {
    const startOfToday = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
    );
    return new Date(startOfToday + MS_PER_DAY);
  }

  /** Previous calendar day's key — used to decide streak continuity. */
  private previousDateKey(dateKey: string): string {
    const parsed = Date.parse(`${dateKey}T00:00:00.000Z`);
    return new Date(parsed - MS_PER_DAY).toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------
  // GET /daily/today
  // ---------------------------------------------------------

  async getToday(userId?: string): Promise<DailyTodayResponse> {
    const now = new Date();
    const dateKey = this.toDateKey(now);
    const questions = await this.loadQuestionSet(dateKey);

    const alreadyAttempted = userId
      ? (await this.prisma.dailyAttempt.count({
          where: { dateKey, userId },
        })) > 0
      : false;

    return {
      dateKey,
      questions: questions.map(
        ({ content, options, difficulty, category }) => ({
          content,
          options,
          difficulty,
          category,
        }),
      ),
      serverTime: now.toISOString(),
      nextResetAt: this.nextResetAt(now).toISOString(),
      alreadyAttempted,
    };
  }

  // ---------------------------------------------------------
  // POST /daily/submit
  // ---------------------------------------------------------

  async submit(
    userId: string,
    input: DailySubmitInput,
  ): Promise<DailySubmitResponse> {
    const now = new Date();
    const dateKey = this.toDateKey(now);
    const questions = await this.loadQuestionSet(dateKey);

    // Grade first: the result payload is identical whether or not the write
    // races, so computing it up-front keeps the transaction body small.
    const results = questions.map((question, index) => {
      const submitted = input.answers[index];
      const isCorrect = this.isAnswerCorrect(question, submitted.answer);
      return {
        answer: submitted.answer,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        responseTimeMs: submitted.responseTimeMs,
      };
    });

    const correctCount = results.filter((r) => r.isCorrect).length;
    const allCorrect = correctCount === questions.length;

    const streakBefore = await this.resolveStreakBefore(userId, dateKey);
    const streakAfter = allCorrect ? streakBefore + 1 : 0;
    const score = this.computeScore(results, allCorrect, streakAfter);

    try {
      const attempt = await this.prisma.dailyAttempt.create({
        data: {
          dateKey,
          userId,
          answers: results.map(({ answer, isCorrect, responseTimeMs }) => ({
            answer,
            isCorrect,
            responseTimeMs,
          })) as unknown as Prisma.InputJsonValue,
          score,
          correctCount,
          streakBefore,
          streakAfter,
        },
      });

      // Best-effort: a stale leaderboard is acceptable, a failed submit is not.
      await this.invalidateLeaderboardCache(dateKey);

      return {
        dateKey,
        score,
        correctCount,
        totalQuestions: questions.length,
        streakBefore,
        streakAfter,
        results,
        completedAt: attempt.completedAt.toISOString(),
      };
    } catch (error) {
      // P2002 = unique([dateKey, userId]): the day is already spent. Surfacing
      // this as 409 (not 500) is what makes the endpoint safe to retry.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          `Daily challenge for ${dateKey} has already been submitted`,
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------
  // GET /daily/leaderboard
  // ---------------------------------------------------------

  async getLeaderboard(
    query: DailyLeaderboardQuery,
  ): Promise<DailyLeaderboardResponse> {
    const dateKey = query.dateKey ?? this.toDateKey();
    const key = this.cacheKey(dateKey, query.limit);

    const cached = await this.safeGetCache(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    const items = await this.computeLeaderboard(dateKey, query.limit);
    const payload: Omit<DailyLeaderboardResponse, "cached"> = {
      dateKey,
      generatedAt: new Date().toISOString(),
      items,
    };

    await this.safeSetCache(key, payload);
    return { ...payload, cached: false };
  }

  // ---------------------------------------------------------
  // Internals
  // ---------------------------------------------------------

  /**
   * Loads and validates a day's question set. The stored JSON is schema-checked
   * on every read: a malformed seed would otherwise surface as an opaque
   * runtime error deep inside grading.
   */
  private async loadQuestionSet(
    dateKey: string,
  ): Promise<StoredDailyQuestion[]> {
    const record = await this.prisma.dailyQuestion.findFirst({
      where: { dateKey, active: true },
    });

    if (!record) {
      throw new NotFoundException(
        `No daily challenge available for ${dateKey}`,
      );
    }

    const parsed = storedDailyQuestionsSchema.safeParse(record.questions);
    if (!parsed.success) {
      this.logger.error(
        `Malformed daily question set for ${dateKey}: ${parsed.error.message}`,
      );
      throw new NotFoundException(
        `Daily challenge for ${dateKey} is unavailable`,
      );
    }

    return parsed.data;
  }

  /** Case-insensitive, whitespace-tolerant comparison. */
  private isAnswerCorrect(
    question: StoredDailyQuestion,
    answer: string,
  ): boolean {
    return (
      answer.trim().toLocaleLowerCase() ===
      question.correctAnswer.trim().toLocaleLowerCase()
    );
  }

  /**
   * Streak carries over only from the immediately preceding day: any gap
   * resets it to 0, which is what makes a streak worth defending.
   */
  private async resolveStreakBefore(
    userId: string,
    dateKey: string,
  ): Promise<number> {
    const previous = await this.prisma.dailyAttempt.findUnique({
      where: {
        dateKey_userId: { dateKey: this.previousDateKey(dateKey), userId },
      },
      select: { streakAfter: true },
    });

    return previous?.streakAfter ?? 0;
  }

  private computeScore(
    results: ReadonlyArray<{ isCorrect: boolean; responseTimeMs: number }>,
    allCorrect: boolean,
    streakAfter: number,
  ): number {
    const answerScore = results.reduce((total, result) => {
      if (!result.isCorrect) return total;

      const clamped = Math.max(0, result.responseTimeMs);
      const remaining = Math.max(0, DAILY_SPEED_BONUS_WINDOW_MS - clamped);
      const speedBonus = Math.floor(remaining / DAILY_SPEED_BONUS_DIVISOR);
      return total + DAILY_SCORE_BASE_CORRECT + speedBonus;
    }, 0);

    if (!allCorrect) return answerScore;

    const streakBonus = Math.min(
      streakAfter * DAILY_STREAK_BONUS_PER_DAY,
      DAILY_STREAK_BONUS_CAP,
    );
    return answerScore + streakBonus;
  }

  /**
   * Ranking: score desc, then fewer total ms, then earliest completion, then
   * id — fully deterministic so equal datasets always produce equal ranks.
   */
  private async computeLeaderboard(
    dateKey: string,
    limit: number,
  ): Promise<DailyLeaderboardItem[]> {
    const rows = await this.prisma.$queryRaw<RawLeaderboardRow[]>`
      SELECT a."userId"       AS user_id,
             u."username"     AS username,
             u."avatar"       AS avatar,
             a."score"        AS score,
             a."correctCount" AS correct_count,
             a."streakAfter"  AS streak_after,
             a."completedAt"  AS completed_at
      FROM "daily_attempts" a
      JOIN "users" u ON u.id = a."userId"
      WHERE a."dateKey" = ${dateKey}
      ORDER BY a."score" DESC,
               a."correctCount" DESC,
               a."completedAt" ASC,
               a."id" ASC
      LIMIT ${limit}::int
    `;

    return rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      username: row.username,
      avatar: row.avatar,
      score: Number(row.score),
      correctCount: Number(row.correct_count),
      streakAfter: Number(row.streak_after),
      completedAt: row.completed_at.toISOString(),
    }));
  }

  private cacheKey(dateKey: string, limit: number): string {
    return `daily:leaderboard:${dateKey}:limit=${limit}`;
  }

  private async safeGetCache(
    key: string,
  ): Promise<Omit<DailyLeaderboardResponse, "cached"> | null> {
    try {
      return await this.redis.getJSON<Omit<DailyLeaderboardResponse, "cached">>(
        key,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis GET failed for ${key}, falling back to DB: ${message}`,
      );
      return null;
    }
  }

  private async safeSetCache(
    key: string,
    payload: Omit<DailyLeaderboardResponse, "cached">,
  ): Promise<void> {
    try {
      await this.redis.setJSON(key, payload, CACHE_TTL.DAILY_LEADERBOARD);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis SET failed for ${key}: ${message}`);
    }
  }

  /**
   * The cache key embeds `limit`, so a submit cannot target one exact key.
   * Rather than scanning, the entry is left to expire naturally (60s) and only
   * the common default limit is evicted eagerly — bounded staleness by design.
   */
  private async invalidateLeaderboardCache(dateKey: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(dateKey, 50));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis DEL failed for daily leaderboard ${dateKey}: ${message}`,
      );
    }
  }

  /** Exposed for tests and callers that need the canonical set size. */
  get questionCount(): number {
    return DAILY_QUESTION_COUNT;
  }
}
