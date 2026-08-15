"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { RankTier } from "@arena/shared";
import { Shield, Award, Crown, Zap, Flame, Sparkles } from "lucide-react";

export interface RankBadgeProps {
  tier: RankTier;
  elo?: number;
  size?: "sm" | "md" | "lg";
  showElo?: boolean;
  showName?: boolean;
  className?: string;
}

const TIER_CONFIG: Record<
  RankTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    bgClass: string;
    borderClass: string;
    textClass: string;
    glowClass: string;
    badgeBg: string;
    colorHex: string;
  }
> = {
  BRONZE: {
    icon: Shield,
    bgClass: "bg-amber-950/40 text-amber-400",
    borderClass: "border-amber-700/60",
    textClass: "text-amber-300",
    glowClass: "shadow-[0_0_8px_rgba(180,83,9,0.3)]",
    badgeBg: "bg-gradient-to-br from-amber-800 to-amber-950",
    colorHex: "#cd7f32",
  },
  SILVER: {
    icon: Shield,
    bgClass: "bg-slate-800/60 text-slate-200",
    borderClass: "border-slate-400/50",
    textClass: "text-slate-200",
    glowClass: "shadow-[0_0_8px_rgba(148,163,184,0.3)]",
    badgeBg: "bg-gradient-to-br from-slate-500 to-slate-800",
    colorHex: "#c0c0c0",
  },
  GOLD: {
    icon: Award,
    bgClass: "bg-yellow-950/50 text-yellow-300",
    borderClass: "border-yellow-500/70",
    textClass: "text-yellow-300",
    glowClass: "shadow-[0_0_12px_rgba(234,179,8,0.4)]",
    badgeBg: "bg-gradient-to-br from-amber-400 to-yellow-600",
    colorHex: "#ffd700",
  },
  PLATINUM: {
    icon: Zap,
    bgClass: "bg-cyan-950/50 text-cyan-300",
    borderClass: "border-cyan-400/70",
    textClass: "text-cyan-300",
    glowClass: "shadow-[0_0_12px_rgba(6,182,212,0.4)]",
    badgeBg: "bg-gradient-to-br from-cyan-400 to-teal-700",
    colorHex: "#e5e4e2",
  },
  DIAMOND: {
    icon: Sparkles,
    bgClass: "bg-blue-950/50 text-blue-300",
    borderClass: "border-blue-400/70",
    textClass: "text-blue-300",
    glowClass: "shadow-[0_0_16px_rgba(59,130,246,0.45)]",
    badgeBg: "bg-gradient-to-br from-blue-400 to-indigo-700",
    colorHex: "#b9f2ff",
  },
  MASTER: {
    icon: Crown,
    bgClass: "bg-purple-950/50 text-purple-300",
    borderClass: "border-purple-500/70",
    textClass: "text-purple-300",
    glowClass: "shadow-[0_0_18px_rgba(168,85,247,0.5)]",
    badgeBg: "bg-gradient-to-br from-purple-400 to-fuchsia-800",
    colorHex: "#9370db",
  },
  GRANDMASTER: {
    icon: Flame,
    bgClass: "bg-rose-950/50 text-rose-300",
    borderClass: "border-rose-500/80 animate-pulse",
    textClass: "text-rose-300",
    glowClass: "shadow-[0_0_22px_rgba(244,63,94,0.6)]",
    badgeBg: "bg-gradient-to-br from-rose-500 via-red-600 to-amber-600",
    colorHex: "#ff0033",
  },
};

export const RankBadge: React.FC<RankBadgeProps> = ({
  tier,
  elo,
  size = "md",
  showElo = false,
  showName = true,
  className = "",
}) => {
  const t = useTranslations("rank");
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.SILVER;
  const Icon = config.icon;

  const tierKey = tier.toLowerCase() as Lowercase<RankTier>;
  const tierName = t(`tiers.${tierKey}` as Parameters<typeof t>[0]);

  const sizeClasses = {
    sm: {
      container: "px-2 py-0.5 text-xs gap-1.5 rounded-md",
      icon: "w-3.5 h-3.5",
      text: "text-xs font-semibold",
      eloText: "text-[10px] opacity-80",
    },
    md: {
      container: "px-2.5 py-1 text-sm gap-2 rounded-lg",
      icon: "w-4 h-4",
      text: "text-sm font-bold",
      eloText: "text-xs opacity-85",
    },
    lg: {
      container: "px-3.5 py-1.5 text-base gap-2.5 rounded-xl",
      icon: "w-5 h-5",
      text: "text-base font-extrabold tracking-wide",
      eloText: "text-xs font-medium opacity-90",
    },
  }[size];

  return (
    <div
      className={`inline-flex items-center backdrop-blur-md border ${config.bgClass} ${config.borderClass} ${config.glowClass} ${sizeClasses.container} ${className}`}
    >
      <div
        className={`flex items-center justify-center p-0.5 rounded ${config.textClass}`}
      >
        <Icon className={sizeClasses.icon} />
      </div>
      {showName && (
        <span className={`${config.textClass} ${sizeClasses.text}`}>
          {tierName}
        </span>
      )}
      {showElo && elo !== undefined && (
        <span
          className={`font-mono ${config.textClass} ${sizeClasses.eloText}`}
        >
          ({elo} {t("elo")})
        </span>
      )}
    </div>
  );
};
