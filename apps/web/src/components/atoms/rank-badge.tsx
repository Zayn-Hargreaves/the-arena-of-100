"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { RankTier } from "@arena/shared";
import { cn } from "@/lib/utils";

export interface RankBadgeProps {
  tier: RankTier;
  elo?: number;
  size?: "sm" | "md" | "lg";
  showElo?: boolean;
  showName?: boolean;
  className?: string;
}

// Custom Pure SVG Icons for Rank Tiers (No Lucide, No Emoji)
function BronzeTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 1.5L2.5 3.5V7.5C2.5 11.5 5 13.8 8 14.5C11 13.8 13.5 11.5 13.5 7.5V3.5L8 1.5Z"
        fill="#D97706"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 4L4.5 5.5V8C4.5 10.5 6 12 8 12.5C10 12 11.5 10.5 11.5 8V5.5L8 4Z"
        fill="#F59E0B"
      />
      <circle cx="8" cy="8" r="1.5" fill="#FEF3C7" />
    </svg>
  );
}

function SilverTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 1.5L2.5 3.5V7.5C2.5 11.5 5 13.8 8 14.5C11 13.8 13.5 11.5 13.5 7.5V3.5L8 1.5Z"
        fill="#94A3B8"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 4L4.5 5.5V8C4.5 10.5 6 12 8 12.5C10 12 11.5 10.5 11.5 8V5.5L8 4Z"
        fill="#CBD5E1"
      />
      <path
        d="M8 5.5L9 7.5H11L9.5 8.8L10 10.8L8 9.5L6 10.8L6.5 8.8L5 7.5H7L8 5.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function GoldTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 1.5L10 5.5L14.5 6.2L11.2 9.5L12 14L8 11.8L4 14L4.8 9.5L1.5 6.2L6 5.5L8 1.5Z"
        fill="#FFD000"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="#FFFFFF" />
    </svg>
  );
}

function PlatinumTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 1.5L13.5 4.5V11.5L8 14.5L2.5 11.5V4.5L8 1.5Z"
        fill="#2DD4BF"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 4L11.5 6V10L8 12L4.5 10V6L8 4Z"
        fill="#99F6E4"
        stroke="#115E59"
        strokeWidth="1"
      />
      <circle cx="8" cy="8" r="1.5" fill="#FFFFFF" />
    </svg>
  );
}

function DiamondTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 2L11 2L14.5 6L8 14.5L1.5 6L5 2Z"
        fill="#60A5FA"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M5 2L8 6L11 2M1.5 6H14.5M8 6L8 14.5"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
      <polygon points="5,2 8,6 11,2 8,3" fill="#BFDBFE" />
      <polygon points="1.5,6 8,6 8,14.5" fill="#93C5FD" opacity="0.6" />
    </svg>
  );
}

function MasterTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 12.5L1.5 5L5.5 8L8 2.5L10.5 8L14.5 5L13.5 12.5H2.5Z"
        fill="#C084FC"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect
        x="2"
        y="11.5"
        width="12"
        height="2.5"
        rx="1"
        fill="#9333EA"
        stroke="#2B2D42"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="7.5" r="1.2" fill="#FFFFFF" />
    </svg>
  );
}

function GrandmasterTierSvg({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 1C9.5 3 13 5 13 9C13 12 10.8 14.5 8 14.5C5.2 14.5 3 12 3 9C3 6.5 5 4.5 6 3.5C6 4.5 6.8 5.5 7.5 5.5C6.8 4.2 7 2.8 8 1Z"
        fill="#FB7185"
        stroke="#2B2D42"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8 7C9 8 10 9 10 10.5C10 11.8 9.1 13 8 13C6.9 13 6 11.8 6 10.5C6 9.5 7 8.5 8 7Z"
        fill="#FFE4E6"
      />
    </svg>
  );
}

const TIER_CONFIG: Record<
  RankTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    bgClass: string;
    borderClass: string;
    textClass: string;
    shadowClass: string;
    badgeBg: string;
    colorHex: string;
  }
> = {
  BRONZE: {
    icon: BronzeTierSvg,
    bgClass: "bg-amber-100/90 text-amber-950",
    borderClass: "border-candy-ink",
    textClass: "text-amber-900",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-amber-100",
    colorHex: "#cd7f32",
  },
  SILVER: {
    icon: SilverTierSvg,
    bgClass: "bg-slate-100 text-slate-800",
    borderClass: "border-candy-ink",
    textClass: "text-slate-800",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-slate-100",
    colorHex: "#c0c0c0",
  },
  GOLD: {
    icon: GoldTierSvg,
    bgClass: "bg-candy-yellow text-candy-ink",
    borderClass: "border-candy-ink",
    textClass: "text-candy-ink",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-candy-yellow",
    colorHex: "#ffd700",
  },
  PLATINUM: {
    icon: PlatinumTierSvg,
    bgClass: "bg-candy-mint text-candy-ink",
    borderClass: "border-candy-ink",
    textClass: "text-candy-ink",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-candy-mint",
    colorHex: "#2dd4bf",
  },
  DIAMOND: {
    icon: DiamondTierSvg,
    bgClass: "bg-sky-100 text-sky-950",
    borderClass: "border-candy-ink",
    textClass: "text-sky-900",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-sky-100",
    colorHex: "#60a5fa",
  },
  MASTER: {
    icon: MasterTierSvg,
    bgClass: "bg-purple-100 text-purple-950",
    borderClass: "border-candy-ink",
    textClass: "text-purple-900",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-purple-100",
    colorHex: "#c084fc",
  },
  GRANDMASTER: {
    icon: GrandmasterTierSvg,
    bgClass: "bg-candy-pink/30 text-candy-ink",
    borderClass: "border-candy-ink",
    textClass: "text-rose-950",
    shadowClass: "shadow-[1.5px_1.5px_0_0_#2B2D42]",
    badgeBg: "bg-candy-pink/30",
    colorHex: "#ff4370",
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
      container: "px-2 py-0.5 text-xs gap-1.5 rounded-lg border-[1.5px]",
      icon: "w-3.5 h-3.5 shrink-0",
      text: "text-xs font-black font-display tracking-tight",
      eloText: "text-[10px] font-mono font-black opacity-85",
    },
    md: {
      container: "px-2.5 py-1 text-sm gap-2 rounded-xl border-[2px]",
      icon: "w-4 h-4 shrink-0",
      text: "text-sm font-black font-display tracking-tight",
      eloText: "text-xs font-mono font-black opacity-90",
    },
    lg: {
      container: "px-3.5 py-1.5 text-base gap-2.5 rounded-2xl border-[2.5px]",
      icon: "w-5 h-5 shrink-0",
      text: "text-base font-black font-display tracking-wide",
      eloText: "text-xs font-mono font-black opacity-95",
    },
  }[size];

  return (
    <div
      className={cn(
        "inline-flex items-center select-none font-bold transition-all",
        config.bgClass,
        config.borderClass,
        config.shadowClass,
        sizeClasses.container,
        className,
      )}
    >
      <div className="flex items-center justify-center shrink-0">
        <Icon className={sizeClasses.icon} />
      </div>
      {showName && (
        <span className={cn(config.textClass, sizeClasses.text)}>
          {tierName}
        </span>
      )}
      {showElo && elo !== undefined && (
        <span className={cn(config.textClass, sizeClasses.eloText)}>
          ({elo} {t("elo")})
        </span>
      )}
    </div>
  );
};
