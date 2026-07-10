"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Swords } from "lucide-react";
import { AnswerTile, type AnswerTileProps } from "./answer-tile";

// The answer contract is fixed at 4 options (A/B/C/D) — this is the
// only shape the server ever sends (see QuestionSnapshot/@arena/shared).
// Deriving codes from `idx` would silently emit "E", "F", ... for any
// out-of-contract payload; a fixed list plus a slice keeps the UI on
// contract even if upstream ever sends a malformed options array.
const ANSWER_CODES = ["A", "B", "C", "D"] as const;

export interface AnswerPanelProps {
  isEliminated: boolean;
  isSpectator: boolean;
  options: string[];
  getTileVariant: (option: string) => AnswerTileProps["variant"];
  onSelect: (option: string) => void;
  disabled: boolean;
}

/**
 * The answer area. For eliminated players and drop-in spectators it
 * renders a read-only block (with different copy per case); otherwise
 * it renders the interactive A/B/C/D answer tiles.
 */
export const AnswerPanel: React.FC<AnswerPanelProps> = ({
  isEliminated,
  isSpectator,
  options,
  getTileVariant,
  onSelect,
  disabled,
}) => {
  const t = useTranslations("Game");
  const tSpectator = useTranslations("Game.dropInSpectator");

  // The isEliminated branch is the original spectator-on-elimination UI.
  // The isSpectator branch is the drop-in spectator path (late-joiner).
  // Both render the same read-only block but with different copy so the
  // user knows why they cannot answer.
  if (isEliminated || isSpectator) {
    return (
      <div className="p-8 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col items-center justify-center min-h-[220px] text-center space-y-4">
        <Swords className="w-12 h-12 text-candy-red stroke-[2]" />
        <h3 className="font-display font-black text-xl uppercase tracking-wide">
          {isSpectator ? tSpectator("bannerTitle") : t("spectatorMode.title")}
        </h3>
        <p className="font-sans text-sm text-candy-ink/70">
          {isSpectator ? tSpectator("bannerBody") : t("spectatorMode.subtitle")}
        </p>
      </div>
    );
  }

  if (options.length > ANSWER_CODES.length) {
    console.error(
      `AnswerPanel: received ${options.length} options, contract allows at most ${ANSWER_CODES.length} (A-D). Truncating.`,
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {options.slice(0, ANSWER_CODES.length).map((option, idx) => {
        const charCode = ANSWER_CODES[idx];
        return (
          <AnswerTile
            key={charCode}
            option={charCode}
            content={option}
            variant={getTileVariant(charCode)}
            onClick={() => onSelect(charCode)}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
};

AnswerPanel.displayName = "AnswerPanel";
