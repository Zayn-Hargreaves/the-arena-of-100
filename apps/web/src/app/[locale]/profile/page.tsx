"use client";

import React, { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { MessageCard } from "@/components/ui/message-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { Spinner } from "@/components/ui/spinner";
import { RankBadge } from "@/components/atoms/rank-badge";
import { Link } from "@/i18n/routing";
import { avatars, findAvatarBySeed, type AvatarOption } from "@/lib/avatars";
import {
  DEFAULT_AVATAR_SEED,
  isValidAvatarSeed,
  type ClassId,
  type ClassStats,
} from "@arena/shared";
import {
  formatDuration,
  formatPercent,
  formatPlayedAt,
  formatResponseMs,
} from "@/lib/formatters";
import { useMatchHistory } from "@/hooks/use-match-history";
import { useClassStats, useProfileStats } from "@/hooks/use-profile-stats";
import { useSocketStore } from "@/stores/socket-store";
import type { Locale } from "@/i18n/routing";
import {
  ProfileHeroBadgeSvg,
  ProfileTrophySvg,
  SwordsClashSvg,
  ShieldGuardianSvg,
  FlameStreakSvg,
  CardsDeckSvg,
  LightningSpeedSvg,
  AccuracyTargetSvg,
  CrownGoldSvg,
  SkullDefeatSvg,
  FlagAbandonSvg,
  CopyClipboardSvg,
  CheckmarkCheckSvg,
  EditAvatarSvg,
  TrendGrowthSvg,
  MedalRibbonSvg,
  ClockTimerSvg,
  PlayersGroupSvg,
  RetroGamepadEmptySvg,
} from "@/components/profile/profile-icons";

function StatValue({
  isLoading,
  value,
}: Readonly<{
  isLoading: boolean;
  value: string | number;
}>) {
  if (isLoading) {
    return <Spinner size="sm" className="text-current" />;
  }

  return <>{value}</>;
}

function HistorySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 md:p-5 space-y-3 shadow-[4px_4px_0_0_#2B2D42]"
        >
          <Skeleton width="180px" height="20px" />
          <Skeleton width="120px" height="14px" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton height="36px" />
            <Skeleton height="36px" />
            <Skeleton height="36px" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Resolves which avatar to render in the profile header.
function getActiveAvatar(
  profile: { user: { avatar: string } } | undefined,
  catalog: AvatarOption[],
): AvatarOption | undefined {
  const seed = profile?.user.avatar;
  if (seed && isValidAvatarSeed(seed)) {
    return findAvatarBySeed(seed);
  }
  return catalog[0];
}

// Badge colour lookup – avoids a nested ternary inside JSX.
const STATUS_BADGE_CLASSES: Record<string, string> = {
  WON: "bg-candy-mint text-white",
  ABANDONED: "bg-candy-yellow text-candy-ink",
  ELIMINATED: "bg-candy-red text-white",
};

function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status] ?? "bg-candy-cloud text-candy-ink";
}

function QueryErrorCard({
  onRetry,
  t,
}: Readonly<{
  onRetry: () => void;
  t: ReturnType<typeof useTranslations>;
}>) {
  return (
    <MessageCard
      message={t("error.loadFailed")}
      actionLabel={t("error.retry")}
      onAction={onRetry}
      tone="error"
    />
  );
}

// -----------------------------------------------------------------------
// Profile Section Title with Neo-brutalist icon frame
// -----------------------------------------------------------------------

function ProfileSectionHeader({
  title,
  icon,
}: Readonly<{
  title: string;
  icon: React.ReactNode;
}>) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-2xl bg-white border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-center shrink-0">
        {icon}
      </div>
      <h3 className="font-display font-black text-xl md:text-2xl text-candy-ink uppercase tracking-wider">
        {title}
      </h3>
    </div>
  );
}

// -----------------------------------------------------------------------
// Stats Section
// -----------------------------------------------------------------------

