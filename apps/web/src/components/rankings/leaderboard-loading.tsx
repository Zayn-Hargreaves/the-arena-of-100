"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

export function LeaderboardLoading() {
  const t = useTranslations("rankings");

  return (
    <div role="status" aria-busy="true" className="space-y-6">
      <span className="sr-only">{t("loading")}</span>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 items-end">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-4"
          >
            <Skeleton
              variant="circle"
              width="96px"
              height="96px"
              className="mx-auto"
            />
            <Skeleton width="140px" height="18px" className="mx-auto" />
            <Skeleton width="90px" height="14px" className="mx-auto" />
          </div>
        ))}
      </div>
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[6px_6px_0_0_#2B2D42] rounded-3xl p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} height="56px" />
        ))}
      </div>
    </div>
  );
}
