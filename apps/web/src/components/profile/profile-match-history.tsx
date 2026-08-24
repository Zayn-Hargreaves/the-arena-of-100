"use client";

import React, { useCallback } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MessageCard } from "@/components/ui/message-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/routing";
import { formatDuration, formatPlayedAt } from "@/lib/formatters";
import type { useMatchHistory } from "@/hooks/use-match-history";
import type { Locale } from "@/i18n/routing";
import { QueryErrorCard } from "./profile-stat-common";
import {
  CrownGoldSvg,
  SkullDefeatSvg,
  FlagAbandonSvg,
  PlayersGroupSvg,
  ClockTimerSvg,
  RetroGamepadEmptySvg,
  SwordsClashSvg,
} from "./profile-icons";

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

const STATUS_BADGE_CLASSES: Record<string, string> = {
  WON: "bg-candy-mint text-white",
  ABANDONED: "bg-candy-yellow text-candy-ink",
  ELIMINATED: "bg-candy-red text-white",
};

function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status] ?? "bg-candy-cloud text-candy-ink";
}

interface ProfileMatchHistoryProps {
  isUnauthorized: boolean;
  historyQuery: ReturnType<typeof useMatchHistory>;
  categoryLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  locale: Locale;
}

export function ProfileMatchHistory({
  isUnauthorized,
  historyQuery,
  categoryLabels,
  statusLabels,
  locale,
}: Readonly<ProfileMatchHistoryProps>) {
  const t = useTranslations("profile");
  const format = useFormatter();

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
    return <QueryErrorCard onRetry={handleRetry} />;
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
                className={`w-[3.25rem] h-[3.25rem] p-3 rounded-2xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#2B2D42] shrink-0 flex items-center justify-center ${
                  isWon
                    ? "bg-candy-yellow text-candy-ink"
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
                      {t("history.top1")}
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
                  {format.number(item.score)} {t("history.pointsUnit")}
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
                  {statusLabels[item.status] ?? item.status}
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
