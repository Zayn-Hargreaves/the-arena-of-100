"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SparklesCandySvg, VibrateHapticSvg } from "./settings-icons";
import { SettingsToggleButton } from "./settings-toggle-button";

interface SettingsGraphicsTabProps {
  confettiEnabled: boolean;
  onToggleConfetti: () => void;
  reduceMotion: boolean;
  onToggleReduceMotion: () => void;
  hapticsEnabled: boolean;
  onToggleHaptics: () => void;
}

export function SettingsGraphicsTab({
  confettiEnabled,
  onToggleConfetti,
  reduceMotion,
  onToggleReduceMotion,
  hapticsEnabled,
  onToggleHaptics,
}: Readonly<SettingsGraphicsTabProps>) {
  const t = useTranslations("settings");

  return (
    <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-6">
      <div className="border-b-[2px] border-dashed border-candy-ink/20 pb-4">
        <h3 className="font-display font-black text-base uppercase tracking-wider text-candy-ink flex items-center gap-2">
          <SparklesCandySvg className="w-5 h-5" />
          {t("graphics.title")}
        </h3>
        <p className="font-body text-xs text-candy-ink/75 font-semibold mt-1">
          {t("graphics.subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Confetti Toggle */}
        <div className="bg-white border-[2.5px] border-candy-ink p-4 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
              {t("graphics.confettiTitle")}
            </span>
            <span className="font-body text-[11px] text-candy-ink/70 font-semibold block">
              {t("graphics.confettiDesc")}
            </span>
          </div>
          <SettingsToggleButton
            value={confettiEnabled}
            onToggle={onToggleConfetti}
            activeClassName="bg-candy-pink text-white"
            onLabel={t("graphics.on")}
            offLabel={t("graphics.off")}
            ariaLabel={t("graphics.confettiTitle")}
          />
        </div>

        {/* Reduce Motion Toggle */}
        <div className="bg-white border-[2.5px] border-candy-ink p-4 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
              {t("graphics.reduceMotionTitle")}
            </span>
            <span className="font-body text-[11px] text-candy-ink/70 font-semibold block">
              {t("graphics.reduceMotionDesc")}
            </span>
          </div>
          <SettingsToggleButton
            value={reduceMotion}
            onToggle={onToggleReduceMotion}
            activeClassName="bg-candy-mint text-white"
            onLabel={t("graphics.on")}
            offLabel={t("graphics.off")}
            ariaLabel={t("graphics.reduceMotionTitle")}
          />
        </div>

        {/* Haptics Toggle */}
        <div className="bg-white border-[2.5px] border-candy-ink p-4 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-between gap-4">
          <div className="space-y-1 flex items-start gap-2">
            <VibrateHapticSvg className="w-5 h-5 text-candy-ink shrink-0 mt-0.5" />
            <div>
              <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
                {t("graphics.hapticsTitle")}
              </span>
              <span className="font-body text-[11px] text-candy-ink/70 font-semibold block">
                {t("graphics.hapticsDesc")}
              </span>
            </div>
          </div>
          <SettingsToggleButton
            value={hapticsEnabled}
            onToggle={onToggleHaptics}
            activeClassName="bg-candy-yellow text-candy-ink"
            onLabel={t("graphics.on")}
            offLabel={t("graphics.off")}
            ariaLabel={t("graphics.hapticsTitle")}
          />
        </div>
      </div>
    </div>
  );
}