interface StatsSectionProps {
  isUnauthorized: boolean;
  statsQuery: ReturnType<typeof useProfileStats>;
  profile: ReturnType<typeof useProfileStats>["data"];
  t: ReturnType<typeof useTranslations>;
}

function StatsSection({
  isUnauthorized,
  statsQuery,
  profile,
  t,
}: Readonly<StatsSectionProps>) {
  const handleRetry = useCallback(() => {
    statsQuery.refetch();
  }, [statsQuery]);

  if (isUnauthorized) {
    return <MessageCard message={t("error.signinRequired")} />;
  }

  if (statsQuery.error) {
    return <QueryErrorCard onRetry={handleRetry} t={t} />;
  }

  return (
    <div className="space-y-4">
      {/* 4 Primary Highlight Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Matches */}
        <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col justify-between shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-black uppercase text-candy-ink/75 tracking-wider">
              {t("stats.matches")}
            </span>
            <div className="w-9 h-9 rounded-xl bg-candy-cloud border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
              <ProfileHeroBadgeSvg size={20} />
            </div>
          </div>
          <div className="mt-3 font-display font-black text-3xl md:text-4xl text-candy-blue tracking-tight">
            <StatValue
              isLoading={statsQuery.isLoading}
              value={profile?.stats.matchesPlayed ?? 0}
            />
          </div>
        </div>

        {/* Victories */}
        <div className="bg-candy-yellow border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col justify-between shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-black uppercase text-candy-ink tracking-wider">
              {t("stats.wins")}
            </span>
            <div className="w-9 h-9 rounded-xl bg-white border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
              <ProfileTrophySvg size={22} />
            </div>
          </div>
          <div className="mt-3 font-display font-black text-3xl md:text-4xl text-candy-ink tracking-tight">
            <StatValue
              isLoading={statsQuery.isLoading}
              value={profile?.stats.wins ?? 0}
            />
          </div>
        </div>

        {/* Avg Response Time */}
        <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col justify-between shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-black uppercase text-candy-ink/75 tracking-wider">
              {t("stats.averageResponse")}
            </span>
            <div className="w-9 h-9 rounded-xl bg-candy-mint/20 border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
              <LightningSpeedSvg size={20} />
            </div>
          </div>
          <div className="mt-3 font-display font-black text-3xl md:text-4xl text-candy-mint tracking-tight">
            <StatValue
              isLoading={statsQuery.isLoading}
              value={formatResponseMs(profile?.stats.avgResponseMs ?? 0)}
            />
          </div>
        </div>

        {/* Accuracy Rate */}
        <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col justify-between shadow-[5px_5px_0_0_#2B2D42] hover:-translate-y-1 transition-transform relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-black uppercase text-candy-ink/75 tracking-wider">
              {t("stats.accuracy")}
            </span>
            <div className="w-9 h-9 rounded-xl bg-candy-pink/20 border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
              <AccuracyTargetSvg size={20} />
            </div>
          </div>
          <div className="mt-3 font-display font-black text-3xl md:text-4xl text-candy-pink tracking-tight">
            <StatValue
              isLoading={statsQuery.isLoading}
              value={formatPercent(profile?.stats.accuracy ?? 0)}
            />
          </div>
        </div>
      </div>

      {/* 4 Secondary Secondary Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: t("stats.footer.totalScore"),
            value: (profile?.stats.totalScore ?? 0).toLocaleString(),
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
            value: (profile?.stats.totalCorrectAnswers ?? 0).toLocaleString(),
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

// -----------------------------------------------------------------------
// Class & Cards Tactical Analytics Section
// -----------------------------------------------------------------------

interface ClassStatsSectionProps {
  isUnauthorized: boolean;
  classStatsQuery: ReturnType<typeof useClassStats>;
  t: ReturnType<typeof useTranslations>;
}

const CLASS_BADGE: Record<string, { className: string; label: string }> = {
  ATTACK: {
    className: "bg-candy-red text-white border-candy-ink",
    label: "ATTACK",
  },
  DEFENSE: {
    className: "bg-candy-blue text-white border-candy-ink",
    label: "DEFENSE",
  },
};

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

function ClassStatsSection({
  isUnauthorized,
  classStatsQuery,
  t,
}: Readonly<ClassStatsSectionProps>) {
  const handleRetry = useCallback(() => {
    classStatsQuery.refetch();
  }, [classStatsQuery]);

  if (isUnauthorized) {
    return <MessageCard message={t("error.signinRequired")} />;
  }
  if (classStatsQuery.error) {
    return <QueryErrorCard onRetry={handleRetry} t={t} />;
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
                  className={`px-2.5 py-1 rounded-xl border-2 shadow-[2px_2px_0_0_#000] text-xs font-mono font-black ${CLASS_BADGE[best.classId]?.className ?? ""}`}
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
          {/* Attack Class Row */}
          <div className="bg-candy-cloud/70 border-2 border-candy-ink rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-candy-red text-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center">
                  <SwordsClashSvg size={18} />
                </div>
                <div>
                  <span className="px-2 py-0.5 rounded-lg bg-candy-red text-white border border-candy-ink text-[10px] font-mono font-black">
                    {t("classStats.class.ATTACK")}
                  </span>
                  <p className="text-[11px] font-mono font-bold text-candy-ink/70 mt-0.5">
                    {attack
                      ? `${attack.wins} / ${attack.plays} ${t("classStats.matchesWon")}`
                      : classStatsQuery.isLoading
                        ? "..."
                        : t("classStats.noClassMatches")}
                  </p>
                </div>
              </div>
              <span className="font-display font-black text-2xl text-candy-red">
                {attack
                  ? formatPercent(attack.winRate)
                  : classStatsQuery.isLoading
                    ? "--"
                    : "0%"}
              </span>
            </div>

            {/* Winrate Progress Meter */}
            <div className="w-full h-3 bg-white border-2 border-candy-ink rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-candy-red rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, attack ? attack.winRate * 100 : 0))}%`,
                }}
              />
            </div>
          </div>

          {/* Defense Class Row */}
          <div className="bg-candy-cloud/70 border-2 border-candy-ink rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-candy-blue text-white border-2 border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center">
                  <ShieldGuardianSvg size={18} />
                </div>
                <div>
                  <span className="px-2 py-0.5 rounded-lg bg-candy-blue text-white border border-candy-ink text-[10px] font-mono font-black">
                    {t("classStats.class.DEFENSE")}
                  </span>
                  <p className="text-[11px] font-mono font-bold text-candy-ink/70 mt-0.5">
                    {defense
                      ? `${defense.wins} / ${defense.plays} ${t("classStats.matchesWon")}`
                      : classStatsQuery.isLoading
                        ? "..."
                        : t("classStats.noClassMatches")}
                  </p>
                </div>
              </div>
              <span className="font-display font-black text-2xl text-candy-blue">
                {defense
                  ? formatPercent(defense.winRate)
                  : classStatsQuery.isLoading
                    ? "--"
                    : "0%"}
              </span>
            </div>

            {/* Winrate Progress Meter */}
            <div className="w-full h-3 bg-white border-2 border-candy-ink rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-candy-blue rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, defense ? defense.winRate * 100 : 0))}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Match History Section
// -----------------------------------------------------------------------

interface HistorySectionProps {
  isUnauthorized: boolean;
  historyQuery: ReturnType<typeof useMatchHistory>;
  categoryLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  locale: Locale;
  t: ReturnType<typeof useTranslations>;
}

function HistorySection({
  isUnauthorized,
  historyQuery,
  categoryLabels,
  statusLabels,
  locale,
  t,
}: Readonly<HistorySectionProps>) {
  const handleRetry = useCallback(() => {
    historyQuery.refetch();
  }, [historyQuery]);

  const handleLoadMore = useCallback(() => {
    historyQuery.fetchNextPage();
  }, [historyQuery]);

  if (isUnauthorized) {
    return <MessageCard message={t("error.signinRequired")} />;
  }
  if (historyQuery.isLoading) {
    return <HistorySkeleton />;
  }
  if (historyQuery.error) {
    return <QueryErrorCard onRetry={handleRetry} t={t} />;
  }
  if (historyQuery.items.length === 0) {
    return (
      <div className="bg-white border-[3px] border-candy-ink rounded-3xl p-8 md:p-12 text-center space-y-4 shadow-[6px_6px_0_0_#2B2D42] flex flex-col items-center">
        <div className="w-20 h-20 rounded-3xl bg-candy-yellow border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] flex items-center justify-center">
          <RetroGamepadEmptySvg size={48} />
        </div>
        <div className="space-y-1">
          <h4 className="font-display font-black text-xl text-candy-ink uppercase">
            {t("history.title")}
          </h4>
          <p className="font-mono text-xs font-bold text-candy-ink/70 max-w-sm mx-auto">
            {t("history.empty")}
          </p>
        </div>
        <Link
          href="/room/create"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-candy-mint text-white border-[2.5px] border-candy-ink font-display font-black text-sm uppercase tracking-wider shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0 transition-transform"
        >
          <SwordsClashSvg size={18} />
          {t("history.playNow")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {historyQuery.items.map((item) => {
        const isWon = item.status === "WON";
        const isEliminated = item.status === "ELIMINATED";

        return (
          <div
            key={item.matchId}
            className={`bg-white border-[3px] border-candy-ink rounded-3xl p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-[5px_5px_0_0_#2B2D42] transition-transform duration-200 hover:-translate-y-0.5 relative overflow-hidden ${
              isWon ? "ring-2 ring-candy-yellow/60" : ""
            }`}
          >
            {isWon && (
              <div className="absolute top-0 left-0 right-0 h-2 bg-candy-yellow" />
            )}

            {/* Left: Category & Meta */}
            <div className="flex items-center gap-4">
              <div
                className={`w-13 h-13 p-3 rounded-2xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#2B2D42] shrink-0 flex items-center justify-center ${
                  isWon
                    ? "bg-candy-yellow text-candy-ink"
                    : isEliminated
                      ? "bg-candy-cloud text-candy-ink"
                      : "bg-candy-cloud text-candy-ink"
                }`}
              >
                {isWon ? (
                  <CrownGoldSvg size={24} />
                ) : isEliminated ? (
                  <SkullDefeatSvg size={22} />
                ) : (
                  <FlagAbandonSvg size={22} />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-display font-black text-base md:text-lg text-candy-ink uppercase">
                    {categoryLabels[
                      item.roomCategory as keyof typeof categoryLabels
                    ] ?? item.roomCategory}
                  </h4>
                  {isWon && (
                    <span className="px-2 py-0.5 rounded-lg bg-candy-yellow text-candy-ink border border-candy-ink text-[10px] font-mono font-black uppercase shadow-[1px_1px_0_0_#000]">
                      TOP 1
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs font-bold text-candy-ink/65 mt-0.5">
                  {formatPlayedAt(item.playedAt, locale)}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] font-mono font-black uppercase text-candy-ink/70">
                  <span className="inline-flex items-center gap-1.5">
                    <PlayersGroupSvg size={14} />
                    {t("history.players")}: {item.playerCount}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClockTimerSvg size={14} />
                    {t("history.duration")}: {formatDuration(item.durationSec)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Score, ELO & Placement */}
            <div className="flex flex-wrap items-center gap-5 md:gap-8 w-full md:w-auto md:text-right md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-candy-ink/10">
              <div>
                <p className="text-[10px] text-candy-ink/65 font-mono font-black uppercase">
                  {t("history.score")}
                </p>
                <p className="font-mono text-lg font-black text-candy-blue">
                  {item.score.toLocaleString()} PTS
                </p>
                {item.eloDelta !== null && item.eloDelta !== undefined && (
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-black mt-0.5 border ${
                      item.eloDelta > 0
                        ? "bg-candy-mint/15 text-candy-mint border-candy-mint/40"
                        : item.eloDelta < 0
                          ? "bg-candy-red/15 text-candy-red border-candy-red/40"
                          : "bg-candy-cloud text-candy-ink/70 border-candy-ink/20"
                    }`}
                  >
                    {item.eloDelta > 0 ? `+${item.eloDelta}` : item.eloDelta}{" "}
                    ELO
                  </span>
                )}
              </div>

              <div>
                <p className="text-[10px] text-candy-ink/65 font-mono font-black uppercase">
                  {t("history.rank")}
                </p>
                <p className="font-display font-black text-lg text-candy-ink">
                  #{item.rank} / {item.playerCount}
                </p>
              </div>

              <div className="shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-black tracking-wide border-2 border-candy-ink shadow-[2.5px_2.5px_0_0_#2B2D42] ${getStatusBadgeClass(item.status)}`}
                >
                  {isWon && <CrownGoldSvg size={14} />}
                  {statusLabels[item.status]}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {historyQuery.hasNextPage ? (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={historyQuery.isFetchingNextPage}
          className="w-full h-12 bg-candy-blue text-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase tracking-wider shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0 transition-transform disabled:opacity-60 cursor-pointer"
        >
          {historyQuery.isFetchingNextPage ? "..." : t("history.loadMore")}
        </button>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------
// Main Profile Page Component
// -----------------------------------------------------------------------

export default function ProfilePage() {
  const { username, accessToken } = useSocketStore();
  const locale = useLocale() as Locale;
  const t = useTranslations("profile");
  const statsQuery = useProfileStats();
  const historyQuery = useMatchHistory({ limit: 20 });
  const classStatsQuery = useClassStats();

  const [copied, setCopied] = useState(false);

  const profile = statsQuery.data;
  const activeName = profile?.user.username || username || "Khách_Đấu_Thủ";
  const activeAvatar = getActiveAvatar(profile, avatars);
  const uid = profile?.user.id ?? null;

  const handleCopyUid = useCallback(() => {
    if (uid && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(uid)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          // ignore rejected clipboard writes
        });
    }
  }, [uid]);

  const categoryLabels: Record<string, string> = {
    ALL: t("roomCategory.ALL"),
    SCIENCE: t("roomCategory.SCIENCE"),
    HISTORY: t("roomCategory.HISTORY"),
    TECHNOLOGY: t("roomCategory.TECHNOLOGY"),
    CULTURE: t("roomCategory.CULTURE"),
    GEOGRAPHY: t("roomCategory.GEOGRAPHY"),
    SPORTS: t("roomCategory.SPORTS"),
    LOGIC: t("roomCategory.LOGIC"),
  };

  const statusLabels: Record<string, string> = {
    WON: t("status.WON"),
    ELIMINATED: t("status.ELIMINATED"),
    ABANDONED: t("status.ABANDONED"),
  };

  const isUnauthorized = !accessToken;

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none">
        {/* ============================================================= */}
        {/* Fighter Pass ID Hero Card                                     */}
        {/* ============================================================= */}
        <div className="relative bg-candy-yellow border-[3.5px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[7px_7px_0_0_#2B2D42] overflow-hidden flex flex-col md:flex-row items-center gap-6 md:gap-8">
          {/* Top Decorative Arcade Hologram Band */}
          <div className="absolute top-0 left-0 right-0 h-3.5 bg-candy-pink/30 z-0 flex items-center justify-around overflow-hidden">
            <div className="w-full h-full bg-[repeating-linear-gradient(45deg,#2B2D42_0,#2B2D42_10px,transparent_10px,transparent_20px)] opacity-10" />
          </div>

          {/* Fighter Avatar Portrait */}
          <div className="relative z-10 shrink-0 mt-1 md:mt-0">
            <div className="relative p-1 bg-white rounded-3xl border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42]">
              <SpriteFrame
                src={activeAvatar?.spritesheet}
                scale={0.5}
                width="96px"
                height="104px"
                frameClassName="w-28 h-28 md:w-32 md:h-32 rounded-2xl border-[2.5px] border-candy-ink bg-candy-cloud/40"
                skeletonSize="96px"
              />
              <div className="absolute -bottom-2.5 -right-2.5 w-9 h-9 rounded-full bg-candy-pink text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
                <LightningSpeedSvg size={18} />
              </div>
            </div>
          </div>

          {/* Fighter Info & Actions */}
          <div className="flex-1 text-center md:text-left space-y-3 z-10 relative w-full">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
              <span className="px-3 py-1 rounded-xl bg-candy-ink text-white text-[10px] font-mono font-black tracking-widest uppercase shadow-[2px_2px_0_0_#2B2D42]">
                {t("hero.fighterPass")}
              </span>
              <span className="px-3 py-1 rounded-xl bg-candy-blue border-2 border-candy-ink text-white text-xs font-mono font-black tracking-wider uppercase shadow-[2px_2px_0_0_#2B2D42]">
                {activeAvatar?.name ??
                  findAvatarBySeed(DEFAULT_AVATAR_SEED).name}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-center md:justify-start gap-3">
              <h2 className="font-display font-black text-2xl md:text-4xl tracking-wide text-candy-ink uppercase break-all">
                {activeName}
              </h2>
              {profile && (
                <RankBadge
                  tier={profile.user.rankTier ?? "SILVER"}
                  elo={profile.user.elo ?? 1200}
                  size="md"
                  showElo={true}
                  className="w-fit mx-auto md:mx-0 shadow-[2px_2px_0_0_#2B2D42]"
                />
              )}
            </div>

            {/* Sub-meta: Registered date, UID + Quick actions */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs font-mono font-black text-candy-ink/80 pt-1">
              <span className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42]">
                <ClockTimerSvg size={14} />
                {t("registeredToday")}
              </span>

              {uid && (
                <button
                  type="button"
                  onClick={handleCopyUid}
                  className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] text-candy-pink hover:bg-candy-pink hover:text-white transition-colors cursor-pointer"
                  title={t("hero.copyUid")}
                >
                  {copied ? (
                    <>
                      <CheckmarkCheckSvg size={14} />
                      <span>{t("hero.copied")}</span>
                    </>
                  ) : (
                    <>
                      <CopyClipboardSvg size={14} />
                      <span>UID: {uid}</span>
                    </>
                  )}
                </button>
              )}

              <Link
                href="/settings"
                className="flex items-center gap-1.5 bg-candy-mint text-white px-3 py-1 rounded-xl border border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0 transition-transform cursor-pointer"
              >
                <EditAvatarSvg size={14} />
                <span>{t("hero.editAvatar")}</span>
              </Link>
            </div>
          </div>
        </div>

        {/* ============================================================= */}
        {/* Survival Stats Dashboard                                      */}
        {/* ============================================================= */}
        <div className="space-y-4">
          <ProfileSectionHeader
            title={t("stats.title")}
            icon={<ProfileHeroBadgeSvg size={24} />}
          />
          <StatsSection
            isUnauthorized={isUnauthorized}
            statsQuery={statsQuery}
            profile={profile}
            t={t}
          />
        </div>

        {/* ============================================================= */}
        {/* Class & Cards Analytics Section                               */}
        {/* ============================================================= */}
        <div className="space-y-4 pt-2">
          <ProfileSectionHeader
            title={t("classStats.title")}
            icon={<FlameStreakSvg size={24} />}
          />
          <ClassStatsSection
            isUnauthorized={isUnauthorized}
            classStatsQuery={classStatsQuery}
            t={t}
          />
        </div>

        {/* ============================================================= */}
        {/* Match History Section                                         */}
        {/* ============================================================= */}
        <div className="space-y-4 pt-2">
          <ProfileSectionHeader
            title={t("history.title")}
            icon={<MedalRibbonSvg size={24} />}
          />
          <HistorySection
            isUnauthorized={isUnauthorized}
            historyQuery={historyQuery}
            categoryLabels={categoryLabels}
            statusLabels={statusLabels}
            locale={locale}
            t={t}
          />
        </div>
      </div>
    </AppShellLayout>
  );
}
