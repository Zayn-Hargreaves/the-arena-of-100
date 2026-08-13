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
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { CACHE_TTL } from "../../common/config/cache-ttl";
import {
  CARD_VARIANT_STREAK_THRESHOLD,
  nextCardVariant,
  pickCardForVariantUnlock,
  type CardId,
  type CardVariantKey,
  type UnlockableCardVariantKey,
} from "@arena/shared";
import {
  DAILY_LEADERBOARD_DEFAULT_LIMIT,
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

/**
 * Speed-bonus window for the WHOLE session, not a single question.
 *
 * Daily Challenge delivers all five questions in one GET and receives all
 * five answers in one POST, so the server can only authoritatively measure
 * the round trip between them — there is no per-question server timestamp to
 * derive. Scoring therefore rewards total session speed. The window is sized
 * at 5 x 15s so an honest player earns roughly what the previous
 * (client-reported, and thus forgeable) per-question bonus paid out.
 */
export const DAILY_SPEED_BONUS_WINDOW_MS = 75_000;
export const DAILY_SPEED_BONUS_DIVISOR = 100;

/** Bonus applied once, on a fully-correct set, scaled by the new streak. */
export const DAILY_STREAK_BONUS_PER_DAY = 50;
export const DAILY_STREAK_BONUS_CAP = 500;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Payload of the short-lived token that binds GET /today to POST /submit. */
interface DailySessionClaims {
  /** User the set was served to, or `anon` for an unauthenticated fetch. */
  sub: string;
  dateKey: string;
  /** Exact question-set version served, so grading cannot drift from it. */
  dailyQuestionId: string;
  /**
   * Authoritative session start (epoch ms), pinned server-side on the FIRST
   * fetch of the day. `null` when it could not be pinned (anonymous session,
   * or the session store was unavailable) — which means no speed bonus.
   */
  startedAtMs: number | null;
  /** Issued-at, in seconds (JWT convention). Not used for timing. */
  iat: number;
}

/** A question set resolved to a specific immutable version. */
interface ResolvedQuestionSet {
  id: string;
  version: number;
  questions: StoredDailyQuestion[];
}

interface RawLeaderboardRow {
  user_id: string;
  username: string;
  avatar: string;
  score: number | bigint;
  correct_count: number | bigint;
  streak_after: number | bigint;
  completed_at: Date;
  cards_played_this_week: number | bigint;
}

@Injectable()
export class DailyService {
  private readonly logger = new Logger(DailyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly authService: AuthService,
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
    const set = await this.loadQuestionSet(dateKey);

    const alreadyAttempted = userId
      ? (await this.prisma.dailyAttempt.count({
          where: { dateKey, userId },
        })) > 0
      : false;

    return {
      dateKey,
      version: set.version,
      questions: set.questions.map(
        ({ content, options, difficulty, category }) => ({
          content,
          options,
          difficulty,
          category,
        }),
      ),
      // Issued here so the server owns the clock for the whole session. The
      // start is pinned on the first fetch, so re-fetching cannot reset it.
      sessionToken: await this.issueSessionToken(
        userId,
        dateKey,
        set.id,
        now.getTime(),
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

    // The token is the server's own record of when this session started, and
    // which version was served. Everything timing-related is derived from it
    // rather than from anything the client reports.
    const claims = this.verifySessionToken(input.sessionToken);

    if (claims.dateKey !== dateKey) {
      throw new BadRequestException(
        "Session token was issued for a different day",
      );
    }

    // An anonymous fetch followed by an authenticated submit is fine; a token
    // minted for a *different* signed-in user is not.
    if (claims.sub !== "anon" && claims.sub !== userId) {
      throw new BadRequestException(
        "Session token was issued for a different user",
      );
    }

    const set = await this.loadQuestionSetById(dateKey, claims.dailyQuestionId);

    // Measured from the PINNED session start, not the token's `iat`: every
    // GET /daily/today mints a fresh token, so an `iat`-based duration could
    // be reset to ~0 by simply re-fetching just before submitting. A null pin
    // (anonymous session, or Redis unavailable) forfeits the speed bonus
    // instead of falling back to that resettable clock.
    // Clamped for the same reason the match engine clamps: a backwards clock
    // step (NTP correction) must not produce a negative duration.
    // See MatchStateMachine.submitAnswer.
    const elapsedMs =
      claims.startedAtMs != null
        ? Math.max(0, now.getTime() - claims.startedAtMs)
        : null;

    // The DTO pins the array to DAILY_QUESTION_COUNT, but the stored set is
    // the real source of truth for how many answers are expected. If the two
    // ever disagree, indexing below would read `undefined` and throw a
    // TypeError (500). Failing here turns that into an honest 400 instead.
    if (input.answers.length !== set.questions.length) {
      throw new BadRequestException(
        `Expected ${set.questions.length} answers, received ${input.answers.length}`,
      );
    }

    // Grade first: the result payload is identical whether or not the write
    // races, so computing it up-front keeps the transaction body small.
    const results = set.questions.map((question, index) => {
      const submitted = input.answers[index];
      const isCorrect = this.isAnswerCorrect(question, submitted.answer);
      return {
        answer: submitted.answer,
        isCorrect,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        // Echoed back and persisted for statistics; deliberately NOT an input
        // to computeScore — see the scoring constants above.
        responseTimeMs: submitted.responseTimeMs,
      };
    });

    const correctCount = results.filter((r) => r.isCorrect).length;
    const allCorrect = correctCount === set.questions.length;

    const streakBefore = await this.resolveStreakBefore(userId, dateKey);
    const streakAfter = allCorrect ? streakBefore + 1 : 0;
    const score = this.computeScore(
      correctCount,
      elapsedMs,
      allCorrect,
      streakAfter,
    );

    const shouldAttemptUnlock =
      streakAfter > 0 && streakAfter % CARD_VARIANT_STREAK_THRESHOLD === 0;

    // Pre-build the response-shape fields up-front so the two
    // return paths (success + P2002 conflict) share one source of
    // truth for the unchanging fields.
    const responseShape = {
      dateKey,
      version: set.version,
      score,
      correctCount,
      totalQuestions: set.questions.length,
      elapsedMs,
      streakBefore,
      streakAfter,
      results,
    } as const;

    // Phase 3 — dailyAttempt.create + (when eligible) the
    // userCardVariant.upsert that powers the cosmetic unlock run
    // inside ONE `$transaction`. The unlock is best-effort: a
    // transient failure inside the callback is caught and logged so
    // the transaction still commits dailyAttempt.create (the submit
    // must not 5xx because a cosmetic row failed). Recovering the
    // unlock is automatic — the next submit whose `streakAfter`
    // crosses the same threshold re-runs the idempotent upsert
    // (guarded by the (userId, cardId, variantKey) unique constraint)
    // and gets the same row eventually. The unique constraint is
    // the real "durable pending grant": a stuck upsert can be replayed
    // any number of times without duplicating the cosmetic grant.
    let submitOutcome: {
      attempt: { completedAt: Date };
      unlock: { cardId: string; variantKey: UnlockableCardVariantKey } | null;
    };
    try {
      submitOutcome = await this.prisma.$transaction(async (tx) => {
        const attempt = await tx.dailyAttempt.create({
          data: {
            dateKey,
            userId,
            dailyQuestionId: set.id,
            answers: results.map(({ answer, isCorrect, responseTimeMs }) => ({
              answer,
              isCorrect,
              responseTimeMs,
            })) as unknown as Prisma.InputJsonValue,
            score,
            correctCount,
            // Null when the session was never pinned: the duration is
            // unknown, not zero. Storing 0 would record an unmeasured
            // run as the fastest possible one.
            elapsedMs,
            streakBefore,
            streakAfter,
          },
        });

        let unlock: {
          cardId: string;
          variantKey: UnlockableCardVariantKey;
        } | null = null;
        if (shouldAttemptUnlock) {
          try {
            unlock = await this.maybeUnlockCardVariantInTx(
              tx,
              userId,
              streakAfter,
            );
          } catch (unlockErr) {
            // Cosmetic-unlock failure must never bubble out of the
            // submit transaction and roll back the attempt that the
            // submit has already paid for.
            //
            // Durable recovery: write a `pending_card_variant_unlocks`
            // row in the SAME transaction as `dailyAttempt.create`.
            // The next submit — regardless of `shouldAttemptUnlock` —
            // drains the row via `drainPendingCardVariantUnlocksInTx`
            // and attempts the idempotent upsert, so a streak reset
            // does not strand the row and a process restart does not
            // lose it. The `@@unique([userId, dateKey, streakAfter])`
            // constraint on the pending table makes the insert itself
            // idempotent on a retried submit (P2002 is swallowed so a
            // replay cannot surface as a 5xx). The `dateKey` slot keeps
            // each attempt-day's pending row distinct, so a future
            // submit on a different day that re-crosses the same
            // `streakAfter` (after the previous grant was processed)
            // can create a fresh pending row.
            //
            // If the pending-row write ALSO fails (a sustained DB
            // outage), the original best-effort swallow stands: the
            // attempt row commits, the unlock is lost. The error is
            // logged with full context so operators can investigate.
            const message =
              unlockErr instanceof Error
                ? unlockErr.message
                : String(unlockErr);
            this.logger.warn(
              `Card variant unlock inside submit tx failed (streak=${streakAfter}); persisting pending grant intent: ${message}`,
            );
            try {
              await tx.pendingCardVariantUnlock.create({
                data: {
                  userId,
                  dateKey,
                  streakAfter,
                },
              });
            } catch (pendingErr) {
              // `@@unique([userId, dateKey, streakAfter])` P2002 on a
              // replayed submit is a no-op (a pending row already
              // exists for this streak boundary — the drainer will
              // pick it up). Anything else is a real failure: log it
              // and let the attempt row commit anyway. The original
              // cosmetic-unlock row is still lost in this rare path.
              if (
                pendingErr instanceof Prisma.PrismaClientKnownRequestError &&
                pendingErr.code === "P2002"
              ) {
                // expected; silent no-op
              } else {
                const pendingMessage =
                  pendingErr instanceof Error
                    ? pendingErr.message
                    : String(pendingErr);
                this.logger.warn(
                  `Card variant pending-grant write also failed (streak=${streakAfter}); unlock is now lost until the user re-crosses this streak boundary: ${pendingMessage}`,
                );
              }
            }
          }
        }

        // Drain any pending grants for this user regardless of
        // `shouldAttemptUnlock` — a streak reset zeroes
        // `streakAfter`, so a user who tripped the unlock once and
        // then missed a day must still recover the row. The drain
        // runs in the same transaction as `dailyAttempt.create`,
        // so it either commits with the attempt or rolls back with
        // it (the attempt row itself is the durable audit trail).
        // The drain's grant (if any) is surfaced as `unlock` so the
        // response shape's `unlockedVariant` reflects what was
        // granted THIS submit, not only what was triggered by the
        // current streak boundary.
        const drainedUnlock = await this.drainPendingCardVariantUnlocksInTx(
          tx,
          userId,
        );
        if (drainedUnlock && !unlock) {
          unlock = drainedUnlock;
        }

        return { attempt, unlock };
      });
    } catch (error) {
      // P2002 = unique([dateKey, userId]): the day is already spent.
      // The constraint is enforced by Prisma at commit time, so it
      // surfaces here as the transaction's thrown error. Surfacing as
      // 409 (not 500) is what makes the endpoint safe to retry.
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

    // Best-effort: a stale leaderboard is acceptable, a failed submit is not.
    await this.invalidateLeaderboardCache(dateKey);

    return {
      ...responseShape,
      completedAt: submitOutcome.attempt.completedAt.toISOString(),
      ...(submitOutcome.unlock
        ? { unlockedVariant: submitOutcome.unlock }
        : {}),
    };
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
   * Loads and validates the newest active version of a day's question set.
   * The stored JSON is schema-checked on every read: a malformed seed would
   * otherwise surface as an opaque runtime error deep inside grading.
   */
  private async loadQuestionSet(dateKey: string): Promise<ResolvedQuestionSet> {
    const record = await this.prisma.dailyQuestion.findFirst({
      where: { dateKey, active: true },
      orderBy: { version: "desc" },
    });

    if (!record) {
      throw new NotFoundException(
        `No daily challenge available for ${dateKey}`,
      );
    }

    return {
      id: record.id,
      version: record.version,
      questions: this.parseQuestions(dateKey, record.questions),
    };
  }

  /**
   * Loads one specific version by id — used at submit time so an attempt is
   * graded against exactly what the player was served, even if a newer
   * version was published while they were answering.
   *
   * Deliberately does NOT filter on `active`. Deactivating a set is how an
   * operator pulls a broken day out of `GET /daily/today`; applying that to
   * submit as well would 400 everyone already mid-session through no fault of
   * their own. The token pins a specific version, so serving it here cannot
   * leak a set the player was never shown. If a set is bad enough that
   * in-flight sessions must be voided too, that is a separate operation
   * (delete/expire the attempts), not a side effect of the `active` flag.
   */
  private async loadQuestionSetById(
    dateKey: string,
    id: string,
  ): Promise<ResolvedQuestionSet> {
    const record = await this.prisma.dailyQuestion.findUnique({
      where: { id },
    });

    if (!record || record.dateKey !== dateKey) {
      throw new BadRequestException(
        "Session token does not match an available daily challenge",
      );
    }

    return {
      id: record.id,
      version: record.version,
      questions: this.parseQuestions(dateKey, record.questions),
    };
  }

  private parseQuestions(dateKey: string, raw: unknown): StoredDailyQuestion[] {
    const parsed = storedDailyQuestionsSchema.safeParse(raw);
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

  /**
   * Case-insensitive, whitespace-tolerant comparison.
   *
   * Uses `toLowerCase`, not `toLocaleLowerCase`: the latter follows the
   * server's ambient locale, so under a Turkish locale "I" lowercases to "ı"
   * and a correct answer would be graded wrong. Grading must not depend on
   * where the process happens to run.
   */
  private isAnswerCorrect(
    question: StoredDailyQuestion,
    answer: string,
  ): boolean {
    return (
      answer.trim().toLowerCase() ===
      question.correctAnswer.trim().toLowerCase()
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

  /**
   * Score = per-correct-answer base + ONE session speed bonus + streak bonus.
   *
   * `elapsedMs` is measured by the server from the pinned session start; no
   * client-reported duration reaches this function. A client posting
   * `responseTimeMs: 0` on every answer gains nothing, because those values
   * are stored for statistics and never scored.
   *
   * A `null` elapsed means the session could not be pinned (anonymous, or the
   * session store was down). The speed bonus is forfeited in that case — the
   * alternative, trusting an unpinned timestamp, is precisely the hole this
   * design exists to close.
   */
  private computeScore(
    correctCount: number,
    elapsedMs: number | null,
    allCorrect: boolean,
    streakAfter: number,
  ): number {
    const answerScore = correctCount * DAILY_SCORE_BASE_CORRECT;

    // No correct answers means no speed reward — finishing a blank sheet fast
    // should not out-score someone who actually answered.
    const speedBonus =
      correctCount > 0 && elapsedMs !== null
        ? Math.floor(
            Math.max(0, DAILY_SPEED_BONUS_WINDOW_MS - Math.max(0, elapsedMs)) /
              DAILY_SPEED_BONUS_DIVISOR,
          )
        : 0;

    if (!allCorrect) return answerScore + speedBonus;

    const streakBonus = Math.min(
      streakAfter * DAILY_STREAK_BONUS_PER_DAY,
      DAILY_STREAK_BONUS_CAP,
    );
    return answerScore + speedBonus + streakBonus;
  }

  /**
   * Mints the token that binds a delivery to its submit, pinning the session
   * start so a later re-fetch cannot reset the clock.
   *
   * The pin lives in Redis under `daily:session:{userId}:{dateKey}` and is
   * written with SET NX: the first fetch of the day wins and every later fetch
   * reads that same value back. `null` is returned when no pin is possible —
   * anonymous sessions (no stable owner to key on) and Redis outages — and a
   * null start means the speed bonus is forfeited rather than silently
   * falling back to a resettable clock.
   */
  private async issueSessionToken(
    userId: string | undefined,
    dateKey: string,
    dailyQuestionId: string,
    nowMs: number,
  ): Promise<string> {
    return this.authService.signDailySession({
      sub: userId ?? "anon",
      dateKey,
      dailyQuestionId,
      startedAtMs: userId
        ? await this.pinSessionStart(userId, dateKey, nowMs)
        : null,
    });
  }

  /**
   * Returns the pinned start for this user's day, creating it on first call.
   * Fails closed (null) if the session store cannot be reached: a missing pin
   * costs a speed bonus, whereas trusting a fresh timestamp would hand out the
   * maximum bonus to anyone who simply re-fetches before submitting.
   */
  private async pinSessionStart(
    userId: string,
    dateKey: string,
    nowMs: number,
  ): Promise<number | null> {
    const key = this.sessionKey(userId, dateKey);

    try {
      // SET NX is atomic, so two concurrent fetches cannot both claim a start.
      const created = await this.redis.setIfAbsent(
        key,
        String(nowMs),
        this.sessionPinTtlSeconds(nowMs),
      );
      if (created) return nowMs;

      const existing = await this.redis.get(key);
      const parsed = Number(existing);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Logs `dateKey`, not `key`: the Redis key embeds the userId, and an
      // infrastructure warning is not a reason to write player identities into
      // the log stream.
      this.logger.warn(
        `Session pin failed for ${dateKey}; forfeiting speed bonus: ${message}`,
      );
      return null;
    }
  }

  /**
   * Lifetime of the pin: the remainder of the UTC day it belongs to.
   *
   * Deliberately NOT the token's TTL. The pin must outlive every token minted
   * against it, because the attempt it guards is one-per-user-per-UTC-day: an
   * expired pin lets the next fetch claim a FRESH start, which is exactly the
   * clock reset this design exists to prevent — merely delayed by the TTL
   * rather than prevented. Expiring at the day boundary means the pin dies
   * only once the attempt it protects can no longer be made.
   *
   * Floored at 1s because Redis rejects a non-positive EX.
   */
  private sessionPinTtlSeconds(nowMs: number): number {
    const msRemaining = this.nextResetAt(new Date(nowMs)).getTime() - nowMs;
    return Math.max(1, Math.ceil(msRemaining / 1000));
  }

  private sessionKey(userId: string, dateKey: string): string {
    return `daily:session:${userId}:${dateKey}`;
  }

  private verifySessionToken(token: string): DailySessionClaims {
    let claims: DailySessionClaims;

    try {
      claims = this.authService.verifyDailySession(token);
    } catch {
      // Expired or tampered — both mean "start the challenge again", which is
      // a client error, not a server fault.
      throw new BadRequestException("Invalid or expired session token");
    }

    if (
      typeof claims?.dateKey !== "string" ||
      typeof claims?.dailyQuestionId !== "string" ||
      typeof claims?.iat !== "number"
    ) {
      throw new BadRequestException("Malformed session token");
    }

    return claims;
  }

  /**
   * Ranking: score desc, then more correct answers, then earliest completion,
   * then id — fully deterministic so equal datasets always produce equal ranks.
   *
   * Deliberately does NOT tie-break on `elapsedMs`: it is nullable (unpinned
   * sessions have no measured duration), and session speed is already priced
   * into `score` via the speed bonus. Ordering on it would either rank NULLs
   * arbitrarily or count the same speed twice.
   */
  /**
   * Ranking: score desc, then more correct answers, then earliest completion,
   * then id — fully deterministic so equal datasets always produce equal ranks.
   *
   * Deliberately does NOT tie-break on `elapsedMs`: it is nullable (unpinned
   * sessions have no measured duration), and session speed is already priced
   * into `score` via the speed bonus. Ordering on it would either rank NULLs
   * arbitrarily or count the same speed twice.
   *
   * Phase 3 — cross-shows `cardsPlayedThisWeek`: count of CARD_RESOLVED events
   * the user triggered across FINISHED matches in the rolling 7-day window
   * ending at `dateKey`. Aggregated from MatchPlayer.cardsPlayed (persisted
   * at finishMatch). The lateral join keeps one query per leaderboard row
   * — O(N) where N is `limit`, bounded by the SQL planner's index use on
   * `match_players(userId, matchId)`.
   */
  private async computeLeaderboard(
    dateKey: string,
    limit: number,
  ): Promise<DailyLeaderboardItem[]> {
    // The 7-day window is computed against `dateKey` itself, not "today",
    // so the leaderboard for a past date still cross-shows the right window.
    const windowEnd = new Date(`${dateKey}T23:59:59.999Z`);
    const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.$queryRaw<RawLeaderboardRow[]>`
      SELECT a."userId"       AS user_id,
             u."username"     AS username,
             u."avatar"       AS avatar,
             a."score"        AS score,
             a."correctCount" AS correct_count,
             a."streakAfter"  AS streak_after,
             a."completedAt"  AS completed_at,
             COALESCE(cards.agg_cards, 0) AS cards_played_this_week
      FROM "daily_attempts" a
      JOIN "users" u ON u.id = a."userId"
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(mp."cardsPlayed"), 0)::bigint AS agg_cards
        FROM "match_players" mp
        JOIN "matches" m ON m."id" = mp."matchId"
        WHERE mp."userId" = a."userId"
          AND m."status" = 'FINISHED'
          AND m."endedAt" >= ${windowStart}::timestamp
          AND m."endedAt" <= ${windowEnd}::timestamp
      ) cards ON true
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
      cardsPlayedThisWeek: Number(row.cards_played_this_week),
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
      await this.redis.del(
        this.cacheKey(dateKey, DAILY_LEADERBOARD_DEFAULT_LIMIT),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis DEL failed for daily leaderboard ${dateKey}: ${message}`,
      );
    }
  }

  // ---------------------------------------------------------
  // Phase 3 — Card variant cosmetic unlock (streak ≥ 7)
  // ---------------------------------------------------------
  /**
   * Fires when `streakAfter` is a positive multiple of
   * `CARD_VARIANT_STREAK_THRESHOLD` (7). Grants the next variant the
   * user does not yet own, attached to a card chosen by rotation.
   *
   * Best-effort: a failure here is logged and returns `null` — the
   * caller's submit response still succeeds. This mirrors the
   * leaderboard cache invalidation's "stale is acceptable, failed
   * submit is not" stance.
   *
   * Idempotent: the (userId, cardId, variantKey) unique constraint
   * means a replay of the same streak-unlock (e.g. a retried submit
   * that somehow reached this path twice) is a no-op — the `upsert`
   * uses empty update semantics, so an existing row is left as-is.
   *
   * `db` is the Prisma client — the production code passes
   * `this.prisma` for the standalone path and a transaction client
   * (`tx`) for the in-submit-transaction path. Sharing the helper
   * ensures both paths enforce the same idempotency contract.
   */
  private async maybeUnlockCardVariantInTx(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    streakAfter: number,
  ): Promise<{ cardId: string; variantKey: UnlockableCardVariantKey } | null> {
    // Only fire on a positive multiple of the threshold (7, 14, 21, …).
    // `streakAfter === 0` means the streak reset (not all correct), so
    // no unlock should fire even though 0 % 7 === 0.
    if (streakAfter <= 0 || streakAfter % CARD_VARIANT_STREAK_THRESHOLD !== 0) {
      return null;
    }

    // Load every variant the user already owns so we can pick the
    // next one deterministically. `nextCardVariant` is a pure
    // function over the owned set — no RNG, no IO.
    const ownedRows = await db.userCardVariant.findMany({
      where: { userId },
      select: { variantKey: true, cardId: true },
    });
    const ownedVariants = new Set<CardVariantKey>(
      ownedRows.map((r) => r.variantKey as CardVariantKey),
    );

    const nextVariant = nextCardVariant(ownedVariants);
    if (nextVariant === null) {
      // User already owns every variant above DEFAULT — nothing to grant.
      return null;
    }

    // Pick the card to attach the unlock to. `unlockIndex` is the
    // count of non-DEFAULT variants the user owns, so it rotates
    // through the class pool deterministically.
    const unlockIndex = ownedVariants.size;
    // v1: we don't have a persisted class for daily-challenge users
    // (class assignment is match-scoped). Default to ATTACK pool for
    // cosmetic variety — the card chosen has no gameplay impact.
    const cardId = pickCardForVariantUnlock("ATTACK", unlockIndex) as CardId;

    // Idempotent upsert: if the row already exists (replayed unlock),
    // `update` is a no-op. The unique constraint on
    // (userId, cardId, variantKey) is the real guard.
    await db.userCardVariant.upsert({
      where: {
        userId_cardId_variantKey: {
          userId,
          cardId,
          variantKey: nextVariant,
        },
      },
      create: {
        userId,
        cardId,
        variantKey: nextVariant,
      },
      update: {},
    });

    return { cardId, variantKey: nextVariant };
  }

  /**
   * Drain pending card-variant unlocks for a user. Called from
   * `submit` (in the same transaction as `dailyAttempt.create`) so
   * the drain commits-or-rolls-back atomically with the attempt.
   *
   * Why on EVERY submit (not just `shouldAttemptUnlock`):
   *   - A streak reset zeroes `streakAfter`, so a user who tripped
   *     the unlock once and then missed a day would never get a
   *     fresh `shouldAttemptUnlock` path to retry from. Without
   *     this drain, the pending row would sit until manual
   *     intervention.
   *
   * Idempotency:
   *   - The drainer's SELECT filters `processedAt IS NULL`, so a
   *     second drain call on the same transaction (e.g. a retry
   *     due to P2002 on `daily_attempts`) finds nothing to do.
   *   - Each pending row's upsert goes through the same
   *     `maybeUnlockCardVariantInTx` path, which uses
   *     `userCardVariant.upsert` keyed on
   *     `(userId, cardId, variantKey)` — a no-op on replay.
   *   - Marking the pending row `processedAt = now()` is itself
   *     idempotent (a second drain call skips the row).
   *
   * Failures inside the drain are swallowed + logged so a
   * transient DB error on a single pending row does not block the
   * `dailyAttempt.create` for the user. The pending row stays
   * unprocessed and the next submit retries.
   */
  private async drainPendingCardVariantUnlocksInTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ cardId: string; variantKey: UnlockableCardVariantKey } | null> {
    let pending: Awaited<
      ReturnType<typeof tx.pendingCardVariantUnlock.findMany>
    >;
    try {
      pending = await tx.pendingCardVariantUnlock.findMany({
        where: { userId, processedAt: null },
        orderBy: { createdAt: "asc" },
      });
    } catch (drainReadErr) {
      // Read-side drain failure is cosmetic: a transient DB blip
      // here must not roll back the `dailyAttempt.create` that
      // submit is committing. Return null so the surrounding
      // transaction completes normally; the unprocessed rows
      // remain pending for the next submit's drain attempt.
      const message =
        drainReadErr instanceof Error
          ? drainReadErr.message
          : String(drainReadErr);
      this.logger.warn(
        `Pending card-variant unlock drain read failed; row scan will retry on next submit: ${message}`,
      );
      return null;
    }
    if (pending.length === 0) return null;

    // Return the FIRST successfully-drained grant so the response
    // shape's `unlockedVariant` can surface the drain's effect on
    // this submit. If multiple pending rows exist (the user crossed
    // multiple streak boundaries while the unlock path was broken),
    // each one is processed in order — but only the first is
    // surfaced in the response, since `unlockedVariant` is a single
    // value, not an array.
    let firstGrant: {
      cardId: string;
      variantKey: UnlockableCardVariantKey;
    } | null = null;

    for (const row of pending) {
      try {
        const grant = await this.maybeUnlockCardVariantInTx(
          tx,
          userId,
          row.streakAfter,
        );
        await tx.pendingCardVariantUnlock.update({
          where: { id: row.id },
          data: { processedAt: new Date() },
        });
        if (grant && !firstGrant) firstGrant = grant;
      } catch (drainErr) {
        const message =
          drainErr instanceof Error ? drainErr.message : String(drainErr);
        this.logger.warn(
          `Pending card-variant unlock drain failed for pending row id=${row.id} at streak=${row.streakAfter}; will retry on next submit: ${message}`,
        );
        // Leave the row unprocessed so a future submit retries it.
      }
    }
    return firstGrant;
  }
}
