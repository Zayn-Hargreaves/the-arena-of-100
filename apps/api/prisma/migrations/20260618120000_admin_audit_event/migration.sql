-- ============================================================
-- Admin Kill-Switch Append-Only Audit Event (PR 3)
--
-- Extends the EventLog model to support admin-scoped audit rows
-- alongside the (unused) match-scoped rows the table was originally
-- defined for. Drops the `seqNo` column + the `@@unique([matchId,
-- seqNo])` invariant because no production code maintained a
-- per-match sequence counter; ordering is now done by `createdAt`
-- (indexed below). See the schema.prisma comment block for full
-- rationale.
-- ============================================================

-- 1. Drop the old unique constraint that depended on seqNo.
--    No production code creates EventLog rows yet, so the constraint
--    has no real dependents to migrate.
ALTER TABLE "event_logs" DROP CONSTRAINT IF EXISTS "event_logs_matchId_seqNo_key";

-- 2. Drop the seqNo column. It was not maintained by any producer
--    in the codebase; the original event-sourcing plan that needed
--    it was deferred and the column sat unused.
ALTER TABLE "event_logs" DROP COLUMN IF EXISTS "seqNo";

-- 3. Make matchId nullable. The original schema declared it NOT NULL
--    because every row was expected to belong to a match; admin-scoped
--    audit rows (this PR) need roomId-only or adminUserId-only rows.
ALTER TABLE "event_logs" ALTER COLUMN "matchId" DROP NOT NULL;

-- 4. Switch the match FK from onDelete: Restrict (which would block
--    match deletion while audit rows exist) to onDelete: SetNull
--    (preserves the audit row with matchId = null when the match is
--    removed). Admin audit must outlive the entity it references.
ALTER TABLE "event_logs" DROP CONSTRAINT IF EXISTS "event_logs_matchId_fkey";
ALTER TABLE "event_logs"
  ADD CONSTRAINT "event_logs_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL;

-- 5. Add the new admin-audit columns.
ALTER TABLE "event_logs" ADD COLUMN IF NOT EXISTS "roomId"      TEXT;
ALTER TABLE "event_logs" ADD COLUMN IF NOT EXISTS "adminUserId" TEXT;

-- 6. Add the adminUser FK with onDelete: SetNull. The audit row
--    outlives the admin who triggered it; the original cuid remains
--    available in the payload JSON for forensic recovery.
ALTER TABLE "event_logs"
  ADD CONSTRAINT "event_logs_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL;

-- 7. Add the four query indexes. `createdAt` is the second column on
--    every index because the GET /admin/audit-events query always
--    orders by it. Composite order matches the WHERE/ORDER BY shape.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "event_logs_admin_user_id_created_at_idx"
  ON "event_logs" ("adminUserId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "event_logs_room_id_created_at_idx"
  ON "event_logs" ("roomId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "event_logs_event_type_created_at_idx"
  ON "event_logs" ("eventType", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "event_logs_match_id_created_at_idx"
  ON "event_logs" ("matchId", "createdAt");
