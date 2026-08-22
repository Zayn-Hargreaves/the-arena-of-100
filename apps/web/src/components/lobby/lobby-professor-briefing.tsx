"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import {
  getRandomProfessorDialogue,
  type ProfessorMood,
  type ProfessorDialogueKey,
} from "@/components/character/professor-roast-engine";

export interface LobbyProfessorBriefingProps {
  playersCount: number;
}

export const LobbyProfessorBriefing: React.FC<LobbyProfessorBriefingProps> = ({
  playersCount,
}) => {
  const tProf = useTranslations("Professor");
  const [mood, setMood] = useState<ProfessorMood>("teaching");
  const [dialogueKey, setDialogueKey] = useState<ProfessorDialogueKey>(
    "dialogues.lobby_briefing.0",
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const d = getRandomProfessorDialogue("lobby_briefing");
      setMood(d.mood);
      setDialogueKey(d.key);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const handlePoke = () => {
    const d = getRandomProfessorDialogue("lobby_briefing");
    setMood(d.mood);
    setDialogueKey(d.key);
  };

  const dialogue = tProf(dialogueKey);

  return (
    <div
      data-testid="lobby-professor-briefing"
      className="p-4 rounded-3xl border-[3px] border-candy-ink bg-[#FFFDF5] shadow-[4px_4px_0_0_#2B2D42] flex items-center gap-3.5 relative overflow-hidden"
    >
      <div className="bg-candy-mint text-white border-[2px] border-candy-ink px-2 py-0.5 rounded-lg font-display font-black text-[9px] uppercase tracking-wider absolute top-2 right-2.5 shadow-[1.5px_1.5px_0_0_#2B2D42]">
        {tProf("supervisorTitle")}
      </div>

      <button
        type="button"
        onClick={handlePoke}
        className="shrink-0 cursor-pointer focus:outline-none transition-transform active:scale-95"
        title={tProf("pokeRulesTitle")}
        aria-label={tProf("pokeRulesTitle")}
      >
        <ProfessorAvatar mood={mood} size="sm" />
      </button>

      <div className="flex-1 min-w-0 pr-12">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-display font-black text-[10px] text-candy-pink uppercase tracking-wide">
            {tProf("rulesLabel")}
          </span>
          <span className="font-mono text-[9px] text-candy-ink/60 font-bold">
            ({playersCount}/100)
          </span>
        </div>
        <p className="font-sans font-bold text-xs text-candy-ink leading-tight tracking-normal">
          &ldquo;{dialogue}&rdquo;
        </p>
      </div>
    </div>
  );
};

LobbyProfessorBriefing.displayName = "LobbyProfessorBriefing";
