"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { DashboardSectionTitle } from "@/components/ui/dashboard-section-title";
import { MessageCard } from "@/components/ui/message-card";
import { Skeleton } from "@/components/ui/skeleton";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import {
  useDailyLeaderboard,
  useDailyToday,
  useSubmitDaily,
} from "@/hooks/use-daily-challenge";
import { useSocketStore } from "@/stores/socket-store";
import { ApiError } from "@/lib/api-client";
import type {
  DailyAnswerInput,
  DailyQuestionPublic,
  DailySubmitResponse,
  DailyTodayResponse,
} from "@/types/daily";
import { DailyQuestionCard } from "@/components/daily/daily-question-card";
import { DailyProgress } from "@/components/daily/daily-progress";
import { DailyResultPanel } from "@/components/daily/daily-result-panel";
import { DailyCountdown } from "@/components/daily/daily-countdown";
import { DailyLeaderboard } from "@/components/daily/daily-leaderboard";
import { DailyNicknameGate } from "@/components/daily/daily-nickname-gate";
import { DailyShareButton } from "@/components/daily/daily-share-button";
import { DailyStreakBadge } from "@/components/daily/daily-streak-badge";
import { DailyStreakRewardsWidget } from "@/components/daily/daily-streak-rewards-widget";
import { CardVariantUnlockModal } from "@/components/daily/card-variant-unlock-modal";

/**
 * Tracks which user action opened the nickname gate. The gate is
 * shared between two flows:
 *   - "play"  — Start button on the intro card; after auth the page
 *               should simply re-render into the quiz.
 *   - "submit" — Submit button at the end of the quiz; after auth the
 *               pending answers must be POSTed.
 * Without this distinction, clicking Start would mistakenly POST an
 * empty answer set (the bug Finding #8 called out).
 */
type NicknameIntent = "play" | "submit" | null;

function freshAnswers(count: number): DailyAnswerInput[] {
  return Array.from({ length: count }, () => ({
    answer: "",
    responseTimeMs: 0,
  }));
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton height="14px" width="60%" />
      <Skeleton height="64px" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton height="44px" />
        <Skeleton height="44px" />
        <Skeleton height="44px" />
        <Skeleton height="44px" />
      </div>
    </div>
  );
}

function statusFromError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof ApiError) {
    return { status: error.status, message: error.message };
  }
  return { status: 0, message: "Unknown error" };
}

