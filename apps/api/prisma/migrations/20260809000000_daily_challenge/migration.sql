-- ============================================================
-- Daily Challenge (Phase 1)
--
-- Adds the two tables behind the Daily Challenge feature.
--
--   daily_questions — append-only question-set versions.
--     A day is keyed by `dateKey` ("YYYY-MM-DD") but is NOT unique on it:
--     publishing a correction inserts version N+1 rather than rewriting
--     version N. UNIQUE ("dateKey", "version") is what keeps the history
--     linear. `publishedAt` marks a payload as immutable — the seed refuses
--     to mutate a published row and appends instead.
--
--     `questions` holds the 5-question payload as JSONB; its shape is
--     validated in application code (storedDailyQuestionsSchema), including
--     the rule that correctAnswer must be one of options.
--
--   daily_attempts — one graded attempt per player per day.
--     UNIQUE ("dateKey", "userId") enforces the one-attempt-per-day rule;
--     the API relies on the resulting P2002 to answer a duplicate submit
--     with 409 instead of silently recording a second run.
--
--     `dailyQuestionId` pins the exact question-set VERSION the attempt was
--     graded against. Without it, a later edit to the day's questions would
--     leave every stored attempt unauditable — the answers would no longer
--     correspond to anything the player was actually shown.
--
--     `elapsedMs` is the server-measured session duration
--     (GET /daily/today -> POST /daily/submit). It, not any client-reported
--     timing, is what the speed bonus scores; the per-question
--     `responseTimeMs` values inside `answers` are retained for statistics
--     only and never influence the score (server-authoritative, see
--     memory-bank/codingGuidelines.md §1).
--
--     Nullable on purpose: a session that could not be pinned (anonymous
--     fetch, or the session store being unavailable) has no measurable
--     duration. Storing NULL keeps that distinct from a genuine 0, which
--     would otherwise read as an instantaneous — and maximally fast — run.
--
-- Foreign keys:
--   userId          -> users(id)             ON DELETE CASCADE
--     A deleted player takes their own attempts with them; the rows carry
--     no value once the user is gone.
--   dailyQuestionId -> daily_questions(id)   ON DELETE RESTRICT
--     Deliberately RESTRICT: a question-set version must not be removable
--     while graded attempts still reference it, because those attempts
--     would become unauditable.
--
-- Indexes:
--   daily_questions (dateKey, active, version) — newest-active lookup for
--     GET /daily/today.
--   daily_attempts  (dateKey, score)           — the per-day leaderboard sort.
--   daily_attempts  (dailyQuestionId)          — FK lookups / version audits.
-- ============================================================

-- CreateTable
CREATE TABLE "daily_questions" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "questions" JSONB NOT NULL,
    "category" "QuestionCategory" NOT NULL DEFAULT 'GENERAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_attempts" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "streakBefore" INTEGER NOT NULL DEFAULT 0,
    "streakAfter" INTEGER NOT NULL DEFAULT 0,
    "elapsedMs" INTEGER,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dailyQuestionId" TEXT NOT NULL,

    CONSTRAINT "daily_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_questions_dateKey_active_version_idx" ON "daily_questions"("dateKey", "active", "version");

-- CreateIndex
CREATE UNIQUE INDEX "daily_questions_dateKey_version_key" ON "daily_questions"("dateKey", "version");

-- CreateIndex
CREATE INDEX "daily_attempts_dateKey_score_idx" ON "daily_attempts"("dateKey", "score");

-- CreateIndex
CREATE INDEX "daily_attempts_dailyQuestionId_idx" ON "daily_attempts"("dailyQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attempts_dateKey_userId_key" ON "daily_attempts"("dateKey", "userId");

-- AddForeignKey
ALTER TABLE "daily_attempts" ADD CONSTRAINT "daily_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attempts" ADD CONSTRAINT "daily_attempts_dailyQuestionId_fkey" FOREIGN KEY ("dailyQuestionId") REFERENCES "daily_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
