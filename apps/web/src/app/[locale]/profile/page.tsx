"use client";

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { DashboardSectionTitle } from "@/components/ui/dashboard-section-title";
import { MessageCard } from "@/components/ui/message-card";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { Spinner } from "@/components/ui/spinner";
import { avatars, findAvatarBySeed, type AvatarOption } from "@/lib/avatars";
import { DEFAULT_AVATAR_SEED, isValidAvatarSeed } from "@arena/shared";
import {
  formatDuration,
  formatPercent,
  formatPlayedAt,
  formatResponseMs,
} from "@/lib/formatters";
import { useMatchHistory } from "@/hooks/use-match-history";
import { useProfileStats } from "@/hooks/use-profile-stats";
import { useSocketStore } from "@/stores/socket-store";
import type { Locale } from "@/i18n/routing";

function StatValue({
  isLoading,
  value,
}: {
  isLoading: boolean;
  value: string | number;
}) {
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
// Fallback order:
//   1. profile.user.avatar (server-known selection)
//   2. first avatar in the catalog (only reached when catalog is empty
//      or the server value is invalid; ensures we always render something)
// We never throw here because the avatar is purely cosmetic — the page
// stays usable even if no avatar can be resolved.
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

export default function ProfilePage() {
  const { username, accessToken } = useSocketStore();
  const locale = useLocale() as Locale;
  const t = useTranslations("profile");
  const statsQuery = useProfileStats();
  const historyQuery = useMatchHistory({ limit: 20 });

  const profile = statsQuery.data;
  const activeName = profile?.user.username || username || "Khách_Đấu_Thủ";
  const activeAvatar = getActiveAvatar(profile, avatars);
  const categoryLabels = {
    ALL: t("roomCategory.ALL"),
    SCIENCE: t("roomCategory.SCIENCE"),
    HISTORY: t("roomCategory.HISTORY"),
    TECHNOLOGY: t("roomCategory.TECHNOLOGY"),
    CULTURE: t("roomCategory.CULTURE"),
  };
  const statusLabels = {
    WON: t("status.WON"),
    ELIMINATED: t("status.ELIMINATED"),
    ABANDONED: t("status.ABANDONED"),
  };

  const isUnauthorized = !accessToken;

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none">
        <div className="relative bg-candy-yellow border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] overflow-hidden flex flex-col sm:flex-row items-center gap-6 md:gap-8">
          <div className="absolute top-0 left-0 right-0 h-3 bg-candy-pink/30 z-0" />

          <div className="relative z-10 shrink-0">
            <SpriteFrame
              src={activeAvatar?.spritesheet}
              scale={0.5}
              width="96px"
              height="104px"
              frameClassName="w-28 h-28 rounded-2xl border-[3px]"
              skeletonSize="96px"
            />
            <div className="absolute -bottom-3 -right-3 w-8 h-8 rounded-full bg-candy-pink text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#000] font-display font-black text-xs">
              <MiniGlyph variant="speed" className="w-4 h-4" />
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left space-y-2.5 z-10 relative">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="font-display font-black text-2xl md:text-3xl tracking-wide text-candy-ink uppercase">
                {activeName}
              </h2>
              <span className="px-3.5 py-1 rounded-xl bg-candy-blue border-[2.5px] border-candy-ink text-white text-xs font-mono font-black tracking-wider uppercase w-fit mx-auto sm:mx-0 shadow-[2px_2px_0_0_#2B2D42]">
                {activeAvatar?.name ??
                  findAvatarBySeed(DEFAULT_AVATAR_SEED).name}
              </span>
            </div>
            <div className="flex justify-center sm:justify-start gap-4 text-xs font-mono font-black text-candy-ink/80">
              <span className="flex items-center gap-1 leading-5">
                <MiniGlyph
                  variant="history"
                  className="w-4 h-4 text-candy-blue"
                />
                {t("registeredToday")}
              </span>
              <span>•</span>
              <span className="text-candy-pink">
                UID: G-{(activeName.length * 342).toString(16).toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <DashboardSectionTitle title={t("stats.title")} glyph="stats" />

          {isUnauthorized ? (
            <MessageCard message={t("error.signinRequired")} />
          ) : statsQuery.error ? (
            <MessageCard
              message={t("error.loadFailed")}
              actionLabel={t("error.retry")}
              onAction={() => void statsQuery.refetch()}
              tone="error"
            />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
                  <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                    {t("stats.matches")}
                  </span>
                  <div className="font-display font-black text-3xl text-candy-blue flex items-center justify-center gap-2">
                    <MiniGlyph
                      variant="leaderboard"
                      className="w-6 h-6 text-candy-blue"
                    />
                    <StatValue
                      isLoading={statsQuery.isLoading}
                      value={profile?.stats.matchesPlayed ?? 0}
                    />
                  </div>
                </div>

                <div className="bg-candy-yellow border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
                  <span className="text-xs font-mono font-black uppercase text-candy-ink">
                    {t("stats.wins")}
                  </span>
                  <div className="font-display font-black text-3xl text-candy-ink flex items-center justify-center gap-2">
                    <MiniGlyph
                      variant="trend"
                      className="w-6 h-6 text-candy-ink"
                    />
                    <StatValue
                      isLoading={statsQuery.isLoading}
                      value={profile?.stats.wins ?? 0}
                    />
                  </div>
                </div>

                <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
                  <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                    {t("stats.averageResponse")}
                  </span>
                  <div className="font-display font-black text-3xl text-candy-mint flex items-center justify-center gap-2">
                    <MiniGlyph
                      variant="speed"
                      className="w-6 h-6 text-candy-mint"
                    />
                    <StatValue
                      isLoading={statsQuery.isLoading}
                      value={formatResponseMs(
                        profile?.stats.avgResponseMs ?? 0,
                      )}
                    />
                  </div>
                </div>

                <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
                  <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                    {t("stats.accuracy")}
                  </span>
                  <div className="font-display font-black text-3xl text-candy-pink flex items-center justify-center gap-2">
                    <MiniGlyph
                      variant="target"
                      className="w-6 h-6 text-candy-pink"
                    />
                    <StatValue
                      isLoading={statsQuery.isLoading}
                      value={formatPercent(profile?.stats.accuracy ?? 0)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: t("stats.footer.totalScore"),
                    value: (profile?.stats.totalScore ?? 0).toLocaleString(),
                  },
                  {
                    label: t("stats.footer.winRate"),
                    value: formatPercent(profile?.stats.winRate ?? 0),
                  },
                  {
                    label: t("stats.footer.survivalRate"),
                    value: formatPercent(profile?.stats.survivalRate ?? 0),
                  },
                  {
                    label: t("stats.footer.correctAnswers"),
                    value: (
                      profile?.stats.totalCorrectAnswers ?? 0
                    ).toLocaleString(),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="bg-candy-cloud border-[2.5px] border-candy-ink rounded-2xl p-3 shadow-[3px_3px_0_0_#2B2D42]"
                  >
                    <p className="text-[10px] font-mono font-black uppercase text-candy-ink/60">
                      {item.label}
                    </p>
                    <p className="font-display font-black text-lg text-candy-ink mt-1">
                      {statsQuery.isLoading ? "--" : item.value}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-4 pt-2">
          <DashboardSectionTitle title={t("history.title")} glyph="history" />

          {isUnauthorized ? (
            <MessageCard message={t("error.signinRequired")} />
          ) : historyQuery.isLoading ? (
            <HistorySkeleton />
          ) : historyQuery.error ? (
            <MessageCard
              message={t("error.loadFailed")}
              actionLabel={t("error.retry")}
              onAction={() => void historyQuery.refetch()}
              tone="error"
            />
          ) : historyQuery.items.length === 0 ? (
            <MessageCard message={t("history.empty")} />
          ) : (
            <div className="space-y-4">
              {historyQuery.items.map((item) => {
                const isWon = item.status === "WON";
                const isAbandoned = item.status === "ABANDONED";

                return (
                  <div
                    key={item.matchId}
                    className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-[4px_4px_0_0_#2B2D42] transition-transform duration-200 hover:-translate-y-0.5 relative overflow-hidden"
                  >
                    {isWon && (
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-candy-yellow" />
                    )}

                    <div className="flex items-center gap-4">
                      <div
                        className={`p-3 rounded-xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#000] shrink-0 ${
                          isWon
                            ? "bg-candy-yellow text-candy-ink"
                            : "bg-candy-cloud text-candy-ink"
                        }`}
                      >
                        <MiniGlyph
                          variant={isWon ? "trend" : "history"}
                          className="w-5 h-5"
                        />
                      </div>
                      <div>
                        <h4 className="font-display font-black text-base text-candy-ink uppercase">
                          {categoryLabels[
                            item.roomCategory as keyof typeof categoryLabels
                          ] ?? item.roomCategory}
                        </h4>
                        <p className="font-mono text-xs font-black text-candy-ink/60">
                          {formatPlayedAt(item.playedAt, locale)}
                        </p>
                        <div className="flex flex-wrap gap-3 mt-1 text-[10px] font-mono font-black uppercase text-candy-ink/60 leading-5">
                          <span className="inline-flex items-center gap-1">
                            <MiniGlyph
                              variant="players"
                              className="w-3.5 h-3.5"
                            />
                            {t("history.players")}: {item.playerCount}
                          </span>
                          <span>
                            {t("history.duration")}:{" "}
                            {formatDuration(item.durationSec)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6 md:gap-8 w-full md:w-auto md:text-right md:justify-end">
                      <div>
                        <p className="text-[10px] text-candy-ink/60 font-mono font-black uppercase">
                          {t("history.score")}
                        </p>
                        <p className="font-mono text-base font-black text-candy-blue">
                          {item.score.toLocaleString()} PTS
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-candy-ink/60 font-mono font-black uppercase">
                          {t("history.rank")}
                        </p>
                        <p className="font-display font-black text-base text-candy-ink">
                          #{item.rank} / {item.playerCount}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-black tracking-wide border-2 border-candy-ink shadow-[2.5px_2.5px_0_0_#000] ${
                            isWon
                              ? "bg-candy-mint text-white"
                              : isAbandoned
                                ? "bg-candy-yellow text-candy-ink"
                                : "bg-candy-red text-white"
                          }`}
                        >
                          {isWon && (
                            <MiniGlyph
                              variant="trend"
                              className="w-3.5 h-3.5"
                            />
                          )}
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
                  onClick={() => void historyQuery.fetchNextPage()}
                  disabled={historyQuery.isFetchingNextPage}
                  className="w-full h-12 bg-candy-blue text-white border-[3px] border-candy-ink rounded-2xl font-display font-black text-sm uppercase tracking-wide shadow-[4px_4px_0_0_#2B2D42] disabled:opacity-60"
                >
                  {historyQuery.isFetchingNextPage
                    ? "..."
                    : t("history.loadMore")}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </AppShellLayout>
  );
}
