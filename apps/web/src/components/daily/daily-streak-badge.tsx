"use client";

import React from "react";
import { StreakGlyph } from "./daily-glyph";

interface DailyStreakBadgeProps {
  streak: number;
  label: string;
}

export function DailyStreakBadge({
  streak,
  label,
}: Readonly<DailyStreakBadgeProps>) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-candy-yellow/30 border-[2px] border-candy-ink rounded-full px-3 py-1">
      <StreakGlyph className="text-candy-pink" size={14} />
      <span className="font-display font-black text-sm text-candy-ink">
        {streak}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-candy-ink/70">
        {label}
      </span>
    </div>
  );
}
