"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";

/**
 * Fullscreen "match finished" overlay shown for a few seconds before
 * the page auto-redirects to the results screen.
 */
export const MatchFinishedOverlay: React.FC = () => {
  const t = useTranslations("Game");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="jelly-card p-8 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-4 animate-bounce-in">
        <div className="flex justify-center">
          <Trophy className="w-16 h-16 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
        </div>
        <h2 className="font-display font-black text-3xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
          {t("matchFinishedOverlay.title")}
        </h2>
        <p className="font-sans text-sm font-bold text-candy-ink/70">
          {t("matchFinishedOverlay.subtitle")}
        </p>
      </div>
    </div>
  );
};

MatchFinishedOverlay.displayName = "MatchFinishedOverlay";
