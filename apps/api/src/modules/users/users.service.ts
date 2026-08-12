// ============================================================
// Users Service - Profile stats, history, avatar
// ============================================================

import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MatchStatus, type AvatarSeed } from "@arena/shared";
import type {
  HistoryItem,
  HistoryQuery,
  StatsResponse,
  Phase3Stats,
  Phase3StatsResponse,
} from "./dto";

const FINISHED = MatchStatus.FINISHED;

type NullableNumeric = string | number | null;
type NullableBigNumeric = string | number | bigint | null;

interface ResponseAggRow {
  avg_response_ms: NullableNumeric;
  accuracy: NullableNumeric;
  total_correct: NullableBigNumeric;
}

interface SurvivalAggRow {
  survival_rate: NullableNumeric;
}

function parseBigIntToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < min) return Number.MIN_SAFE_INTEGER;
  /* c8 ignore next */
  return Number(value);
}

function parseObjectToSafeNumber(value: object): number {
  const v = value as {
    toNumber?: () => number;
    valueOf?: () => unknown;
    toString?: () => string;
  };
  if (typeof v.toNumber === "function") {
    const n = v.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "valueOf") &&
    typeof v.valueOf === "function"
  ) {
    const n = Number(v.valueOf());
    return Number.isFinite(n) ? n : 0;
  }
  if (
    typeof v.toString === "function" &&
    v.toString !== Object.prototype.toString
  ) {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toSafeNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return parseBigIntToSafeNumber(value);
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object") {
    return parseObjectToSafeNumber(value);
  }
  return 0;
}

