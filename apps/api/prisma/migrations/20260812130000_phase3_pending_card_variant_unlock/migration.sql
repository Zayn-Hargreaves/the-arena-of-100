-- ============================================================
-- Phase 3 — durable pending-grant intent
--
-- Adds the `pending_card_variant_unlocks` table for the
-- cosmetic-unlock failure-recovery path. A row is written in the
-- SAME transaction as `dailyAttempt.create` when the in-transaction
-- `userCardVariant.upsert` fails; the next submit drains the row
-- and marks it processed.
--
-- Why this table exists (vs. relying on `user_card_variants` /
-- (userId, cardId, variantKey) as a "pending grant"):
--   - The unique constraint on `user_card_variants` enforces
--     idempotency of the upsert WHEN IT FIRES, but a failed
--     upsert leaves NO row behind — there is nothing to replay.
--   - The previous in-process retry counter could not survive a
--     process restart, and relied on the user crossing the same
--     streak boundary again. A streak reset zeroes `streakAfter`,
--     so a user who tripped the unlock once and then missed a day
--     would never get the row back.
--
-- The drain runs on EVERY submit, independently of the new
-- submit's `shouldAttemptUnlock`, so a streak reset does not
-- strand the row.
--
-- Idempotency:
--   - `@@unique([userId, dateKey, streakAfter])` makes the INSERT
--     idempotent within a single attempt-day — a retried submit
--     cannot create a duplicate pending row. Including `dateKey`
--     ensures a future submit on a different day that crosses the
--     same `streakAfter` (after the previous grant was processed)
--     can create a fresh pending row.
--   - The drainer is idempotent on the upsert side
--     (the existing `(userId, cardId, variantKey)` unique key
--     on `user_card_variants`).
-- ============================================================

CREATE TABLE "pending_card_variant_unlocks" (
    "id"          TEXT      NOT NULL,
    "userId"      TEXT      NOT NULL,
    "dateKey"     TEXT      NOT NULL,
    "streakAfter" INTEGER   NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "pending_card_variant_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_card_variant_unlocks_userId_dateKey_streakAfter_key"
    ON "pending_card_variant_unlocks"("userId", "dateKey", "streakAfter");

-- Drainer lookup: `WHERE userId = ? AND processedAt IS NULL`. The
-- composite (userId, dateKey, streakAfter) UNIQUE index supports
-- the unique constraint but is keyed on `streakAfter` — the drainer
-- reads every unprocessed row for the user regardless of threshold.
-- A PARTIAL index on (userId) restricted to `processedAt IS NULL`
-- matches the drainer's predicate exactly and keeps a tiny
-- index footprint (most rows will eventually be processed).
--
-- This index is intentionally NOT declared in the Prisma model
-- because Prisma cannot declare partial indexes inline; the
-- accompanying `@@index([userId])` declaration was removed for
-- the same reason — a non-partial index would be redundant with
-- the partial one below.
CREATE INDEX "pending_card_variant_unlocks_userId_unprocessed_idx"
    ON "pending_card_variant_unlocks"("userId")
    WHERE "processedAt" IS NULL;

ALTER TABLE "pending_card_variant_unlocks"
    ADD CONSTRAINT "pending_card_variant_unlocks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;