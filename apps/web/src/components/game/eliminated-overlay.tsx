"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";
import type { EliminationReason } from "@arena/shared";

export interface EliminatedOverlayProps {
  /**
   * Why the local player was eliminated. Drives the reason line
   * ("wrong answer" / "ran out of time" / "AFK"). When null/undefined
   * the overlay falls back to the generic subtitle — e.g. an eliminated
   * state hydrated from a reconnect snapshot that carries no reason.
   */
  reason?: EliminationReason | null;
}

/**
 * Fullscreen overlay shown when the local player has been eliminated.
 * Purely presentational — the parent decides when to render it.
 */
export const EliminatedOverlay: React.FC<EliminatedOverlayProps> = ({
  reason = null,
}) => {
  const t = useTranslations("Game");

  const REASON_TEXT: Record<EliminationReason, string> = {
    WRONG_ANSWER: t("eliminatedOverlay.reasonWrong"),
    TIMEOUT: t("eliminatedOverlay.reasonTimeout"),
    AFK: t("eliminatedOverlay.reasonAfk"),
  };
  const reasonText = reason ? REASON_TEXT[reason] : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
      <div className="jelly-card p-6 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-3 animate-bounce-in pointer-events-auto">
        <div className="flex justify-center">
          <Trophy className="w-12 h-12 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
        </div>
        <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink">
          {t("eliminatedOverlay.title")}
        </h2>
        {reasonText && (
          <p
            data-testid="elimination-reason"
            className="font-display font-black text-sm uppercase tracking-wide text-candy-red"
          >
            {reasonText}
          </p>
        )}
        <p className="font-sans text-sm font-bold text-candy-ink/70">
          {t("eliminatedOverlay.subtitle")}
        </p>
      </div>
    </div>
  );
};

EliminatedOverlay.displayName = "EliminatedOverlay";
