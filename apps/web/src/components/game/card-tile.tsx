"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  type CardId,
  type CardTier,
  type CardVariantKey,
  getCardDefinition,
} from "@arena/shared";

export interface CardTileProps {
  cardId: CardId;
  variant?: "default" | "selected" | "dimmed" | "spent";
  /** Cosmetic variant unlock (Phase 3). Swaps border/glow; no effect change. */
  cosmeticVariant?: CardVariantKey;
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

// Phase 3 — cosmetic variant overlay. Applied ON TOP of the tier style
// so the tier colour remains visible; the variant adds a glow/ring.
const COSMETIC_VARIANT_STYLES: Record<
  NonNullable<CardTileProps["cosmeticVariant"]>,
  string
> = {
  DEFAULT: "",
  NEON: "ring-2 ring-cyan-400 shadow-[0_0_12px_2px_rgba(34,211,238,0.5)]",
  GOLD: "ring-2 ring-amber-400 shadow-[0_0_12px_2px_rgba(251,191,36,0.5)]",
};

export function CardTile({
  cardId,
  variant = "default",
  cosmeticVariant = "DEFAULT",
  onClick,
  disabled,
  className,
}: CardTileProps) {
  const def = getCardDefinition(cardId);
  const t = useTranslations("Cards");
  // Phase 3 — localize the card name + description from the i18n
  // catalog. Falls back to the canonical English name (def.name) when
  // a translation key is missing — keeps untranslated locales from
  // showing an empty string while the i18n rollout is in progress.
  const localizedName = t.has(`byId.${cardId}.name`)
    ? t(`byId.${cardId}.name`)
    : def.name;
  const localizedDescription = t.has(`byId.${cardId}.description`)
    ? t(`byId.${cardId}.description`)
    : def.description;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-card-id={cardId}
      data-tier={def.tier}
      data-class={def.classId}
      data-cosmetic-variant={cosmeticVariant}
      className={cn(
        "rounded-lg border-2 p-3 text-left shadow-[3px_3px_0_0_#2B2D42] transition-all",
        TIER_STYLES[def.tier],
        VARIANT_STYLES[variant],
        COSMETIC_VARIANT_STYLES[cosmeticVariant],
        disabled && "cursor-not-allowed",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{localizedName}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            TIER_LABEL_CLASS[def.tier],
          )}
        >
          {t(`tiers.${def.tier}`)}
        </span>
      </div>
      <p className="mt-1 text-xs text-candy-ink/70">{localizedDescription}</p>
    </button>
  );
}

export const CARD_TIE_BORDER_STYLES = TIER_STYLES;
