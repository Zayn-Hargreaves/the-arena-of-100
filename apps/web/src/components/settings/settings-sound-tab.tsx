"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { VolumeHighSvg, VolumeMuteSvg, MusicNoteSvg } from "./settings-icons";
import { SettingsToggleButton } from "./settings-toggle-button";

interface SettingsSoundTabProps {
  sfxEnabled: boolean;
  onToggleSfx: () => void;
  sfxVolume: number;
  onSfxVolumeChange: (volume: number) => void;
  onTestSfx: () => void;
  bgmEnabled: boolean;
  onToggleBgm: () => void;
  bgmVolume: number;
  onBgmVolumeChange: (volume: number) => void;
  testingBgm: boolean;
  onToggleTestBgm: () => void;
}

export function SettingsSoundTab({
  sfxEnabled,
  onToggleSfx,
  sfxVolume,
  onSfxVolumeChange,
  onTestSfx,
  bgmEnabled,
  onToggleBgm,
  bgmVolume,
  onBgmVolumeChange,
  testingBgm,
  onToggleTestBgm,
}: Readonly<SettingsSoundTabProps>) {
  const t = useTranslations("settings");
  const format = useFormatter();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Sound Effects SFX */}
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-candy-pink border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center text-white">
              {sfxEnabled ? (
                <VolumeHighSvg className="w-5 h-5 text-white" />
              ) : (
                <VolumeMuteSvg className="w-5 h-5 text-white" />
              )}
            </div>
            <div>
              <h3 className="font-display font-black text-sm uppercase tracking-wide text-candy-ink">
                {t("sound.sfx")}
              </h3>
              <p className="font-body text-[11px] text-candy-ink/75 font-semibold">
                {t("sound.sfxDesc")}
              </p>
            </div>
          </div>

          <SettingsToggleButton
            value={sfxEnabled}
            onToggle={onToggleSfx}
            activeClassName="bg-candy-pink text-white"
            onLabel={t("sound.on")}
            offLabel={t("sound.off")}
            ariaLabel={t("sound.sfx")}
          />
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between font-mono text-xs font-black text-candy-ink">
            <span>{t("sound.sfxVolume")}</span>
            <span>
              {sfxEnabled
                ? format.number(sfxVolume / 100, { style: "percent" })
                : t("sound.muted")}
            </span>
          </div>
          <input
            type="range"
            aria-label={t("sound.sfxVolume")}
            min="0"
            max="100"
            step="5"
            disabled={!sfxEnabled}
            value={sfxVolume}
            onChange={(e) => onSfxVolumeChange(Number(e.target.value))}
            className="w-full h-3 bg-candy-pink/20 rounded-lg appearance-none cursor-pointer accent-candy-pink disabled:opacity-30 border-[1.5px] border-candy-ink"
          />
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onTestSfx}
            className="w-full py-2.5 rounded-xl bg-white hover:bg-candy-yellow/20 text-candy-ink font-display font-black text-xs uppercase tracking-wider border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <VolumeHighSvg className="w-4 h-4" />
            {t("sound.testSfx")}
          </button>
        </div>
      </div>

      {/* Background Music BGM */}
      <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-candy-yellow border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center text-candy-ink">
              <MusicNoteSvg className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-black text-sm uppercase tracking-wide text-candy-ink">
                {t("sound.bgm")}
              </h3>
              <p className="font-body text-[11px] text-candy-ink/75 font-semibold">
                {t("sound.bgmDesc")}
              </p>
            </div>
          </div>

          <SettingsToggleButton
            value={bgmEnabled}
            onToggle={onToggleBgm}
            activeClassName="bg-candy-yellow text-candy-ink"
            onLabel={t("sound.on")}
            offLabel={t("sound.off")}
            ariaLabel={t("sound.bgm")}
          />
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between font-mono text-xs font-black text-candy-ink">
            <span>{t("sound.bgmVolume")}</span>
            <span>
              {bgmEnabled
                ? format.number(bgmVolume / 100, { style: "percent" })
                : t("sound.muted")}
            </span>
          </div>
          <input
            type="range"
            aria-label={t("sound.bgmVolume")}
            min="0"
            max="100"
            step="5"
            disabled={!bgmEnabled}
            value={bgmVolume}
            onChange={(e) => onBgmVolumeChange(Number(e.target.value))}
            className="w-full h-3 bg-candy-yellow/20 rounded-lg appearance-none cursor-pointer accent-candy-yellow disabled:opacity-30 border-[1.5px] border-candy-ink"
          />
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onToggleTestBgm}
            className={cn(
              "w-full py-2.5 rounded-xl font-display font-black text-xs uppercase tracking-wider border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all flex items-center justify-center gap-2 cursor-pointer",
              testingBgm
                ? "bg-candy-yellow text-candy-ink animate-pulse"
                : "bg-white hover:bg-candy-yellow/20 text-candy-ink",
            )}
          >
            <MusicNoteSvg className="w-4 h-4" />
            {testingBgm ? t("sound.stopTestBgm") : t("sound.testBgm")}
          </button>
        </div>
      </div>
    </div>
  );
}
