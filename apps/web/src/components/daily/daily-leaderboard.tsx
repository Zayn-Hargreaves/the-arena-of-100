"use client";

import React from "react";
import type { DailyLeaderboardItem } from "@/types/daily";
import { useLocale, useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { RankOneCrownGlyph, StreakGlyph, CardsGlyph } from "./daily-glyph";
import { DAILY_QUESTION_COUNT, isValidAvatarSeed } from "@arena/shared";
import { avatars, findAvatarBySeed } from "@/lib/avatars";

// Phase 3 — tier boundaries for the "cards played this week" cross-show.
// Common = light runner, Rare = active player, Epic = card-slinging shark.
// Mirrors the daily-challenge visual language so the badge sits cleanly
// next to the score column.
const CARDS_PLAYED_TIERS = {
  COMMON: { max: 5, className: "bg-slate-100 text-slate-600" },
  RARE: { max: 15, className: "bg-sky-100 text-sky-700" },
  EPIC: {
    max: Number.POSITIVE_INFINITY,
    className: "bg-amber-100 text-amber-700",
  },
} as const;

function cardsPlayedTier(count: number): keyof typeof CARDS_PLAYED_TIERS {
  if (count <= CARDS_PLAYED_TIERS.COMMON.max) return "COMMON";
  if (count <= CARDS_PLAYED_TIERS.RARE.max) return "RARE";
  return "EPIC";
}

interface DailyLeaderboardProps {
  items: DailyLeaderboardItem[];
}

export function DailyLeaderboard({ items }: Readonly<DailyLeaderboardProps>) {
  const t = useTranslations("daily");
  // Format against the active app locale rather than the browser's, so
  // the separators match the rest of the page (and stay deterministic
  // in tests / SSR).
  const locale = useLocale();

  if (items.length === 0) {
    return (
      <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl p-6 text-center">
        <p className="font-body text-sm font-semibold text-candy-ink/70">
          {t("leaderboard.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl overflow-hidden">
      <div className="bg-candy-ink text-white px-4 py-2 flex items-center justify-between text-[11px] font-mono font-black uppercase tracking-wider">
        <span>{t("leaderboard.topBanner")}</span>
        <span className="text-candy-yellow">{items.length} Đấu thủ</span>
      </div>

      <ol className="divide-y-[2px] divide-candy-ink/15">
        {items.slice(0, 10).map((item) => {
          const avatar = isValidAvatarSeed(item.avatar)
            ? findAvatarBySeed(item.avatar)
            : (avatars[0] ?? null);
          const tier = cardsPlayedTier(item.cardsPlayedThisWeek);
          const isFirst = item.rank === 1;
          const isSecond = item.rank === 2;
          const isThird = item.rank === 3;

          return (
            <li
              key={item.userId}
              className={`flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 transition-colors ${
                isFirst
                  ? "bg-amber-50/70 hover:bg-amber-100/60"
                  : isSecond
                    ? "bg-sky-50/50 hover:bg-sky-100/50"
                    : isThird
                      ? "bg-orange-50/40 hover:bg-orange-100/40"
                      : "hover:bg-candy-yellow/10"
              }`}
            >
              {/* Rank Badge */}
              <div className="w-7 sm:w-8 flex justify-center items-center shrink-0">
                {isFirst ? (
                  <span className="w-7 h-7 rounded-full bg-amber-400 border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] flex items-center justify-center text-candy-ink">
                    <RankOneCrownGlyph size={15} />
                  </span>
                ) : isSecond ? (
                  <span className="w-6 h-6 rounded-full bg-slate-200 border-[2px] border-candy-ink font-mono font-black text-xs text-candy-ink flex items-center justify-center">
                    #2
                  </span>
                ) : isThird ? (
                  <span className="w-6 h-6 rounded-full bg-amber-200 border-[2px] border-candy-ink font-mono font-black text-xs text-candy-ink flex items-center justify-center">
                    #3
                  </span>
                ) : (
                  <span className="font-mono font-black text-xs text-candy-ink/70">
                    #{item.rank}
                  </span>
                )}
              </div>

              {/* Avatar Frame */}
              <span
                className={`w-9 h-9 rounded-xl border-[2px] border-candy-ink flex items-center justify-center overflow-hidden shrink-0 shadow-[1px_1px_0_0_#2B2D42] ${
                  isFirst ? "bg-amber-100" : "bg-white"
                }`}
              >
                <SpriteFrame
                  src={avatar?.spritesheet}
                  scale={0.15}
                  width="28px"
                  height="30px"
                  frameClassName="w-9 h-9 rounded-xl border-0 shadow-none"
                  skeletonSize="20px"
                />
              </span>

              {/* Username */}
              <span className="font-display font-black text-xs sm:text-sm text-candy-ink truncate flex-1 min-w-0">
                {item.username}
              </span>

              {/* Score */}
              <span className="font-mono font-black text-xs sm:text-sm text-candy-pink shrink-0">
                {item.score.toLocaleString(locale)}
              </span>

              {/* Accuracy / Total */}
              <span className="font-mono text-[10px] text-candy-ink/60 inline-flex items-center gap-0.5 shrink-0 hidden sm:inline-flex">
                <MiniGlyph variant="speed" className="w-3 h-3" />
                {item.correctCount}/{DAILY_QUESTION_COUNT}
              </span>

              {/* Streak */}
              <span className="font-mono text-[10px] text-candy-ink/60 shrink-0 inline-flex items-center gap-0.5">
                <StreakGlyph className="text-candy-pink" size={10} />
                {item.streakAfter}
              </span>

              {/* Cards tier badge */}
              <span
                className={`shrink-0 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${CARDS_PLAYED_TIERS[tier].className}`}
                title={t("leaderboard.cardsThisWeek")}
                aria-label={t(`leaderboard.cardsTier.${tier}`)}
              >
                <CardsGlyph size={10} className="shrink-0" />
                {t("leaderboard.cardsLabel", {
                  count: item.cardsPlayedThisWeek,
                })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
