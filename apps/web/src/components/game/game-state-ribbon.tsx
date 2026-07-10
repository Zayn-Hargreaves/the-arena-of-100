"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Timer } from "./timer";

export interface GameStateRibbonProps {
  roundNo: number;
  timeLeft: number;
  roundDuration: number;
  livePlayerCount: number;
  maxPlayers: number;
}

/**
 * Top ribbon: current round + difficulty label on the left, the
 * circular round timer + remaining-player count on the right.
 */
export const GameStateRibbon: React.FC<GameStateRibbonProps> = ({
  roundNo,
  timeLeft,
  roundDuration,
  livePlayerCount,
  maxPlayers,
}) => {
  const t = useTranslations("Game");

  return (
    <div className="border-[3.5px] border-candy-ink bg-white rounded-3xl shadow-[5px_5px_0_0_#2B2D42] p-5 flex flex-col md:flex-row gap-4 items-center justify-between relative overflow-hidden">
      {/* Subtle decorative stripe */}
      <div className="absolute top-0 left-0 right-0 h-[6px] bg-gradient-to-r from-candy-pink via-candy-yellow to-candy-mint" />

      <div className="flex items-center gap-6 w-full md:w-auto">
        <div>
          <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
            {t("matchingTitle")}
          </span>
          <span className="font-display font-black text-2xl text-candy-pink drop-shadow-[0_2px_0_rgba(0,0,0,0.02)]">
            {t("roundLabel")} {roundNo}
          </span>
        </div>
        <div className="h-10 w-[3px] bg-candy-ink/10 hidden sm:block" />
        <div className="hidden sm:block">
          <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
            {t("roundComplexity")}
          </span>
          <span className="font-sans text-sm font-bold text-candy-orange bg-candy-yellow/15 border-[2px] border-candy-orange/30 px-2.5 py-0.5 rounded-lg inline-block">
            {t("roundLevelExtreme")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto border-t-[2.5px] border-candy-ink/10 md:border-0 pt-4 md:pt-0">
        {/* Active countdown circular timer component */}
        <Timer
          duration={roundDuration}
          timeLeft={timeLeft}
          size={72}
          height={72}
        />

        <div className="h-10 w-[3px] bg-candy-ink/10" />

        <div className="text-right">
          <span className="text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider flex items-center gap-1 justify-end">
            <Users className="w-3.5 h-3.5 text-candy-blue stroke-[2.5]" />
            {t("remainingLabel")}
          </span>
          <span className="font-display font-black text-3xl text-candy-blue">
            {livePlayerCount} / {maxPlayers}
          </span>
        </div>
      </div>
    </div>
  );
};

GameStateRibbon.displayName = "GameStateRibbon";
