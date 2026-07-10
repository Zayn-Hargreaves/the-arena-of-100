"use client";

import React from "react";
import { useTranslations } from "next-intl";

export interface QuestionCardProps {
  hasCurrentQuestion: boolean;
  questionText: string;
  roundCompleted: boolean;
}

/**
 * The question panel. Renders the current question text, or a loading
 * skeleton when the question is not yet available (late hydration /
 * pre-ROUND_STARTED / snapshot gap) instead of stale fallback content.
 */
export const QuestionCard: React.FC<QuestionCardProps> = ({
  hasCurrentQuestion,
  questionText,
  roundCompleted,
}) => {
  const t = useTranslations("Game");

  return (
    <div className="p-8 md:p-10 rounded-3xl border-[3.5px] border-candy-ink bg-candy-yellow text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col justify-between min-h-[220px] relative overflow-hidden">
      <div className="bg-white border-[2.5px] border-candy-ink px-3 py-1 text-[9px] font-mono text-candy-ink font-black tracking-wider rounded-lg absolute top-3 left-4 shadow-[1.5px_1.5px_0_0_#2B2D42]">
        {t("rulesHeader")}
      </div>
      <div className="absolute top-3 right-4 text-xs font-display font-black text-candy-pink animate-pulse flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-candy-pink border border-candy-ink" />
        {roundCompleted ? t("lockedAnswer") : t("waiting")}
      </div>

      <h2 className="font-sans font-bold text-lg md:text-2xl text-candy-ink leading-relaxed tracking-wide pt-8">
        {/* Render a loading skeleton when the current question is not
            yet available, instead of stale fallback content. */}
        {hasCurrentQuestion ? (
          questionText
        ) : (
          <div
            data-testid="loading-question"
            className="animate-pulse text-center text-candy-ink/50 py-4"
          >
            {t("loadingQuestion")}
          </div>
        )}
      </h2>
    </div>
  );
};

QuestionCard.displayName = "QuestionCard";
