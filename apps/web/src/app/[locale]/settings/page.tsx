"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DEFAULT_AVATAR_SEED,
  isValidAvatarSeed,
  type AvatarSeed,
} from "@arena/shared";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useProfileStats } from "@/hooks/use-profile-stats";
import { useUpdateAvatar } from "@/hooks/use-update-avatar";
import { findAvatarBySeed } from "@/lib/avatars";
import { playCandyChime } from "@/lib/audio-preview";
import {
  invalidateAudioSettingsCache,
  startBgm,
  stopBgm,
  updateAudioSettings,
} from "@/lib/sound-engine";
import { usePathname, useRouter } from "@/i18n/routing";
import {
  SettingsHeroGearSvg,
  CheckmarkBadgeSvg,
  type TabId,
  type SettingsState,
  defaultSettings,
  STORAGE_KEY,
  SettingsTabBar,
  SettingsProfileTab,
  SettingsSoundTab,
  SettingsGraphicsTab,
  SettingsControlsTab,
  SettingsSystemTab,
} from "@/components/settings";

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

  // Profile callsign state
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

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearCacheOpen, setConfirmClearCacheOpen] = useState(false);

  const handleSwitchLanguage = (newLocale: "vi" | "en") => {
    if (newLocale === locale || isPendingLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  const handleResetDefaults = () => {
    setConfirmResetOpen(true);
  };

  const handlePerformResetDefaults = () => {
    setSfxEnabled(defaultSettings.sfxEnabled);
    setSfxVolume(defaultSettings.sfxVolume);
    setBgmEnabled(defaultSettings.bgmEnabled);
    setBgmVolume(defaultSettings.bgmVolume);
    setConfettiEnabled(defaultSettings.confettiEnabled);
    setReduceMotion(defaultSettings.reduceMotion);
    setHapticsEnabled(defaultSettings.hapticsEnabled);
    setQuickAnswers(defaultSettings.quickAnswers);
    setAutoFocus(defaultSettings.autoFocus);

    setConfirmResetOpen(false);

    toast({
      description: t("system.resetSuccess"),
      variant: "success",
    });
  };

  const handleClearCache = () => {
    setConfirmClearCacheOpen(true);
  };

  const handlePerformClearCache = () => {
    setConfirmClearCacheOpen(false);
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

      // Re-persist current in-memory settings so the persistence effect
      // doesn't lose them, and invalidate the sound-engine cache.
      const currentSettings: SettingsState = {
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
      invalidateAudioSettingsCache();

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
        <SettingsTabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Tab Content Panels */}
        <div
          role="tabpanel"
          id={`settings-tabpanel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          className="space-y-6"
        >
          {/* TAB 1: PROFILE & AVATAR */}
          {activeTab === "profile" && (
            <SettingsProfileTab
              callsign={callsign}
              onCallsignChange={setCallsign}
              onSaveCallsign={handleSaveCallsign}
              selectedAvatarSeed={selectedAvatarSeed}
              currentAvatar={currentAvatar}
              profileLoading={profileQuery.isLoading}
              onAvatarChange={handleAvatarChange}
              updateAvatarPending={updateAvatar.isPending}
              submittingSeed={submittingSeed}
            />
          )}

          {/* TAB 2: AUDIO & MUSIC */}
          {activeTab === "sound" && (
            <SettingsSoundTab
              sfxEnabled={sfxEnabled}
              onToggleSfx={() => setSfxEnabled(!sfxEnabled)}
              sfxVolume={sfxVolume}
              onSfxVolumeChange={setSfxVolume}
              onTestSfx={handleTestSfx}
              bgmEnabled={bgmEnabled}
              onToggleBgm={() => {
                if (bgmEnabled) {
                  stopBgm();
                  setTestingBgm(false);
                  setBgmEnabled(false);
                } else {
                  setBgmEnabled(true);
                }
              }}
              bgmVolume={bgmVolume}
              onBgmVolumeChange={setBgmVolume}
              testingBgm={testingBgm}
              onToggleTestBgm={handleToggleTestBgm}
            />
          )}

          {/* TAB 3: VISUALS & EFFECTS */}
          {activeTab === "graphics" && (
            <SettingsGraphicsTab
              confettiEnabled={confettiEnabled}
              onToggleConfetti={() => setConfettiEnabled(!confettiEnabled)}
              reduceMotion={reduceMotion}
              onToggleReduceMotion={() => setReduceMotion(!reduceMotion)}
              hapticsEnabled={hapticsEnabled}
              onToggleHaptics={() => setHapticsEnabled(!hapticsEnabled)}
            />
          )}

          {/* TAB 4: BATTLE CONTROLS */}
          {activeTab === "controls" && (
            <SettingsControlsTab
              quickAnswers={quickAnswers}
              onToggleQuickAnswers={() => setQuickAnswers(!quickAnswers)}
              autoFocus={autoFocus}
              onToggleAutoFocus={() => setAutoFocus(!autoFocus)}
            />
          )}

          {/* TAB 5: SYSTEM & DATA */}
          {activeTab === "system" && (
            <SettingsSystemTab
              locale={locale === "en" ? "en" : "vi"}
              isPendingLocale={isPendingLocale}
              onSwitchLanguage={handleSwitchLanguage}
              onResetDefaults={handleResetDefaults}
              onClearCache={handleClearCache}
            />
          )}
        </div>

        {/* Reset Defaults Confirmation Modal */}
        <Modal
          open={confirmResetOpen}
          onOpenChange={setConfirmResetOpen}
          title={t("system.resetTitle")}
          description={t("system.confirmReset")}
        >
          <div className="flex justify-end gap-3 pt-4 border-t border-candy-ink/10">
            <Button
              variant="secondary"
              onClick={() => setConfirmResetOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={handlePerformResetDefaults}>
              {t("system.resetBtn")}
            </Button>
          </div>
        </Modal>

        {/* Clear Cache Confirmation Modal */}
        <Modal
          open={confirmClearCacheOpen}
          onOpenChange={setConfirmClearCacheOpen}
          title={t("system.clearCacheTitle")}
          description={t("system.confirmClearCache")}
        >
          <div className="flex justify-end gap-3 pt-4 border-t border-candy-ink/10">
            <Button
              variant="secondary"
              onClick={() => setConfirmClearCacheOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button variant="danger" onClick={handlePerformClearCache}>
              {t("system.clearCacheBtn")}
            </Button>
          </div>
        </Modal>
      </div>
    </AppShellLayout>
  );
}
