import React from "react";
import { useTranslations } from "next-intl";
import { MessageCard } from "@/components/ui/message-card";
import { DailyProgress } from "@/components/daily/daily-progress";
import { DailyQuestionCard } from "@/components/daily/daily-question-card";
import type { DailyAnswerInput, DailyQuestionPublic } from "@/types/daily";

interface DailyQuizRunnerProps {
  questionIndex: number;
  questionCount: number;
  currentQuestion?: DailyQuestionPublic;
  answers: DailyAnswerInput[];
  allAnswered: boolean;
  submitting: boolean;
  submitError: { status: number; message: string } | null;
  onSelectAnswer: (option: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export function DailyQuizRunner({
  questionIndex,
  questionCount,
  currentQuestion,
  answers,
  allAnswered,
  submitting,
  submitError,
  onSelectAnswer,
  onBack,
  onNext,
  onSubmit,
}: DailyQuizRunnerProps) {
  const t = useTranslations("daily");

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] p-6 rounded-3xl space-y-6">
      <DailyProgress index={questionIndex + 1} total={questionCount} />

      {currentQuestion ? (
        <DailyQuestionCard
          question={currentQuestion}
          questionNumber={questionIndex + 1}
          totalQuestions={questionCount}
          selected={answers[questionIndex]?.answer ?? null}
          locked={false}
          onSelect={onSelectAnswer}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={questionIndex === 0}
          className="min-h-11 px-5 py-2 rounded-xl bg-white text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-40 cursor-pointer"
        >
          {t("back")}
        </button>
        {questionIndex < questionCount - 1 ? (
          <button
            type="button"
            onClick={onNext}
            disabled={!answers[questionIndex]?.answer}
            className="min-h-11 px-6 py-2 rounded-xl bg-candy-yellow text-candy-ink border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] disabled:opacity-40 cursor-pointer"
          >
            {t("next")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
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
  );
}
