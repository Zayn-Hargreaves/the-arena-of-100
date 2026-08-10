"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type CardId, type CardTier, getCardDefinition } from "@arena/shared";

export interface CardTileProps {
  cardId: CardId;
  variant?: "default" | "selected" | "dimmed" | "spent";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

// Visual tier → background colour. The card UI surfaces the
// tier as a coloured border so the player's hand is readable at
// a glance. Spec §3.3 enforces the 60/30/10 tier weights; the
// UI does NOT surface the underlying probabilities.
const TIER_STYLES: Record<CardTier, string> = {
  COMMON: "border-slate-400 bg-white",
  RARE: "border-sky-500 bg-sky-50",
  EPIC: "border-amber-500 bg-amber-50",
};

const TIER_LABEL_CLASS: Record<CardTier, string> = {
  COMMON: "text-slate-600",
  RARE: "text-sky-700",
  EPIC: "text-amber-700",
};

const VARIANT_STYLES: Record<NonNullable<CardTileProps["variant"]>, string> = {
  default: "hover:translate-y-[-2px] hover:shadow-[4px_4px_0_0_#2B2D42]",
  selected: "ring-2 ring-candy-pink translate-y-[2px]",
  dimmed: "opacity-50",
  spent: "opacity-30 cursor-not-allowed grayscale",
};

export function CardTile({
  cardId,
  variant = "default",
  onClick,
  disabled,
  className,
}: CardTileProps) {
  const def = getCardDefinition(cardId);
  const t = useTranslations("Cards");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-card-id={cardId}
      data-tier={def.tier}
      data-class={def.classId}
      className={cn(
        "rounded-lg border-2 p-3 text-left shadow-[3px_3px_0_0_#2B2D42] transition-all",
        TIER_STYLES[def.tier],
        VARIANT_STYLES[variant],
        disabled && "cursor-not-allowed",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{def.name}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            TIER_LABEL_CLASS[def.tier],
          )}
        >
          {t(`tiers.${def.tier}`)}
        </span>
      </div>
      <p className="mt-1 text-xs text-candy-ink/70">{def.description}</p>
    </button>
  );
}

export const CARD_TIE_BORDER_STYLES = TIER_STYLES;
