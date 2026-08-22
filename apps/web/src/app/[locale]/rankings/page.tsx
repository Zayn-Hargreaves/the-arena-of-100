"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { MessageCard } from "@/components/ui/message-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { avatars, findAvatarBySeed } from "@/lib/avatars";
import { isValidAvatarSeed } from "@arena/shared";
import { formatPercent, formatResponseMs } from "@/lib/formatters";
import { reportError } from "@/lib/report-error";
import { RankBadge } from "@/components/atoms/rank-badge";
import {
  TrophyArcadeSvg,
  Top1CrownBadgeSvg,
  Top2SilverBadgeSvg,
  Top3BronzeBadgeSvg,
  SpeedClockSvg,
  TargetAccuracySvg,
  WeeklyPeriodSvg,
  AllTimePeriodSvg,
  FlashStarSvg,
} from "@/components/rankings/ranking-icons";
import {
  type LeaderboardEntry,
  type LeaderboardPeriod,
  useLeaderboard,
} from "@/hooks/use-leaderboard";
import { cn } from "@/lib/utils";

// Threshold above which the leaderboard table switches to row-virtualization
const VIRTUALIZE_ROW_THRESHOLD = 200;

interface PodiumStepProps {
  entry: LeaderboardEntry;
  rank: 1 | 2 | 3;
}

