"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type ClassId } from "@arena/shared";

export interface ClassBadgeProps {
  classId: ClassId;
  variant?: "soft" | "strong";
  className?: string;
}

const CLASS_STYLES: Record<ClassId, { soft: string; strong: string }> = {
  ATTACK: {
    soft: "bg-candy-red/10 text-candy-red border-candy-red/40",
    strong: "bg-candy-red text-white border-candy-red",
  },
  DEFENSE: {
    soft: "bg-candy-mint/30 text-candy-ink border-candy-mint",
    strong: "bg-candy-mint text-candy-ink border-candy-mint",
  },
};

// `ClassBadge` — surfaces the player's class (Offensive /
// Defensive — ATTACK / DEFENSE enum identifiers) in the match UI.
// Spec §3.1 random server-side assignment per match — the
// badge is read-only after the `CLASS_ASSIGNED` event is
// applied. Display text is sourced from the i18n bundle under
// `Cards.classes.ATTACK` / `Cards.classes.DEFENSE`.
export function ClassBadge({
  classId,
  variant = "soft",
  className,
}: ClassBadgeProps) {
  const t = useTranslations("Cards");
  const styles = CLASS_STYLES[classId];
  return (
    <span
      data-class={classId}
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold",
        variant === "soft" ? styles.soft : styles.strong,
        className,
      )}
      aria-label={t(`classes.${classId}`)}
    >
      {t(`classes.${classId}`)}
    </span>
  );
}
