"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";

/**
 * Thin top-of-page strip telling a drop-in spectator they joined the
 * match read-only. Lighter than the eliminated fullscreen overlay
 * because the spectator can still follow the round and leave at will.
 */
export const SpectatorBanner: React.FC = () => {
  const tSpectator = useTranslations("Game.dropInSpectator");

  return (
    <div
      data-testid="game-spectator-banner"
      className="max-w-6xl mx-auto w-full mb-4 mt-2 px-4 py-3 rounded-2xl border-[3px] border-candy-ink bg-candy-blue/15 flex items-start gap-3 shadow-[3px_3px_0_0_#2B2D42]"
    >
      <Eye className="w-5 h-5 text-candy-blue stroke-[2.5] shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider">
          {tSpectator("bannerTitle")}
        </h3>
        <p className="text-xs font-semibold text-candy-ink/70 leading-relaxed">
          {tSpectator("bannerBody")}
        </p>
      </div>
    </div>
  );
};

SpectatorBanner.displayName = "SpectatorBanner";
