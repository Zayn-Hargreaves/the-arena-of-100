"use client";

import React from "react";
import type { DailyLeaderboardItem } from "@/types/daily";
import { useLocale, useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { StreakGlyph } from "./daily-glyph";
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
      <p className="font-body text-sm font-semibold text-candy-ink/70">
        {t("leaderboard.empty")}
      </p>
    );
  }

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl overflow-hidden">
      <ol className="divide-y-[2px] divide-candy-ink/20">
        {items.slice(0, 10).map((item) => {
          const avatar = isValidAvatarSeed(item.avatar)
            ? findAvatarBySeed(item.avatar)
            : (avatars[0] ?? null);
          const tier = cardsPlayedTier(item.cardsPlayedThisWeek);
          return (
            <li
              key={item.userId}
              className="flex items-center gap-3 px-4 py-2 hover:bg-candy-yellow/10 transition-colors"
            >
              <span className="font-mono font-black text-sm text-candy-ink/80 w-8 text-center">
                #{item.rank}
              </span>
              <span className="w-9 h-9 rounded-lg bg-white border-[2px] border-candy-ink flex items-center justify-center overflow-hidden shrink-0">
                <SpriteFrame
                  src={avatar?.spritesheet}
                  scale={0.15}
                  width="28px"
                  height="30px"
                  frameClassName="w-9 h-9 rounded-lg border-0 shadow-none"
                  skeletonSize="20px"
                />
              </span>
              <span className="font-display font-black text-sm text-candy-ink truncate flex-1 min-w-0">
                {item.username}
              </span>
              <span className="font-mono font-black text-sm text-candy-pink shrink-0">
                {item.score.toLocaleString(locale)}
              </span>
              <span className="font-mono text-[10px] text-candy-ink/60 inline-flex items-center gap-0.5 shrink-0">
                <MiniGlyph variant="speed" className="w-3 h-3" />
                {/* The leaderboard payload carries `correctCount` with no
                    denominator, so the shared constant supplies it. Rows
                    that DO get a server-side total (result panel, share
                    card) use that instead. */}
                {item.correctCount}/{DAILY_QUESTION_COUNT}
              </span>
              <span className="font-mono text-[10px] text-candy-ink/60 shrink-0 inline-flex items-center gap-0.5">
                <StreakGlyph className="text-candy-pink" size={10} />
                {item.streakAfter}
              </span>
              {/* Phase 3 — cross-show "Most cards played this week".
                  Tier badge (Common / Rare / Epic) gives at-a-glance rank
                  without forcing a sort on the metric itself. */}
              <span
                className={`shrink-0 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${CARDS_PLAYED_TIERS[tier].className}`}
                title={t("leaderboard.cardsThisWeek")}
              >
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
