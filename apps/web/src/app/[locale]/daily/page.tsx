"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { DashboardSectionTitle } from "@/components/ui/dashboard-section-title";
import { MessageCard } from "@/components/ui/message-card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { DailyResultPanel } from "@/components/daily/daily-result-panel";
import { DailyLeaderboard } from "@/components/daily/daily-leaderboard";
import { DailyNicknameGate } from "@/components/daily/daily-nickname-gate";
import { DailyShareButton } from "@/components/daily/daily-share-button";
import { DailyStreakRewardsWidget } from "@/components/daily/daily-streak-rewards-widget";
import { CardVariantUnlockModal } from "@/components/daily/card-variant-unlock-modal";
import { DailyHeaderHero } from "@/components/daily/daily-header-hero";
import { DailyIntroCard } from "@/components/daily/daily-intro-card";
import { DailyQuizRunner } from "@/components/daily/daily-quiz-runner";

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
  const [unlockedAt, setUnlockedAt] =
    React.useState<DailySubmitResponse | null>(null);

  const startedAtRef = React.useRef<number | null>(null);

  const questionCount = data?.questions.length ?? 0;
  const currentQuestion: DailyQuestionPublic | undefined =
    data?.questions[questionIndex];

  React.useEffect(() => {
    if (!data?.dateKey) return;
    setQuestionIndex(0);
    setAnswers(freshAnswers(data.questions.length));
    setResult(null);
    setSubmitError(null);
  }, [data?.dateKey, data?.questions.length]);

  const alreadySubmitted = data?.alreadyAttempted ?? false;
  const showAlreadyDone = alreadySubmitted && !result;

  const allAnswered =
    questionCount > 0 &&
    answers.length === questionCount &&
    answers.every((a) => a.answer.length > 0);

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
    if (accessToken) return;
    setNicknameIntent("play");
    setNicknameGateOpen(true);
  };

  const handleNicknameAuthenticated = React.useCallback(async () => {
    const intent = nicknameIntent;
    setNicknameIntent(null);
    if (intent === "submit") {
      await doSubmit();
    }
  }, [doSubmit, nicknameIntent]);

  return (
    <AppShellLayout>
      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 pb-12 select-none relative z-10">
        <DailyHeaderHero data={data} result={result} />

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
                <DailyIntroCard onStart={handleStart} />
              ) : result ? null : (
                <DailyQuizRunner
                  questionIndex={questionIndex}
                  questionCount={questionCount}
                  currentQuestion={currentQuestion}
                  answers={answers}
                  allAnswered={allAnswered}
                  submitting={submitting}
                  submitError={submitError}
                  onSelectAnswer={handleSelect}
                  onBack={handleBack}
                  onNext={handleNext}
                  onSubmit={handleSubmitRequest}
                />
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

          {/* Sidebar Column (Rewards + Leaderboard) */}
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
