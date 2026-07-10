"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";

/**
 * Fullscreen overlay shown when the local player has been eliminated.
 * Purely presentational — the parent decides when to render it.
 */
export const EliminatedOverlay: React.FC = () => {
  const t = useTranslations("Game");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
      <div className="jelly-card p-6 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-3 animate-bounce-in pointer-events-auto">
        <div className="flex justify-center">
          <Trophy className="w-12 h-12 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
        </div>
        <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink">
          {t("eliminatedOverlay.title")}
        </h2>
        <p className="font-sans text-sm font-bold text-candy-ink/70">
          {t("eliminatedOverlay.subtitle")}
        </p>
      </div>
    </div>
  );
};

EliminatedOverlay.displayName = "EliminatedOverlay";
