"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { MessageCard } from "@/components/ui/message-card";
import {
  type LeaderboardPeriod,
  useLeaderboard,
} from "@/hooks/use-leaderboard";
import {
  ChampionPodiumCard,
  RankingsHeader,
  LeaderboardLoading,
  LeaderboardTable,
} from "@/components/rankings";

export default function RankingsPage() {
  const t = useTranslations("rankings");
  const [period, setPeriod] = useState<LeaderboardPeriod>("weekly");
  const { data, error, isLoading, refetch } = useLeaderboard({
    period,
    limit: 100,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const topThree = useMemo(() => items.slice(0, 3), [items]);
  const remaining = useMemo(() => items.slice(3), [items]);

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 pb-12 select-none relative z-10">
        {/* Subtle decorative glow */}
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-candy-yellow/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 -right-10 w-40 h-40 bg-candy-mint/20 rounded-full blur-3xl pointer-events-none" />

        {/* Header Banner & Period Switcher */}
        <RankingsHeader period={period} onPeriodChange={setPeriod} />

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
            <LeaderboardTable entries={remaining} />
          </>
        ) : null}
      </div>
    </AppShellLayout>
  );
}
