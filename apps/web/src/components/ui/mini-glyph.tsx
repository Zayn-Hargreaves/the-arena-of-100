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
    | "streak";
  className?: string;
}

const glyphPaths: Record<MiniGlyphProps["variant"], React.ReactNode> = {
  stats: <path d="M7 18h2V10H7v8Zm4 0h2V6h-2v12Zm4 0h2v-5h-2v5Z" />,
  history: <path d="M12 6v6l4 2M12 3a9 9 0 1 0 9 9" />,
  leaderboard: <path d="M6 18h12M8 18V9m4 9V6m4 12v-4" />,
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
};

export function MiniGlyph({ variant, className }: Readonly<MiniGlyphProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
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
