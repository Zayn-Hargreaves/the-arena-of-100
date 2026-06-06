-- ============================================================
-- Add indexes to speed up /rankings/leaderboard aggregations.
-- The endpoint runs window/aggregate CTEs over matches,
-- match_players, and answers. These composite indexes turn
-- the most expensive scans into index lookups.
-- ============================================================

-- Weekly window filter (status = 'FINISHED' AND endedAt >= NOW() - 7d).
-- Keep this migration free of explicit BEGIN/COMMIT wrappers so PostgreSQL
-- accepts concurrent index creation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_status_ended_at_idx"
  ON "matches" ("status", "endedAt");

-- Joins + GROUP BY userId in player_match_agg.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "match_players_match_id_user_id_idx"
  ON "match_players" ("matchId", "userId");

-- answer_agg scans over (matchId, userId) and computes AVG().
CREATE INDEX CONCURRENTLY IF NOT EXISTS "answers_match_id_user_id_idx"
  ON "answers" ("matchId", "userId");
