import React from "react";
import { useTranslations } from "next-intl";
import { Activity, Cpu, Database } from "lucide-react";

const MAX_LOBBY_COUNT = 100;

interface AdminMetricsGridProps {
  metrics: {
    cpuUsage: number;
    memoryUsageMb: number;
    totalMemoryMb: number;
    roomCount: number;
  };
}

export function AdminMetricsGrid({ metrics }: AdminMetricsGridProps) {
  const t = useTranslations("admin");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* CPU Metric Card */}
      <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
        <div className="flex justify-between items-center">
          <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-candy-red" />
            {t("cpuCoreLoad")}
          </span>
          <span className="font-mono font-black text-sm text-candy-red">
            {metrics.cpuUsage.toFixed(1)}%
          </span>
        </div>

        {/* Custom 3D Progress Bar */}
        <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
          <div
            className="bg-candy-red border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
            style={{
              width: `${Math.max(0, Math.min(100, metrics.cpuUsage))}%`,
            }}
          />
        </div>

        <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
          {t("cpuCaption")}
        </span>
      </div>

      {/* Ram Metric Card */}
      <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
        <div className="flex justify-between items-center">
          <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-candy-blue" />
            {t("ramAllocation")}
          </span>
          <span className="font-mono font-black text-sm text-candy-blue">
            {metrics.memoryUsageMb} {t("units.mb")} /{" "}
            {metrics.totalMemoryMb || "?"} {t("units.mb")}
          </span>
        </div>

        {/* Custom 3D Progress Bar */}
        <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
          <div
            className="bg-candy-blue border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
            style={{
              width: `${
                metrics.totalMemoryMb > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (metrics.memoryUsageMb / metrics.totalMemoryMb) * 100,
                      ),
                    )
                  : 0
              }%`,
            }}
          />
        </div>

        <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
          {t("ramCaption")}
        </span>
      </div>

      {/* Database Connections */}
      <div className="bg-white border-[3px] border-candy-ink rounded-2xl p-5 space-y-4 shadow-[4px_4px_0_0_#2B2D42]">
        <div className="flex justify-between items-center">
          <span className="text-xs font-mono font-black uppercase text-candy-ink flex items-center gap-1.5">
            <Database className="w-4 h-4 text-candy-mint" />
            {t("activeLobbies")}
          </span>
          <span className="font-mono font-black text-sm text-candy-mint">
            {metrics.roomCount} {t("units.rooms")}
          </span>
        </div>

        {/* Custom 3D Progress Bar */}
        <div className="w-full bg-candy-cloud h-5 rounded-xl border-[2.5px] border-candy-ink overflow-hidden p-0.5 shadow-inner">
          <div
            className="bg-candy-mint border-r-[2px] border-candy-ink h-full rounded-lg shadow-[0_0_4px_rgba(0,0,0,0.15)]"
            style={{
              width: `${Math.max(0, Math.min(100, (metrics.roomCount / MAX_LOBBY_COUNT) * 100))}%`,
            }}
          />
        </div>

        <span className="block font-mono text-[10px] font-black text-candy-ink/50 uppercase">
          {t("lobbiesCaption")}
        </span>
      </div>
    </div>
  );
}
