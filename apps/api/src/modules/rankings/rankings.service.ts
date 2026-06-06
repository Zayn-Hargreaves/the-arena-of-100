// ============================================================
// Rankings Service - Leaderboard with Redis cache-aside
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  LEADERBOARD_CACHE_TTL_SEC,
  type LeaderboardItem,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from "./dto";

const FINISHED = "FINISHED";

interface RawLeaderboardRow {
  user_id: string;
  username: string;
  avatar: string;
  wins: string | number | bigint;
  matches_played: string | number | bigint;
  total_score: string | number | bigint;
  avg_response_ms: string | number | null;
  accuracy: string | number | null;
}

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // GET /rankings/leaderboard
  // Cache-aside: try Redis first, compute from DB on miss, write-through best-effort.
  async getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardResponse> {
    const key = this.cacheKey(query.period, query.limit);

    const cached = await this.safeGetCache(key);
    if (cached) {
      return { ...cached, cached: true };
    }

    const items = await this.computeLeaderboard(query.period, query.limit);
    const payload: Omit<LeaderboardResponse, "cached"> = {
      period: query.period,
      generatedAt: new Date().toISOString(),
      items,
    };

    await this.safeSetCache(key, payload);
    return { ...payload, cached: false };
  }

  private cacheKey(period: string, limit: number): string {
    return `leaderboard:${period}:limit=${limit}`;
  }

  private async safeGetCache(
    key: string,
  ): Promise<Omit<LeaderboardResponse, "cached"> | null> {
    try {
      return await this.redis.getJSON<Omit<LeaderboardResponse, "cached">>(key);
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
    payload: Omit<LeaderboardResponse, "cached">,
  ): Promise<void> {
    try {
      await this.redis.setJSON(key, payload, LEADERBOARD_CACHE_TTL_SEC);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis SET failed for ${key}: ${message}`);
    }
  }

  // Single raw SQL trip: wins, matchesPlayed, totalScore, avgResponseMs, accuracy
  // Ordered by wins DESC, then totalScore DESC, then avgResponseMs ASC, then id ASC.
  // Ties are broken deterministically so the same dataset always yields the same ranks.
  //
  // Two branches: weekly (endedAt >= NOW() - 7 days) and all (no time filter).
  // The branches are kept as separate $queryRaw calls so the SQL is explicit
  // and trivially inspectable in tests.
  private async computeLeaderboard(
    period: LeaderboardQuery["period"],
    limit: number,
  ): Promise<LeaderboardItem[]> {
    const rows =
      period === "weekly"
        ? await this.prisma.$queryRaw<RawLeaderboardRow[]>`
            WITH window_matches AS (
              SELECT id
              FROM "matches"
              WHERE "status" = ${FINISHED}::text
                AND "endedAt" >= NOW() - INTERVAL '7 days'
            ),
            player_match_agg AS (
              SELECT mp."userId"           AS user_id,
                     COUNT(DISTINCT mp."matchId") AS matches_played,
                     SUM(mp."score")        AS total_score
              FROM "match_players" mp
              JOIN window_matches wm ON wm.id = mp."matchId"
              GROUP BY mp."userId"
            ),
            win_agg AS (
              SELECT m."winnerId" AS user_id,
                     COUNT(*)     AS wins
              FROM "matches" m
              JOIN window_matches wm ON wm.id = m.id
              WHERE m."winnerId" IS NOT NULL
              GROUP BY m."winnerId"
            ),
            answer_agg AS (
              SELECT a."userId" AS user_id,
                     AVG(a."responseTimeMs")::numeric(10,2)                         AS avg_response_ms,
                     AVG(CASE WHEN a."isCorrect" THEN 1.0 ELSE 0.0 END)::numeric(6,4) AS accuracy
              FROM "answers" a
              JOIN window_matches wm ON wm.id = a."matchId"
              GROUP BY a."userId"
            )
            SELECT u.id                                                  AS user_id,
                   u.username                                            AS username,
                   u.avatar                                              AS avatar,
                   COALESCE(w.wins, 0)                                   AS wins,
                   COALESCE(p.matches_played, 0)                         AS matches_played,
                   COALESCE(p.total_score, 0)                            AS total_score,
                   COALESCE(a.avg_response_ms, 0)                        AS avg_response_ms,
                   COALESCE(a.accuracy, 0)                               AS accuracy
            FROM "users" u
            JOIN player_match_agg p ON p.user_id = u.id
            LEFT JOIN win_agg     w ON w.user_id = u.id
            LEFT JOIN answer_agg  a ON a.user_id = u.id
            ORDER BY wins DESC, total_score DESC, avg_response_ms ASC, u.id ASC
            LIMIT ${limit}::int
          `
        : await this.prisma.$queryRaw<RawLeaderboardRow[]>`
            WITH window_matches AS (
              SELECT id
              FROM "matches"
              WHERE "status" = ${FINISHED}::text
            ),
            player_match_agg AS (
              SELECT mp."userId"           AS user_id,
                     COUNT(DISTINCT mp."matchId") AS matches_played,
                     SUM(mp."score")        AS total_score
              FROM "match_players" mp
              JOIN window_matches wm ON wm.id = mp."matchId"
              GROUP BY mp."userId"
            ),
            win_agg AS (
              SELECT m."winnerId" AS user_id,
                     COUNT(*)     AS wins
              FROM "matches" m
              JOIN window_matches wm ON wm.id = m.id
              WHERE m."winnerId" IS NOT NULL
              GROUP BY m."winnerId"
            ),
            answer_agg AS (
              SELECT a."userId" AS user_id,
                     AVG(a."responseTimeMs")::numeric(10,2)                         AS avg_response_ms,
                     AVG(CASE WHEN a."isCorrect" THEN 1.0 ELSE 0.0 END)::numeric(6,4) AS accuracy
              FROM "answers" a
              JOIN window_matches wm ON wm.id = a."matchId"
              GROUP BY a."userId"
            )
            SELECT u.id                                                  AS user_id,
                   u.username                                            AS username,
                   u.avatar                                              AS avatar,
                   COALESCE(w.wins, 0)                                   AS wins,
                   COALESCE(p.matches_played, 0)                         AS matches_played,
                   COALESCE(p.total_score, 0)                            AS total_score,
                   COALESCE(a.avg_response_ms, 0)                        AS avg_response_ms,
                   COALESCE(a.accuracy, 0)                               AS accuracy
            FROM "users" u
            JOIN player_match_agg p ON p.user_id = u.id
            LEFT JOIN win_agg     w ON w.user_id = u.id
            LEFT JOIN answer_agg  a ON a.user_id = u.id
            ORDER BY wins DESC, total_score DESC, avg_response_ms ASC, u.id ASC
            LIMIT ${limit}::int
          `;

    return rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      username: row.username,
      avatar: row.avatar,
      wins: Number(row.wins),
      matchesPlayed: Number(row.matches_played),
      accuracy: Number(row.accuracy),
      avgResponseMs: Number(row.avg_response_ms ?? 0),
      totalScore: Number(row.total_score),
    }));
  }
}
