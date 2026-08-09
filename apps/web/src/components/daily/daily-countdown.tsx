"use client";

import React from "react";
import { useDailyCountdown } from "@/hooks/use-daily-countdown";
import { CountdownGlyph } from "./daily-glyph";

interface DailyCountdownProps {
  targetIso: string;
  serverNowIso?: string;
  label: string;
}

export function DailyCountdown({
  targetIso,
  serverNowIso,
  label,
}: Readonly<DailyCountdownProps>) {
  const { display, isExpired } = useDailyCountdown(targetIso, serverNowIso);
  return (
    <span className="font-mono text-[11px] font-black uppercase tracking-wider text-candy-ink/80 bg-white/70 border border-candy-ink/20 px-2 py-1 rounded-md inline-flex items-center gap-1.5">
      <CountdownGlyph className="text-candy-ink/70" size={12} />
      <span>
        {label}:{" "}
        <span className="text-candy-pink">
          {isExpired ? "00:00:00" : display}
        </span>
      </span>
    </span>
  );
}
