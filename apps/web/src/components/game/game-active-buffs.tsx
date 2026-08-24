"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ClassId } from "@arena/shared";
import { CardGlyph } from "./card-glyphs";
import { ClassBadge } from "./class-badge";

export interface GameActiveBuffsProps {
  hasShield: boolean;
  scoreMultiplier: number | null;
  hasSecondChance: boolean;
  classId?: ClassId | null;
}

export function GameActiveBuffs({
  hasShield,
  scoreMultiplier,
  hasSecondChance,
  classId,
}: Readonly<GameActiveBuffsProps>) {
  const t = useTranslations("Game");

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {hasShield && (
        <div className="flex items-center gap-1.5 bg-candy-mint px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs animate-pulse">
          <CardGlyph variant="shield" size={18} className="text-candy-ink" />
          <span>{t("shieldActive")}</span>
        </div>
      )}
      {scoreMultiplier && (
        <div className="flex items-center gap-1.5 bg-candy-yellow px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs animate-bounce">
          <CardGlyph
            variant="doubleScore"
            size={18}
            className="text-candy-ink"
          />
          <span>{t("scoreMultiplier", { factor: scoreMultiplier })}</span>
        </div>
      )}
      {hasSecondChance && (
        <div className="flex items-center gap-1.5 bg-candy-pink px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs">
          <CardGlyph
            variant="secondChance"
            size={18}
            className="text-candy-ink"
          />
          <span>{t("secondChance")}</span>
        </div>
      )}
      {classId && (
        <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
          <span className="text-xs font-bold text-candy-ink/70">
            {t("classLabel")}
          </span>
          <ClassBadge classId={classId} variant="strong" />
        </div>
      )}
    </div>
  );
}
