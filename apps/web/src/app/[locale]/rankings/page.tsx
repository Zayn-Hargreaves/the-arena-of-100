"use client";

import React from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trophy, Crown, Target, Zap, TrendingUp, Sparkles } from "lucide-react";

export default function RankingsPage() {
  // Static high-fidelity leaderboard mock data representing battle champions
  const leaders = [
    {
      rank: 1,
      name: "Zero_Cool",
      score: 9840,
      speed: "0.45s",
      accuracy: "98%",
      spritesheet: "/arena_of_100/nyakoshigure_spritesheet.webp",
    },
    {
      rank: 2,
      name: "Acid_Burn",
      score: 9510,
      speed: "0.52s",
      accuracy: "96%",
      spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
    },
    {
      rank: 3,
      name: "Cereal_Killer",
      score: 9230,
      speed: "0.61s",
      accuracy: "93%",
      spritesheet: "/arena_of_100/tux_spritesheet.webp",
    },
    {
      rank: 4,
      name: "Lord_Nikon",
      score: 8900,
      speed: "0.55s",
      accuracy: "91%",
      spritesheet: "/arena_of_100/clippit_spritesheet.webp",
    },
    {
      rank: 5,
      name: "Crash_Override",
      score: 8650,
      speed: "0.48s",
      accuracy: "90%",
      spritesheet: "/arena_of_100/dario_spritesheet.webp",
    },
    {
      rank: 6,
      name: "Phantom_Phreak",
      score: 8400,
      speed: "0.72s",
      accuracy: "89%",
      spritesheet: "/arena_of_100/dentist_spritesheet.webp",
    },
    {
      rank: 7,
      name: "The_Plague",
      score: 8120,
      speed: "0.68s",
      accuracy: "88%",
      spritesheet: "/arena_of_100/slavik_spritesheet.webp",
    },
    {
      rank: 8,
      name: "Razor_Blade",
      score: 7980,
      speed: "0.59s",
      accuracy: "87%",
      spritesheet: "/arena_of_100/yellingdario_spritesheet.webp",
    },
  ];

  const shouldVirtualizeRows = leaders.length > 200;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: Math.max(leaders.length - 3, 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 74,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-8 pt-2 pb-8 select-none relative z-10">
        {/* Floating background decorations */}
        <div className="absolute -top-10 -left-10 w-24 h-24 bg-candy-yellow/20 rounded-full blur-2xl pointer-events-none animate-pulse" />
        <div className="absolute top-1/3 -right-10 w-32 h-32 bg-candy-mint/20 rounded-full blur-2xl pointer-events-none" />

        {/* Header Block */}
        <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-full bg-candy-pink/5 -skew-x-12 translate-x-8" />
          <div className="relative space-y-1.5">
            <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink tracking-wider uppercase drop-shadow-[2px_2px_0_#FFE45E] flex items-center gap-2">
              <Trophy className="w-8 h-8 text-candy-yellow fill-candy-yellow stroke-candy-ink stroke-[2px]" />
              BẢNG VÀNG CAO THỦ
            </h1>
            <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85">
              Vinh danh những bộ óc siêu việt sống sót lâu nhất trong đấu trường
            </p>
          </div>
          <div className="shrink-0 flex gap-2">
            <div className="bg-candy-mint border-[2px] border-candy-ink px-4 py-2 rounded-xl text-candy-ink font-mono text-xs font-black shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              WEEKLY SEASON
            </div>
          </div>
        </div>

        {/* Podium section for Top 3 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 items-end">
          {/* Rank 2 (Left) */}
          <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-2 md:order-1 h-[270px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200">
            <div className="absolute top-0 left-0 right-0 h-2 bg-candy-mint/40" />
            <div className="relative mx-auto w-fit">
              <div className="w-24 h-24 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
                <AnimatedSprite
                  src={leaders[1].spritesheet}
                  row={0}
                  scale={0.4}
                  width="77px"
                  height="83px"
                />
              </div>
              <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-slate-300 text-candy-ink flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-xs">
                #2
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-black text-base text-candy-ink truncate tracking-wide">
                {leaders[1].name}
              </h3>
              <p className="font-mono text-xs font-black text-candy-ink/80 bg-slate-200/50 border border-slate-300 px-2 py-0.5 rounded-md inline-block">
                {leaders[1].score.toLocaleString()} PTS
              </p>
            </div>
            <div className="flex justify-center gap-4 text-xs font-mono text-candy-ink/90 border-t-[2px] border-dashed border-candy-ink/20 pt-3">
              <span className="font-black text-secondary">
                {leaders[1].accuracy} Acc
              </span>
              <span className="font-black text-tertiary">
                {leaders[1].speed}
              </span>
            </div>
          </div>

          {/* Rank 1 (Middle - Crown) */}
          <div className="bg-candy-yellow border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-1 md:order-2 h-[315px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200">
            <div className="absolute top-0 left-0 right-0 h-3 bg-candy-pink/20" />
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-candy-ink animate-bounce">
              <Crown className="w-8 h-8 fill-candy-ink stroke-white stroke-[2px]" />
            </div>
            <div className="relative mx-auto mt-2 w-fit">
              <div className="w-28 h-28 rounded-2xl bg-white border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
                <AnimatedSprite
                  src={leaders[0].spritesheet}
                  row={0}
                  scale={0.5}
                  width="96px"
                  height="104px"
                />
              </div>
              <div className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-candy-pink text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-sm">
                🏆
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-black text-lg text-candy-ink truncate tracking-wider">
                {leaders[0].name}
              </h3>
              <p className="font-mono text-sm font-black text-white bg-candy-ink px-3 py-0.5 rounded-full inline-block">
                {leaders[0].score.toLocaleString()} PTS
              </p>
            </div>
            <div className="flex justify-center gap-4 text-xs font-mono text-candy-ink border-t-[2px] border-dashed border-candy-ink/20 pt-3">
              <span className="font-black text-candy-pink">
                {leaders[0].accuracy} Acc
              </span>
              <span className="font-black text-candy-pink">
                {leaders[0].speed}
              </span>
            </div>
          </div>

          {/* Rank 3 (Right) */}
          <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 text-center space-y-4 rounded-3xl order-3 h-[250px] flex flex-col justify-center relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200">
            <div className="absolute top-0 left-0 right-0 h-2 bg-candy-mint/40" />
            <div className="relative mx-auto w-fit">
              <div className="w-20 h-20 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
                <AnimatedSprite
                  src={leaders[2].spritesheet}
                  row={0}
                  scale={0.35}
                  width="67px"
                  height="73px"
                />
              </div>
              <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center border-2 border-candy-ink shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-[10px]">
                #3
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="font-display font-black text-base text-candy-ink truncate tracking-wide">
                {leaders[2].name}
              </h3>
              <p className="font-mono text-xs font-black text-candy-ink/80 bg-amber-100/50 border border-amber-600/30 px-2 py-0.5 rounded-md inline-block">
                {leaders[2].score.toLocaleString()} PTS
              </p>
            </div>
            <div className="flex justify-center gap-4 text-xs font-mono text-candy-ink/90 border-t-[2px] border-dashed border-candy-ink/20 pt-3">
              <span className="font-black text-secondary">
                {leaders[2].accuracy} Acc
              </span>
              <span className="font-black text-tertiary">
                {leaders[2].speed}
              </span>
            </div>
          </div>
        </div>

        {/* Lower Leaderboard Rows */}
        <div className="space-y-4 pt-4">
          <h3 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-secondary" />
            TOP PHÂN HẠNG TIẾP THEO
          </h3>

          <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-2xl overflow-hidden">
            <div
              ref={parentRef}
              className="overflow-x-auto"
              style={
                shouldVirtualizeRows
                  ? { maxHeight: "560px", overflowY: "auto" }
                  : undefined
              }
            >
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider">
                    <th className="p-4 w-20 text-center border-r-[2px] border-candy-ink">
                      Hạng
                    </th>
                    <th className="p-4 border-r-[2px] border-candy-ink">
                      Đấu Thủ
                    </th>
                    <th className="p-4 text-right border-r-[2px] border-candy-ink">
                      Điểm Số
                    </th>
                    <th className="p-4 text-right hidden sm:table-cell border-r-[2px] border-candy-ink">
                      Phản Xạ
                    </th>
                    <th className="p-4 text-right">Tỉ Lệ Đúng</th>
                  </tr>
                </thead>
                {shouldVirtualizeRows ? (
                  <tbody
                    className="relative block font-body text-sm text-candy-ink font-semibold"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = leaders[virtualRow.index + 3];
                      if (!item) return null;

                      return (
                        <tr
                          key={virtualRow.key}
                          className="hover:bg-candy-yellow/10 transition-colors duration-150 border-b-[2px] border-candy-ink absolute left-0 top-0 w-full table"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <td className="p-4 w-20 text-center font-mono font-black text-candy-ink/80 border-r-[2px] border-candy-ink">
                            #{item.rank}
                          </td>
                          <td className="p-4 border-r-[2px] border-candy-ink">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
                                <AnimatedSprite
                                  src={item.spritesheet}
                                  row={0}
                                  scale={0.18}
                                  width="35px"
                                  height="37px"
                                />
                              </div>
                              <span className="font-display font-black truncate max-w-[120px] sm:max-w-none">
                                {item.name}
                              </span>
                            </div>
                          </td>
                          <td className="p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink">
                            {item.score.toLocaleString()}
                          </td>
                          <td className="p-4 text-right font-mono text-xs text-candy-ink/85 hidden sm:table-cell border-r-[2px] border-candy-ink">
                            <div className="inline-flex items-center gap-1">
                              <Zap className="w-3.5 h-3.5 text-tertiary" />
                              {item.speed}
                            </div>
                          </td>
                          <td className="p-4 text-right font-mono text-xs text-secondary font-black">
                            <div className="inline-flex items-center gap-1 justify-end w-full">
                              <Target className="w-3.5 h-3.5 text-candy-pink" />
                              {item.accuracy}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ) : (
                  <tbody className="divide-y-[2px] divide-candy-ink font-body text-sm text-candy-ink font-semibold">
                    {leaders.slice(3).map((item) => (
                      <tr
                        key={item.rank}
                        className="hover:bg-candy-yellow/10 transition-colors duration-150"
                      >
                        <td className="p-4 text-center font-mono font-black text-candy-ink/80 border-r-[2px] border-candy-ink">
                          #{item.rank}
                        </td>
                        <td className="p-4 flex items-center gap-3 border-r-[2px] border-candy-ink">
                          <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden">
                            <AnimatedSprite
                              src={item.spritesheet}
                              row={0}
                              scale={0.18}
                              width="35px"
                              height="37px"
                            />
                          </div>
                          <span className="font-display font-black truncate max-w-[120px] sm:max-w-none">
                            {item.name}
                          </span>
                        </td>
                        <td className="p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink">
                          {item.score.toLocaleString()}
                        </td>
                        <td className="p-4 text-right font-mono text-xs text-candy-ink/85 hidden sm:table-cell border-r-[2px] border-candy-ink">
                          <div className="inline-flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5 text-tertiary" />
                            {item.speed}
                          </div>
                        </td>
                        <td className="p-4 text-right font-mono text-xs text-secondary font-black">
                          <div className="inline-flex items-center gap-1 justify-end w-full">
                            <Target className="w-3.5 h-3.5 text-candy-pink" />
                            {item.accuracy}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
