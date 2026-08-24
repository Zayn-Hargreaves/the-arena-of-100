"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { resolveAvatar } from "@/lib/avatars";
import { formatPercent, formatResponseMs } from "@/lib/formatters";
import { RankBadge } from "@/components/atoms/rank-badge";
import { DEFAULT_RANK_TIER, DEFAULT_ELO } from "@arena/shared";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/hooks/use-leaderboard";
import {
  Top1CrownBadgeSvg,
  Top2SilverBadgeSvg,
  Top3BronzeBadgeSvg,
  SpeedClockSvg,
  TargetAccuracySvg,
  FlashStarSvg,
} from "./ranking-icons";

export interface ChampionPodiumCardProps {
  entry: LeaderboardEntry;
  rank: 1 | 2 | 3;
}

export type PodiumStepProps = ChampionPodiumCardProps;

const PODIUM_STATIC_CONFIG = {
  1: {
    cardBg: "bg-gradient-to-b from-candy-yellow via-amber-300 to-amber-400",
    shadow: "shadow-[6px_6px_0_0_#2B2D42]",
    avatarRing: "border-[3px] border-candy-ink ring-4 ring-candy-yellow",
    pedestalBg:
      "bg-candy-yellow text-candy-ink border-t-[3px] border-candy-ink",
    heightClass: "md:h-[350px]",
    spriteScale: 0.52,
    spriteW: "98px",
    spriteH: "104px",
    translationKey: "podium.top1" as const,
    badgeIcon: <Top1CrownBadgeSvg size={28} />,
  },
  2: {
    cardBg: "bg-gradient-to-b from-slate-50 via-slate-100 to-slate-200",
    shadow: "shadow-[4px_4px_0_0_#2B2D42]",
    avatarRing: "border-[3px] border-candy-ink ring-4 ring-slate-300",
    pedestalBg: "bg-slate-200 text-slate-800 border-t-[3px] border-candy-ink",
    heightClass: "md:h-[305px]",
    spriteScale: 0.42,
    spriteW: "78px",
    spriteH: "84px",
    translationKey: "podium.top2" as const,
    badgeIcon: <Top2SilverBadgeSvg size={26} />,
  },
  3: {
    cardBg: "bg-gradient-to-b from-amber-50 via-amber-100 to-amber-200",
    shadow: "shadow-[4px_4px_0_0_#2B2D42]",
    avatarRing: "border-[3px] border-candy-ink ring-4 ring-amber-300",
    pedestalBg: "bg-amber-200 text-amber-900 border-t-[3px] border-candy-ink",
    heightClass: "md:h-[285px]",
    spriteScale: 0.38,
    spriteW: "70px",
    spriteH: "76px",
    translationKey: "podium.top3" as const,
    badgeIcon: <Top3BronzeBadgeSvg size={26} />,
  },
} as const;

export function ChampionPodiumCard({
  entry,
  rank,
}: Readonly<ChampionPodiumCardProps>) {
  const t = useTranslations("rankings");
  const format = useFormatter();
  const avatar = resolveAvatar(entry.avatar);

  const isFirst = rank === 1;
  const isSecond = rank === 2;
  const isThird = rank === 3;

  const staticConfig = PODIUM_STATIC_CONFIG[rank];
  const pedestalLabel = t(staticConfig.translationKey);

  return (
    <div
      className={cn(
        "relative rounded-3xl border-[3px] border-candy-ink flex flex-col justify-between overflow-hidden group transition-all duration-200 hover:-translate-y-1.5",
        staticConfig.cardBg,
        staticConfig.shadow,
        staticConfig.heightClass,
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
              staticConfig.avatarRing,
            )}
          >
            <SpriteFrame
              src={avatar?.spritesheet}
              scale={staticConfig.spriteScale}
              width={staticConfig.spriteW}
              height={staticConfig.spriteH}
              frameClassName={cn(
                "rounded-2xl",
                isFirst ? "w-24 h-24" : "w-20 h-20",
              )}
              skeletonSize="60px"
            />
          </div>

          {/* Badge attached to top-right of Avatar */}
          <div className="absolute -top-3.5 -right-3.5 drop-shadow-[2px_2px_0_#2B2D42]">
            {staticConfig.badgeIcon}
          </div>
        </div>

        {/* Username and Rank Tier */}
        <div className="space-y-1.5">
          <h3 className="font-display font-black text-lg text-candy-ink truncate tracking-tight max-w-[200px] mx-auto">
            {entry.username}
          </h3>

          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <span className="font-mono text-xs font-black text-candy-ink bg-white/90 border-[1.5px] border-candy-ink px-2.5 py-0.5 rounded-lg shadow-[1px_1px_0_0_#2B2D42]">
              {format.number(entry.totalScore)} {t("pointsUnit")}
            </span>
            <RankBadge
              tier={entry.rankTier ?? DEFAULT_RANK_TIER}
              elo={entry.elo ?? DEFAULT_ELO}
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
          staticConfig.pedestalBg,
        )}
      >
        {pedestalLabel}
      </div>
    </div>
  );
}
