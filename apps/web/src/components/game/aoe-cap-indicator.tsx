"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AOE_CAP_PER_ROUND } from "@arena/shared";
import { cn } from "@/lib/utils";

export interface AoeCapIndicatorProps {
  used: number;
  cap?: number;
  className?: string;
}

// `AoeCapIndicator` — AOE counter shown beside the card hand at
// milestone rounds. The cap is the constant 2 per (matchId,
// roundNo) from spec §3.3. The indicator turns red when the
// cap is exhausted so the player knows further AOE cards are
// gated.
export function AoeCapIndicator({
  used,
  cap = AOE_CAP_PER_ROUND,
  className,
}: AoeCapIndicatorProps) {
  const t = useTranslations("Cards");
  const exhausted = used >= cap;
  return (
    <span
      data-aoe-cap={cap}
      data-aoe-used={used}
      className={cn(
        "rounded border px-2 py-0.5 text-xs font-mono",
        exhausted
          ? "border-candy-red bg-candy-red/10 text-candy-red"
          : "border-candy-ink/30 bg-white text-candy-ink/70",
        className,
      )}
      title={exhausted ? t("aoeExhausted") : t("aoeCapHint", { used, cap })}
    >
      AOE {used}/{cap}
    </span>
  );
}
