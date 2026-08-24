"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { StreakGlyph, CardsGlyph } from "./daily-glyph";
import { SparkleSmallSvg } from "@/components/home/home-icons";

interface DailyStreakRewardsWidgetProps {
  currentStreak: number;
}

export function DailyStreakRewardsWidget({
  currentStreak,
}: Readonly<DailyStreakRewardsWidgetProps>) {
  const t = useTranslations("daily");

  const milestones = [
    {
      target: 7,
      label: t("rewards.neonTier"),
      variantKey: "NEON",
      bgClass: "bg-cyan-50 border-cyan-400 text-cyan-800",
      badgeClass: "bg-cyan-500 text-white",
      isUnlocked: currentStreak >= 7,
    },
    {
      target: 14,
      label: t("rewards.goldTier"),
      variantKey: "GOLD",
      bgClass: "bg-amber-50 border-amber-400 text-amber-800",
      badgeClass: "bg-amber-500 text-white",
      isUnlocked: currentStreak >= 14,
    },
  ];

  // Calculate next target
  const nextMilestone =
    milestones.find((m) => !m.isUnlocked) ?? milestones[milestones.length - 1];
  const progressPercent = Math.min(
    100,
    Math.round((currentStreak / nextMilestone.target) * 100),
  );

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 border-b-2 border-dashed border-candy-ink/20 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-candy-yellow border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center shrink-0">
            <StreakGlyph className="text-candy-pink" size={16} />
          </div>
          <div>
            <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wide">
              {t("rewards.title")}
            </h3>
            <p className="font-body text-[11px] font-semibold text-candy-ink/70">
              {t("rewards.subtitle")}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-candy-yellow/40 border-2 border-candy-ink rounded-full px-2.5 py-0.5">
          <StreakGlyph className="text-candy-pink" size={12} />
          <span className="font-mono font-black text-xs text-candy-ink">
            {currentStreak}
          </span>
        </div>
      </div>

      {/* Progress towards next unlock */}
      {!nextMilestone.isUnlocked && (
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-[11px] font-mono font-black text-candy-ink">
            <span className="flex items-center gap-1">
              <SparkleSmallSvg size={12} className="text-candy-yellow" />
              {nextMilestone.label}
            </span>
            <span className="text-candy-pink">
              {currentStreak}/{nextMilestone.target} {t("streak")}
            </span>
          </div>
          <div className="w-full bg-white border-2 border-candy-ink rounded-full h-3.5 p-0.5 shadow-inner overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-candy-yellow to-candy-pink rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Milestone Badges */}
      <div className="grid grid-cols-1 gap-2 pt-1">
        {milestones.map((m) => {
          return (
            <div
              key={m.variantKey}
              className={`border-2 rounded-xl p-2.5 flex items-center justify-between gap-2 transition-all ${
                m.isUnlocked
                  ? `${m.bgClass} shadow-[2px_2px_0_0_#2B2D42]`
                  : "bg-white/70 border-candy-ink/20 opacity-75"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg border border-candy-ink/40 flex items-center justify-center font-mono font-black text-xs ${
                    m.isUnlocked ? m.badgeClass : "bg-slate-200 text-slate-500"
                  }`}
                >
                  <CardsGlyph size={12} />
                </div>
                <span className="font-display font-black text-xs text-candy-ink truncate">
                  {m.label}
                </span>
              </div>
              <span
                className={`font-mono text-[10px] font-black uppercase px-2 py-0.5 rounded-md shrink-0 ${
                  m.isUnlocked
                    ? "bg-candy-mint text-candy-ink border border-candy-ink/30"
                    : "bg-slate-100 text-slate-500 border border-slate-300"
                }`}
              >
                {m.isUnlocked
                  ? t("rewards.unlocked")
                  : `${currentStreak}/${m.target}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
