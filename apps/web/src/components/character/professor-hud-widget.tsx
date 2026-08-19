"use client";

import React, { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ProfessorAvatar } from "./professor-avatar";
import {
  getRandomProfessorDialogue,
  type ProfessorMood,
} from "./professor-roast-engine";

export interface ProfessorHudWidgetProps {
  timeLeft?: number;
  hasAnswered?: boolean;
  isCorrect?: boolean | null;
  isEliminated?: boolean;
  locale?: string;
}

export const ProfessorHudWidget: React.FC<ProfessorHudWidgetProps> = ({
  timeLeft,
  hasAnswered = false,
  isCorrect = null,
  isEliminated = false,
  locale: propLocale,
}) => {
  const t = useTranslations("Game");
  const tProf = useTranslations("Professor");
  const contextLocale = useLocale();
  const locale = propLocale ?? contextLocale;

  const [mood, setMood] = useState<ProfessorMood>("teaching");
  const [dialogue, setDialogue] = useState<string>("");
  const [showDialogue, setShowDialogue] = useState(true);

  // Reaction to game state changes
  useEffect(() => {
    if (isEliminated) {
      const d = getRandomProfessorDialogue("game_eliminated", locale);
      setMood(d.mood);
      setDialogue(d.text);
      setShowDialogue(true);
      return;
    }

    if (hasAnswered && isCorrect === true) {
      const d = getRandomProfessorDialogue("game_correct_answer", locale);
      setMood(d.mood);
      setDialogue(d.text);
      setShowDialogue(true);
      return;
    }

    if (hasAnswered && isCorrect === false) {
      const d = getRandomProfessorDialogue("game_wrong_answer", locale);
      setMood(d.mood);
      setDialogue(d.text);
      setShowDialogue(true);
      return;
    }

    if (typeof timeLeft === "number" && timeLeft <= 4 && !hasAnswered) {
      const d = getRandomProfessorDialogue("game_last_seconds", locale);
      setMood("ticking_panic");
      setDialogue(d.text);
      setShowDialogue(true);
      return;
    }

    // Default teaching mood
    if (!hasAnswered) {
      setMood("teaching");
      setDialogue(
        locale.startsWith("vi")
          ? "Đọc kỹ câu hỏi trước khi chọn nhé trò!"
          : "Read the question carefully before picking!",
      );
    }
  }, [timeLeft, hasAnswered, isCorrect, isEliminated, locale]);

  // Click on professor to hear a witty line
  const handlePokeProfessor = () => {
    const d = getRandomProfessorDialogue(
      hasAnswered ? "game_correct_answer" : "game_round_start",
      locale,
    );
    setMood(d.mood);
    setDialogue(d.text);
    setShowDialogue(true);
  };

  return (
    <aside
      aria-label={t("professorSupervisorLabel", {
        defaultMessage: tProf("supervisorTitle"),
      })}
      className="flex items-center gap-3 bg-white/90 backdrop-blur-md p-2.5 md:p-3 rounded-2xl border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] max-w-sm transition-all"
    >
      <button
        type="button"
        onClick={handlePokeProfessor}
        className="cursor-pointer transition-transform active:scale-95 shrink-0 focus:outline-none"
        title={tProf("pokeGameTitle")}
        aria-label={tProf("pokeGameTitle")}
      >
        <ProfessorAvatar mood={mood} size="sm" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-display font-black text-[10px] uppercase tracking-wider text-candy-pink">
            {tProf("supervisorTitle")}
          </span>
        </div>
        {showDialogue && (
          <p className="font-sans font-bold text-xs text-candy-ink leading-tight line-clamp-2">
            &ldquo;{dialogue}&rdquo;
          </p>
        )}
      </div>
    </aside>
  );
};

ProfessorHudWidget.displayName = "ProfessorHudWidget";
