import React from "react";
import { cn } from "@/lib/utils";

interface MiniGlyphProps {
  variant:
    | "stats"
    | "history"
    | "leaderboard"
    | "trend"
    | "settings"
    | "sound"
    | "controls"
    | "avatar"
    | "display"
    | "players"
    | "speed"
    | "target"
    | "streak"
    | "trophy"
    | "swords"
    | "shield"
    | "hourglass"
    | "rematch"
    | "home"
    | "zap"
    | "logout"
    | "alert"
    | "eye"
    | "close"
    | "arrowRight"
    | "search";
  className?: string;
}

const glyphPaths: Record<MiniGlyphProps["variant"], React.ReactNode> = {
  stats: <path d="M7 18h2V10H7v8Zm4 0h2V6h-2v12Zm4 0h2v-5h-2v5Z" />,
  history: <path d="M12 6v6l4 2M12 3a9 9 0 1 0 9 9" />,
  leaderboard: <path d="M6 18h12M8 18V9m4 9V6m4 12v-4" />,
  trophy: (
    <path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2M6 3h12v7a6 6 0 0 1-12 0V3Zm3 14h6m-3-3v7m-4 0h8" />
  ),
  trend: <path d="m6 15 4-4 3 3 5-5M14 9h4v4" />,
  settings: (
    <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 1 0 12 8.5Zm8 3.5-2 .8a6.9 6.9 0 0 1-.4 1l1.2 1.8-1.8 1.8-1.8-1.2a6.9 6.9 0 0 1-1 .4L12 20l-2.2-.9a6.9 6.9 0 0 1-1-.4L7 19.9l-1.8-1.8 1.2-1.8a6.9 6.9 0 0 1-.4-1L4 12l.9-2.2a6.9 6.9 0 0 1 .4-1L4.1 7l1.8-1.8 1.8 1.2a6.9 6.9 0 0 1 1-.4L12 4l2.2.9a6.9 6.9 0 0 1 1 .4L17 4.1 18.8 6l-1.2 1.8c.2.3.3.7.4 1L20 12Z" />
  ),
  sound: (
    <path d="M5 14h3l4 4V6L8 10H5v4Zm10-4a4 4 0 0 1 0 8M17.5 7a7 7 0 0 1 0 14" />
  ),
  controls: <path d="M7 8h10M7 12h6M7 16h10M17 11l2 2-2 2" />,
  avatar: <path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0" />,
  display: <path d="M5 7h14v9H5V7Zm4 13h6" />,
  streak: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  players: (
    <path d="M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 1a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5.5 18a3.5 3.5 0 0 1 7 0m1 0a3 3 0 0 1 6 0" />
  ),
  speed: <path d="M12 4 7 13h4l-1 7 7-10h-4l1-6Z" />,
  target: (
    <path d="M12 5v2m0 10v2m7-7h-2M7 12H5m11.95-4.95-1.4 1.4m-7.1 7.1-1.4 1.4m9.9 0-1.4-1.4m-7.1-7.1-1.4-1.4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
  ),
  swords: (
    <path d="m14.5 17.5 3 3 3.5-3.5-3-3m-6.5-6.5L3 19l2 2 11.5-8.5M14.5 6.5l3-3 3.5 3.5-3 3m-6.5 6.5L3 5l2-2 11.5 8.5" />
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  hourglass: (
    <path d="M5 22h14M5 2h14m-4 10a5 5 0 0 1 4 5v5H5v-5a5 5 0 0 1 4-5m0 0a5 5 0 0 1-4-5V2h14v5a5 5 0 0 1-4 5" />
  ),
  rematch: (
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8m0 0V3m0 5h5" />
  ),
  home: (
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" />
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  logout: (
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />
  ),
  alert: (
    <g>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </g>
  ),
  eye: (
    <g>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
  search: (
    <g>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </g>
  ),
};

export function MiniGlyph({ variant, className }: Readonly<MiniGlyphProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("w-5 h-5", className)}
      aria-hidden="true"
    >
      {glyphPaths[variant]}
    </svg>
  );
}
