"use client";

import React, { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import { ProfessorDialogueBox } from "@/components/character/professor-dialogue-box";
import {
  getRandomProfessorDialogue,
  type ProfessorMood,
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
  const locale = useLocale();
  const [mood, setMood] = useState<ProfessorMood>("idle");
  const [dialogue, setDialogue] = useState<string>(() =>
    locale.startsWith("vi")
      ? "Trò mới tới à? Mau ghi danh vào sổ điểm danh để thầy xếp phòng thi!"
      : "New student? Quick, sign into the attendance book so I can assign your exam hall!",
  );

  // Update dialogue and mood when nickname changes
  useEffect(() => {
    if (!nickname.trim()) {
      setMood("idle");
      setDialogue(
        locale.startsWith("vi")
          ? "Trò mới tới à? Mau ghi danh vào sổ điểm danh để thầy xếp phòng thi!"
          : "New student? Quick, sign into the attendance book so I can assign your exam hall!",
      );
    } else {
      setMood("proud_cheer");
      const avatarNote = avatarName ? ` (${avatarName})` : "";
      setDialogue(
        locale.startsWith("vi")
          ? `Biệt danh "${nickname}"${avatarNote} nghe chiến đấy! Sẵn sàng vào đấu trường chưa trò?`
          : `Fierce nickname "${nickname}"${avatarNote}! Are you ready to enter the arena?`,
      );
    }
  }, [nickname, avatarName, locale]);

  const handlePoke = () => {
    const d = getRandomProfessorDialogue(
      nickname.trim() ? "home_nickname_typed" : "home_greeting",
      locale,
    );
    setMood(d.mood);
    setDialogue(d.text);
  };

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