function ChampionPodiumCard({ entry, rank }: Readonly<PodiumStepProps>) {
  const t = useTranslations("rankings");
  const format = useFormatter();
  const avatar = isValidAvatarSeed(entry.avatar)
    ? findAvatarBySeed(entry.avatar)
    : (avatars[0] ?? null);

  const isFirst = rank === 1;
  const isSecond = rank === 2;
  const isThird = rank === 3;

  const config = {
    1: {
      cardBg: "bg-gradient-to-b from-candy-yellow via-amber-300 to-amber-400",
      accentBorder: "border-candy-ink",
      shadow: "shadow-[6px_6px_0_0_#2B2D42]",
      avatarRing: "border-[3px] border-candy-ink ring-4 ring-candy-yellow",
      pedestalBg:
        "bg-candy-yellow text-candy-ink border-t-[3px] border-candy-ink",
      heightClass: "md:h-[350px]",
      spriteScale: 0.52,
      spriteW: "98px",
      spriteH: "104px",
      pedestalLabel: t("podium.top1"),
      badgeIcon: <Top1CrownBadgeSvg size={28} />,
    },
    2: {
      cardBg: "bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200",
      accentBorder: "border-candy-ink",
      shadow: "shadow-[4px_4px_0_0_#2B2D42]",
      avatarRing: "border-[3px] border-candy-ink ring-4 ring-slate-300",
      pedestalBg: "bg-slate-200 text-slate-800 border-t-[3px] border-candy-ink",
      heightClass: "md:h-[305px]",
      spriteScale: 0.42,
      spriteW: "78px",
      spriteH: "84px",
      pedestalLabel: t("podium.top2"),
      badgeIcon: <Top2SilverBadgeSvg size={26} />,
    },
    3: {
      cardBg: "bg-gradient-to-b from-amber-50 via-amber-100 to-amber-200",
      accentBorder: "border-candy-ink",
      shadow: "shadow-[4px_4px_0_0_#2B2D42]",
      avatarRing: "border-[3px] border-candy-ink ring-4 ring-amber-300",
      pedestalBg: "bg-amber-200 text-amber-900 border-t-[3px] border-candy-ink",
      heightClass: "md:h-[285px]",
      spriteScale: 0.38,
      spriteW: "70px",
      spriteH: "76px",
      pedestalLabel: t("podium.top3"),
      badgeIcon: <Top3BronzeBadgeSvg size={26} />,
    },
  }[rank];

  return (
    <div
      className={cn(
        "relative rounded-3xl border-[3px] border-candy-ink flex flex-col justify-between overflow-hidden group transition-all duration-200 hover:-translate-y-1.5",
        config.cardBg,
        config.shadow,
        config.heightClass,
        isFirst && "order-1 md:order-2 z-20",
        isSecond && "order-2 md:order-1 z-10",
        isThird && "order-3 md:order-3 z-10",
      )}
    >
      {/* Glow highlight for Top 1 */}
      {isFirst && (
        <>
          <div className="absolute top-2 left-3 text-candy-ink/40 pointer-events-none">
            <FlashStarSvg size={18} />
          </div>
          <div className="absolute top-2 right-3 text-candy-ink/40 pointer-events-none">
            <FlashStarSvg size={18} />
          </div>
        </>
      )}

      {/* Main Info */}
      <div className="p-5 text-center space-y-3 pt-6">
        {/* Avatar Frame with Badge */}
        <div className="relative mx-auto w-fit">
          <div
            className={cn(
              "rounded-2xl overflow-hidden bg-white shadow-[2px_2px_0_0_#2B2D42]",
              config.avatarRing,
            )}
          >
            <SpriteFrame
              src={avatar?.spritesheet}
              scale={config.spriteScale}
              width={config.spriteW}
              height={config.spriteH}
              frameClassName={cn(
                "rounded-2xl",
                isFirst ? "w-24 h-24" : "w-20 h-20",
              )}
              skeletonSize="60px"
            />
          </div>

          {/* Badge attached to top-right of Avatar */}
          <div className="absolute -top-3.5 -right-3.5 drop-shadow-[2px_2px_0_#2B2D42]">
            {config.badgeIcon}
          </div>
        </div>

        {/* Username and Rank Tier */}
        <div className="space-y-1.5">
          <h3 className="font-display font-black text-lg text-candy-ink truncate tracking-tight max-w-[200px] mx-auto">
            {entry.username}
          </h3>

          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-black text-candy-ink bg-white/90 border-[1.5px] border-candy-ink px-2.5 py-0.5 rounded-lg shadow-[1px_1px_0_0_#2B2D42]">
              {format.number(entry.totalScore)} PTS
            </span>
            <RankBadge
              tier={entry.rankTier ?? "SILVER"}
              elo={entry.elo ?? 1200}
              size="sm"
              showElo={true}
            />
          </div>
        </div>

        {/* Stats Chips (Accuracy & Speed) */}
        <div className="flex justify-center items-center gap-2 pt-1">
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/80 border-[1.5px] border-candy-ink rounded-md font-mono text-[11px] font-black text-rose-700 shadow-[1px_1px_0_0_#2B2D42]">
            <TargetAccuracySvg size={13} />
            <span>{formatPercent(entry.accuracy)}</span>
          </div>
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/80 border-[1.5px] border-candy-ink rounded-md font-mono text-[11px] font-black text-cyan-800 shadow-[1px_1px_0_0_#2B2D42]">
            <SpeedClockSvg size={13} />
            <span>{formatResponseMs(entry.avgResponseMs)}</span>
          </div>
        </div>
      </div>

      {/* Pedestal Bottom Base */}
      <div
        className={cn(
          "w-full py-2.5 px-3 text-center font-display font-black text-xs uppercase tracking-wider select-none",
          config.pedestalBg,
        )}
      >
        {config.pedestalLabel}
      </div>
    </div>
  );
}

function LeaderboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 items-end">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-4"
          >
            <Skeleton
              variant="circle"
              width="96px"
              height="96px"
              className="mx-auto"
            />
            <Skeleton width="140px" height="18px" className="mx-auto" />
            <Skeleton width="90px" height="14px" className="mx-auto" />
          </div>
        ))}
      </div>
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-3xl p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height="56px" />
        ))}
      </div>
    </div>
  );
}