export default function DailyPage() {
  const t = useTranslations("daily");
  const accessToken = useSocketStore((state) => state.accessToken);

  const today = useDailyToday();
  const data: DailyTodayResponse | undefined = today.data;

  // Key the leaderboard on the challenge date. The reset timer only
  // resets DAILY_TODAY_KEY, and this query disables focus refetches,
  // so without the dateKey the board would stay pinned to the previous
  // day's cache entry while the question set has already rolled over.
  const leaderboard = useDailyLeaderboard({
    dateKey: data?.dateKey,
    limit: 10,
  });
  const submitMutation = useSubmitDaily();

  const [questionIndex, setQuestionIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<DailyAnswerInput[]>([]);
  const [result, setResult] = React.useState<DailySubmitResponse | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<{
    status: number;
    message: string;
  } | null>(null);
  const [nicknameGateOpen, setNicknameGateOpen] = React.useState(false);
  const [nicknameIntent, setNicknameIntent] =
    React.useState<NicknameIntent>(null);
  // Phase 3 — fires when the submit response carries `unlockedVariant`.
  // Captured into a separate piece of state so the modal can read the
  // snapshot at the moment of unlock (a later state change shouldn't
  // mutate the modal payload).
  const [unlockedAt, setUnlockedAt] =
    React.useState<DailySubmitResponse | null>(null);

  // Per-question start timestamp — `responseTimeMs` is advisory only;
  // scoring derives from the server-side sessionToken clock, not from
  // anything the client reports (server-authoritative).
  const startedAtRef = React.useRef<number | null>(null);

  // The server owns the question count — a day may ship more or fewer
  // than the usual five. Everything below (progress, navigation,
  // submit-enable) derives from this instead of a hardcoded constant.
  const questionCount = data?.questions.length ?? 0;

  const currentQuestion: DailyQuestionPublic | undefined =
    data?.questions[questionIndex];

  // A new day (or a differently-sized set) invalidates every in-flight
  // attempt: the reset timer refetches `today` under the same query key,
  // so without this the previous day's answers, position, and result
  // would bleed into the new challenge.
  React.useEffect(() => {
    if (!data?.dateKey) return;
    setQuestionIndex(0);
    setAnswers(freshAnswers(data.questions.length));
    setResult(null);
    setSubmitError(null);
  }, [data?.dateKey, data?.questions.length]);

  // Returning users (server says they already submitted) should see the
  // already-done notice. Fresh submissions must NOT show it — the result
  // panel renders for them instead.
  const alreadySubmitted = data?.alreadyAttempted ?? false;
  const showAlreadyDone = alreadySubmitted && !result;
  // The length check is load-bearing: `[].every()` is `true`, so without
  // it the Submit button would enable before answers are initialised.
  const allAnswered =
    questionCount > 0 &&
    answers.length === questionCount &&
    answers.every((a) => a.answer.length > 0);

  // Only start the per-question clock once the question card is actually
  // on screen. Counting load + gate time would inflate the first answer's
  // responseTimeMs (and the test enforces this — see page.spec.tsx).
  const quizVisible =
    Boolean(currentQuestion) && !showAlreadyDone && Boolean(accessToken);

  React.useEffect(() => {
    if (!quizVisible) {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = Date.now();
  }, [questionIndex, quizVisible]);

  const handleSelect = (option: string) => {
    if (!data) return;
    const elapsed = startedAtRef.current
      ? Date.now() - startedAtRef.current
      : 0;
    setAnswers((prev) => {
      const next = prev.slice();
      next[questionIndex] = { answer: option, responseTimeMs: elapsed };
      return next;
    });
  };

  const handleNext = () => {
    setQuestionIndex((i) => Math.min(questionCount - 1, i + 1));
  };

  const handleBack = () => {
    setQuestionIndex((i) => Math.max(0, i - 1));
  };

  // Capture the stable mutateAsync reference rather than the entire
  // submitMutation object so this callback doesn't re-create whenever
  // TanStack Query swaps the wrapper out.
  const submitMutationAsync = submitMutation.mutateAsync;

  const doSubmit = React.useCallback(async () => {
    if (!data) return;
    const token = useSocketStore.getState().accessToken;
    if (!token) {
      setNicknameIntent("submit");
      setNicknameGateOpen(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await submitMutationAsync({
        token,
        body: { sessionToken: data.sessionToken, answers },
      });
      setResult(response);
      // Phase 3 — fire the share modal when a cosmetic variant
      // unlocks. Only fires on a fresh streak-threshold crossing —
      // safe to ignore for replays (server is idempotent: a replay
      // returns the same response without unlocking anything new).
      if (response.unlockedVariant) {
        setUnlockedAt(response);
      }
    } catch (e) {
      setSubmitError(statusFromError(e));
    } finally {
      setSubmitting(false);
    }
  }, [data, answers, submitMutationAsync]);

  const handleSubmitRequest = () => {
    void doSubmit();
  };

  const handleStart = () => {
    // Already authenticated? The quiz is already visible — no-op.
    if (accessToken) return;
    setNicknameIntent("play");
    setNicknameGateOpen(true);
  };

  const handleNicknameAuthenticated = React.useCallback(async () => {
    // The gate is already closed by the time we get here (the gate calls
    // onOpenChange(false) before invoking onAuthenticated). The auth
    // result drives the next step based on the intent we captured at
    // open time.
    const intent = nicknameIntent;
    setNicknameIntent(null);
    if (intent === "submit") {
      await doSubmit();
    }
    // For "play" the page re-renders into the quiz naturally once
    // accessToken lands in the store.
  }, [doSubmit, nicknameIntent]);

  return (
    <AppShellLayout>
      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 pb-12 select-none relative z-10">
        {/* Header Hero Card */}
        <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] p-5 sm:p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
          <div className="relative space-y-1">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-candy-pink shrink-0">
                <MiniGlyph variant="target" className="w-5 h-5" />
              </span>
              <h1 className="font-display font-black text-2xl md:text-3xl text-candy-ink tracking-wide uppercase">
                {t("title")}
              </h1>
            </div>
            <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85 sm:pl-[52px]">
              {t("subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 items-center">
            {result ||
            (data?.currentStreak != null && data.currentStreak > 0) ? (
              <DailyStreakBadge
                streak={
                  result ? result.streakAfter : (data?.currentStreak ?? 0)
                }
                label={t("streak")}
              />
            ) : null}
            {data?.nextResetAt ? (
              <DailyCountdown
                targetIso={data.nextResetAt}
                serverNowIso={data.serverTime}
                label={t("nextReset")}
              />
            ) : null}
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Column (Quiz / Results) */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-6">
            {today.isLoading ? <LoadingSkeleton /> : null}

            {today.error ? (
              <MessageCard
                message={t("error.loadFailed")}
                actionLabel={t("error.retry")}
                onAction={() => today.refetch()}
                tone="error"
              />
            ) : null}

            {data && data.questions.length === 0 ? (
              <MessageCard message={t("error.noQuestions")} />
            ) : null}

            {data && data.questions.length > 0 ? (
              showAlreadyDone ? (
                <MessageCard message={t("alreadyDone")} />
              ) : !accessToken ? (
                <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-2xl space-y-4">
                  <p className="font-body text-sm font-semibold text-candy-ink">
                    {t("intro")}
                  </p>
                  <button
                    type="button"
                    onClick={handleStart}
                    className="min-h-11 px-6 py-2.5 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] hover:bg-candy-pink/90 active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
                  >
                    {t("start")}
                  </button>
                </div>
              ) : result ? null : (
                <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] p-6 rounded-3xl space-y-6">
                  <DailyProgress
                    index={questionIndex + 1}
                    total={questionCount}
                  />
                  {currentQuestion ? (
                    <DailyQuestionCard
                      question={currentQuestion}
                      questionNumber={questionIndex + 1}
                      totalQuestions={questionCount}
                      selected={answers[questionIndex]?.answer ?? null}
                      locked={false}
                      onSelect={handleSelect}
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleBack}
                      disabled={questionIndex === 0}
                      className="min-h-11 px-5 py-2 rounded-xl bg-white text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-40 cursor-pointer"
                    >
                      {t("back")}
                    </button>
                    {questionIndex < questionCount - 1 ? (
                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={!answers[questionIndex]?.answer}
                        className="min-h-11 px-6 py-2 rounded-xl bg-candy-yellow text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-40 cursor-pointer"
                      >
                        {t("next")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSubmitRequest}
                        disabled={!allAnswered || submitting}
                        className="min-h-11 px-6 py-2 rounded-xl bg-candy-mint text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-40 cursor-pointer"
                      >
                        {t("submit")}
                      </button>
                    )}
                  </div>
                  {submitError?.status === 409 ? (
                    <MessageCard message={t("error.alreadySubmitted")} />
                  ) : submitError?.status === 429 ? (
                    <MessageCard message={t("error.rateLimited")} />
                  ) : submitError ? (
                    <MessageCard
                      message={`${t("error.submitFailed")}: ${submitError.message}`}
                      tone="error"
                    />
                  ) : null}
                </div>
              )
            ) : null}

            {result ? (
              <>
                <DailyResultPanel
                  result={result}
                  speedBonusLabel={
                    result.elapsedMs == null
                      ? t("speedBonus.none")
                      : t("speedBonus.awarded", {
                          seconds: (result.elapsedMs / 1000).toFixed(1),
                        })
                  }
                />
                <DailyShareButton
                  result={result}
                  shareLabel={t("share.result")}
                  copyLabel={t("share.copy")}
                  copiedLabel={t("share.copied")}
                  errorLabel={t("share.error")}
                  shareTextTitle={t("share.textTitle")}
                  shareTextScoreLabel={t("result.score")}
                  shareTextStreakLabel={t("result.streak")}
                />
              </>
            ) : null}
          </div>

          {/* Side Column (Streak Rewards & Leaderboard) */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-6">
            <DailyStreakRewardsWidget
              currentStreak={
                result ? result.streakAfter : (data?.currentStreak ?? 0)
              }
            />

            <section className="space-y-3">
              <DashboardSectionTitle
                title={t("leaderboard.title")}
                glyph="trophy"
              />
              {leaderboard.isLoading ? <LoadingSkeleton /> : null}
              {leaderboard.error ? (
                <MessageCard message={t("leaderboard.error")} />
              ) : null}
              {leaderboard.data ? (
                <DailyLeaderboard items={leaderboard.data.items} />
              ) : null}
            </section>
          </div>
        </div>

        <DailyNicknameGate
          open={nicknameGateOpen}
          onOpenChange={setNicknameGateOpen}
          onAuthenticated={handleNicknameAuthenticated}
          title={t("gate.title")}
          description={t("gate.description")}
          ctaLabel={t("gate.cta")}
          cancelLabel={t("gate.cancel")}
        />

        {unlockedAt?.unlockedVariant ? (
          <CardVariantUnlockModal
            result={unlockedAt}
            onClose={() => setUnlockedAt(null)}
            title={t("cardVariant.unlockedTitle")}
            subtitle={t("cardVariant.unlockedSubtitle")}
            shareLabel={t("share.result")}
            copyLabel={t("share.copy")}
            copiedLabel={t("share.copied")}
            closeLabel={t("cardVariant.close")}
            unlockHeadlineTemplate={t("cardVariant.headline")}
            shareHeadline={t("cardVariant.shareHeadline")}
            shareScoreLine={(score, correct, total) =>
              t("share.textScore", { score, correct, total })
            }
            shareStreakLine={(streak) => t("share.textStreak", { streak })}
          />
        ) : null}
      </div>
    </AppShellLayout>
  );
}
