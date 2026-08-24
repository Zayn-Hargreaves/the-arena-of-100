"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { useMatchHistory } from "@/hooks/use-match-history";
import { useClassStats, useProfileStats } from "@/hooks/use-profile-stats";
import { useSocketStore } from "@/stores/socket-store";
import type { Locale } from "@/i18n/routing";
import {
  ProfileHeroCard,
  ProfileStatsGrid,
  ProfileClassStats,
  ProfileMatchHistory,
  ProfileSectionHeader,
  ProfileHeroBadgeSvg,
  FlameStreakSvg,
  MedalRibbonSvg,
} from "@/components/profile";

export default function ProfilePage() {
  const { username, accessToken } = useSocketStore();
  const locale = useLocale() as Locale;
  const t = useTranslations("profile");
  const statsQuery = useProfileStats();
  const historyQuery = useMatchHistory({ limit: 20 });
  const classStatsQuery = useClassStats();

  const profile = statsQuery.data;
  const isUnauthorized = !accessToken;

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

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none">
        {/* Fighter Pass ID Hero Card */}
        <ProfileHeroCard
          profile={profile}
          username={username}
          locale={locale}
        />

        {/* Survival Stats Dashboard */}
        <div className="space-y-4">
          <ProfileSectionHeader
            title={t("stats.title")}
            icon={<ProfileHeroBadgeSvg size={24} />}
          />
          <ProfileStatsGrid
            isUnauthorized={isUnauthorized}
            statsQuery={statsQuery}
          />
        </div>

        {/* Class & Cards Analytics Section */}
        <div className="space-y-4 pt-2">
          <ProfileSectionHeader
            title={t("classStats.title")}
            icon={<FlameStreakSvg size={24} />}
          />
          <ProfileClassStats
            isUnauthorized={isUnauthorized}
            classStatsQuery={classStatsQuery}
          />
        </div>

        {/* Match History Section */}
        <div className="space-y-4 pt-2">
          <ProfileSectionHeader
            title={t("history.title")}
            icon={<MedalRibbonSvg size={24} />}
          />
          <ProfileMatchHistory
            isUnauthorized={isUnauthorized}
            historyQuery={historyQuery}
            categoryLabels={categoryLabels}
            statusLabels={statusLabels}
            locale={locale}
          />
        </div>
      </div>
    </AppShellLayout>
  );
}
