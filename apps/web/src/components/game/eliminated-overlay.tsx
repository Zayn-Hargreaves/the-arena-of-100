"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { EliminationReason } from "@arena/shared";
import { ProfessorAvatar } from "@/components/character/professor-avatar";
import { getRandomProfessorDialogue } from "@/components/character/professor-roast-engine";

import { MiniGlyph } from "@/components/ui/mini-glyph";

export interface EliminatedOverlayProps {
  /**
   * Why the local player was eliminated. Drives the reason line
   * ("wrong answer" / "ran out of time" / "AFK"). When null/undefined
   * the overlay falls back to the generic subtitle — e.g. an eliminated
   * state hydrated from a reconnect snapshot that carries no reason.
   */
  reason?: EliminationReason | null;
  /**
   * Optional callback to dismiss the overlay and enter spectator mode.
   */
  onSpectate?: () => void;
  /**
   * Optional callback to prompt leaving the match.
   */
  onLeave?: () => void;
}

/**
 * Fullscreen overlay shown when the local player has been eliminated.
 * Provides actions to continue spectating the remaining match or leave.
 */
export const EliminatedOverlay: React.FC<EliminatedOverlayProps> = ({
  reason = null,
  onSpectate,
  onLeave,
}) => {
  const t = useTranslations("Game");
  const tProf = useTranslations("Professor");

  const REASON_TEXT: Record<EliminationReason, string> = {
    WRONG_ANSWER: t("eliminatedOverlay.reasonWrong"),
    TIMEOUT: t("eliminatedOverlay.reasonTimeout"),
    AFK: t("eliminatedOverlay.reasonAfk"),
  };
  const reasonText = reason ? REASON_TEXT[reason] : null;

  const professorRoast = useMemo(() => {
    const d = getRandomProfessorDialogue(
      reason === "TIMEOUT" ? "game_eliminated_timeout" : "game_wrong_answer",
    );
    return tProf(d.key);
  }, [reason, tProf]);

  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    previousActiveElement.current =
      document.activeElement as HTMLElement | null;
    if (dialogRef.current) {
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length > 0) {
        focusable[0]?.focus();
      } else {
        dialogRef.current.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          document.activeElement === dialogRef.current
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (
        previousActiveElement.current &&
        typeof previousActiveElement.current.focus === "function"
      ) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="eliminated-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-16 sm:pt-4 overflow-y-auto bg-black/60 backdrop-blur-sm pointer-events-none outline-none"
    >
      <div className="jelly-card p-5 sm:p-6 md:p-8 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-3.5 sm:space-y-4 animate-bounce-in pointer-events-auto max-w-md w-full my-auto relative">
        {/* Red Stamp Badge */}
        <div className="absolute -top-3 -right-2 sm:-top-3.5 sm:-right-2 bg-candy-red text-white font-display font-black text-[10px] sm:text-[11px] px-3 sm:px-3.5 py-1 border-[3px] border-candy-ink rounded-xl transform rotate-6 shadow-[2px_2px_0_0_#2B2D42] z-10">
          {tProf("grades.eliminated")}
        </div>

        {/* Professor Angry Roast Avatar */}
        <div className="flex justify-center pt-2">
          <ProfessorAvatar mood="angry_roast" size="lg" />
        </div>

        <div>
          <h2
            id="eliminated-title"
            className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink"
          >
            {t("eliminatedOverlay.title")}
          </h2>
          {reasonText && (
            <p
              data-testid="elimination-reason"
              className="font-display font-black text-sm uppercase tracking-wide text-candy-red mt-1"
            >
              {reasonText}
            </p>
          )}
        </div>

        {/* Professor Roast Remark */}
        <div className="p-3.5 rounded-2xl bg-[#FFF5F5] border-[2.5px] border-candy-red/40 text-left">
          <span className="font-display font-black text-[10px] text-candy-red uppercase tracking-wider block mb-1">
            {tProf("roastLabel")}
          </span>
          <p className="font-sans font-bold text-xs text-candy-ink leading-relaxed tracking-normal">
            &ldquo;{professorRoast}&rdquo;
          </p>
        </div>

        <p className="font-sans text-xs font-bold text-candy-ink/70">
          {t("eliminatedOverlay.subtitle")}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 pt-2">
          {onLeave && (
            <button
              type="button"
              onClick={onLeave}
              data-testid="eliminated-leave-btn"
              className="flex-1 h-12 sm:h-11 px-4 bg-white hover:bg-candy-cloud text-candy-ink border-[3px] border-candy-ink shadow-[3.5px_3.5px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1px] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] font-display font-black text-sm sm:text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer transition-all outline-none whitespace-nowrap"
            >
              <MiniGlyph
                variant="logout"
                className="w-5 h-5 sm:w-4 sm:h-4 stroke-[2.5] shrink-0"
              />
              <span className="leading-none">
                {t("eliminatedOverlay.leaveButton")}
              </span>
            </button>
          )}
          {onSpectate && (
            <button
              type="button"
              onClick={onSpectate}
              data-testid="eliminated-spectate-btn"
              className="flex-1 h-12 sm:h-11 px-4 bg-candy-blue hover:bg-candy-blue/90 text-white border-[3px] border-candy-ink shadow-[3.5px_3.5px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1px] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] font-display font-black text-sm sm:text-xs tracking-wider uppercase flex items-center justify-center gap-2 cursor-pointer transition-all outline-none whitespace-nowrap"
            >
              <MiniGlyph
                variant="eye"
                className="w-5 h-5 sm:w-4 sm:h-4 stroke-[2.5] shrink-0"
              />
              <span className="leading-none">
                {t("eliminatedOverlay.spectateButton")}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

EliminatedOverlay.displayName = "EliminatedOverlay";
