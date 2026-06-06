"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { DashboardSectionTitle } from "@/components/ui/dashboard-section-title";
import { MessageCard } from "@/components/ui/message-card";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { avatars, findAvatarBySeed } from "@/lib/avatars";
import { isValidAvatarSeed } from "@arena/shared";
import { formatPercent, formatResponseMs } from "@/lib/formatters";
import {
  type LeaderboardEntry,
  type LeaderboardPeriod,
  useLeaderboard,
} from "@/hooks/use-leaderboard";

function PodiumCard({
  entry,
  badge,
  className,
  accentClassName,
  spriteWidth,
  spriteHeight,
  spriteScale,
}: {
  entry: LeaderboardEntry;
  badge: React.ReactNode;
  className: string;
  accentClassName: string;
  spriteWidth: string;
  spriteHeight: string;
  spriteScale: number;
}) {
  const avatar = isValidAvatarSeed(entry.avatar)
    ? findAvatarBySeed(entry.avatar)
    : (avatars[0] ?? null);

  return (
    <div className={className}>
      <div className={`absolute top-0 left-0 right-0 ${accentClassName}`} />
      <div className="relative mx-auto w-fit">
        <SpriteFrame
          src={avatar?.spritesheet}
          scale={spriteScale}
          width={spriteWidth}
          height={spriteHeight}
          frameClassName="w-24 h-24 rounded-2xl"
          skeletonSize="72px"
        />
        <div className="absolute -top-3 -right-3 min-w-8 h-8 px-2 rounded-full bg-white text-candy-ink flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-xs">
          {badge}
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-display font-black text-base text-candy-ink truncate tracking-wide">
          {entry.username}
        </h3>
        <p className="font-mono text-xs font-black text-candy-ink/80 bg-white/70 border border-candy-ink/20 px-2 py-0.5 rounded-md inline-block">
          {entry.totalScore.toLocaleString()} PTS
        </p>
      </div>
      <div className="flex justify-center gap-4 text-xs font-mono text-candy-ink/90 border-t-[2px] border-dashed border-candy-ink/20 pt-3">
        <span className="font-black text-secondary inline-flex items-center gap-1 leading-5">
          <MiniGlyph variant="target" className="w-3.5 h-3.5" />
          {formatPercent(entry.accuracy)}
        </span>
        <span className="font-black text-tertiary inline-flex items-center gap-1 leading-5">
          <MiniGlyph variant="speed" className="w-3.5 h-3.5" />
          {formatResponseMs(entry.avgResponseMs)}
        </span>
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
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-2xl p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height="52px" />
        ))}
      </div>
    </div>
  );
}

