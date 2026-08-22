"use client";

import React, { useEffect, useState } from "react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { FlameSvg, SparkleSmallSvg, ArrowRightSvg, ZapSvg } from "./home-icons";

export function DailyModeCard() {
  const t = useTranslations("HomePage");
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedStreak = localStorage.getItem("dailyStreak");
      if (savedStreak) {
        const parsed = parseInt(savedStreak, 10);
        if (!isNaN(parsed) && parsed > 0) {
          setStreak(parsed);
        }
      }
    }
  }, []);

  return (
    <div className="bg-white border-4 border-candy-ink rounded-3xl p-6 shadow-[6px_6px_0_0_#2B2D42] relative overflow-hidden flex flex-col justify-between transition-transform hover:-translate-y-1 hover:shadow-[8px_8px_0_0_#2B2D42]">
      {/* Decorative top-right accent */}
      <div className="absolute -top-6 -right-6 w-24 h-24 bg-candy-yellow/40 rounded-full blur-xl pointer-events-none" />

      <div>
        {/* Header badges */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="inline-flex items-center gap-1.5 bg-candy-yellow text-candy-ink font-display text-[11px] font-black px-3 py-1 border-2 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42] uppercase tracking-wider">
            <FlameSvg size={14} className="text-candy-pink" />
            <span>{t("dailyBadge")}</span>
          </div>

          {streak !== null && streak > 0 && (
            <div className="inline-flex items-center gap-1.5 bg-candy-pink/15 text-candy-pink font-mono text-xs font-black px-2.5 py-0.5 rounded-full border border-candy-pink/40">
              <FlameSvg size={14} />
              <span>
                {streak} {t("dailyStreakLabel")}
              </span>
            </div>
          )}
        </div>

        {/* Title & Description */}
        <h3 className="font-display font-black text-xl text-candy-ink uppercase tracking-tight flex items-center gap-2">
          {t("dailyCardTitle")}
        </h3>
        <p className="font-body text-xs text-candy-ink/75 font-semibold mt-1.5 leading-relaxed">
          {t("dailyCardDesc")}
        </p>

        {/* Feature Pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          <span className="inline-flex items-center gap-1.5 bg-candy-cloud text-candy-ink font-mono text-[10px] font-bold px-2.5 py-1 rounded-lg border border-candy-ink/20">
            <ZapSvg size={13} />
            {t("dailySpeedQuestions", { count: 5 })}
          </span>
          <span className="inline-flex items-center gap-1.5 bg-candy-cloud text-candy-ink font-mono text-[10px] font-bold px-2.5 py-1 rounded-lg border border-candy-ink/20">
            <SparkleSmallSvg size={12} className="text-candy-pink" />
            {t("dailyUnlockSkins")}
          </span>
        </div>
      </div>

      {/* Action Button */}
      <div className="mt-6 pt-4 border-t-2 border-dashed border-candy-ink/15">
        <Link
          href="/daily"
          className="w-full min-h-12 bg-candy-pink text-white font-display text-sm py-3 px-4 rounded-2xl border-3 border-candy-ink shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] hover:bg-candy-pink/90 transition-all uppercase tracking-wide font-black flex items-center justify-center gap-2"
        >
          <span>{t("playDaily")}</span>
          <ArrowRightSvg size={16} />
        </Link>
      </div>
    </div>
  );
}
