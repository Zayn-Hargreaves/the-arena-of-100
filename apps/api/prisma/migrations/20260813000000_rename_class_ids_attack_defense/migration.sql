-- Rename class-id values stored on MatchPlayer.classId to match the
-- refactored ClassId union in @arena/shared: "CONG" -> "ATTACK",
-- "THU" -> "DEFENSE". classId is a nullable free-text String column
-- (not a DB enum), so historical FINISHED matches persisted the raw
-- legacy values. Without this backfill, UsersService.getClassStats
-- filters (classId IN ('ATTACK','DEFENSE')) would silently drop all
-- pre-refactor rows and zero out class winrate.
--
-- DEPLOY SEQUENCE (REQUIRED — enforce via the deploy runbook/CI, NOT
-- this file). These UPDATEs are a one-shot backfill; they cannot stop
-- an old-version pod from writing a fresh 'CONG'/'THU' row AFTER the
-- backfill runs. To guarantee no legacy value is re-introduced:
--   1. Stop matchmaking (no new matches can be created).
--   2. Drain all active matches to completion (every in-flight match
--      finishes and persists its final MatchPlayer.classId).
--   3. Terminate ALL old-version (pre-refactor) API pods so nothing
--      can emit CLASS_ASSIGNED with legacy 'CONG'/'THU' values.
--   4. THEN run this migration.
-- The in-memory/Redis event log (CLASS_ASSIGNED payloads) is ephemeral
-- and gone after a match ends, so only the persisted
-- MatchPlayer.classId column needs backfilling — provided the sequence
-- above holds. Do NOT rely on these SQL comments or the UPDATEs below
-- to prevent legacy writes; that is the deploy pipeline's job.
UPDATE "match_players"
   SET "classId" = 'ATTACK'
 WHERE "classId" = 'CONG';
UPDATE "match_players"
   SET "classId" = 'DEFENSE'
 WHERE "classId" = 'THU';
