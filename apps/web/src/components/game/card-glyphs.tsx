"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { type CardId } from "@arena/shared";

export type CardGlyphVariant =
  | "cards"
  | "freeze"
  | "delay"
  | "burn"
  | "lock"
  | "fog"
  | "flag"
  | "reverse"
  | "distract"
  | "fiftyFifty"
  | "doubleScore"
  | "hint"
  | "shield"
  | "timeBonus"
  | "secondChance"
  | "deepRead"
  | "brainBurst"
  | "blocked"
  | "attack"
  | "defense"
  | "sparkle";

const GLYPH_PATHS: Record<CardGlyphVariant, React.ReactNode> = {
  cards: (
    <g>
      <rect
        x="3"
        y="5"
        width="12"
        height="16"
        rx="2"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <rect x="7" y="3" width="12" height="16" rx="2" />
      <path d="M11 9h4M11 13h4M11 17h2" />
    </g>
  ),
  freeze: (
    <g>
      <path d="M12 2v20M2 12h20M5 5l14 14M5 19L19 5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.25" />
      <path d="M9 3l3 2 3-2M9 21l3-2 3 2M3 9l2 3-2 3M21 9l-2 3 2 3" />
    </g>
  ),
  delay: (
    <g>
      <path d="M6 3h12M6 21h12M7 3v4l4 4-4 4v6M17 3v4l-4 4 4 4v6" />
      <path d="M10 17h4M9 7h6" />
    </g>
  ),
  burn: (
    <g>
      <path d="M8.5 14.5A4.5 4.5 0 0 0 13 19a4.5 4.5 0 0 0 4.5-4.5c0-2.5-2-4.5-3.5-6.5C13 10 12 11.5 11 11c0-2 2-4.5 1-7-3 3-5 7-3.5 10.5Z" />
      <path
        d="M12 16a2 2 0 0 0 2-2c0-1-.7-1.7-1.3-2.5-.4.5-.7 1-.7 1.5a1 1 0 0 0 0 3Z"
        fill="currentColor"
      />
    </g>
  ),
  lock: (
    <g>
      <rect x="5" y="10" width="14" height="11" rx="2.5" />
      <path d="M8 10V6.5a4 4 0 0 1 8 0V10" />
      <circle cx="12" cy="15.5" r="1.5" fill="currentColor" />
      <path d="M12 17v2" />
    </g>
  ),
  fog: (
    <g>
      <path d="M4 14.5c-.8-.5-1.5-1.5-1.5-2.7A3.8 3.8 0 0 1 6.3 8a4.5 4.5 0 0 1 8.4-1.2 4.2 4.2 0 0 1 5.3 4.2c0 1.2-.6 2.3-1.5 2.9" />
      <path d="M3 18h18M5 21h14M7 15h10" />
    </g>
  ),
  flag: (
    <g>
      <path d="M5 22V3M5 3l12 4-12 5" />
      <path d="M10 6.5l2 .7M9 8.5l4 1.3" />
    </g>
  ),
  reverse: (
    <g>
      <path d="M4 8h12a4 4 0 0 1 4 4v1M8 4L4 8l4 4" />
      <path d="M20 16H8a4 4 0 0 1-4-4v-1M16 20l4-4-4-4" />
    </g>
  ),
  distract: (
    <g>
      <path d="M13 2L3 14h8l-2 8 11-12h-8l3-8Z" />
      <circle cx="6" cy="4" r="1.5" fill="currentColor" />
      <circle cx="19" cy="19" r="1.5" fill="currentColor" />
    </g>
  ),
  fiftyFifty: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M8 16l8-8" strokeWidth="2.5" />
    </g>
  ),
  doubleScore: (
    <g>
      <path
        d="M12 2l2.6 6.2L21 9.2l-5 4.3 1.5 6.7L12 16.5l-5.5 3.7 1.5-6.7-5-4.3 6.4-1z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M12 7v6M9 10h6" strokeWidth="2" />
    </g>
  ),
  hint: (
    <g>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5V16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.5A6 6 0 0 0 12 3Z" />
      <path d="M12 7v3M10.5 9h3" />
    </g>
  ),
  shield: (
    <g>
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M12 6v12M8 10l4-2 4 2" />
    </g>
  ),
  timeBonus: (
    <g>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 2v3M9 2h6" />
      <path d="M12 9v4l3 2" />
      <path d="M17 5l2-2" />
    </g>
  ),
  secondChance: (
    <g>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </g>
  ),
  deepRead: (
    <g>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6" />
    </g>
  ),
  brainBurst: (
    <g>
      <path d="M9.5 2a4 4 0 0 0-4 4c0 .7.2 1.3.5 1.8A4 4 0 0 0 4 11.5c0 1.7 1 3.2 2.5 3.8.3 2.7 2.6 4.7 5.5 4.7" />
      <path d="M14.5 2a4 4 0 0 1 4 4c0 .7-.2 1.3-.5 1.8A4 4 0 0 1 20 11.5c0 1.7-1 3.2-2.5 3.8-.3 2.7-2.6 4.7-5.5 4.7" />
      <path d="M12 5v14M8 9h8M7 14h10" />
    </g>
  ),
  blocked: (
    <g>
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"
        fill="currentColor"
        fillOpacity="0.2"
      />
      <path d="M8 8l8 8M16 8l-8 8" strokeWidth="2.5" />
    </g>
  ),
  attack: (
    <g>
      <path d="m14.5 17.5 3 3 3.5-3.5-3-3m-6.5-6.5L3 19l2 2 11.5-8.5M14.5 6.5l3-3 3.5 3.5-3 3m-6.5 6.5L3 5l2-2 11.5 8.5" />
    </g>
  ),
  defense: (
    <g>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </g>
  ),
  sparkle: (
    <g>
      <path
        d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"
        fill="currentColor"
        fillOpacity="0.3"
      />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </g>
  ),
};

export interface CardGlyphProps {
  variant: CardGlyphVariant;
  className?: string;
  size?: number;
}

export function CardGlyph({
  variant,
  className,
  size = 20,
}: Readonly<CardGlyphProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {GLYPH_PATHS[variant] ?? GLYPH_PATHS.cards}
    </svg>
  );
}

/**
 * Maps a CardId (e.g. 'CB-1', 'TN-4') to its corresponding SVG Pop-Art Glyph.
 */
export function getGlyphForCardId(cardId: CardId | string): CardGlyphVariant {
  switch (cardId) {
    case "CB-1":
      return "freeze";
    case "CB-2":
      return "delay";
    case "CB-3":
      return "burn";
    case "CB-4":
      return "lock";
    case "CB-5":
      return "fog";
    case "CB-6":
      return "flag";
    case "CB-7":
      return "reverse";
    case "CB-8":
      return "distract";
    case "TN-1":
    case "TN-10":
      return "fiftyFifty";
    case "TN-2":
      return "doubleScore";
    case "TN-3":
      return "hint";
    case "TN-4":
      return "shield";
    case "TN-5":
    case "TN-8":
      return "timeBonus";
    case "TN-6":
      return "secondChance";
    case "TN-7":
      return "deepRead";
    case "TN-9":
      return "brainBurst";
    default:
      return "cards";
  }
}
