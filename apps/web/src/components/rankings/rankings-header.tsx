"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { LeaderboardPeriod } from "@/hooks/use-leaderboard";
import {
  TrophyArcadeSvg,
  WeeklyPeriodSvg,
  AllTimePeriodSvg,
} from "./ranking-icons";

export interface RankingsHeaderProps {
  period: LeaderboardPeriod;
  onPeriodChange: (period: LeaderboardPeriod) => void;
}

export function RankingsHeader({
  period,
  onPeriodChange,
}: Readonly<RankingsHeaderProps>) {
  const t = useTranslations("rankings");

  return (
    <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-5 relative overflow-hidden">
      <div className="flex items-center gap-4 relative z-10">
        <div className="w-14 h-14 rounded-2xl bg-candy-yellow border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-center shrink-0">
          <TrophyArcadeSvg size={34} />
        </div>
        <div className="space-y-1">
          <h1 className="font-display font-black text-2xl md:text-3xl text-candy-ink tracking-wide uppercase drop-shadow-[1.5px_1.5px_0_#FFE45E]">
            {t("title")}
          </h1>
          <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Arcade Segmented Period Switcher */}
      <div
        role="group"
        aria-label={t("period.label")}
        className="shrink-0 flex items-center p-1.5 bg-candy-ink/5 border-[2.5px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] gap-1.5"
      >
        <button
          type="button"
          aria-pressed={period === "weekly"}
          onClick={() => onPeriodChange("weekly")}
          className={cn(
            "px-4 py-2 rounded-xl font-display font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer",
            period === "weekly"
              ? "bg-candy-mint text-candy-ink border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]"
              : "text-candy-ink/75 hover:text-candy-ink border-[2px] border-transparent",
          )}
        >
          <WeeklyPeriodSvg size={16} />
          {t("period.weekly")}
        </button>
        <button
          type="button"
          aria-pressed={period === "all"}
          onClick={() => onPeriodChange("all")}
          className={cn(
            "px-4 py-2 rounded-xl font-display font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer",
            period === "all"
              ? "bg-candy-yellow text-candy-ink border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]"
              : "text-candy-ink/75 hover:text-candy-ink border-[2px] border-transparent",
          )}
        >
          <AllTimePeriodSvg size={16} />
          {t("period.all")}
        </button>
      </div>
    </div>
  );
}
