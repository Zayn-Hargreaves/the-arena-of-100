"use client";

import React, { useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { resolveAvatar } from "@/lib/avatars";
import { formatPercent, formatResponseMs } from "@/lib/formatters";
import { RankBadge } from "@/components/atoms/rank-badge";
import type { LeaderboardEntry } from "@/hooks/use-leaderboard";
import { DEFAULT_RANK_TIER, DEFAULT_ELO } from "@arena/shared";
import {
  TrophyArcadeSvg,
  SpeedClockSvg,
  TargetAccuracySvg,
} from "./ranking-icons";

// Threshold above which the leaderboard table switches to row-virtualization
export const VIRTUALIZE_ROW_THRESHOLD = 30;

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
}

function LeaderboardRankCell({ rank }: Readonly<{ rank: number }>) {
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] text-xs">
      #{rank}
    </span>
  );
}

function LeaderboardPlayerCell({
  item,
  avatar,
  accuracyShortLabel,
}: Readonly<{
  item: LeaderboardEntry;
  avatar: ReturnType<typeof resolveAvatar>;
  accuracyShortLabel: string;
}>) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-white border-[2px] border-candy-ink shadow-[1.5px_1.5px_0_0_#2B2D42] flex items-center justify-center overflow-hidden shrink-0">
        <SpriteFrame
          src={avatar?.spritesheet}
          scale={0.18}
          width="35px"
          height="37px"
          frameClassName="w-10 h-10 rounded-xl border-0 shadow-none"
          skeletonSize="28px"
        />
      </div>
      <div className="min-w-0">
        <span className="font-display font-black text-candy-ink truncate block text-sm">
          {item.username}
        </span>
        <span className="text-[11px] font-mono font-black text-candy-ink/60 uppercase">
          {item.wins} W • {accuracyShortLabel} {formatPercent(item.accuracy)}
        </span>
      </div>
    </div>
  );
}

function LeaderboardEloCell({
  tier,
  elo,
}: Readonly<{
  tier?: LeaderboardEntry["rankTier"];
  elo?: number;
}>) {
  return (
    <RankBadge
      tier={tier ?? DEFAULT_RANK_TIER}
      elo={elo ?? DEFAULT_ELO}
      size="sm"
      showElo={true}
    />
  );
}

function LeaderboardScoreCell({
  totalScore,
  pointsUnit,
}: Readonly<{
  totalScore: string;
  pointsUnit: string;
}>) {
  return (
    <span className="bg-candy-pink/10 border border-candy-pink/30 px-2 py-0.5 rounded-lg text-candy-pink font-mono text-xs">
      {totalScore} {pointsUnit}
    </span>
  );
}

function LeaderboardSpeedCell({
  avgResponseMs,
}: Readonly<{ avgResponseMs: number }>) {
  return (
    <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-cyan-800 bg-cyan-50 border border-cyan-300 px-2 py-0.5 rounded-lg">
      <SpeedClockSvg size={12} />
      {formatResponseMs(avgResponseMs)}
    </div>
  );
}

function LeaderboardAccuracyCell({ accuracy }: Readonly<{ accuracy: number }>) {
  return (
    <div className="inline-flex items-center gap-1 font-mono text-xs font-bold text-rose-800 bg-rose-50 border border-rose-300 px-2 py-0.5 rounded-lg">
      <TargetAccuracySvg size={12} />
      {formatPercent(accuracy)}
    </div>
  );
}

interface ColumnContext {
  avatar: ReturnType<typeof resolveAvatar>;
  accuracyShortLabel: string;
  pointsUnit: string;
  format: ReturnType<typeof useFormatter>;
}

interface LeaderboardColumn {
  id: string;
  headerLabelKey: "rank" | "player" | "elo" | "score" | "speed" | "accuracy";
  virtualHeaderClassName: string;
  standardHeaderClassName: string;
  virtualCellClassName: string;
  standardCellClassName: string;
  renderCell: (
    item: LeaderboardEntry,
    context: ColumnContext,
  ) => React.ReactNode;
}