export default function RankingsPage() {
  const t = useTranslations("rankings");
  const [period, setPeriod] = React.useState<LeaderboardPeriod>("weekly");
  const { data, error, isLoading, refetch } = useLeaderboard({
    period,
    limit: 50,
  });

  const items = data?.items ?? [];
  const topThree = items.slice(0, 3);
  const remaining = items.slice(3);
  const shouldVirtualizeRows = remaining.length > 200;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: remaining.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 pb-8 select-none relative z-10">
        <div className="absolute -top-10 -left-10 w-24 h-24 bg-candy-yellow/20 rounded-full blur-2xl pointer-events-none animate-pulse" />
        <div className="absolute top-1/3 -right-10 w-32 h-32 bg-candy-mint/20 rounded-full blur-2xl pointer-events-none" />

        <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-full bg-candy-pink/5 -skew-x-12 translate-x-8" />
          <div className="relative space-y-1.5">
            <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink tracking-wider uppercase drop-shadow-[2px_2px_0_#FFE45E] flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-candy-yellow">
                <MiniGlyph variant="leaderboard" className="w-6 h-6" />
              </span>
              {t("title")}
            </h1>
            <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85">
              {t("subtitle")}
            </p>
          </div>
          <div className="shrink-0 flex gap-2">
            {(["weekly", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`border-[2px] border-candy-ink px-4 py-2 rounded-xl font-mono text-xs font-black shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-1.5 transition-colors ${
                  period === key
                    ? "bg-candy-mint text-candy-ink"
                    : "bg-white text-candy-ink"
                }`}
              >
                {key === "weekly" ? (
                  <MiniGlyph variant="trend" className="w-4 h-4" />
                ) : null}
                {t(`period.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? <LeaderboardLoading /> : null}

        {!isLoading && error ? (
          <MessageCard
            message={t("error.loadFailed")}
            actionLabel={t("error.retry")}
            onAction={() => void refetch()}
            tone="error"
          />
        ) : null}

        {!isLoading && !error && items.length === 0 ? (
          <MessageCard message={t("empty")} />
        ) : null}

        {!isLoading && !error && topThree.length > 0 ? (
          <>
            {topThree.length === 3 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 items-end">
                <PodiumCard
                  entry={topThree[1]}
                  badge="#2"
                  className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-2 md:order-1 h-[270px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200"
                  accentClassName="h-2 bg-candy-mint/40"
                  spriteWidth="77px"
                  spriteHeight="83px"
                  spriteScale={0.4}
                />
                <div className="bg-candy-yellow border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-1 md:order-2 h-[315px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200">
                  <div className="absolute top-0 left-0 right-0 h-3 bg-candy-pink/20" />
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-candy-ink animate-bounce">
                    <MiniGlyph variant="leaderboard" className="w-8 h-8" />
                  </div>
                  <PodiumCard
                    entry={topThree[0]}
                    badge="🏆"
                    className="space-y-4 mt-2"
                    accentClassName="hidden"
                    spriteWidth="96px"
                    spriteHeight="104px"
                    spriteScale={0.5}
                  />
                </div>
                <PodiumCard
                  entry={topThree[2]}
                  badge="#3"
                  className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-3 h-[250px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200"
                  accentClassName="h-2 bg-candy-mint/40"
                  spriteWidth="67px"
                  spriteHeight="73px"
                  spriteScale={0.35}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                {topThree.map((entry) => (
                  <PodiumCard
                    key={entry.userId}
                    entry={entry}
                    badge={`#${entry.rank}`}
                    className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl flex flex-col justify-center relative overflow-hidden"
                    accentClassName="h-2 bg-candy-mint/40"
                    spriteWidth="77px"
                    spriteHeight="83px"
                    spriteScale={0.4}
                  />
                ))}
              </div>
            )}

            <div className="space-y-4 pt-4">
              <DashboardSectionTitle title={t("tableTitle")} glyph="trend" />

              <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-2xl overflow-hidden">
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
                    <div className="w-full text-left">
                      <div className="flex border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider sticky top-0 z-10">
                        <div className="p-4 w-20 text-center border-r-[2px] border-candy-ink shrink-0">
                          {t("columns.rank")}
                        </div>
                        <div className="p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink">
                          {t("columns.player")}
                        </div>
                        <div className="p-4 text-right shrink-0 border-r-[2px] border-candy-ink">
                          {t("columns.score")}
                        </div>
                        <div className="p-4 text-right shrink-0 hidden sm:block border-r-[2px] border-candy-ink">
                          {t("columns.speed")}
                        </div>
                        <div className="p-4 text-right shrink-0">
                          {t("columns.accuracy")}
                        </div>
                      </div>
                      <div
                        className="relative font-body text-sm text-candy-ink font-semibold"
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                      >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                          const item = remaining[virtualRow.index];

                          if (!item) {
                            return null;
                          }

                          const avatar = isValidAvatarSeed(item.avatar)
                            ? findAvatarBySeed(item.avatar)
                            : (avatars[0] ?? null);

                          return (
                            <div
                              key={virtualRow.key}
                              className="absolute left-0 top-0 w-full flex hover:bg-candy-yellow/10 transition-colors duration-150 border-b-[2px] border-candy-ink"
                              style={{
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <div className="p-4 w-20 text-center font-mono font-black text-candy-ink/80 border-r-[2px] border-candy-ink shrink-0">
                                #{item.rank}
                              </div>
                              <div className="p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink">
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
                                  <span className="font-display font-black truncate max-w-[120px] sm:max-w-none">
                                    {item.username}
                                  </span>
                                </div>
                              </div>
                              <div className="p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink shrink-0">
                                {item.totalScore.toLocaleString()}
                              </div>
                              <div className="p-4 text-right font-mono text-xs text-candy-ink/85 hidden sm:flex shrink-0 items-center border-r-[2px] border-candy-ink">
                                <div className="inline-flex items-center gap-1 leading-5">
                                  <MiniGlyph
                                    variant="speed"
                                    className="w-3.5 h-3.5 text-tertiary"
                                  />
                                  {formatResponseMs(item.avgResponseMs)}
                                </div>
                              </div>
                              <div className="p-4 text-right font-mono text-xs text-secondary font-black shrink-0">
                                <div className="inline-flex items-center gap-1 justify-end w-full leading-5">
                                  <MiniGlyph
                                    variant="target"
                                    className="w-3.5 h-3.5 text-candy-pink"
                                  />
                                  {formatPercent(item.accuracy)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider">
                          <th className="p-4 w-20 text-center border-r-[2px] border-candy-ink">
                            {t("columns.rank")}
                          </th>
                          <th className="p-4 border-r-[2px] border-candy-ink">
                            {t("columns.player")}
                          </th>
                          <th className="p-4 text-right border-r-[2px] border-candy-ink">
                            {t("columns.score")}
                          </th>
                          <th className="p-4 text-right hidden sm:table-cell border-r-[2px] border-candy-ink">
                            {t("columns.speed")}
                          </th>
                          <th className="p-4 text-right">
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
                              className="hover:bg-candy-yellow/10 transition-colors duration-150"
                            >
                              <td className="p-4 text-center font-mono font-black text-candy-ink/80 border-r-[2px] border-candy-ink">
                                #{item.rank}
                              </td>
                              <td className="p-4 flex items-center gap-3 border-r-[2px] border-candy-ink">
                                <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
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
                                  <span className="font-display font-black truncate block max-w-[120px] sm:max-w-none">
                                    {item.username}
                                  </span>
                                  <span className="text-[10px] font-mono font-black text-candy-ink/60 uppercase">
                                    {item.wins} W • {t("accuracyShort")}{" "}
                                    {formatPercent(item.accuracy)}
                                  </span>
                                </div>
                              </td>
                              <td className="p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink">
                                {item.totalScore.toLocaleString()}
                              </td>
                              <td className="p-4 text-right font-mono text-xs text-candy-ink/85 hidden sm:table-cell border-r-[2px] border-candy-ink">
                                <div className="inline-flex items-center gap-1 leading-5">
                                  <MiniGlyph
                                    variant="speed"
                                    className="w-3.5 h-3.5 text-tertiary"
                                  />
                                  {formatResponseMs(item.avgResponseMs)}
                                </div>
                              </td>
                              <td className="p-4 text-right font-mono text-xs text-secondary font-black">
                                <div className="inline-flex items-center gap-1 justify-end w-full leading-5">
                                  <MiniGlyph
                                    variant="target"
                                    className="w-3.5 h-3.5 text-candy-pink"
                                  />
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
          </>
        ) : null}
      </div>
    </AppShellLayout>
  );
}
