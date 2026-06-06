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
import type { HistoryItem, HistoryQuery, StatsResponse } from "./dto";

const FINISHED = MatchStatus.FINISHED;

interface ResponseAggRow {
  avg_response_ms: string | number | null;
  accuracy: string | number | null;
  total_correct: string | number | bigint | null;
}

interface SurvivalAggRow {
  survival_rate: string | number | null;
}

function toSafeNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    const clamped = value > max ? max : value < min ? min : value;
    return Number(clamped);
  }
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal (or any object exposing toNumber / valueOf / toString).
  if (typeof value === "object") {
    const v = value as { toNumber?: () => number; valueOf?: () => unknown };
    if (typeof v.toNumber === "function") {
      const n = v.toNumber();
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof v.valueOf === "function") {
      const n = Number(v.valueOf());
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(String(value));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
      const status: HistoryItem["status"] =
        m.winnerId === userId ? "WON" : m.winnerId ? "ELIMINATED" : "ABANDONED";
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
}