const LEADERBOARD_COLUMNS: readonly LeaderboardColumn[] = [
  {
    id: "rank",
    headerLabelKey: "rank",
    virtualHeaderClassName:
      "p-4 w-20 text-center border-r-[2px] border-candy-ink shrink-0",
    standardHeaderClassName:
      "p-4 w-20 text-center border-r-[2px] border-candy-ink",
    virtualCellClassName:
      "p-4 w-20 text-center font-mono font-black text-candy-ink border-r-[2px] border-candy-ink shrink-0",
    standardCellClassName:
      "p-4 text-center font-mono font-black text-candy-ink border-r-[2px] border-candy-ink",
    renderCell: (item) => <LeaderboardRankCell rank={item.rank} />,
  },
  {
    id: "player",
    headerLabelKey: "player",
    virtualHeaderClassName:
      "p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink",
    standardHeaderClassName: "p-4 border-r-[2px] border-candy-ink",
    virtualCellClassName: "p-4 flex-1 min-w-0 border-r-[2px] border-candy-ink",
    standardCellClassName: "p-4 border-r-[2px] border-candy-ink",
    renderCell: (item, { avatar, accuracyShortLabel }) => (
      <LeaderboardPlayerCell
        item={item}
        avatar={avatar}
        accuracyShortLabel={accuracyShortLabel}
      />
    ),
  },
  {
    id: "elo",
    headerLabelKey: "elo",
    virtualHeaderClassName:
      "p-4 w-44 text-center shrink-0 hidden md:block border-r-[2px] border-candy-ink",
    standardHeaderClassName:
      "p-4 text-center hidden md:table-cell w-44 border-r-[2px] border-candy-ink",
    virtualCellClassName:
      "p-4 w-44 hidden md:flex items-center justify-center shrink-0 border-r-[2px] border-candy-ink",
    standardCellClassName:
      "p-4 hidden md:table-cell text-center border-r-[2px] border-candy-ink",
    renderCell: (item) => (
      <LeaderboardEloCell tier={item.rankTier} elo={item.elo} />
    ),
  },
  {
    id: "score",
    headerLabelKey: "score",
    virtualHeaderClassName:
      "p-4 w-32 text-right shrink-0 border-r-[2px] border-candy-ink",
    standardHeaderClassName:
      "p-4 text-right w-32 border-r-[2px] border-candy-ink",
    virtualCellClassName:
      "p-4 w-32 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink shrink-0",
    standardCellClassName:
      "p-4 text-right font-mono font-black text-candy-pink border-r-[2px] border-candy-ink",
    renderCell: (item, { pointsUnit, format }) => (
      <LeaderboardScoreCell
        totalScore={format.number(item.totalScore)}
        pointsUnit={pointsUnit}
      />
    ),
  },
  {
    id: "speed",
    headerLabelKey: "speed",
    virtualHeaderClassName:
      "p-4 w-32 text-right shrink-0 hidden sm:block border-r-[2px] border-candy-ink",
    standardHeaderClassName:
      "p-4 text-right hidden sm:table-cell w-32 border-r-[2px] border-candy-ink",
    virtualCellClassName:
      "p-4 w-32 text-right hidden sm:flex shrink-0 items-center justify-end border-r-[2px] border-candy-ink",
    standardCellClassName:
      "p-4 text-right font-mono text-xs hidden sm:table-cell border-r-[2px] border-candy-ink",
    renderCell: (item) => (
      <LeaderboardSpeedCell avgResponseMs={item.avgResponseMs} />
    ),
  },
  {
    id: "accuracy",
    headerLabelKey: "accuracy",
    virtualHeaderClassName: "p-4 w-32 text-right shrink-0",
    standardHeaderClassName: "p-4 text-right w-32",
    virtualCellClassName: "p-4 w-32 text-right shrink-0",
    standardCellClassName: "p-4 text-right font-mono text-xs",
    renderCell: (item) => <LeaderboardAccuracyCell accuracy={item.accuracy} />,
  },
];

export function LeaderboardTable({ entries }: Readonly<LeaderboardTableProps>) {
  const t = useTranslations("rankings");
  const format = useFormatter();

  const shouldVirtualizeRows = entries.length > VIRTUALIZE_ROW_THRESHOLD;
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  if (entries.length === 0) return null;

  return (
    <div className="space-y-4 pt-6">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-candy-mint border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center">
          <TrophyArcadeSvg size={18} />
        </div>
        <h2 className="font-display font-black text-lg md:text-xl text-candy-ink tracking-wide uppercase">
          {t("tableTitle")}
        </h2>
      </div>

      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-3xl overflow-hidden">
        <div
          ref={parentRef}
          className="overflow-x-auto"
          style={
            shouldVirtualizeRows
              ? { maxHeight: "560px", overflowY: "auto" }
              : undefined
          }
        >
          {shouldVirtualizeRows ? (
            <div
              role="table"
              aria-label={t("tableTitle")}
              aria-rowcount={entries.length + 1}
              className="w-full text-left min-w-[640px]"
            >
              {/* Virtualized Header */}
              <div
                role="row"
                aria-rowindex={1}
                className="flex border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider sticky top-0 z-10"
              >
                {LEADERBOARD_COLUMNS.map((col) => (
                  <div
                    key={col.id}
                    role="columnheader"
                    className={col.virtualHeaderClassName}
                  >
                    {t(`columns.${col.headerLabelKey}`)}
                  </div>
                ))}
              </div>

              {/* Virtualized Body */}
              <div
                role="rowgroup"
                className="relative font-body text-sm text-candy-ink font-semibold"
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const item = entries[virtualRow.index];

                  const avatar = resolveAvatar(item.avatar);
                  const cellContext: ColumnContext = {
                    avatar,
                    accuracyShortLabel: t("accuracyShort"),
                    pointsUnit: t("pointsUnit"),
                    format,
                  };

                  return (
                    <div
                      key={virtualRow.key}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      role="row"
                      aria-rowindex={virtualRow.index + 2}
                      className="absolute left-0 top-0 w-full flex items-center hover:bg-candy-yellow/15 transition-colors duration-150 border-b-[2px] border-candy-ink bg-candy-cloud"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {LEADERBOARD_COLUMNS.map((col) => (
                        <div
                          key={col.id}
                          role="cell"
                          className={col.virtualCellClassName}
                        >
                          {col.renderCell(item, cellContext)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Standard Table */
            <table className="w-full border-collapse text-left min-w-[640px]">
              <thead>
                <tr className="border-b-[3px] border-candy-ink bg-candy-mint font-display font-black text-xs uppercase text-candy-ink tracking-wider">
                  {LEADERBOARD_COLUMNS.map((col) => (
                    <th key={col.id} className={col.standardHeaderClassName}>
                      {t(`columns.${col.headerLabelKey}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y-[2px] divide-candy-ink font-body text-sm text-candy-ink font-semibold">
                {entries.map((item) => {
                  const avatar = resolveAvatar(item.avatar);
                  const cellContext: ColumnContext = {
                    avatar,
                    accuracyShortLabel: t("accuracyShort"),
                    pointsUnit: t("pointsUnit"),
                    format,
                  };

                  return (
                    <tr
                      key={item.userId}
                      className="hover:bg-candy-yellow/15 transition-colors duration-150 bg-candy-cloud"
                    >
                      {LEADERBOARD_COLUMNS.map((col) => (
                        <td key={col.id} className={col.standardCellClassName}>
                          {col.renderCell(item, cellContext)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
