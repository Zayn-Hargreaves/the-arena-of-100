"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { MessageCard } from "@/components/ui/message-card";
import { StatValue, QueryErrorCard } from "./profile-stat-common";
import { formatPercent } from "@/lib/formatters";
import type { ClassId, ClassStats } from "@arena/shared";
import type { useClassStats } from "@/hooks/use-profile-stats";
import {
  FlameStreakSvg,
  CardsDeckSvg,
  ProfileTrophySvg,
  SwordsClashSvg,
  ShieldGuardianSvg,
} from "./profile-icons";

interface ClassStyleTokens {
  badge: string;
  pill: string;
  text: string;
  meter: string;
}

const CLASS_THEME: Record<ClassId, ClassStyleTokens> = {
  ATTACK: {
    badge: "bg-candy-red",
    pill: "bg-candy-red text-white border-candy-ink",
    text: "text-candy-red",
    meter: "bg-candy-red",
  },
  DEFENSE: {
    badge: "bg-candy-blue",
    pill: "bg-candy-blue text-white border-candy-ink",
    text: "text-candy-blue",
    meter: "bg-candy-blue",
  },
};

interface ClassStatCardProps {
  classId: ClassId;
  stats?: ClassStats["classWinrate"][ClassId];
  isLoading: boolean;
  icon: React.ReactNode;
  colorClass?: ClassStyleTokens;
}

function ClassStatCard({
  classId,
  stats,
  isLoading,
  icon,
  colorClass = CLASS_THEME[classId],
}: Readonly<ClassStatCardProps>) {
  const t = useTranslations("profile");

  return (
    <div className="bg-candy-cloud/70 border-2 border-candy-ink rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-xl ${colorClass.badge} text-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center`}
          >
            {icon}
          </div>
          <div>
            <span
              className={`px-2 py-0.5 rounded-lg ${colorClass.badge} text-white border border-candy-ink text-[10px] font-mono font-black`}
            >
              {t(`classStats.class.${classId}`)}
            </span>
            <p className="text-[11px] font-mono font-bold text-candy-ink/70 mt-0.5">
              {stats && stats.plays > 0
                ? `${stats.wins} / ${stats.plays} ${t("classStats.matchesWon")}`
                : isLoading
                  ? "..."
                  : t("classStats.noClassMatches")}
            </p>
          </div>
        </div>
        <span className={`font-display font-black text-2xl ${colorClass.text}`}>
          {stats ? formatPercent(stats.winRate) : isLoading ? "--" : "0%"}
        </span>
      </div>

      {/* Winrate Progress Meter */}
      <div className="w-full h-3 bg-white border-2 border-candy-ink rounded-full overflow-hidden p-0.5">
        <div
          className={`h-full ${colorClass.meter} rounded-full transition-all duration-500`}
          style={{
            width: `${Math.min(100, Math.max(0, stats ? stats.winRate * 100 : 0))}%`,
          }}
        />
      </div>
    </div>
  );
}

function pickBestClass(
  classWinrate: ClassStats["classWinrate"],
): { classId: ClassId; winRate: number } | null {
  const attack = classWinrate.ATTACK;
  const defense = classWinrate.DEFENSE;
  const attackPlayed = (attack?.plays ?? 0) > 0;
  const defensePlayed = (defense?.plays ?? 0) > 0;
  if (!attackPlayed && !defensePlayed) return null;
  if (!defensePlayed) {
    return { classId: "ATTACK", winRate: attack?.winRate ?? 0 };
  }
  if (!attackPlayed) {
    return { classId: "DEFENSE", winRate: defense?.winRate ?? 0 };
  }
  return (attack?.winRate ?? 0) >= (defense?.winRate ?? 0)
    ? { classId: "ATTACK", winRate: attack?.winRate ?? 0 }
    : { classId: "DEFENSE", winRate: defense?.winRate ?? 0 };
}

interface ProfileClassStatsProps {
  isUnauthorized: boolean;
  classStatsQuery: ReturnType<typeof useClassStats>;
}

