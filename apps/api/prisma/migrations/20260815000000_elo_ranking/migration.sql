-- AlterTable
ALTER TABLE "users" ADD COLUMN "elo" INTEGER NOT NULL DEFAULT 1200;

-- AlterTable
ALTER TABLE "match_players" ADD COLUMN "eloBefore" INTEGER,
ADD COLUMN "eloAfter" INTEGER,
ADD COLUMN "eloDelta" INTEGER;

-- CreateIndex
-- Keep this migration free of explicit BEGIN/COMMIT wrappers so PostgreSQL accepts concurrent index creation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_elo_idx" ON "users"("elo" DESC);
