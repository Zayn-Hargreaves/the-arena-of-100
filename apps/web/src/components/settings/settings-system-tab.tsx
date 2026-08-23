"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  GlobeSvg,
  ResetRotateSvg,
  TrashCanSvg,
  CheckmarkBadgeSvg,
} from "./settings-icons";

import type { SupportedLocale } from "./settings-types";

export interface SettingsSystemTabProps {
  locale: SupportedLocale;
  isPendingLocale: boolean;
  onSwitchLanguage: (locale: SupportedLocale) => void;
  onResetDefaults: () => void;
  onClearCache: () => void;
}

export function SettingsSystemTab({
  locale,
  isPendingLocale,
  onSwitchLanguage,
  onResetDefaults,
  onClearCache,
}: Readonly<SettingsSystemTabProps>) {
  const t = useTranslations("settings");

  return (
    <div className="space-y-6">
      {/* Language Settings Card */}
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-4">
        <div className="flex items-center justify-between border-b-[2px] border-dashed border-candy-ink/20 pb-3">
          <div className="flex items-center gap-2">
            <GlobeSvg className="w-5 h-5" />
            <div>
              <h3 className="font-display font-black text-sm uppercase tracking-wide text-candy-ink">
                {t("system.languageTitle")}
              </h3>
              <p className="font-body text-[11px] text-candy-ink/75 font-semibold">
                {t("system.languageDesc")}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={() => onSwitchLanguage("vi")}
            disabled={isPendingLocale}
            className={cn(
              "p-4 rounded-2xl border-[2.5px] border-candy-ink font-display font-black text-xs uppercase tracking-wide flex items-center justify-between transition-all cursor-pointer",
              locale === "vi"
                ? "bg-candy-mint text-white shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                : "bg-white text-candy-ink/70 hover:text-candy-ink hover:bg-candy-cloud shadow-[2px_2px_0_0_#2B2D42]",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🇻🇳</span> Tiếng Việt (Vietnamese)
            </span>
            {locale === "vi" && (
              <CheckmarkBadgeSvg className="w-5 h-5 text-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSwitchLanguage("en")}
            disabled={isPendingLocale}
            className={cn(
              "p-4 rounded-2xl border-[2.5px] border-candy-ink font-display font-black text-xs uppercase tracking-wide flex items-center justify-between transition-all cursor-pointer",
              locale === "en"
                ? "bg-candy-pink text-white shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                : "bg-white text-candy-ink/70 hover:text-candy-ink hover:bg-candy-cloud shadow-[2px_2px_0_0_#2B2D42]",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🇬🇧</span> English (US/UK)
            </span>
            {locale === "en" && (
              <CheckmarkBadgeSvg className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </div>

      {/* Reset & Clear Cache Danger Zone */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Reset Defaults */}
        <div className="bg-white border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 rounded-3xl space-y-3 flex flex-col justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-candy-ink">
              <ResetRotateSvg className="w-5 h-5" />
              <h4 className="font-display font-black text-xs uppercase tracking-wide">
                {t("system.resetTitle")}
              </h4>
            </div>
            <p className="font-body text-[11px] text-candy-ink/75 font-semibold">
              {t("system.resetDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onResetDefaults}
            className="w-full py-2.5 rounded-xl bg-candy-yellow text-candy-ink font-display font-black text-xs uppercase tracking-wider border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
          >
            {t("system.resetBtn")}
          </button>
        </div>

        {/* Clear Local Cache */}
        <div className="bg-white border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 rounded-3xl space-y-3 flex flex-col justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-candy-pink">
              <TrashCanSvg className="w-5 h-5" />
              <h4 className="font-display font-black text-xs uppercase tracking-wide text-candy-ink">
                {t("system.clearCacheTitle")}
              </h4>
            </div>
            <p className="font-body text-[11px] text-candy-ink/75 font-semibold">
              {t("system.clearCacheDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearCache}
            className="w-full py-2.5 rounded-xl bg-candy-pink text-white font-display font-black text-xs uppercase tracking-wider border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
          >
            {t("system.clearCacheBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