export function ProfileClassStats({
  isUnauthorized,
  classStatsQuery,
}: Readonly<ProfileClassStatsProps>) {
  const t = useTranslations("profile");

  const handleRetry = useCallback(() => {
    classStatsQuery.refetch();
  }, [classStatsQuery]);

  if (isUnauthorized) {
    return <MessageCard message={t("error.signinRequired")} />;
  }
  if (classStatsQuery.error) {
    return <QueryErrorCard onRetry={handleRetry} />;
  }

  const data = classStatsQuery.data?.stats;
  const attack = data?.classWinrate.ATTACK;
  const defense = data?.classWinrate.DEFENSE;
  const best = data ? pickBestClass(data.classWinrate) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Streak Card */}
        <div className="bg-candy-pink border-[3px] border-candy-ink rounded-3xl p-5 text-center space-y-2 shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden">
          <div className="flex items-center justify-center gap-2">
            <FlameStreakSvg size={26} />
            <span className="text-xs font-mono font-black uppercase text-white tracking-wider">
              {t("classStats.streak")}
            </span>
          </div>
          <div className="font-display font-black text-4xl text-white">
            <StatValue
              isLoading={classStatsQuery.isLoading}
              value={data?.currentStreak ?? 0}
            />
          </div>
          <p className="text-[11px] font-mono font-black uppercase text-white/90">
            {t("classStats.streakHint")}
          </p>
        </div>

        {/* Cards Played Counter */}
        <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-5 text-center space-y-2 shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden">
          <div className="flex items-center justify-center gap-2">
            <CardsDeckSvg size={26} />
            <span className="text-xs font-mono font-black uppercase text-candy-ink/75 tracking-wider">
              {t("classStats.cardsPlayed")}
            </span>
          </div>
          <div className="font-display font-black text-4xl text-candy-red">
            <StatValue
              isLoading={classStatsQuery.isLoading}
              value={data?.cardsPlayed ?? 0}
            />
          </div>
          <p className="text-[11px] font-mono font-black uppercase text-candy-ink/65">
            {t("classStats.cardsPlayedHint")}
          </p>
        </div>

        {/* Best Class Highlight */}
        <div className="bg-candy-yellow border-[3px] border-candy-ink rounded-3xl p-5 text-center space-y-2 shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden">
          <div className="flex items-center justify-center gap-2">
            <ProfileTrophySvg size={24} />
            <span className="text-xs font-mono font-black uppercase text-candy-ink tracking-wider">
              {t("classStats.bestClass")}
            </span>
          </div>
          <div className="font-display font-black text-2xl text-candy-ink flex items-center justify-center gap-2.5 min-h-[40px]">
            {best ? (
              <>
                <span
                  className={`px-2.5 py-1 rounded-xl border-2 shadow-[2px_2px_0_0_#000] text-xs font-mono font-black ${CLASS_THEME[best.classId]?.pill ?? ""}`}
                >
                  {t(`classStats.class.${best.classId}`)}
                </span>
                <span className="text-3xl font-display font-black">
                  <StatValue
                    isLoading={classStatsQuery.isLoading}
                    value={formatPercent(best.winRate)}
                  />
                </span>
              </>
            ) : (
              <StatValue isLoading={classStatsQuery.isLoading} value="—" />
            )}
          </div>
          <p className="text-[11px] font-mono font-black uppercase text-candy-ink/75">
            {t("classStats.bestClassHint")}
          </p>
        </div>
      </div>

      {/* Class Winrate Detailed Battle Breakdown */}
      <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-5 shadow-[5px_5px_0_0_#2B2D42] space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-display font-black text-sm uppercase text-candy-ink tracking-wider flex items-center gap-2">
            <SwordsClashSvg size={20} />
            {t("classStats.versus")}
          </h4>
          <span className="text-xs font-mono font-black text-candy-ink/60 uppercase">
            {t("classStats.winRate")}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ClassStatCard
            classId="ATTACK"
            stats={attack}
            isLoading={classStatsQuery.isLoading}
            icon={<SwordsClashSvg size={18} />}
            colorClass={CLASS_THEME.ATTACK}
          />
          <ClassStatCard
            classId="DEFENSE"
            stats={defense}
            isLoading={classStatsQuery.isLoading}
            icon={<ShieldGuardianSvg size={18} />}
            colorClass={CLASS_THEME.DEFENSE}
          />
        </div>
      </div>
    </div>
  );
}
