-- ============================================================
-- Phase 3 — Daily streak reward: card variant cosmetic unlock
--
-- Adds the `CardVariantKey` enum and the `user_card_variants` table.
--
-- A row is created when a user's daily streak reaches a multiple of 7
-- (spec §2 Decision 19). The variant is cosmetic only — it swaps the
-- card's visual border/glow in the UI; it does NOT change any effect.
--
-- The (userId, cardId, variantKey) unique constraint makes the upsert
-- idempotent: a replayed streak-unlock attempt cannot create a second
-- row for the same triple.
-- ============================================================

CREATE TYPE "CardVariantKey" AS ENUM ('DEFAULT', 'NEON', 'GOLD');

CREATE TABLE "user_card_variants" (
    "id"         TEXT   NOT NULL,
    "userId"     TEXT   NOT NULL,
    "cardId"     TEXT   NOT NULL,
    "variantKey" "CardVariantKey" NOT NULL DEFAULT 'DEFAULT',
    "unlockedAt" TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_card_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_card_variants_userId_cardId_variantKey_key"
    ON "user_card_variants"("userId", "cardId", "variantKey");

CREATE INDEX "user_card_variants_userId_idx"
    ON "user_card_variants"("userId");

ALTER TABLE "user_card_variants"
    ADD CONSTRAINT "user_card_variants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 3 — cards played count on MatchPlayer
ALTER TABLE "match_players"
    ADD COLUMN IF NOT EXISTS "cardsPlayed" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "match_players"
    ADD COLUMN IF NOT EXISTS "classId" TEXT;
