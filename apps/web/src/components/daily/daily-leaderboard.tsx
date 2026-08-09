"use client";

import React from "react";
import type { DailyLeaderboardItem } from "@/types/daily";
import { useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { StreakGlyph } from "./daily-glyph";
import { isValidAvatarSeed } from "@arena/shared";
import { avatars, findAvatarBySeed } from "@/lib/avatars";

interface DailyLeaderboardProps {
  items: DailyLeaderboardItem[];
}

export function DailyLeaderboard({ items }: Readonly<DailyLeaderboardProps>) {
  const t = useTranslations("daily");

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
                {item.score.toLocaleString()}
              </span>
              <span className="font-mono text-[10px] text-candy-ink/60 inline-flex items-center gap-0.5 shrink-0">
                <MiniGlyph variant="speed" className="w-3 h-3" />
                {item.correctCount}/{5}
              </span>
              <span className="font-mono text-[10px] text-candy-ink/60 shrink-0 inline-flex items-center gap-0.5">
                <StreakGlyph className="text-candy-pink" size={10} />
                {item.streakAfter}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
