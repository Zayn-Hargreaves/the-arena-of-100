"use client";

import React, { useCallback } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MessageCard } from "@/components/ui/message-card";
import { StatValue, QueryErrorCard } from "./profile-stat-common";
import { formatPercent, formatResponseMs } from "@/lib/formatters";
import type { useProfileStats } from "@/hooks/use-profile-stats";
import {
  ProfileHeroBadgeSvg,
  ProfileTrophySvg,
  LightningSpeedSvg,
  AccuracyTargetSvg,
  MedalRibbonSvg,
  TrendGrowthSvg,
  ShieldGuardianSvg,
  CheckmarkCheckSvg,
} from "./profile-icons";

interface ProfileStatsGridProps {
  isUnauthorized: boolean;
  statsQuery: ReturnType<typeof useProfileStats>;
}

export function ProfileStatsGrid({
  isUnauthorized,
  statsQuery,
}: Readonly<ProfileStatsGridProps>) {
  const t = useTranslations("profile");
  const format = useFormatter();
  const profile = statsQuery.data;

  const handleRetry = useCallback(() => {
    statsQuery.refetch();
  }, [statsQuery]);

  if (isUnauthorized) {
    return <MessageCard message={t("error.signinRequired")} />;
  }

  if (statsQuery.error) {
    return <QueryErrorCard onRetry={handleRetry} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: t("stats.matches"),
            icon: <ProfileHeroBadgeSvg size={20} />,
            value: format.number(profile?.stats.matchesPlayed ?? 0),
            color: "text-candy-blue",
            cardBg: "bg-white",
            iconBg: "bg-candy-cloud",
            labelOpacity: "text-candy-ink/75",
          },
          {
            label: t("stats.wins"),
            icon: <ProfileTrophySvg size={22} />,
            value: format.number(profile?.stats.wins ?? 0),
            color: "text-candy-ink",
            cardBg: "bg-candy-yellow",
            iconBg: "bg-white",
            labelOpacity: "text-candy-ink",
          },
          {
            label: t("stats.averageResponse"),
            icon: <LightningSpeedSvg size={20} />,
            value: formatResponseMs(profile?.stats.avgResponseMs ?? 0),
            color: "text-candy-mint",
            cardBg: "bg-white",
            iconBg: "bg-candy-mint/20",
            labelOpacity: "text-candy-ink/75",
          },
          {
            label: t("stats.accuracy"),
            icon: <AccuracyTargetSvg size={20} />,
            value: formatPercent(profile?.stats.accuracy ?? 0),
            color: "text-candy-pink",
            cardBg: "bg-white",
            iconBg: "bg-candy-pink/20",
            labelOpacity: "text-candy-ink/75",
          },
        ].map((item) => (
          <div
            key={item.label}
            className={`${item.cardBg} border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col justify-between shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden group`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[11px] font-mono font-black uppercase ${item.labelOpacity} tracking-wider`}
              >
                {item.label}
              </span>
              <div
                className={`w-9 h-9 rounded-xl ${item.iconBg} border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center`}
              >
                {item.icon}
              </div>
            </div>
            <div
              className={`mt-3 font-display font-black text-3xl md:text-4xl ${item.color} tracking-tight`}
            >
              <StatValue isLoading={statsQuery.isLoading} value={item.value} />
            </div>
          </div>
        ))}
      </div>

      {/* Footer Sub-stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: t("stats.footer.totalScore"),
            value: format.number(profile?.stats.totalScore ?? 0),
            icon: <MedalRibbonSvg size={18} />,
            color: "text-candy-blue",
          },
          {
            label: t("stats.footer.winRate"),
            value: formatPercent(profile?.stats.winRate ?? 0),
            icon: <TrendGrowthSvg size={18} />,
            color: "text-candy-mint",
          },
          {
            label: t("stats.footer.survivalRate"),
            value: formatPercent(profile?.stats.survivalRate ?? 0),
            icon: <ShieldGuardianSvg size={18} />,
            color: "text-candy-pink",
          },
          {
            label: t("stats.footer.correctAnswers"),
            value: format.number(profile?.stats.totalCorrectAnswers ?? 0),
            icon: <CheckmarkCheckSvg size={18} />,
            color: "text-candy-ink",
          },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-candy-cloud border-[2.5px] border-candy-ink rounded-2xl p-3.5 shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[10px] font-mono font-black uppercase text-candy-ink/65 tracking-wide">
                {item.label}
              </p>
              <p
                className={`font-display font-black text-lg md:text-xl mt-0.5 ${item.color}`}
              >
                {statsQuery.isLoading ? "--" : item.value}
              </p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center shrink-0">
              {item.icon}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
