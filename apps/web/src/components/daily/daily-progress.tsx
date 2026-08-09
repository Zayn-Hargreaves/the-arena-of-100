"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface DailyProgressProps {
  index: number;
  total: number;
}

export function DailyProgress({ index, total }: Readonly<DailyProgressProps>) {
  const t = useTranslations("daily");
  const filled = Math.max(0, Math.min(total, index));
  const cells = Array.from({ length: total }, (_, i) => i < filled);
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-label={t("progressLabel")}
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      {cells.map((on, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-full border border-candy-ink/30 ${
            on ? "bg-candy-mint" : "bg-white/60"
          }`}
        />
      ))}
    </div>
  );
}
