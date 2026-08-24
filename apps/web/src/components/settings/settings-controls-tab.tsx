"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { KeyboardSvg } from "./settings-icons";
import { SettingsToggleButton } from "./settings-toggle-button";

interface SettingsControlsTabProps {
  quickAnswers: boolean;
  onToggleQuickAnswers: () => void;
  autoFocus: boolean;
  onToggleAutoFocus: () => void;
}

export function SettingsControlsTab({
  quickAnswers,
  onToggleQuickAnswers,
  autoFocus,
  onToggleAutoFocus,
}: Readonly<SettingsControlsTabProps>) {
  const t = useTranslations("settings");

  return (
    <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-6">
      <div className="border-b-[2px] border-dashed border-candy-ink/20 pb-4">
        <h3 className="font-display font-black text-base uppercase tracking-wider text-candy-ink flex items-center gap-2">
          <KeyboardSvg className="w-5 h-5" />
          {t("controls.title")}
        </h3>
      </div>

      {/* Quick Keys Option */}
      <div className="bg-white border-[2.5px] border-candy-ink p-5 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
              {t("controls.quickAnswersTitle")}
            </span>
            <span className="font-body text-[11px] text-candy-ink/70 font-semibold block">
              {t("controls.quickAnswersDesc")}
            </span>
          </div>
          <SettingsToggleButton
            value={quickAnswers}
            onToggle={onToggleQuickAnswers}
            activeClassName="bg-candy-pink text-white"
            onLabel={t("controls.enabled")}
            offLabel={t("controls.disabled")}
            ariaLabel={t("controls.quickAnswersTitle")}
          />
        </div>

        {/* Key Map Badges */}
        <div
          className={cn(
            "grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 transition-opacity duration-150",
            !quickAnswers && "opacity-50",
          )}
        >
          {[
            {
              key: "1",
              label: t("controls.key1"),
              color: "bg-candy-pink",
            },
            {
              key: "2",
              label: t("controls.key2"),
              color: "bg-candy-yellow",
            },
            {
              key: "3",
              label: t("controls.key3"),
              color: "bg-candy-mint",
            },
            {
              key: "4",
              label: t("controls.key4"),
              color: "bg-candy-sky",
            },
          ].map((item) => (
            <div
              key={item.key}
              className={cn(
                "p-3 rounded-xl bg-candy-cloud border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-3 transition-colors",
                !quickAnswers && "bg-candy-cloud/50",
              )}
            >
              <span
                className={cn(
                  "w-7 h-7 rounded-lg border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] font-mono font-black text-xs flex items-center justify-center text-candy-ink",
                  item.color,
                  !quickAnswers && "opacity-60",
                )}
              >
                {item.key}
              </span>
              <span
                className={cn(
                  "font-display font-black text-xs uppercase text-candy-ink",
                  !quickAnswers && "text-candy-ink/50",
                )}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Auto Focus Option */}
      <div className="bg-white border-[2.5px] border-candy-ink p-4 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
            {t("controls.autoFocusTitle")}
          </span>
          <span className="font-body text-[11px] text-candy-ink/70 font-semibold block">
            {t("controls.autoFocusDesc")}
          </span>
        </div>
        <SettingsToggleButton
          value={autoFocus}
          onToggle={onToggleAutoFocus}
          activeClassName="bg-candy-mint text-white"
          onLabel={t("controls.enabled")}
          offLabel={t("controls.disabled")}
          ariaLabel={t("controls.autoFocusTitle")}
        />
      </div>
    </div>
  );
}
