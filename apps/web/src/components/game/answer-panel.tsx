"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ANSWER_CODES } from "@arena/shared";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { AnswerTile, type AnswerTileProps } from "./answer-tile";

export interface AnswerPanelProps {
  isEliminated: boolean;
  isSpectator: boolean;
  options: string[];
  getTileVariant: (option: string) => AnswerTileProps["variant"];
  onSelect: (option: string) => void;
  disabled: boolean;
  disabledOptionCodes?: string[];
  isOptionLocked?: boolean;
  fakeFlaggedIndexes?: readonly number[];
}

/**
 * The answer area. Renders the interactive or practice A/B/C/D answer tiles.
 * For eliminated players and drop-in spectators, tiles remain visible so
 * viewers can participate informally and see answer reveals in real-time.
 */
export const AnswerPanel: React.FC<AnswerPanelProps> = ({
  isEliminated,
  isSpectator,
  options,
  getTileVariant,
  onSelect,
  disabled,
  disabledOptionCodes = [],
  isOptionLocked = false,
  fakeFlaggedIndexes = [],
}) => {
  const t = useTranslations("Game");
  const isObserving = isEliminated || isSpectator;

  if (options.length > ANSWER_CODES.length) {
    console.error(
      `AnswerPanel: received ${options.length} options, contract allows at most ${ANSWER_CODES.length} (A-D). Truncating.`,
    );
  }

  return (
    <div className="space-y-3">
      {isObserving && (
        <div
          role="status"
          data-testid="spectator-practice-badge"
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-candy-cloud rounded-2xl border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-xs text-candy-ink/80 animate-fade-in"
        >
          <div className="flex items-center gap-2 font-bold">
            <MiniGlyph
              variant="eye"
              className="w-4 h-4 text-candy-blue stroke-[2.5] shrink-0"
            />
            <span>{t("spectatorMode.practiceHint")}</span>
          </div>
          <span className="text-[10px] uppercase font-display font-black tracking-wider px-2 py-0.5 rounded-lg bg-candy-blue/15 text-candy-blue border-[1.5px] border-candy-blue/30 shrink-0">
            {t("spectatorMode.observingBadge")}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {options.slice(0, ANSWER_CODES.length).map((option, idx) => {
          const charCode = ANSWER_CODES[idx];
          const isFiftyFiftyDisabled = disabledOptionCodes.includes(charCode);
          const isFakeFlagged = fakeFlaggedIndexes.includes(idx);

          return (
            <AnswerTile
              key={charCode}
              option={charCode}
              content={option}
              variant={getTileVariant(charCode)}
              onClick={() => onSelect(charCode)}
              disabled={disabled}
              isLocked={isOptionLocked}
              isFiftyFiftyDisabled={isFiftyFiftyDisabled}
              isFakeFlagged={isFakeFlagged}
            />
          );
        })}
      </div>
    </div>
  );
};

AnswerPanel.displayName = "AnswerPanel";
