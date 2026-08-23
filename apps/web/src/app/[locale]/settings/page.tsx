"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DEFAULT_AVATAR_SEED,
  isValidAvatarSeed,
  type AvatarSeed,
} from "@arena/shared";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { SpriteFrame } from "@/components/ui/sprite-frame";
import { toast } from "@/hooks/use-toast";
import { useProfileStats } from "@/hooks/use-profile-stats";
import { useUpdateAvatar } from "@/hooks/use-update-avatar";
import { avatars, findAvatarBySeed } from "@/lib/avatars";
import { playCandyChime } from "@/lib/audio-preview";
import {
  invalidateAudioSettingsCache,
  startBgm,
  stopBgm,
  updateAudioSettings,
} from "@/lib/sound-engine";
import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
  SettingsHeroGearSvg,
  UserBadgeSvg,
  VolumeHighSvg,
  VolumeMuteSvg,
  MusicNoteSvg,
  SparklesCandySvg,
  GamepadSvg,
  KeyboardSvg,
  GlobeSvg,
  ResetRotateSvg,
  TrashCanSvg,
  SlidersConfigSvg,
  VibrateHapticSvg,
  CheckmarkBadgeSvg,
} from "@/components/settings/settings-icons";

const STORAGE_KEY = "arena-settings";

type TabId = "profile" | "sound" | "graphics" | "controls" | "system";

type SettingsState = {
  sfxEnabled: boolean;
  sfxVolume: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  confettiEnabled: boolean;
  reduceMotion: boolean;
  hapticsEnabled: boolean;
  quickAnswers: boolean;
  autoFocus: boolean;
};

const defaultSettings: SettingsState = {
  sfxEnabled: true,
  sfxVolume: 80,
  bgmEnabled: true,
  bgmVolume: 60,
  confettiEnabled: true,
  reduceMotion: false,
  hapticsEnabled: true,
  quickAnswers: true,
  autoFocus: true,
};

