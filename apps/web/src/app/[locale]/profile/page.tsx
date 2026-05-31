"use client";

import React, { useState, useEffect } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useSocketStore } from "@/stores/socket-store";
import {
  Gamepad2,
  Calendar,
  Swords,
  Zap,
  Target,
  Sparkles,
  Trophy,
  Activity,
} from "lucide-react";

export default function ProfilePage() {
  const { username } = useSocketStore();
  const activeName = username || "Khách_Đấu_Thủ";

  // Avatar states loaded from localStorage
  const [avatarName, setAvatarName] = useState("Zero_Cool");
  const [avatarSpritesheet, setAvatarSpritesheet] = useState(
    "/arena_of_100/nyakoshigure_spritesheet.webp",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedName = localStorage.getItem("avatarName");
    const savedSpritesheet = localStorage.getItem("avatarSpritesheet");
    if (savedName) setAvatarName(savedName);
    if (savedSpritesheet) setAvatarSpritesheet(savedSpritesheet);
  }, []);

  // Mock stats
  const stats = {
    matchesPlayed: 42,
    wins: 8,
    eliminations: 235,
    avgSpeed: "0.58s",
    winRate: "19%",
    survivalRate: "82%",
  };

  const history = [
    {
      id: "h1",
      date: "30/05/2026",
      mode: "Đấu Trường 1 vs 100",
      rank: 1,
      score: 3200,
      status: "WON",
    },
    {
      id: "h2",
      date: "29/05/2026",
      mode: "Phòng Công Cộng",
      rank: 14,
      score: 1450,
      status: "ELIMINATED",
    },
    {
      id: "h3",
      date: "28/05/2026",
      mode: "Chế Độ Siêu Tốc",
      rank: 3,
      score: 2600,
      status: "ELIMINATED",
    },
    {
      id: "h4",
      date: "25/05/2026",
      mode: "Trắc Nghiệm Sinh Tồn",
      rank: 28,
      score: 980,
      status: "ELIMINATED",
    },
  ];

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none">
        {/* Profile Card Header */}
        <div className="relative bg-candy-yellow border-[3px] border-candy-ink rounded-3xl p-6 md:p-8 shadow-[6px_6px_0_0_#2B2D42] overflow-hidden flex flex-col sm:flex-row items-center gap-6 md:gap-8">
          {/* Header background pattern */}
          <div className="absolute top-0 left-0 right-0 h-3 bg-candy-pink/30 z-0" />

          {/* Avatar card wrapper */}
          <div className="relative z-10 shrink-0">
            <div className="w-28 h-28 rounded-2xl bg-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
              <AnimatedSprite
                src={avatarSpritesheet}
                row={0}
                scale={0.5}
                width="96px"
                height="104px"
              />
            </div>
            <div className="absolute -bottom-3 -right-3 w-8 h-8 rounded-full bg-candy-pink text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#000] font-display font-black text-xs">
              ⚡
            </div>
          </div>

          {/* User Details */}
          <div className="flex-1 text-center sm:text-left space-y-2.5 z-10 relative">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <h2 className="font-display font-black text-2xl md:text-3xl tracking-wide text-candy-ink uppercase">
                {activeName}
              </h2>
              <span className="px-3.5 py-1 rounded-xl bg-candy-blue border-[2.5px] border-candy-ink text-white text-xs font-mono font-black tracking-wider uppercase w-fit mx-auto sm:mx-0 shadow-[2px_2px_0_0_#2B2D42]">
                {avatarName}
              </span>
            </div>
            <div className="flex justify-center sm:justify-start gap-4 text-xs font-mono font-black text-candy-ink/80">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-candy-blue" />
                ĐĂNG KÝ: HÔM NAY
              </span>
              <span>•</span>
              <span className="text-candy-pink">
                UID: G-{(activeName.length * 342).toString(16).toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="space-y-4">
          <h3 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-5 h-5 text-candy-pink" />
            CHỈ SỐ SINH TỒN
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Matches Played */}
            <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
              <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                TỔNG SỐ TRẬN
              </span>
              <div className="font-display font-black text-3xl text-candy-blue flex items-center justify-center gap-2">
                <Swords className="w-6 h-6 text-candy-blue" />
                {stats.matchesPlayed}
              </div>
            </div>

            {/* Wins */}
            <div className="bg-candy-yellow border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
              <span className="text-xs font-mono font-black uppercase text-candy-ink">
                VÔ ĐỊCH (WINS)
              </span>
              <div className="font-display font-black text-3xl text-candy-ink flex items-center justify-center gap-2">
                <Trophy className="w-6 h-6 text-candy-ink" />
                {stats.wins}
              </div>
            </div>

            {/* Response Time */}
            <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
              <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                PHẢN XẠ TRUNG BÌNH
              </span>
              <div className="font-display font-black text-3xl text-candy-mint flex items-center justify-center gap-2">
                <Zap className="w-6 h-6 text-candy-mint" />
                {stats.avgSpeed}
              </div>
            </div>

            {/* Accuracy */}
            <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-4 text-center space-y-1 shadow-[4px_4px_0_0_#2B2D42] hover:-translate-y-0.5 transition-transform">
              <span className="text-xs font-mono font-black uppercase text-candy-ink/75">
                TỶ LỆ CHÍNH XÁC
              </span>
              <div className="font-display font-black text-3xl text-candy-pink flex items-center justify-center gap-2">
                <Target className="w-6 h-6 text-candy-pink" />
                {stats.winRate}
              </div>
            </div>
          </div>
        </div>

        {/* Match History Row list */}
        <div className="space-y-4 pt-2">
          <h3 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-candy-blue" />
            LỊCH SỬ THI ĐẤU GẦN ĐÂY
          </h3>

          <div className="space-y-4">
            {history.map((h) => {
              const isWon = h.status === "WON";
              return (
                <div
                  key={h.id}
                  className={`bg-white border-[3px] border-candy-ink rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-[4px_4px_0_0_#2B2D42] transition-transform duration-200 hover:-translate-y-0.5 relative overflow-hidden`}
                >
                  {isWon && (
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-candy-yellow" />
                  )}

                  {/* Mode details */}
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-3 rounded-xl border-[2.5px] border-candy-ink shadow-[2.5px_2.5px_0_0_#000] shrink-0 ${isWon ? "bg-candy-yellow text-candy-ink" : "bg-candy-cloud text-candy-ink"}`}
                    >
                      {isWon ? (
                        <Trophy className="w-5 h-5 animate-pulse" />
                      ) : (
                        <Gamepad2 className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-display font-black text-base text-candy-ink uppercase">
                        {h.mode}
                      </h4>
                      <p className="font-mono text-xs font-black text-candy-ink/60">
                        {h.date}
                      </p>
                    </div>
                  </div>

                  {/* Score & Rank */}
                  <div className="flex flex-wrap items-center gap-6 md:gap-8 w-full md:w-auto md:text-right md:justify-end">
                    <div>
                      <p className="text-[10px] text-candy-ink/60 font-mono font-black uppercase">
                        ĐIỂM SỐ
                      </p>
                      <p className="font-mono text-base font-black text-candy-blue">
                        {h.score} PTS
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-candy-ink/60 font-mono font-black uppercase">
                        THỨ HẠNG
                      </p>
                      <p className="font-display font-black text-base text-candy-ink">
                        #{h.rank} / 100
                      </p>
                    </div>
                    <div className="shrink-0">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-black tracking-wide border-2 border-candy-ink shadow-[2.5px_2.5px_0_0_#000] ${
                          isWon
                            ? "bg-candy-mint text-white"
                            : "bg-candy-red text-white"
                        }`}
                      >
                        {isWon && <Sparkles className="w-3.5 h-3.5" />}
                        {isWon ? "CHIẾN THẮNG" : "BỊ LOẠI"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
