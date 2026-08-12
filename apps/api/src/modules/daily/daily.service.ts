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

    try {
      const attempt = await this.prisma.dailyAttempt.create({
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
          // Null when the session was never pinned: the duration is unknown,
          // not zero. Storing 0 would record an unmeasured run as the fastest
          // possible one.
          elapsedMs,
          streakBefore,
          streakAfter,
        },
      });

      // Best-effort: a stale leaderboard is acceptable, a failed submit is not.
      await this.invalidateLeaderboardCache(dateKey);

      // Phase 3 — streak-based card variant unlock (spec §2 Decision 19).
      // Fires when streakAfter is a positive multiple of 7. The unlock is
      // best-effort: a failure here (DB error, already-owned variant) MUST
      // NOT fail the submit — the attempt is already committed.
      const unlockedVariant = await this.maybeUnlockCardVariant(
        userId,
        streakAfter,
      );

      return {
        dateKey,
        version: set.version,
        score,
        correctCount,
        totalQuestions: set.questions.length,
        elapsedMs,
        streakBefore,
        streakAfter,
        results,
        completedAt: attempt.completedAt.toISOString(),
        ...(unlockedVariant ? { unlockedVariant } : {}),
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
   * Best-effort: the attempt is already committed by the time this
   * runs, so any failure (DB error, user already owns every variant)
   * is logged and returns `null` — the submit response still
   * succeeds. This mirrors the leaderboard cache invalidation's
   * "stale is acceptable, failed submit is not" stance.
   *
   * Idempotent: the (userId, cardId, variantKey) unique constraint
   * means a replay of the same streak-unlock (e.g. a retried submit
   * that somehow reached this path twice) is a no-op — the `upsert`
   * uses `createOnly` semantics, so an existing row is left as-is.
   */
  private async maybeUnlockCardVariant(
    userId: string,
    streakAfter: number,
  ): Promise<{ cardId: string; variantKey: CardVariantKey } | null> {
    // Only fire on a positive multiple of the threshold (7, 14, 21, …).
    // `streakAfter === 0` means the streak reset (not all correct), so
    // no unlock should fire even though 0 % 7 === 0.
    if (streakAfter <= 0 || streakAfter % CARD_VARIANT_STREAK_THRESHOLD !== 0) {
      return null;
    }

    let nextVariant: CardVariantKey | null = null;
    try {
      // Load every variant the user already owns so we can pick the
      // next one deterministically. `nextCardVariant` is a pure
      // function over the owned set — no RNG, no IO.
      const ownedRows = await this.prisma.userCardVariant.findMany({
        where: { userId },
        select: { variantKey: true, cardId: true },
      });
      const ownedVariants = new Set<CardVariantKey>(
        ownedRows.map((r) => r.variantKey as CardVariantKey),
      );

      nextVariant = nextCardVariant(ownedVariants);
      if (nextVariant === null) {
        // User already owns every variant above DEFAULT — nothing to grant.
        return null;
      }

      // Pick the card to attach the unlock to. `unlockIndex` is the
      // count of non-DEFAULT variants the user owns, so it rotates
      // through the class pool deterministically.
      const unlockIndex = ownedVariants.size;
      // v1: we don't have a persisted class for daily-challenge users
      // (class assignment is match-scoped). Default to CONG pool for
      // cosmetic variety — the card chosen has no gameplay impact.
      const cardId = pickCardForVariantUnlock("CONG", unlockIndex) as CardId;

      // Idempotent upsert: if the row already exists (replayed unlock),
      // `update` is a no-op. The unique constraint on
      // (userId, cardId, variantKey) is the real guard.
      await this.prisma.userCardVariant.upsert({
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
    } catch (error) {
      // Best-effort: the submit must not fail because a cosmetic
      // unlock failed. Log and move on.
      const message = error instanceof Error ? error.message : String(error);
      // Use a non-identifying internal label instead of userId so the
      // operator log carries no PII. Use the grant code when the
      // unlock path got far enough to compute one; otherwise use the
      // generic `unlock` label. Streak + DB error preserved for
      // diagnostics.
      const grantLabel = nextVariant ?? "unlock";
      this.logger.warn(
        `Card variant unlock failed for grant ${grantLabel} streak ${streakAfter}: ${message}`,
      );
      return null;
    }
  }
}
