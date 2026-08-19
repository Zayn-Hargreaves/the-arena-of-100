"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";

/** Small informational note about the anti-cheat protection. */
export const AntiHackNote: React.FC = () => {
  const t = useTranslations("Game");

  return (
    <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
      <MiniGlyph
        variant="shield"
        className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]"
      />
      <p className="text-[10px] leading-relaxed text-candy-ink font-semibold">
        <strong>{t("antiHackDescription")}:</strong> {t("antiHackDetails")}
      </p>
    </div>
  );
};

AntiHackNote.displayName = "AntiHackNote";