function syncLocalAvatar(seed: AvatarSeed) {
  if (typeof window === "undefined") return;

  const avatar = findAvatarBySeed(seed);
  if (!avatar) return;

  try {
    localStorage.setItem("avatarSeed", seed);
    localStorage.setItem("avatarName", avatar.name);
    localStorage.setItem(
      "avatarIsAnimated",
      avatar.isAnimated ? "true" : "false",
    );
    localStorage.setItem("avatarSpritesheet", avatar.spritesheet ?? "");
    window.dispatchEvent(new Event("storage"));
  } catch (err) {
    console.warn("syncLocalAvatar: localStorage write failed", err);
  }
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tAvatar = useTranslations("settings.avatar");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPendingLocale, startTransition] = useTransition();

  const profileQuery = useProfileStats();
  const updateAvatar = useUpdateAvatar();

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  // Profile callsing state
  const [callsign, setCallsign] = useState("");

  // Sound settings
  const [sfxEnabled, setSfxEnabled] = useState(defaultSettings.sfxEnabled);
  const [sfxVolume, setSfxVolume] = useState(defaultSettings.sfxVolume);
  const [bgmEnabled, setBgmEnabled] = useState(defaultSettings.bgmEnabled);
  const [bgmVolume, setBgmVolume] = useState(defaultSettings.bgmVolume);

  // Graphics & Visuals
  const [confettiEnabled, setConfettiEnabled] = useState(
    defaultSettings.confettiEnabled,
  );
  const [reduceMotion, setReduceMotion] = useState(
    defaultSettings.reduceMotion,
  );
  const [hapticsEnabled, setHapticsEnabled] = useState(
    defaultSettings.hapticsEnabled,
  );

  // Controls
  const [quickAnswers, setQuickAnswers] = useState(
    defaultSettings.quickAnswers,
  );
  const [autoFocus, setAutoFocus] = useState(defaultSettings.autoFocus);

  // Avatar submission state
  const [submittingSeed, setSubmittingSeed] = useState<AvatarSeed | null>(null);

  // Selected avatar state (synced with localStorage & server profile query)
  const [selectedAvatarSeed, setSelectedAvatarSeed] =
    useState<AvatarSeed>(DEFAULT_AVATAR_SEED);

  const currentAvatar = findAvatarBySeed(selectedAvatarSeed);

  const initializedCallsignRef = useRef(false);
  const initializedAvatarRef = useRef(false);

  const [settingsHydrated, setSettingsHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      if (!initializedCallsignRef.current) {
        const savedCallsign = window.localStorage.getItem("callsign");
        if (savedCallsign) {
          setCallsign(savedCallsign);
          initializedCallsignRef.current = true;
        } else if (profileQuery.data?.user.username) {
          setCallsign((prev) =>
            prev ? prev : profileQuery.data.user.username,
          );
          initializedCallsignRef.current = true;
        }
      }

      if (!initializedAvatarRef.current) {
        const savedSeed = window.localStorage.getItem("avatarSeed");
        const profileAvatar = profileQuery.data?.user.avatar;
        if (typeof savedSeed === "string" && isValidAvatarSeed(savedSeed)) {
          setSelectedAvatarSeed(savedSeed);
          initializedAvatarRef.current = true;
        } else if (
          typeof profileAvatar === "string" &&
          isValidAvatarSeed(profileAvatar)
        ) {
          setSelectedAvatarSeed(profileAvatar);
          initializedAvatarRef.current = true;
        }
      }

      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      setSfxEnabled(parsed.sfxEnabled ?? defaultSettings.sfxEnabled);
      setSfxVolume(parsed.sfxVolume ?? defaultSettings.sfxVolume);
      setBgmEnabled(parsed.bgmEnabled ?? defaultSettings.bgmEnabled);
      setBgmVolume(parsed.bgmVolume ?? defaultSettings.bgmVolume);
      setConfettiEnabled(
        parsed.confettiEnabled ?? defaultSettings.confettiEnabled,
      );
      setReduceMotion(parsed.reduceMotion ?? defaultSettings.reduceMotion);
      setHapticsEnabled(
        parsed.hapticsEnabled ?? defaultSettings.hapticsEnabled,
      );
      setQuickAnswers(parsed.quickAnswers ?? defaultSettings.quickAnswers);
      setAutoFocus(parsed.autoFocus ?? defaultSettings.autoFocus);
    } catch (error) {
      console.error("Failed to parse settings from localStorage:", error);
    } finally {
      setSettingsHydrated(true);
    }
  }, [profileQuery.data?.user.username, profileQuery.data?.user.avatar]);

  // Persist settings changes
  useEffect(() => {
    if (!settingsHydrated) return;

    const settings: SettingsState = {
      sfxEnabled,
      sfxVolume,
      bgmEnabled,
      bgmVolume,
      confettiEnabled,
      reduceMotion,
      hapticsEnabled,
      quickAnswers,
      autoFocus,
    };

    try {
      const existingRaw = window.localStorage.getItem(STORAGE_KEY);
      let existingObj: Record<string, unknown> = {};
      if (existingRaw) {
        try {
          const parsed = JSON.parse(existingRaw);
          if (typeof parsed === "object" && parsed !== null) {
            existingObj = parsed as Record<string, unknown>;
          }
        } catch {}
      }
      const payload = {
        ...existingObj,
        ...settings,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      invalidateAudioSettingsCache();
    } catch (err) {
      console.warn("Failed to save settings:", err);
    }
  }, [
    settingsHydrated,
    sfxEnabled,
    sfxVolume,
    bgmEnabled,
    bgmVolume,
    confettiEnabled,
    reduceMotion,
    hapticsEnabled,
    quickAnswers,
    autoFocus,
  ]);

  const handleSaveCallsign = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = callsign.trim();
    if (!trimmed) return;

    try {
      localStorage.setItem("callsign", trimmed);
      toast({
        description: t("profile.callsignSaved"),
        variant: "success",
      });
    } catch {
      toast({
        description: t("profile.callsignSaveFailed"),
        variant: "error",
      });
    }
  };

  const handleAvatarChange = (seed: AvatarSeed) => {
    if (seed === selectedAvatarSeed || updateAvatar.isPending) {
      return;
    }

    const previousSeed = selectedAvatarSeed;

    // Optimistically update UI & localStorage immediately
    setSelectedAvatarSeed(seed);
    syncLocalAvatar(seed);
    setSubmittingSeed(seed);

    updateAvatar.mutate(seed, {
      onSuccess: () => {
        toast({ description: tAvatar("updated"), variant: "success" });
      },
      onError: (error) => {
        setSelectedAvatarSeed(previousSeed);
        syncLocalAvatar(previousSeed);
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

  const [testingBgm, setTestingBgm] = useState(false);

  const handleTestSfx = () => {
    if (!sfxEnabled) {
      setSfxEnabled(true);
    }
    updateAudioSettings({ sfxEnabled: true, sfxVolume });
    playCandyChime(sfxVolume);
  };

  const handleToggleTestBgm = () => {
    if (testingBgm) {
      stopBgm();
      setTestingBgm(false);
    } else {
      if (!bgmEnabled) {
        setBgmEnabled(true);
      }
      updateAudioSettings({ bgmEnabled: true, bgmVolume });
      startBgm();
      setTestingBgm(true);
    }
  };

  useEffect(() => {
    return () => {
      if (testingBgm) {
        stopBgm();
      }
    };
  }, [testingBgm]);

  const handleSwitchLanguage = (newLocale: "vi" | "en") => {
    if (newLocale === locale || isPendingLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  const handleResetDefaults = () => {
    setSfxEnabled(defaultSettings.sfxEnabled);
    setSfxVolume(defaultSettings.sfxVolume);
    setBgmEnabled(defaultSettings.bgmEnabled);
    setBgmVolume(defaultSettings.bgmVolume);
    setConfettiEnabled(defaultSettings.confettiEnabled);
    setReduceMotion(defaultSettings.reduceMotion);
    setHapticsEnabled(defaultSettings.hapticsEnabled);
    setQuickAnswers(defaultSettings.quickAnswers);
    setAutoFocus(defaultSettings.autoFocus);

    toast({
      description: t("system.resetSuccess"),
      variant: "success",
    });
  };

  const handleClearCache = () => {
    try {
      const keysToKeep = [
        "callsign",
        "avatarSeed",
        "avatarName",
        "avatarIsAnimated",
        "avatarSpritesheet",
      ];
      const saved: Record<string, string | null> = {};
      keysToKeep.forEach((k) => {
        saved[k] = localStorage.getItem(k);
      });

      localStorage.clear();

      keysToKeep.forEach((k) => {
        if (saved[k] !== null) localStorage.setItem(k, saved[k] as string);
      });

      toast({
        description: t("system.clearCacheSuccess"),
        variant: "success",
      });
    } catch {
      toast({
        description: t("system.clearCacheFailed"),
        variant: "error",
      });
    }
  };

  const tabsConfig = [
    {
      id: "profile" as TabId,
      label: t("tabs.profile"),
      icon: UserBadgeSvg,
      badgeColor: "bg-candy-yellow text-candy-ink",
    },
    {
      id: "sound" as TabId,
      label: t("tabs.sound"),
      icon: VolumeHighSvg,
      badgeColor: "bg-candy-pink text-white",
    },
    {
      id: "graphics" as TabId,
      label: t("tabs.graphics"),
      icon: SparklesCandySvg,
      badgeColor: "bg-candy-mint text-white",
    },
    {
      id: "controls" as TabId,
      label: t("tabs.controls"),
      icon: GamepadSvg,
      badgeColor: "bg-candy-sky text-candy-ink",
    },
    {
      id: "system" as TabId,
      label: t("tabs.system"),
      icon: SlidersConfigSvg,
      badgeColor: "bg-candy-purple text-white",
    },
  ];

  return (
    <AppShellLayout>
      <div className="max-w-5xl mx-auto w-full space-y-6 pt-2 pb-12 select-none relative z-10">
        {/* Floating background ambient glow */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-candy-pink/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute top-1/2 -left-16 w-56 h-56 bg-candy-yellow/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 right-1/4 w-44 h-44 bg-candy-mint/15 rounded-full blur-3xl pointer-events-none" />

        {/* Header Console Banner */}
        <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[5px_5px_0_0_#2B2D42] p-5 sm:p-6 rounded-3xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="absolute top-0 right-0 w-48 h-full bg-candy-yellow/10 -skew-x-12 translate-x-12 pointer-events-none" />
          <div className="relative flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-2xl bg-candy-yellow border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] flex items-center justify-center shrink-0">
              <SettingsHeroGearSvg className="w-8 h-8 animate-spin-slow" />
            </div>
            <div>
              <h1 className="font-display font-black text-2xl sm:text-3xl text-candy-ink tracking-wider uppercase drop-shadow-[1.5px_1.5px_0_#FFF275]">
                {t("title")}
              </h1>
              <p className="font-body text-xs sm:text-sm text-candy-ink/80 font-bold leading-relaxed">
                {t("subtitle")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <button
              type="button"
              onClick={() => handleSaveCallsign()}
              className="px-4 py-2.5 rounded-2xl bg-candy-mint text-white font-display font-black text-xs uppercase tracking-wider border-[2.5px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#2B2D42] active:translate-y-0.5 active:shadow-[1px_1px_0_0_#2B2D42] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <CheckmarkBadgeSvg className="w-4 h-4 text-white" />
              {t("saveButton")}
            </button>
          </div>
        </div>

        {/* Arcade Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pt-2.5 pb-2 px-1 scrollbar-none snap-x">
          {tabsConfig.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-4 py-3 rounded-2xl font-display font-black text-xs uppercase tracking-wide border-[2.5px] border-candy-ink transition-all flex items-center gap-2 shrink-0 cursor-pointer snap-start",
                  isActive
                    ? "bg-candy-yellow text-candy-ink -translate-y-1 shadow-[4px_4px_0_0_#2B2D42]"
                    : "bg-white hover:bg-candy-cloud/80 text-candy-ink/75 hover:text-candy-ink shadow-[2px_2px_0_0_#2B2D42]",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Panels */}
        <div className="space-y-6">
          {/* TAB 1: PROFILE & AVATAR */}
          {activeTab === "profile" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Callsign & Live Preview Showcase */}
              <div className="lg:col-span-5 space-y-6">
                {/* Callsign Form */}
                <div className="bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 rounded-3xl space-y-4">
                  <div className="flex items-center gap-2 text-candy-ink">
                    <UserBadgeSvg className="w-5 h-5" />
                    <h3 className="font-display font-black text-xs uppercase tracking-wider">
                      {t("profile.callsignLabel")}
                    </h3>
                  </div>

                  <form onSubmit={handleSaveCallsign} className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={20}
                        value={callsign}
                        onChange={(e) => setCallsign(e.target.value)}
                        placeholder={t("profile.callsignPlaceholder")}
                        className="w-full h-11 px-3.5 rounded-2xl bg-white border-[2.5px] border-candy-ink font-display font-black text-sm text-candy-ink placeholder:text-candy-ink/40 shadow-[2px_2px_0_0_#2B2D42] focus:outline-none focus:ring-2 focus:ring-candy-pink"
                      />
                    </div>
                    <p className="font-body text-[11px] text-candy-ink/70 font-semibold leading-relaxed">
                      {t("profile.callsignHint")}
                    </p>
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-xl bg-candy-yellow text-candy-ink font-display font-black text-xs uppercase tracking-wide border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
                    >
                      {t("profile.saveCallsign")}
                    </button>
                  </form>
                </div>

                {/* Avatar Showcase Card */}
                <div className="bg-white border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-6 rounded-3xl text-center relative overflow-hidden">
                  <div className="absolute -top-6 -right-6 w-20 h-20 bg-candy-yellow/20 rounded-full blur-xl pointer-events-none" />
                  <span className="inline-block px-3 py-1 rounded-full bg-candy-sky text-candy-ink font-mono text-[10px] font-black uppercase tracking-wider border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] mb-3">
                    {t("profile.avatarShowcase")}
                  </span>

                  {profileQuery.isLoading ? (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <Skeleton
                        width="110px"
                        height="110px"
                        className="rounded-3xl"
                      />
                      <Skeleton width="140px" height="20px" />
                      <Skeleton width="90px" height="12px" />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-2">
                      <div className="w-28 h-28 rounded-3xl bg-candy-cloud border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] flex items-center justify-center relative overflow-hidden group">
                        <SpriteFrame
                          src={currentAvatar?.spritesheet}
                          scale={0.48}
                          width="88px"
                          height="96px"
                          frameClassName="w-24 h-24 rounded-2xl"
                          skeletonSize="72px"
                        />
                      </div>
                      <h4 className="font-display font-black text-lg text-candy-ink uppercase tracking-wide mt-2 drop-shadow-[1px_1px_0_#FFE45E]">
                        {currentAvatar?.name ?? "Linh Thú"}
                      </h4>
                      <p className="font-mono text-xs text-candy-ink/60 font-black uppercase tracking-widest">
                        SEED: #{selectedAvatarSeed}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Avatar Selection Roster */}
              <div className="lg:col-span-7 bg-candy-cloud border-candy-ink border-[3px] shadow-[4px_4px_0_0_#2B2D42] p-5 sm:p-6 rounded-3xl space-y-4">
                <div className="flex items-center justify-between border-b-[2px] border-dashed border-candy-ink/20 pb-3">
                  <div>
                    <h3 className="font-display font-black text-sm uppercase tracking-wider text-candy-ink flex items-center gap-2">
                      <SparklesCandySvg className="w-5 h-5" />
                      {t("profile.avatarGallery")}
                    </h3>
                    <p className="font-body text-xs text-candy-ink/75 font-semibold mt-0.5">
                      {t("profile.chooseTip")}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pt-2">
                  {avatars.map((avatar) => {
                    const isActive = avatar.seed === selectedAvatarSeed;
                    const isPending =
                      updateAvatar.isPending && avatar.seed === submittingSeed;

                    return (
                      <button
                        key={avatar.seed}
                        type="button"
                        onClick={() => handleAvatarChange(avatar.seed)}
                        disabled={updateAvatar.isPending}
                        className={cn(
                          "group rounded-2xl border-[3px] border-candy-ink p-2.5 text-center transition-all cursor-pointer relative",
                          isActive
                            ? "bg-candy-yellow -translate-y-1 shadow-[4px_4px_0_0_#2B2D42]"
                            : "bg-white hover:bg-candy-yellow/20 hover:-translate-y-0.5 shadow-[2px_2px_0_0_#2B2D42]",
                          isPending && "opacity-60 animate-pulse",
                        )}
                      >
                        {isActive && (
                          <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-candy-mint border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] flex items-center justify-center z-10">
                            <CheckmarkBadgeSvg className="w-3.5 h-3.5 text-white" />
                          </span>
                        )}
                        <div className="w-14 h-14 mx-auto rounded-xl bg-candy-cloud border-[2px] border-candy-ink flex items-center justify-center overflow-hidden">
                          <SpriteFrame
                            src={avatar.spritesheet}
                            scale={0.24}
                            width="48px"
                            height="52px"
                            frameClassName="w-14 h-14"
                            skeletonSize="36px"
                          />
                        </div>
                        <p className="mt-2 text-[10px] font-display font-black uppercase text-candy-ink truncate">
                          {avatar.name}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUDIO & MUSIC */}
          {activeTab === "sound" && (
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

                  <button
                    type="button"
                    onClick={() => setSfxEnabled(!sfxEnabled)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl font-display font-black text-xs uppercase border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] cursor-pointer",
                      sfxEnabled
                        ? "bg-candy-pink text-white"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {sfxEnabled ? t("sound.on") : t("sound.off")}
                  </button>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between font-mono text-xs font-black text-candy-ink">
                    <span>{t("sound.sfxVolume")}</span>
                    <span>
                      {sfxEnabled ? `${sfxVolume}%` : t("sound.muted")}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    disabled={!sfxEnabled}
                    value={sfxVolume}
                    onChange={(e) => setSfxVolume(Number(e.target.value))}
                    className="w-full h-3 bg-candy-pink/20 rounded-lg appearance-none cursor-pointer accent-candy-pink disabled:opacity-30 border-[1.5px] border-candy-ink"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleTestSfx}
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

                  <button
                    type="button"
                    onClick={() => {
                      if (bgmEnabled) {
                        stopBgm();
                        setTestingBgm(false);
                        setBgmEnabled(false);
                      } else {
                        setBgmEnabled(true);
                      }
                    }}
                    className={cn(
                      "px-3.5 py-1.5 rounded-xl font-display font-black text-xs uppercase border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] cursor-pointer",
                      bgmEnabled
                        ? "bg-candy-yellow text-candy-ink"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {bgmEnabled ? t("sound.on") : t("sound.off")}
                  </button>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between font-mono text-xs font-black text-candy-ink">
                    <span>{t("sound.bgmVolume")}</span>
                    <span>
                      {bgmEnabled ? `${bgmVolume}%` : t("sound.muted")}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    disabled={!bgmEnabled}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(Number(e.target.value))}
                    className="w-full h-3 bg-candy-yellow/20 rounded-lg appearance-none cursor-pointer accent-candy-yellow disabled:opacity-30 border-[1.5px] border-candy-ink"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleToggleTestBgm}
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
          )}

          {/* TAB 3: VISUALS & EFFECTS */}
          {activeTab === "graphics" && (
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
                  <button
                    type="button"
                    onClick={() => setConfettiEnabled(!confettiEnabled)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
                      confettiEnabled
                        ? "bg-candy-pink text-white"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {confettiEnabled ? t("graphics.on") : t("graphics.off")}
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setReduceMotion(!reduceMotion)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
                      reduceMotion
                        ? "bg-candy-mint text-white"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {reduceMotion ? t("graphics.on") : t("graphics.off")}
                  </button>
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
                  <button
                    type="button"
                    onClick={() => setHapticsEnabled(!hapticsEnabled)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
                      hapticsEnabled
                        ? "bg-candy-yellow text-candy-ink"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {hapticsEnabled ? t("graphics.on") : t("graphics.off")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BATTLE CONTROLS */}
          {activeTab === "controls" && (
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
                  <button
                    type="button"
                    onClick={() => setQuickAnswers(!quickAnswers)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
                      quickAnswers
                        ? "bg-candy-pink text-white"
                        : "bg-white text-candy-ink/60",
                    )}
                  >
                    {quickAnswers
                      ? t("controls.enabled")
                      : t("controls.disabled")}
                  </button>
                </div>

                {/* Key Map Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
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
                      className="p-3 rounded-xl bg-candy-cloud border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] flex items-center gap-3"
                    >
                      <span
                        className={cn(
                          "w-7 h-7 rounded-lg border-[2px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42] font-mono font-black text-xs flex items-center justify-center text-candy-ink",
                          item.color,
                        )}
                      >
                        {item.key}
                      </span>
                      <span className="font-display font-black text-xs text-candy-ink uppercase">
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
                <button
                  type="button"
                  onClick={() => setAutoFocus(!autoFocus)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-display font-black border-[2px] border-candy-ink transition-all shadow-[2px_2px_0_0_#2B2D42] shrink-0 cursor-pointer",
                    autoFocus
                      ? "bg-candy-mint text-white"
                      : "bg-white text-candy-ink/60",
                  )}
                >
                  {autoFocus ? t("controls.enabled") : t("controls.disabled")}
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: SYSTEM & DATA */}
          {activeTab === "system" && (
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
                    onClick={() => handleSwitchLanguage("vi")}
                    disabled={isPendingLocale}
                    className={cn(
                      "p-4 rounded-2xl border-[2.5px] border-candy-ink font-display font-black text-xs uppercase tracking-wide flex items-center justify-between transition-all cursor-pointer",
                      locale === "vi"
                        ? "bg-candy-mint text-white shadow-[3px_3px_0_0_#2B2D42] -translate-y-0.5"
                        : "bg-white text-candy-ink/70 hover:text-candy-ink hover:bg-candy-cloud shadow-[2px_2px_0_0_#2B2D42]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">🇻🇳</span> Tiếng Việt
                      (Vietnamese)
                    </span>
                    {locale === "vi" && (
                      <CheckmarkBadgeSvg className="w-5 h-5 text-white" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchLanguage("en")}
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
                    onClick={handleResetDefaults}
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
                    onClick={handleClearCache}
                    className="w-full py-2.5 rounded-xl bg-candy-pink text-white font-display font-black text-xs uppercase tracking-wider border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42] hover:-translate-y-0.5 active:translate-y-0.5 transition-all cursor-pointer"
                  >
                    {t("system.clearCacheBtn")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShellLayout>
  );
}
