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

const OPTION_LETTERS = ["A", "B", "C", "D"];

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
    <div className="space-y-5 select-none">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-black uppercase tracking-wider text-candy-ink bg-white border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] px-2.5 py-0.5 rounded-lg">
            Câu {questionNumber}/{totalQuestions}
          </span>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-candy-ink/80 bg-candy-cloud border-[2px] border-candy-ink/30 px-2.5 py-0.5 rounded-lg">
            {question.category}
          </span>
        </div>
        <span
          className={`font-mono text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-lg border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] ${tone.bg} ${tone.fg}`}
        >
          {t(`difficulty.${question.difficulty}`)}
        </span>
      </div>

      <div className="bg-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl p-5">
        <p className="font-display font-black text-lg sm:text-xl text-candy-ink leading-snug">
          {question.content}
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {question.options.map((option, idx) => {
          const isSelected = selected === option;
          const isCorrectAnswer = revealCorrectAnswer === option;
          const isWrongSelected = locked && isSelected && !isCorrectAnswer;
          const letter = OPTION_LETTERS[idx] ?? String(idx + 1);

          const cardStateStyle = isCorrectAnswer
            ? "bg-candy-mint text-candy-ink border-candy-ink shadow-[3px_3px_0_0_#2B2D42]"
            : isWrongSelected
              ? "bg-candy-pink/30 text-candy-ink border-candy-pink shadow-[3px_3px_0_0_#2B2D42]"
              : isSelected
                ? "bg-candy-yellow text-candy-ink border-candy-ink shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                : "bg-white text-candy-ink border-candy-ink shadow-[3px_3px_0_0_#2B2D42] hover:bg-candy-yellow/20 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none";

          return (
            <li key={option}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onSelect(option)}
                aria-pressed={isSelected}
                className={`w-full text-left border-[2px] rounded-xl p-3.5 font-body text-sm font-bold transition-all duration-150 flex items-center gap-3 cursor-pointer disabled:cursor-not-allowed ${cardStateStyle}`}
              >
                <span
                  className={`w-7 h-7 rounded-lg border-[2px] border-candy-ink flex items-center justify-center font-mono font-black text-xs shrink-0 ${
                    isSelected
                      ? "bg-candy-pink text-white"
                      : "bg-candy-cloud text-candy-ink"
                  }`}
                >
                  {letter}
                </span>
                <span className="flex-1 leading-snug">{option}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
