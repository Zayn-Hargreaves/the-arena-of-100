import React from "react";
import { useTranslations } from "next-intl";

interface DailyIntroCardProps {
  onStart: () => void;
}

export function DailyIntroCard({ onStart }: DailyIntroCardProps) {
  const t = useTranslations("daily");

  return (
    <div className="bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-2xl space-y-4">
      <p className="font-body text-sm font-semibold text-candy-ink">
        {t("intro")}
      </p>
      <button
        type="button"
        onClick={onStart}
        className="min-h-11 px-6 py-2.5 rounded-xl bg-candy-pink text-white border-[2px] border-candy-ink font-display font-black text-xs uppercase shadow-[2px_2px_0_0_#2B2D42] hover:bg-candy-pink/90 active:translate-x-0.5 active:translate-y-0.5 cursor-pointer"
      >
        {t("start")}
      </button>
    </div>
  );
}
