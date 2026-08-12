-- ============================================================
-- Phase 3 — MatchPlayer userId-leading index
--
-- Adds an explicit (userId, matchId) index to match_players so the
-- LATERAL aggregate in DailyService.computeLeaderboard and the
-- aggregate in UsersService.getPhase3Stats can both filter by
-- mp."userId" without falling back to the (matchId, userId) UNIQUE
-- index. The existing UNIQUE index is matchId-leading, which is
-- wrong for these access patterns (every query scans by userId first,
-- then joins on matchId).
--
-- The (userId, matchId) index is additive and does NOT change any
-- existing constraint.
-- ============================================================

-- CreateIndex
CREATE INDEX "match_players_user_id_match_id_idx" ON "match_players"("userId", "matchId");