export default function RankingsPage() {
  const t = useTranslations("rankings");
  const format = useFormatter();
  const [period, setPeriod] = React.useState<LeaderboardPeriod>("weekly");
  const { data, error, isLoading, refetch } = useLeaderboard({
    period,
    limit: 50,
  });

  const items = data?.items ?? [];
  const topThree = items.slice(0, 3);
  const remaining = items.slice(3);
  const shouldVirtualizeRows = remaining.length > VIRTUALIZE_ROW_THRESHOLD;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: remaining.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const reportedMissingRef = React.useRef<Set<number>>(new Set());

  React.useEffect(() => {
    if (!shouldVirtualizeRows) return;
    for (const row of virtualRows) {
      if (!remaining[row.index] && !reportedMissingRef.current.has(row.index)) {
        reportedMissingRef.current.add(row.index);
        reportError(
          new Error("rankings: missing virtual row", {
            cause: {
              index: row.index,
              remaining: remaining.length,
              virtualCount: virtualRows.length,
            },
          }),
        );
      }
    }
  }, [shouldVirtualizeRows, virtualRows, remaining]);

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 pb-12 select-none relative z-10">
        {/* Subtle decorative glow */}
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-candy-yellow/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 -right-10 w-40 h-40 bg-candy-mint/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header Banner & Period Switcher */}
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
          <div className="shrink-0 flex items-center p-1.5 bg-candy-ink/5 border-[2.5px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] gap-1.5">
            <button
              type="button"
              aria-pressed={period === "weekly"}
              onClick={() => setPeriod("weekly")}
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
              onClick={() => setPeriod("all")}
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

        {/* Loading State */}
        {isLoading ? <LeaderboardLoading /> : null}

        {/* Error State */}
        {!isLoading && error ? (
          <MessageCard
            message={t("error.loadFailed")}
            actionLabel={t("error.retry")}
            onAction={() => refetch()}
            tone="error"
          />
        ) : null}

        {/* Empty State */}
        {!isLoading && !error && items.length === 0 ? (
          <MessageCard message={t("empty")} />
        ) : null}

        {/* Top 3 Hall of Fame Podium */}
        {!isLoading && !error && topThree.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 items-end">
              {topThree.length >= 2 ? (
                <ChampionPodiumCard entry={topThree[1]} rank={2} />
              ) : null}
              {topThree.length >= 1 ? (
                <ChampionPodiumCard entry={topThree[0]} rank={1} />
              ) : null}
              {topThree.length >= 3 ? (
                <ChampionPodiumCard entry={topThree[2]} rank={3} />
              ) : null}
            </div>

            {/* Remaining Leaderboard Table */}
            {remaining.length > 0 && (
              <div className="space-y-4 pt-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-candy-mint border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
                    <TrophyArcadeSvg size={18} />
                  </div>
                  <h2 className="font-display font-black text-lg md:text-xl text-candy-ink tracking-wide uppercase">
                    {t("tableTitle")}
                  </h2>
                </div>

                <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-3xl overflow-hidden">
                  <div
                    ref={parentRef}
                    className="overflow-x-auto"
                    style={
                      shouldVirtualizeRows
                        ? { maxHeight: "560px", overflowY: "auto" }
                        : undefined
                    }
                  >
                    {shouldVirtualizeRows ? (
                      <div
                        role="table"
                        aria-label={t("tableTitle")}
                        aria-rowcount={remaining.length + 1}
                        className="w-full text-left min-w-[640px]"
                      >
                        {/* Virtualized Header */}
                        <div
                          role="row"
                          aria-rowindex={1}
                          className="flex border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider sticky top-0 z-10"
                        >
                          <div
                            role="columnheader"
                            className="p-4 w-20 text-center border-r-[2px] border-candy-ink shrink-0"
                          >
                            {t("columns.rank")}
                          </div>
                          <div
                            role="columnheader"
                            className="p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink"
                          >
                            {t("columns.player")}
                          </div>
                          <div
                            role="columnheader"
                            className="p-4 w-44 text-center shrink-0 hidden md:block border-r-[2px] border-candy-ink"
                          >
                            {t("columns.elo")}
                          </div>
                          <div
                            role="columnheader"
                            className="p-4 w-32 text-right shrink-0 border-r-[2px] border-candy-ink"
                          >
                            {t("columns.score")}
                          </div>
                          <div
                            role="columnheader"
                            className="p-4 w-32 text-right shrink-0 hidden sm:block border-r-[2px] border-candy-ink"
                          >
                            {t("columns.speed")}
                          </div>
                          <div
                            role="columnheader"
                            className="p-4 w-32 text-right shrink-0"
                          >
                            {t("columns.accuracy")}
                          </div>
                        </div>

                        {/* Virtualized Body */}
                        <div
                          role="rowgroup"
                          className="relative font-body text-sm text-candy-ink font-semibold"
                          style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                          }}
                        >
                          {virtualRows.map((virtualRow) => {
                            const item = remaining[virtualRow.index];

                            if (!item) {
                              return (
                                <div
                                  key={virtualRow.key}
                                  role="row"
                                  aria-rowindex={virtualRow.index + 2}
                                  className="absolute left-0 top-0 w-full border-b-[2px] border-candy-ink bg-candy-yellow/10 px-4 py-5 text-xs font-mono font-black text-candy-ink/70"
                                  style={{
                                    transform: `translateY(${virtualRow.start}px)`,
                                  }}
                                >
                                  <div role="cell" className="w-full">
                                    {t("error.rowUnavailable")}
                                  </div>
                                </div>
                              );
                            }

                            const avatar = isValidAvatarSeed(item.avatar)
                              ? findAvatarBySeed(item.avatar)
                              : (avatars[0] ?? null);

                            return (
                              <div
                                key={virtualRow.key}
                                role="row"
                                aria-rowindex={virtualRow.index + 2}
                                className="absolute left-0 top-0 w-full flex items-center hover:bg-candy-yellow/15 transition-colors duration-150 border-b-[2px] border-candy-ink bg-candy-cloud"
                                style={{
                                  transform: `translateY(${virtualRow.start}px)`,
                                }}
                              >
                                <div
                                  role="cell"
                                  className="p-4 w-20 text-center font-mono font-black text-candy-ink border-r-[2px] border-candy-ink shrink-0"
                                >
                                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] text-xs">
                                    #{item.rank}
                                  </span>
                                </div>
                                <div
                                  role="cell"
                                  className="p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden shrink-0">
                                      <SpriteFrame
                                        src={avatar?.spritesheet}
                                        scale={0.18}
                                        width="35px"
                                        height="37px"
                                        frameClassName="w-10 h-10 rounded-xl border-0 shadow-none"
                                        skeletonSize="28px"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <span className="font-display font-black text-candy-ink truncate block text-sm">
                                        {item.username}
                                      </span>
                                      <span className="text-[11px] font-mono font-black text-candy-ink/60 uppercase">
                                        {item.wins} W • {t("accuracyShort")}{" "}
                                        {formatPercent(item.accuracy)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div
                                  role="cell"
                                  className="p-4 w-44 hidden md:flex items-center justify-center shrink-0 border-r-[2px] border-candy-ink"
                                >
                                  <RankBadge
                                    tier={item.rankTier ?? "SILVER"}
                                    elo={item.elo ?? 1200}
                                    size="sm"
                                    showElo={true}
                                  />
                                </div>
                                <div
                                  role="cell"
                                  className="p-4 w-32 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink shrink-0"
                                >
                                  <span className="bg-candy-pink/10 border border-candy-pink/30 px-2 py-0.5 rounded-lg text-candy-pink font-mono text-xs">
                                    {format.number(item.totalScore)} PTS
                                  </span>
                                </div>
                                <div
                                  role="cell"
                                  className="p-4 w-32 text-right hidden sm:flex shrink-0 items-center justify-end border-r-[2px] border-candy-ink"
                                >
                                  <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-cyan-800 bg-cyan-50 border border-cyan-300 px-2 py-0.5 rounded-lg">
                                    <SpeedClockSvg size={12} />
                                    {formatResponseMs(item.avgResponseMs)}
                                  </div>
                                </div>
                                <div
                                  role="cell"
                                  className="p-4 w-32 text-right shrink-0"
                                >
                                  <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-rose-800 bg-rose-50 border border-rose-300 px-2 py-0.5 rounded-lg">
                                    <TargetAccuracySvg size={12} />
                                    {formatPercent(item.accuracy)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      /* Standard Table */
                      <table className="w-full border-collapse text-left min-w-[640px]">
                        <thead>
                          <tr className="border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider">
                            <th className="p-4 w-20 text-center border-r-[2px] border-candy-ink">
                              {t("columns.rank")}
                            </th>
                            <th className="p-4 border-r-[2px] border-candy-ink">
                              {t("columns.player")}
                            </th>
                            <th className="p-4 text-center hidden md:table-cell w-44 border-r-[2px] border-candy-ink">
                              {t("columns.elo")}
                            </th>
                            <th className="p-4 text-right w-32 border-r-[2px] border-candy-ink">
                              {t("columns.score")}
                            </th>
                            <th className="p-4 text-right hidden sm:table-cell w-32 border-r-[2px] border-candy-ink">
                              {t("columns.speed")}
                            </th>
                            <th className="p-4 text-right w-32">
                              {t("columns.accuracy")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y-[2px] divide-candy-ink font-body text-sm text-candy-ink font-semibold">
                          {remaining.map((item) => {
                            const avatar = isValidAvatarSeed(item.avatar)
                              ? findAvatarBySeed(item.avatar)
                              : (avatars[0] ?? null);

                            return (
                              <tr
                                key={item.userId}
                                className="hover:bg-candy-yellow/15 transition-colors duration-150 bg-candy-cloud"
                              >
                                <td className="p-4 text-center font-mono font-black text-candy-ink border-r-[2px] border-candy-ink">
                                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] text-xs">
                                    #{item.rank}
                                  </span>
                                </td>
                                <td className="p-4 border-r-[2px] border-candy-ink">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden shrink-0">
                                      <SpriteFrame
                                        src={avatar?.spritesheet}
                                        scale={0.18}
                                        width="35px"
                                        height="37px"
                                        frameClassName="w-10 h-10 rounded-xl border-0 shadow-none"
                                        skeletonSize="28px"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <span className="font-display font-black text-candy-ink truncate block text-sm">
                                        {item.username}
                                      </span>
                                      <span className="text-[11px] font-mono font-black text-candy-ink/60 uppercase">
                                        {item.wins} W • {t("accuracyShort")}{" "}
                                        {formatPercent(item.accuracy)}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td className="p-4 hidden md:table-cell text-center border-r-[2px] border-candy-ink">
                                  <RankBadge
                                    tier={item.rankTier ?? "SILVER"}
                                    elo={item.elo ?? 1200}
                                    size="sm"
                                    showElo={true}
                                  />
                                </td>
                                <td className="p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink">
                                  <span className="bg-candy-pink/10 border border-candy-pink/30 px-2 py-0.5 rounded-lg text-candy-pink font-mono text-xs">
                                    {format.number(item.totalScore)} PTS
                                  </span>
                                </td>
                                <td className="p-4 text-right font-mono text-xs hidden sm:table-cell border-r-[2px] border-candy-ink">
                                  <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-cyan-800 bg-cyan-50 border border-cyan-300 px-2 py-0.5 rounded-lg">
                                    <SpeedClockSvg size={12} />
                                    {formatResponseMs(item.avgResponseMs)}
                                  </div>
                                </td>
                                <td className="p-4 text-right font-mono text-xs">
                                  <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-rose-800 bg-rose-50 border border-rose-300 px-2 py-0.5 rounded-lg">
                                    <TargetAccuracySvg size={12} />
                                    {formatPercent(item.accuracy)}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </AppShellLayout>
  );
}
