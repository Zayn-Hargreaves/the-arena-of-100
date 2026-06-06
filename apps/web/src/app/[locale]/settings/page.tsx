"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_AVATAR_SEED, type AvatarSeed } from "@arena/shared";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { PanelSection } from "@/components/ui/panel-section";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { toast } from "@/hooks/use-toast";
import { useProfileStats } from "@/hooks/use-profile-stats";
import { useUpdateAvatar } from "@/hooks/use-update-avatar";
import { avatars, findAvatarBySeed } from "@/lib/avatars";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "arena-settings";

type SettingsState = {
  sfxEnabled: boolean;
  sfxVolume: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  glowIntensity: string;
  scanlines: boolean;
  particles: boolean;
  quickAnswers: boolean;
};

const defaultSettings: SettingsState = {
  sfxEnabled: true,
  sfxVolume: 80,
  bgmEnabled: true,
  bgmVolume: 50,
  glowIntensity: "high",
  scanlines: true,
  particles: true,
  quickAnswers: true,
};

function syncLocalAvatar(seed: AvatarSeed) {
  if (typeof window === "undefined") {
    return;
  }

  const avatar = findAvatarBySeed(seed);

  if (!avatar) {
    return;
  }

  // Wrap storage writes in try/catch: private-browsing / quota-exceeded
  // / SecurityError shouldn't crash the page after a successful server
  // update. We swallow the error (and log it) because the authoritative
  // avatar lives on the server; the local mirror is just an optimization.
  try {
    localStorage.setItem("avatarSeed", seed);
    localStorage.setItem("avatarName", avatar.name);
    localStorage.setItem(
      "avatarIsAnimated",
      avatar.isAnimated ? "true" : "false",
    );
    localStorage.setItem("avatarSpritesheet", avatar.spritesheet ?? "");
  } catch (err) {
    console.warn("syncLocalAvatar: localStorage write failed", err);
  }
}

