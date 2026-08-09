"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DailyQuestionPublic } from "@/types/daily";

interface DailyQuestionCardProps {
  question: DailyQuestionPublic;
  questionNumber: number;
  totalQuestions: number;
  selected: string | null;
  /** Disabled after submit, used during result reveal. */
  locked: boolean;
  /** Reveal styling for already-submitted flow. */
  revealCorrectAnswer?: string;
  onSelect: (option: string) => void;
}

const difficultyTone: Record<
  DailyQuestionPublic["difficulty"],
  { bg: string; fg: string }
> = {
  EASY: { bg: "bg-candy-mint/30", fg: "text-candy-ink" },
  MEDIUM: { bg: "bg-candy-yellow/30", fg: "text-candy-ink" },
  HARD: { bg: "bg-candy-pink/20", fg: "text-candy-ink" },
};

export function DailyQuestionCard({
  question,
  questionNumber,
  totalQuestions,
  selected,
  locked,
  revealCorrectAnswer,
  onSelect,
}: Readonly<DailyQuestionCardProps>) {
  const t = useTranslations("daily");
  const tone = difficultyTone[question.difficulty];

  return (
    <div className="space-y-4 select-none">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-black uppercase tracking-wider text-candy-ink/70 bg-white/70 border border-candy-ink/20 px-2 py-0.5 rounded-md">
          {questionNumber}/{totalQuestions}
        </span>
        <span className="font-mono text-[10px] font-black uppercase tracking-wider text-candy-ink/70 bg-white/70 border border-candy-ink/20 px-2 py-0.5 rounded-md">
          {question.category}
        </span>
        <span
          className={`font-mono text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border border-candy-ink/20 ${tone.bg} ${tone.fg}`}
        >
          {t(`difficulty.${question.difficulty}`)}
        </span>
      </div>

      <p className="font-display font-black text-lg md:text-xl text-candy-ink leading-snug">
        {question.content}
      </p>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((option) => {
          const isSelected = selected === option;
          const isCorrectAnswer = revealCorrectAnswer === option;
          const isWrongSelected = locked && isSelected && !isCorrectAnswer;
          const toneClass = isCorrectAnswer
            ? "bg-candy-mint border-candy-ink"
            : isWrongSelected
              ? "bg-candy-pink/40 border-candy-red"
              : isSelected
                ? "bg-candy-yellow/40 border-candy-ink"
                : "bg-white border-candy-ink/20 hover:bg-candy-yellow/10";

          return (
            <li key={option}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onSelect(option)}
                aria-pressed={isSelected}
                className={`w-full text-left border-[2px] rounded-xl px-4 py-3 font-body text-sm text-candy-ink font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${toneClass}`}
              >
                {option}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
