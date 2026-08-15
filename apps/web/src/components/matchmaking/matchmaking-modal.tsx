"use client";

import React, { useEffect, useState } from "react";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { Zap, Swords, X } from "lucide-react";
import { MiniGlyph } from "@/components/ui/mini-glyph";

export function MatchmakingModal() {
  const router = useRouter();
  const { matchmaking, leaveMatchmaking, clearMatchmakingMatched } =
    useSocketStore();

  const [displaySeconds, setDisplaySeconds] = useState(0);

  // Local ticker for smooth second counting
  useEffect(() => {
    if (!matchmaking.isQueued || !matchmaking.queuedAt) {
      setDisplaySeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - matchmaking.queuedAt!) / 1000);
      setDisplaySeconds(Math.max(0, elapsed));
    }, 1000);

    return () => clearInterval(interval);
  }, [matchmaking.isQueued, matchmaking.queuedAt]);

  // Handle match found auto-redirect
  useEffect(() => {
    if (matchmaking.matchedRoomCode) {
      const timer = setTimeout(() => {
        const targetCode = matchmaking.matchedRoomCode!;
        clearMatchmakingMatched();
        router.push(`/lobby/${targetCode}`);
      }, 1200);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [matchmaking.matchedRoomCode, clearMatchmakingMatched, router]);

  if (!matchmaking.isQueued && !matchmaking.matchedRoomCode) {
    return null;
  }

  const minutes = Math.floor(displaySeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (displaySeconds % 60).toString().padStart(2, "0");

  const isMatched = Boolean(matchmaking.matchedRoomCode);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white border-4 border-candy-ink rounded-3xl p-6 shadow-[8px_8px_0_0_#2B2D42] overflow-hidden">
        {/* Playful Top Badge */}
        <div className="flex justify-between items-center mb-4">
          <div className="inline-flex items-center gap-2 bg-candy-purple text-white font-display text-xs px-3 py-1.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#2B2D42]">
            <Zap className="w-4 h-4 text-candy-yellow fill-candy-yellow" />
            <span className="font-black uppercase tracking-wider">
              {isMatched ? "TRẬN ĐẤU ĐÃ TÌM THẤY!" : "ĐANG TÌM TRẬN ĐẤU..."}
            </span>
          </div>

          {!isMatched && (
            <button
              onClick={leaveMatchmaking}
              className="p-1.5 rounded-xl border-2 border-candy-ink bg-candy-cloud hover:bg-candy-red hover:text-white transition-colors cursor-pointer"
              title="Hủy tìm trận"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex flex-col items-center text-center my-6 gap-4">
          {isMatched ? (
            <div className="flex flex-col items-center gap-3 animate-bounce">
              <div className="w-20 h-20 bg-candy-mint text-white border-4 border-candy-ink rounded-2xl flex items-center justify-center shadow-[4px_4px_0_0_#2B2D42]">
                <Swords className="w-10 h-10" />
              </div>
              <h3 className="font-display font-black text-2xl text-candy-ink">
                SẴN SÀNG VÀO TRẬN!
              </h3>
              <p className="font-display text-xs text-candy-slate font-bold">
                Phòng: {matchmaking.matchedRoomCode} • Đang chuyển hướng...
              </p>
            </div>
          ) : (
            <>
              {/* Animated Radar Circle */}
              <div className="relative flex items-center justify-center w-28 h-28">
                <div className="absolute inset-0 rounded-full border-4 border-dashed border-candy-pink animate-[spin_8s_linear_infinite]" />
                <div className="absolute inset-3 rounded-full bg-candy-yellow/20 animate-ping opacity-60" />
                <div className="relative w-20 h-20 bg-candy-pink text-white border-4 border-candy-ink rounded-full flex items-center justify-center shadow-[3px_3px_0_0_#2B2D42]">
                  <MiniGlyph variant="target" className="w-9 h-9" />
                </div>
              </div>

              {/* Timer Display */}
              <div>
                <div className="font-display font-black text-4xl tracking-widest text-candy-ink">
                  {minutes}:{seconds}
                </div>
                <div className="font-display text-xs text-candy-slate font-bold mt-1">
                  Ước tính: ~00:
                  {matchmaking.estimatedWaitSeconds
                    ? matchmaking.estimatedWaitSeconds
                        .toString()
                        .padStart(2, "0")
                    : "30"}
                </div>
              </div>

              {/* Players in Queue Indicator */}
              <div className="w-full bg-[#FFF8E7] border-3 border-candy-ink rounded-2xl p-3 shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between text-xs font-display">
                <span className="text-candy-slate font-bold flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-candy-mint animate-pulse inline-block" />
                  Người đang tìm trận:
                </span>
                <span className="font-black text-candy-ink bg-white px-2.5 py-0.5 border-2 border-candy-ink rounded-lg">
                  {Math.max(1, matchmaking.playersInQueue)} người
                </span>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        {!isMatched && (
          <div className="mt-2">
            <button
              onClick={leaveMatchmaking}
              className="w-full py-3 bg-white hover:bg-candy-red hover:text-white text-candy-ink border-3 border-candy-ink rounded-2xl font-display font-black text-sm uppercase shadow-[3px_3px_0_0_#2B2D42] hover:translate-y-[-1px] active:translate-y-[1px] transition-all cursor-pointer"
            >
              HỦY TÌM TRẬN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