export default function SettingsPage() {
  const tAvatar = useTranslations("settings.avatar");
  const profileQuery = useProfileStats();
  const updateAvatar = useUpdateAvatar();

  // Audio State
  const [sfxEnabled, setSfxEnabled] = useState(defaultSettings.sfxEnabled);
  const [sfxVolume, setSfxVolume] = useState(defaultSettings.sfxVolume);
  const [bgmEnabled, setBgmEnabled] = useState(defaultSettings.bgmEnabled);
  const [bgmVolume, setBgmVolume] = useState(defaultSettings.bgmVolume);

  // Graphics Visuals
  const [glowIntensity, setGlowIntensity] = useState(
    defaultSettings.glowIntensity,
  ); // normal, high, extreme
  const [scanlines, setScanlines] = useState(defaultSettings.scanlines);
  const [particles, setParticles] = useState(defaultSettings.particles);

  // Key bindings
  const [quickAnswers, setQuickAnswers] = useState(
    defaultSettings.quickAnswers,
  ); // Press 1-4 for answers

  const currentAvatarSeed = (profileQuery.data?.user.avatar ??
    DEFAULT_AVATAR_SEED) as AvatarSeed;
  const currentAvatar = findAvatarBySeed(currentAvatarSeed);
  // Track which avatar the user just submitted so the pending state
  // only highlights that specific tile (rather than dimming every
  // non-active avatar during a mutation).
  const [submittingSeed, setSubmittingSeed] = useState<AvatarSeed | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      setSfxEnabled(parsed.sfxEnabled ?? defaultSettings.sfxEnabled);
      setSfxVolume(parsed.sfxVolume ?? defaultSettings.sfxVolume);
      setBgmEnabled(parsed.bgmEnabled ?? defaultSettings.bgmEnabled);
      setBgmVolume(parsed.bgmVolume ?? defaultSettings.bgmVolume);
      setGlowIntensity(parsed.glowIntensity ?? defaultSettings.glowIntensity);
      setScanlines(parsed.scanlines ?? defaultSettings.scanlines);
      setParticles(parsed.particles ?? defaultSettings.particles);
      setQuickAnswers(parsed.quickAnswers ?? defaultSettings.quickAnswers);
    } catch (error) {
      console.error("Failed to parse settings from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    const settings: SettingsState = {
      sfxEnabled,
      sfxVolume,
      bgmEnabled,
      bgmVolume,
      glowIntensity,
      scanlines,
      particles,
      quickAnswers,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [
    sfxEnabled,
    sfxVolume,
    bgmEnabled,
    bgmVolume,
    glowIntensity,
    scanlines,
    particles,
    quickAnswers,
  ]);

  const handleAvatarChange = (seed: AvatarSeed) => {
    if (seed === currentAvatarSeed || updateAvatar.isPending) {
      return;
    }

    setSubmittingSeed(seed);
    updateAvatar.mutate(seed, {
      onSuccess: () => {
        syncLocalAvatar(seed);
        toast({ description: tAvatar("updated"), variant: "success" });
      },
      onError: (error) => {
        toast({
          description:
            error instanceof Error ? error.message : tAvatar("updateFailed"),
          variant: "error",
        });
      },
      onSettled: () => {
        setSubmittingSeed(null);
      },
    });
  };

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 pb-8 select-none relative z-10">
        {/* Floating background decorations */}
        <div className="absolute -top-10 -right-10 w-24 h-24 bg-candy-pink/10 rounded-full blur-2xl pointer-events-none animate-pulse" />
        <div className="absolute bottom-1/3 -left-10 w-32 h-32 bg-candy-yellow/10 rounded-full blur-2xl pointer-events-none" />

        {/* Header Block */}
        <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-full bg-candy-mint/5 -skew-x-12 translate-x-8" />
          <div className="relative space-y-1.5">
            <h1 className="font-display font-black text-3xl md:text-4xl text-candy-ink tracking-wider uppercase drop-shadow-[2px_2px_0_#FFE45E] flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-white border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] text-candy-yellow">
                <MiniGlyph
                  variant="settings"
                  className="w-6 h-6 animate-spin-slow"
                />
              </span>
              CẤU HÌNH HỆ THỐNG
            </h1>
            <p className="font-body text-xs md:text-sm text-candy-ink font-semibold opacity-85 leading-6">
              Tinh chỉnh âm thanh, đồ họa và phím tắt điều khiển đấu trường của
              bạn
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {/* Column 1: Sound Settings */}
          <div className="space-y-6">
            <PanelSection
              title="Cài Đặt Âm Thanh"
              glyph="sound"
              className="space-y-6"
            >
              {/* Sound Effects SFX */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <label
                    htmlFor="settings-sfx-volume"
                    className="font-display font-black text-xs uppercase tracking-wide text-candy-ink"
                  >
                    Hiệu Ứng (SFX)
                  </label>
                  <button
                    onClick={() => setSfxEnabled(!sfxEnabled)}
                    className={cn(
                      "min-h-11 px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42]",
                      sfxEnabled
                        ? "bg-candy-pink text-white translate-y-[1px] shadow-[1px_1px_0_0_#2B2D42]"
                        : "bg-white hover:bg-candy-cloud text-candy-ink",
                    )}
                  >
                    {sfxEnabled ? "BẬT" : "TẮT"}
                  </button>
                </div>
                <div className="flex items-center gap-4 bg-white/50 border-[2px] border-candy-ink p-3 rounded-2xl shadow-[2px_2px_0_0_#2B2D42]">
                  <MiniGlyph
                    variant="sound"
                    className="w-4 h-4 text-candy-ink shrink-0"
                  />
                  <input
                    id="settings-sfx-volume"
                    type="range"
                    min="0"
                    max="100"
                    disabled={!sfxEnabled}
                    value={sfxVolume}
                    onChange={(e) => setSfxVolume(Number(e.target.value))}
                    className="flex-1 accent-candy-pink h-2 bg-candy-pink/20 rounded-lg appearance-none cursor-pointer disabled:opacity-30"
                  />
                  <span className="font-mono text-xs text-candy-ink font-black w-10 text-right">
                    {sfxVolume}%
                  </span>
                </div>
              </div>

              {/* Music BGM */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label
                    htmlFor="settings-bgm-volume"
                    className="font-display font-black text-xs uppercase tracking-wide text-candy-ink"
                  >
                    Nhạc Nền (BGM)
                  </label>
                  <button
                    onClick={() => setBgmEnabled(!bgmEnabled)}
                    className={cn(
                      "min-h-11 px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42]",
                      bgmEnabled
                        ? "bg-candy-yellow text-candy-ink translate-y-[1px] shadow-[1px_1px_0_0_#2B2D42]"
                        : "bg-white hover:bg-candy-cloud text-candy-ink",
                    )}
                  >
                    {bgmEnabled ? "BẬT" : "TẮT"}
                  </button>
                </div>
                <div className="flex items-center gap-4 bg-white/50 border-[2px] border-candy-ink p-3 rounded-2xl shadow-[2px_2px_0_0_#2B2D42]">
                  <MiniGlyph
                    variant="sound"
                    className="w-4 h-4 text-candy-ink shrink-0"
                  />
                  <input
                    id="settings-bgm-volume"
                    type="range"
                    min="0"
                    max="100"
                    disabled={!bgmEnabled}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(Number(e.target.value))}
                    className="flex-1 accent-candy-yellow h-2 bg-candy-yellow/20 rounded-lg appearance-none cursor-pointer disabled:opacity-30"
                  />
                  <span className="font-mono text-xs text-candy-ink font-black w-10 text-right">
                    {bgmVolume}%
                  </span>
                </div>
              </div>
            </PanelSection>

            {/* Keyboard Shortcuts controls */}
            <PanelSection
              title="Phím Tắt Điều Khiển"
              glyph="controls"
              className="space-y-4"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
                <div className="space-y-0.5">
                  <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
                    Trả Lời Bằng Phím Tắt
                  </span>
                  <span className="font-body text-xs text-candy-ink/75 font-semibold block">
                    Bấm phím 1, 2, 3, 4 tương ứng đáp án A, B, C, D
                  </span>
                </div>
                <button
                  onClick={() => setQuickAnswers(!quickAnswers)}
                  className={cn(
                    "min-h-11 px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42] shrink-0",
                    quickAnswers
                      ? "bg-candy-pink text-white translate-y-[1px] shadow-[1px_1px_0_0_#2B2D42]"
                      : "bg-white hover:bg-candy-cloud text-candy-ink",
                  )}
                >
                  {quickAnswers ? "KÍCH HOẠT" : "VÔ HIỆU"}
                </button>
              </div>
            </PanelSection>

            <PanelSection title={tAvatar("title")} glyph="avatar">
              <p className="font-body text-xs text-candy-ink/75 font-semibold pt-2">
                {tAvatar("subtitle")}
              </p>

              <div className="bg-white/70 border-[2px] border-candy-ink rounded-2xl p-4 shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-4">
                {profileQuery.isLoading ? (
                  <>
                    <Skeleton
                      width="80px"
                      height="80px"
                      className="rounded-2xl shrink-0"
                    />
                    <div className="min-w-0 space-y-2 flex-1">
                      <Skeleton width="60px" height="10px" />
                      <Skeleton width="140px" height="16px" />
                      <Skeleton width="80px" height="10px" />
                    </div>
                  </>
                ) : (
                  <>
                    <SpriteFrame
                      src={currentAvatar?.spritesheet}
                      scale={0.35}
                      width="64px"
                      height="70px"
                      frameClassName="w-20 h-20 rounded-2xl shrink-0"
                      skeletonSize="54px"
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] text-candy-ink/60 font-black uppercase tracking-wider">
                        {tAvatar("current")}
                      </p>
                      <p className="font-display font-black text-sm text-candy-ink uppercase truncate">
                        {currentAvatar?.name ?? "Jellyfrog"}
                      </p>
                      <p className="font-mono text-[10px] text-candy-ink/60 font-black uppercase tracking-wider mt-1">
                        {profileQuery.data?.user.username ?? "Guest"}
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 gap-3">
                {avatars.map((avatar) => {
                  const isActive = avatar.seed === currentAvatarSeed;
                  const isPending =
                    updateAvatar.isPending && avatar.seed === submittingSeed;

                  return (
                    <button
                      key={avatar.seed}
                      type="button"
                      onClick={() => handleAvatarChange(avatar.seed)}
                      disabled={updateAvatar.isPending}
                      className={cn(
                        "rounded-2xl border-[3px] border-candy-ink p-3 bg-white shadow-[3px_3px_0_0_#2B2D42] text-center transition-all",
                        isActive
                          ? "bg-candy-yellow -translate-y-0.5 shadow-[4px_4px_0_0_#2B2D42]"
                          : "hover:-translate-y-0.5",
                        isPending && "opacity-60",
                      )}
                    >
                      <SpriteFrame
                        src={avatar.spritesheet}
                        scale={0.22}
                        width="44px"
                        height="48px"
                        frameClassName="w-14 h-14 mx-auto rounded-xl bg-candy-cloud"
                        skeletonSize="32px"
                      />
                      <p className="mt-2 text-[10px] font-display font-black uppercase text-candy-ink leading-tight line-clamp-2">
                        {avatar.name}
                      </p>
                    </button>
                  );
                })}
              </div>
            </PanelSection>
          </div>

          {/* Column 2: Graphics Settings */}
          <div className="space-y-6">
            <PanelSection
              title="Cài Đặt Đồ Họa (UI/UX)"
              glyph="display"
              className="space-y-6"
            >
              {/* Glowing strength */}
              <div className="space-y-3 pt-2">
                <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink block">
                  Cường Độ Neon Glow
                </span>
                <div className="flex gap-2">
                  {["normal", "high", "extreme"].map((val) => (
                    <button
                      key={val}
                      onClick={() => setGlowIntensity(val)}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl font-display font-black text-xs uppercase border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42]",
                        glowIntensity === val
                          ? "bg-candy-yellow text-candy-ink translate-y-[1.5px] shadow-[0.5px_0.5px_0_0_#2B2D42]"
                          : "bg-white hover:bg-candy-cloud text-candy-ink",
                      )}
                    >
                      {val === "normal"
                        ? "Cơ bản"
                        : val === "high"
                          ? "Đặc trưng"
                          : "Cực hạn"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggle Scanlines and Grids */}
              <div className="space-y-4 pt-2 border-t-[2px] border-dashed border-candy-ink/20">
                <div className="flex items-center justify-between">
                  <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink">
                    Đường Quét CRT (Scanlines)
                  </span>
                  <button
                    onClick={() => setScanlines(!scanlines)}
                    className={cn(
                      "min-h-11 px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42]",
                      scanlines
                        ? "bg-candy-pink text-white translate-y-[1px] shadow-[1px_1px_0_0_#2B2D42]"
                        : "bg-white hover:bg-candy-cloud text-candy-ink",
                    )}
                  >
                    {scanlines ? "BẬT" : "TẮT"}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-display font-black text-xs uppercase tracking-wide text-candy-ink">
                    Lưới Không Gian (Tech Grids)
                  </span>
                  <button
                    onClick={() => setParticles(!particles)}
                    className={cn(
                      "min-h-11 px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all duration-200 shadow-[2px_2px_0_0_#2B2D42]",
                      particles
                        ? "bg-candy-pink text-white translate-y-[1px] shadow-[1px_1px_0_0_#2B2D42]"
                        : "bg-white hover:bg-candy-cloud text-candy-ink",
                    )}
                  >
                    {particles ? "BẬT" : "ẨN"}
                  </button>
                </div>
              </div>
            </PanelSection>

            {/* Quick action: Save configs */}
            <div className="pt-2">
              <button
                className="jelly-btn bg-candy-pink text-white hover:bg-candy-pink/90 w-full h-12 font-display uppercase tracking-wider text-xs font-black border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl flex items-center justify-center gap-2"
                onClick={() =>
                  toast({
                    description:
                      "Đã lưu các tùy chỉnh cấu hình vào bộ nhớ đệm browser!",
                  })
                }
              >
                <MiniGlyph variant="settings" className="w-5 h-5 text-white" />
                Lưu Tùy Chỉnh
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
