"use client";

import React from "react";
import { Gamepad } from "lucide-react";

interface LobbyCountdownOverlayProps {
  secondsRemaining: number;
  isStarting: boolean;
  isInGame: boolean;
}

export const LobbyCountdownOverlay: React.FC<LobbyCountdownOverlayProps> = ({
  secondsRemaining,
  isStarting,
  isInGame,
}) => {
  if (!isStarting && !isInGame) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="jelly-card p-8 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-4 animate-bounce-in">
        <div className="flex justify-center">
          <Gamepad className="w-16 h-16 text-candy-mint animate-bounce stroke-[2]" />
        </div>
        <h2 className="font-display font-black text-3xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
          {isInGame ? "ĐANG CHUYỂN TRẬN..." : "CHUẨN BỊ VÀO TRẬN!"}
        </h2>
        {isStarting && (
          <div className="flex items-center justify-center gap-2">
            <span className="font-mono text-5xl font-black text-candy-pink tabular-nums">
              {secondsRemaining}
            </span>
            <span className="font-display font-black text-xl text-candy-ink uppercase">
              giây
            </span>
          </div>
        )}
        <p className="font-sans text-sm font-bold text-candy-ink/70">
          {isInGame
            ? "Server đang đồng bộ trạng thái trận đấu..."
            : "Vui lòng không rời khỏi màn hình này"}
        </p>
      </div>
    </div>
  );
};
