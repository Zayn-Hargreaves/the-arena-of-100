"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
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
}

export const ProfessorHudWidget: React.FC<ProfessorHudWidgetProps> = ({
  timeLeft,
  hasAnswered = false,
  isCorrect = null,
  isEliminated = false,
}) => {
  const t = useTranslations("Game");
  const tProf = useTranslations("Professor");

  const [mood, setMood] = useState<ProfessorMood>("teaching");
  const [dialogueKey, setDialogueKey] = useState<string>("defaultRoundHint");
  const lastPokeTimeRef = useRef<number>(0);
  const lastSecondsTriggeredRef = useRef<boolean>(false);

  const isLastSeconds = typeof timeLeft === "number" && timeLeft <= 4;

  // Reaction to game state changes
  useEffect(() => {
    if (isEliminated) {
      const d = getRandomProfessorDialogue("game_eliminated");
      setMood(d.mood);
      setDialogueKey(d.key);
      return;
    }

    if (hasAnswered && isCorrect === true) {
      const d = getRandomProfessorDialogue("game_correct_answer");
      setMood(d.mood);
      setDialogueKey(d.key);
      return;
    }

    if (hasAnswered && isCorrect === false) {
      const d = getRandomProfessorDialogue("game_wrong_answer");
      setMood(d.mood);
      setDialogueKey(d.key);
      return;
    }

    // Default teaching mood
    if (!hasAnswered) {
      if (Date.now() - lastPokeTimeRef.current < 4000) {
        return;
      }
      setMood("teaching");
      setDialogueKey("defaultRoundHint");
    }
  }, [
    isEliminated,
    hasAnswered,
    isCorrect,
    isLastSeconds, // Triggers restoring defaultRoundHint when exiting countdown state
  ]);

  // Countdown effect - triggers only once per countdown cycle
  useEffect(() => {
    if (!isLastSeconds) {
      lastSecondsTriggeredRef.current = false;
      return;
    }

    if (!lastSecondsTriggeredRef.current && !hasAnswered && !isEliminated) {
      if (Date.now() - lastPokeTimeRef.current < 4000) {
        return;
      }
      lastSecondsTriggeredRef.current = true;
      const d = getRandomProfessorDialogue("game_last_seconds");
      setMood("ticking_panic");
      setDialogueKey(d.key);
    }
  }, [isLastSeconds, hasAnswered, isEliminated, timeLeft]);

  // Click on professor to hear a witty line
  const handlePokeProfessor = () => {
    lastPokeTimeRef.current = Date.now();
    const d = getRandomProfessorDialogue(
      hasAnswered ? "game_correct_answer" : "game_round_start",
    );
    setMood(d.mood);
    setDialogueKey(d.key);
  };

  const dialogue = dialogueKey ? tProf(dialogueKey) : "";

  return (
    <aside
      aria-label={t("professorSupervisorLabel")}
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
        {dialogue && (
          <p className="font-sans font-bold text-xs text-candy-ink leading-tight line-clamp-2">
            &ldquo;{dialogue}&rdquo;
          </p>
        )}
      </div>
    </aside>
  );
};

ProfessorHudWidget.displayName = "ProfessorHudWidget";
