import React from "react";
import { useTranslations } from "next-intl";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { DailyStreakBadge } from "@/components/daily/daily-streak-badge";
import { DailyCountdown } from "@/components/daily/daily-countdown";
import type { DailySubmitResponse, DailyTodayResponse } from "@/types/daily";

interface DailyHeaderHeroProps {
  data?: DailyTodayResponse;
  result: DailySubmitResponse | null;
}

export function DailyHeaderHero({ data, result }: DailyHeaderHeroProps) {
  const t = useTranslations("daily");

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] p-5 sm:p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
      <div className="relative space-y-1">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-candy-pink shrink-0">
            <MiniGlyph variant="target" className="w-5 h-5" />
          </span>
          <h1 className="font-display font-black text-2xl md:text-3xl text-candy-ink tracking-wide uppercase">
            {t("title")}
          </h1>
        </div>
        <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85 sm:pl-[52px]">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2.5 items-center">
        {result || (data?.currentStreak != null && data.currentStreak > 0) ? (
          <DailyStreakBadge
            streak={result ? result.streakAfter : (data?.currentStreak ?? 0)}
            label={t("streak")}
          />
        ) : null}
        {data?.nextResetAt ? (
          <DailyCountdown
            targetIso={data.nextResetAt}
            serverNowIso={data.serverTime}
            label={t("nextReset")}
          />
        ) : null}
      </div>
    </div>
  );
}
