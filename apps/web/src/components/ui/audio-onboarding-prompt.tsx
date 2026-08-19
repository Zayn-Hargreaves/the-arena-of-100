"use client";

import React, { useState, useEffect } from "react";
import {
  playSfx,
  startBgm,
  stopBgm,
  updateAudioSettings,
} from "@/lib/sound-engine";
import {
  MusicNoteSvg,
  VolumeHighSvg,
  VolumeMuteSvg,
} from "@/components/settings/settings-icons";

const PROMPT_KEY = "arena-audio-prompted";

export function AudioOnboardingPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    try {
      const alreadyPrompted = window.localStorage.getItem(PROMPT_KEY);
      if (!alreadyPrompted) {
        setShowPrompt(true);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  if (!showPrompt) return null;

  const handleEnableAudio = () => {
    try {
      window.localStorage.setItem(PROMPT_KEY, "true");
    } catch {}

    updateAudioSettings({
      sfxEnabled: true,
      bgmEnabled: true,
      sfxVolume: 80,
      bgmVolume: 60,
    });

    playSfx("correct");
    startBgm();
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(PROMPT_KEY, "true");
    } catch {}

    updateAudioSettings({
      sfxEnabled: false,
      bgmEnabled: false,
    });

    stopBgm();
    setShowPrompt(false);
  };

  return (
    <aside
      aria-label="Cài đặt âm thanh"
      className="fixed bottom-5 right-5 z-[9999] max-w-sm w-[calc(100vw-2.5rem)] animate-in fade-in slide-in-from-bottom-6 duration-300 pointer-events-auto"
    >
      <div className="bg-candy-yellow border-[3.5px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-3xl p-5 relative overflow-hidden space-y-4">
        {/* Ambient decorative blur */}
        <div className="absolute -top-6 -right-6 w-20 h-20 bg-candy-pink/30 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start gap-3.5 relative">
          <div className="w-12 h-12 rounded-2xl bg-white border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center justify-center text-candy-ink shrink-0 animate-bounce">
            <MusicNoteSvg size={26} className="text-candy-ink" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-candy-ink">
              Âm Thanh Đấu Trường
            </h3>
            <p className="font-body text-xs text-candy-ink/80 font-bold leading-relaxed">
              Bật nhạc nền BGM & hiệu ứng âm thanh thao tác để trải nghiệm trận
              đấu sống động nhất?
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            data-sfx="none"
            onClick={handleEnableAudio}
            className="flex-1 py-2.5 px-3 rounded-2xl bg-candy-mint text-candy-ink font-display font-black text-xs uppercase tracking-wide border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <VolumeHighSvg size={18} className="text-candy-ink" />
            <span>Bật Âm Thanh</span>
          </button>

          <button
            type="button"
            data-sfx="none"
            onClick={handleDismiss}
            className="py-2.5 px-3.5 rounded-2xl bg-white text-candy-ink/70 hover:text-candy-ink font-display font-black text-xs uppercase tracking-wide border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all flex items-center gap-1 cursor-pointer shrink-0"
          >
            <VolumeMuteSvg size={16} className="text-candy-ink/70" />
            <span>Tắt</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