function getHistoryItemStatus(
  winnerId: string | null,
  userId: string,
): HistoryItem["status"] {
  if (winnerId === userId) return "WON";
  if (winnerId != null) return "ELIMINATED";
  return "ABANDONED";
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // GET /users/me/stats
  // Aggregates from MatchPlayer, Match, Answer — only FINISHED matches.
  async getMyStats(userId: string): Promise<StatsResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, avatar: true, role: true },
    });
    if (!user) {
      throw new NotFoundException("USER_NOT_FOUND");
    }

    // matchesPlayed + totalScore via groupBy on MatchPlayer
    const playerAgg = await this.prisma.matchPlayer.groupBy({
      by: ["matchId"],
      where: { userId, match: { status: FINISHED } },
      _sum: { score: true },
    });
    const matchesPlayed = playerAgg.length;
    const totalScore = playerAgg.reduce(
      (sum, row) => sum + (row._sum.score ?? 0),
      0,
    );

    // wins via Match.winnerId
    const wins = await this.prisma.match.count({
      where: { winnerId: userId, status: FINISHED },
    });

    // avgResponseMs + accuracy + totalCorrect via raw SQL
    const responseAgg = await this.prisma.$queryRaw<ResponseAggRow[]>`
      SELECT
        AVG("responseTimeMs")::numeric(10, 2) AS avg_response_ms,
        AVG(CASE WHEN "isCorrect" THEN 1.0 ELSE 0.0 END)::numeric(6, 4) AS accuracy,
        COUNT(*) FILTER (WHERE "isCorrect") AS total_correct
      FROM "answers" a
      JOIN "matches" m ON m."id" = a."matchId"
      WHERE a."userId" = ${userId}::text AND m."status" = ${FINISHED}::text
    `;
    const responseRow = responseAgg[0] ?? {
      avg_response_ms: null,
      accuracy: null,
      total_correct: null,
    };

    // survivalRate: top 50% by score within each match (RANK, ties broken by userId)
    const survivalAgg = await this.prisma.$queryRaw<SurvivalAggRow[]>`
      WITH ranked AS (
        SELECT
          mp."userId" AS user_id,
          RANK() OVER (
            PARTITION BY mp."matchId"
            ORDER BY mp."score" DESC, mp."userId" ASC
          ) AS rank,
          COUNT(*) OVER (PARTITION BY mp."matchId") AS total
        FROM "match_players" mp
        JOIN "matches" m ON m."id" = mp."matchId"
        WHERE m."status" = ${FINISHED}::text
      )
      SELECT
        COUNT(*) FILTER (WHERE rank <= total / 2.0)::numeric
          / NULLIF(COUNT(*), 0) AS survival_rate
      FROM ranked
      WHERE user_id = ${userId}::text
    `;
    const survivalRow = survivalAgg[0] ?? { survival_rate: null };

    return {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
      },
      stats: {
        matchesPlayed,
        wins,
        totalScore,
        avgResponseMs: toSafeNumber(responseRow.avg_response_ms),
        accuracy: toSafeNumber(responseRow.accuracy),
        winRate: matchesPlayed > 0 ? wins / matchesPlayed : 0,
        survivalRate: toSafeNumber(survivalRow.survival_rate),
        totalCorrectAnswers: toSafeNumber(responseRow.total_correct),
      },
    };
  }

  // GET /users/me/history
  // Cursor pagination on MatchPlayer.id, ordered by Match.endedAt desc.
  async getMyHistory(
    userId: string,
    query: HistoryQuery,
  ): Promise<{
    items: HistoryItem[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = query.limit;
    const rows = await this.prisma.matchPlayer.findMany({
      where: { userId, match: { status: FINISHED } },
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: [{ match: { endedAt: "desc" } }, { id: "desc" }],
      include: {
        match: {
          include: {
            room: { select: { category: true } },
            _count: { select: { players: true } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    if (page.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    // Compute rank per (matchId, userId) with a single raw SQL trip
    // using a window function (RANK() OVER PARTITION BY matchId).
    // Stable order: score DESC, userId ASC — matches getMyStats.
    const matchIds = page.map((r) => r.matchId);
    const rankRows = await this.prisma.$queryRaw<
      Array<{ match_id: string; user_id: string; rank: number | bigint }>
    >`
      SELECT
        "matchId" AS match_id,
        "userId"  AS user_id,
        CAST(RANK() OVER (
          PARTITION BY "matchId"
          ORDER BY score DESC, "userId" ASC
        ) AS INTEGER) AS rank
      FROM "match_players"
      WHERE "matchId" IN (${Prisma.join(matchIds)})
    `;
    const rankByMatchAndUser = new Map<string, Map<string, number>>();
    for (const row of rankRows) {
      const inner =
        rankByMatchAndUser.get(row.match_id) ?? new Map<string, number>();
      inner.set(row.user_id, Number(row.rank));
      rankByMatchAndUser.set(row.match_id, inner);
    }

    const items: HistoryItem[] = page.map((row) => {
      const m = row.match;
      const rank = rankByMatchAndUser.get(m.id)?.get(userId);
      if (rank == null) {
        throw new InternalServerErrorException(
          `MATCH_HISTORY_RANK_MISSING:${m.id}:${userId}`,
        );
      }
      const startedAt = m.startedAt;
      const endedAt = m.endedAt;
      const durationSec =
        startedAt && endedAt
          ? Math.max(
              0,
              Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
            )
          : 0;
      const status = getHistoryItemStatus(m.winnerId, userId);
      return {
        matchId: m.id,
        playedAt: (endedAt ?? m.createdAt).toISOString(),
        roomCategory: m.room.category,
        playerCount: m._count.players,
        rank,
        score: row.score,
        status,
        durationSec,
      };
    });

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  // PATCH /users/me/avatar
  async updateMyAvatar(userId: string, avatar: AvatarSeed) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar },
      select: { id: true, username: true, avatar: true, role: true },
    });
  }

  // ============================================================
  // Phase 3 — getPhase3Stats (class winrate, streak, sabotage count)
  // ============================================================

  /**
   * Aggregate Phase 3 profile stats (class winrate, current streak,
   * sabotage count).
   *
   * Executes FOUR database queries:
   *   1. user.findUnique           — existence check (throws NotFoundException if missing)
   *   2. $queryRaw                 — class winrate GROUP BY classId over FINISHED matches
   *   3. dailyAttempt.findFirst    — latest streakAfter (current streak)
   *   4. matchPlayer.aggregate     — SUM(cardsPlayed) across FINISHED matches
   *
   * After the existence check, queries 2-4 run concurrently via
   * Promise.all, so the wall-clock latency is bounded by the slowest
   * query, not the sum. Read-only; no side effects, no event
   * emissions. Counts are bounded by indexed predicates
   * (`userId` + `match.status`) so they stay fast across many
   * matches — well within the latency budget for the profile page.
   */
  async getPhase3Stats(userId: string): Promise<Phase3StatsResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException("USER_NOT_FOUND");
    }

    // ----- Class winrate + current streak + sabotage count (concurrent) -----
    const [winrateRows, latestStreakRow, sabotageRow] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ class_id: string | null; plays: bigint; wins: bigint }>
      >`
        SELECT
          mp."classId"                              AS class_id,
          COUNT(*)::bigint                          AS plays,
          COUNT(*) FILTER (WHERE m."winnerId" = mp."userId")::bigint AS wins
        FROM "match_players" mp
        JOIN "matches" m ON m."id" = mp."matchId"
        WHERE mp."userId" = ${userId}::text
          AND m."status"  = ${FINISHED}::text
          AND mp."classId" IS NOT NULL
        GROUP BY mp."classId"
      `,
      this.prisma.dailyAttempt.findFirst({
        where: { userId },
        orderBy: { completedAt: "desc" },
        select: { streakAfter: true },
      }),
      this.prisma.matchPlayer.aggregate({
        where: { userId, match: { status: FINISHED } },
        _sum: { cardsPlayed: true },
      }),
    ]);

    const classWinrate: Phase3Stats["classWinrate"] = {};
    for (const row of winrateRows) {
      if (row.class_id !== "CONG" && row.class_id !== "THU") continue;
      const plays = Number(row.plays);
      const wins = Number(row.wins);
      classWinrate[row.class_id] = {
        plays,
        wins,
        winRate: plays > 0 ? wins / plays : 0,
      };
    }

    const currentStreak = latestStreakRow?.streakAfter ?? 0;

    // ----- Sabotage count -----
    // SUM(MatchPlayer.cardsPlayed) across the user's FINISHED matches.
    // cardsPlayed is the authoritative counter persisted at finishMatch
    // (derived from CARD_RESOLVED events in the state machine event
    // log), so this aggregate survives event-log eviction.
    const sabotageCount = toSafeNumber(sabotageRow._sum.cardsPlayed ?? 0);

    return {
      stats: {
        classWinrate,
        currentStreak,
        sabotageCount,
      },
    };
  }
}
