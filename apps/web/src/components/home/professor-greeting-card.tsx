"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import { ProfessorDialogueBox } from "@/components/character/professor-dialogue-box";
import {
  getRandomProfessorDialogue,
  type ProfessorMood,
  type ProfessorDialogueKey,
} from "@/components/character/professor-roast-engine";

export interface ProfessorGreetingCardProps {
  nickname?: string;
  avatarName?: string;
}

export const ProfessorGreetingCard: React.FC<ProfessorGreetingCardProps> = ({
  nickname = "",
  avatarName = "",
}) => {
  const t = useTranslations("HomePage");
  const tProf = useTranslations("Professor");
  const [mood, setMood] = useState<ProfessorMood>("idle");
  const [dialogueKey, setDialogueKey] = useState<ProfessorDialogueKey | null>(
    null,
  );

  // Update dialogue and mood when nickname changes
  useEffect(() => {
    if (!nickname.trim()) {
      setMood("idle");
      setDialogueKey(null);
    } else {
      setMood("proud_cheer");
      setDialogueKey(null);
    }
  }, [nickname, avatarName]);

  const handlePoke = () => {
    const d = getRandomProfessorDialogue(
      nickname.trim() ? "home_nickname_typed" : "home_greeting",
    );
    setMood(d.mood);
    setDialogueKey(d.key);
  };

  const avatarNote = avatarName ? ` (${avatarName})` : "";
  const dialogue = dialogueKey
    ? tProf(dialogueKey)
    : !nickname.trim()
      ? tProf("greetingIdle")
      : tProf("greetingNickname", { nickname, avatarNote });

  return (
    <aside
      aria-label={t("professorSupervisorLabel", {
        defaultMessage: tProf("attendanceDesk"),
      })}
      className="mb-6 p-4 pt-7 sm:pt-4 rounded-3xl border-[3.5px] border-candy-ink bg-[#FFFDF5] shadow-[5px_5px_0_0_#2B2D42] flex flex-col sm:flex-row items-center gap-4 relative overflow-hidden"
    >
      <div className="bg-candy-yellow text-candy-ink border-[2px] border-candy-ink px-2.5 py-0.5 rounded-lg font-display font-black text-[10px] uppercase tracking-wider absolute top-2.5 right-3 shadow-[2px_2px_0_0_#2B2D42] z-10">
        {tProf("attendanceDesk")}
      </div>

      <button
        type="button"
        onClick={handlePoke}
        className="shrink-0 cursor-pointer group focus:outline-none transition-transform active:scale-95 mt-1 sm:mt-0"
        title={tProf("pokeAttendanceTitle")}
        aria-label={tProf("pokeAttendanceTitle")}
      >
        <ProfessorAvatar mood={mood} size="md" showNameplate />
      </button>

      <div className="flex-1 text-center sm:text-left">
        <div className="font-display font-black text-xs text-candy-pink uppercase tracking-wide mb-1">
          {tProf("instructionsLabel")}
        </div>
        <ProfessorDialogueBox
          text={dialogue}
          tailPosition="left"
          variant="paper"
          className="shadow-none border-[2.5px]"
        />
      </div>
    </aside>
  );
};

ProfessorGreetingCard.displayName = "ProfessorGreetingCard";
