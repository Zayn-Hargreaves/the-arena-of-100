"use client";

import React, { useState, useEffect, useRef } from "react";
import { AvatarSelector } from "@/components/home/avatar-selector";
import { MatchmakingModal } from "@/components/matchmaking/matchmaking-modal";
import { Link, useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import {
  CandySvg,
  DonutSvg,
  StarSvg,
  BalloonSvg,
  SparkleSvg,
  CrownSvg,
  FlameSvg,
  SmileySvg,
  SparkleSmallSvg,
  UserCheckSvg,
  ArrowRightSvg,
  SettingsGearSvg,
  BombSvg,
  SwordsSvg,
} from "@/components/home/home-icons";

import { avatars, type AvatarOption } from "@/lib/avatars";
import { apiSendJson } from "@/lib/api-client";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { PolicyModal, type PolicyType } from "@/components/home/policy-modal";
import { DailyModeCard } from "@/components/home/daily-mode-card";
import { GameFeaturesBanner } from "@/components/home/game-features-banner";
import { ProfessorGreetingCard } from "@/components/home/professor-greeting-card";
import type { CreateTypes } from "canvas-confetti";

export default function HomePage() {
  const router = useRouter();
  const tCommon = useTranslations("common");
  const t = useTranslations("HomePage");
  const tErrors = useTranslations("Errors");
  const { toast } = useToast();
  const { username, connect, authenticate, joinMatchmaking } = useSocketStore();

  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [squash, setSquash] = useState(false);
  const [activePolicy, setActivePolicy] = useState<PolicyType | null>(null);

  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiInstanceRef = useRef<CreateTypes | null>(null);

  useEffect(() => {
    let isMounted = true;

    import("canvas-confetti").then((module) => {
      if (!isMounted || !confettiCanvasRef.current) return;
      confettiInstanceRef.current = module.create(confettiCanvasRef.current, {
        resize: true,
        useWorker: true,
        disableForReducedMotion: true,
      });
    });

    return () => {
      isMounted = false;
      confettiInstanceRef.current?.reset();
      confettiInstanceRef.current = null;
    };
  }, []);

  // Auto connect socket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // If already authenticated in store, sync nickname field
  useEffect(() => {
    if (username) {
      setNickname(username);
    }
  }, [username]);

  // Synced state on mount from localStorage if it exists
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedName = localStorage.getItem("callsign");
    const savedSeed = localStorage.getItem("avatarSeed");
    if (savedName) setNickname(savedName);
    if (savedSeed) {
      const idx = avatars.findIndex((a) => a.seed === savedSeed);
      if (idx !== -1) setAvatarIndex(idx);
    }
  }, []);

  const getAuthErrorMessage = (err: unknown): string => {
    const KNOWN_ERROR_CODES = new Set([
      "ROOM_FULL",
      "INVALID_ROOM_CODE",
      "MATCH_ALREADY_STARTED",
      "USER_ALREADY_EXISTS",
      "ROOM_NOT_FOUND",
      "CARD_NOT_IN_HAND",
      "INVALID_CARD_TARGET",
      "AOE_CAP_REACHED",
      "COMMAND_ID_CONFLICT",
      "CARD_NOT_FOUND",
      "INVALID_COMMAND_ID",
      "SPECTATOR_CANNOT_ANSWER",
      "PLAYER_DISCONNECTED",
      "MATCH_NOT_FOUND",
      "UNAUTHORIZED",
      "INVALID_PAYLOAD",
      "INTERNAL_ERROR",
      "TOPIC_VOTING_CLOSED",
      "INVALID_TOPIC",
      "USERNAME_TAKEN",
      "UNKNOWN_ERROR",
    ]);

    if (err instanceof Error) {
      const code = err.message;
      if (KNOWN_ERROR_CODES.has(code)) {
        try {
          return tErrors(code as Parameters<typeof tErrors>[0]);
        } catch {
          return t("alerts.authFailed");
        }
      }
    }
    return t("alerts.authFailed");
  };

  const runAuthFlow = async (action: () => void | Promise<void>) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      let authenticated = false;
      try {
        await connect();
        await authenticate(nickname.trim());
        authenticated = true;
      } catch (err) {
        toast({
          variant: "error",
          description: getAuthErrorMessage(err),
        });
      }

      if (authenticated) {
        try {
          await action();
        } catch (err) {
          console.error("Action error:", err);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveAvatarToLocalStorage = (name: string, opt: AvatarOption) => {
    try {
      localStorage.setItem("callsign", name);
      localStorage.setItem("avatarSeed", opt.seed);
      localStorage.setItem("avatarEmoji", "");
      localStorage.setItem("avatarName", opt.name);
      localStorage.setItem(
        "avatarIsAnimated",
        opt.isAnimated ? "true" : "false",
      );
      localStorage.setItem(
        "avatarSpritesheet",
        opt.isAnimated && opt.spritesheet ? opt.spritesheet : "",
      );
      localStorage.setItem("petSeed", "");
      window.dispatchEvent(new Event("storage"));

      const token = useSocketStore.getState().accessToken;
      if (token) {
        void apiSendJson(
          "/api/v1/users/me/avatar",
          "PATCH",
          { avatar: opt.seed },
          token,
        ).catch(() => {});
      }
    } catch {
      // Ignore localStorage errors
    }
  };

  const createConfetti = (x: number, y: number) => {
    const confetti = confettiInstanceRef.current;
    if (!confetti || typeof window === "undefined") return;

    const origin = {
      x: x / window.innerWidth,
      y: y / window.innerHeight,
    };

    void confetti({
      particleCount: 60,
      spread: 90,
      startVelocity: 40,
      scalar: 1.1,
      ticks: 140,
      colors: [
        "#FF85A2",
        "#FFD000",
        "#2EC4B6",
        "#3A86C8",
        "#2BB8D8",
        "#FF7A00",
      ],
      origin,
    });
  };

  const handleQuickMatchSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNickname") });
      return;
    }

    const activeAvatar = avatars[avatarIndex];
    saveAvatarToLocalStorage(nickname.trim(), activeAvatar);

    // Trigger confetti from screen coordinates of submit button
    const target = e.currentTarget as HTMLFormElement;
    const submitBtn = target.querySelector("button[type='submit']");
    if (submitBtn) {
      const rect = submitBtn.getBoundingClientRect();
      const clickX = rect.left + rect.width / 2 + window.scrollX;
      const clickY = rect.top + rect.height / 2 + window.scrollY;
      createConfetti(clickX, clickY);
    }

    void runAuthFlow(() => {
      joinMatchmaking();
    });
  };

  const handleCreateRoom = () => {
    if (isSubmitting) return;
    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNicknameCreate") });
      return;
    }
    const activeAvatar = avatars[avatarIndex];
    saveAvatarToLocalStorage(nickname.trim(), activeAvatar);
    void runAuthFlow(() => {
      router.push("/room/create");
    });
  };

  const handleJoinRoom = () => {
    if (isSubmitting) return;
    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNicknameJoin") });
      return;
    }
    if (!roomCode.trim()) {
      toast({ description: t("alerts.enterRoomCode") });
      return;
    }
    const activeAvatar = avatars[avatarIndex];
    saveAvatarToLocalStorage(nickname.trim(), activeAvatar);
    void runAuthFlow(() => {
      router.push(`/lobby/${roomCode.trim().toUpperCase()}`);
    });
  };

  const cycleAvatar = (direction: number) => {
    setSquash(true);
    setTimeout(() => {
      setAvatarIndex(
        (prev) => (prev + direction + avatars.length) % avatars.length,
      );
      setSquash(false);
    }, 150);
  };

  const currentAvatar = avatars[avatarIndex] || avatars[0];

  return (
    <main
      id="main-content"
      className="text-candy-ink min-h-screen flex flex-col font-sans selection:bg-candy-pink selection:text-white relative overflow-x-hidden antialiased"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-3 focus:rounded-2xl focus:bg-white focus:text-candy-ink focus:border-[3px] focus:border-candy-ink focus:shadow-[4px_4px_0_0_#2B2D42] focus:font-display focus:font-black focus:text-xs focus:uppercase"
      >
        {tCommon("skipToMainContent")}
      </a>
      <canvas
        ref={confettiCanvasRef}
        className="pointer-events-none fixed inset-0 z-50"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Playful Floating SVG Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
        <div className="absolute top-[15%] left-[8%] floating-candy opacity-35">
          <CandySvg size={72} />
        </div>
        <div className="absolute top-[20%] right-[10%] floating-donut opacity-35">
          <DonutSvg size={68} />
        </div>
        <div className="absolute bottom-[25%] left-[5%] floating-star opacity-30">
          <StarSvg size={64} />
        </div>
        <div className="absolute bottom-[15%] right-[8%] floating-candy opacity-35">
          <BalloonSvg size={76} />
        </div>
        <div className="absolute top-[50%] left-[85%] floating-star opacity-25">
          <SparkleSvg size={52} />
        </div>
      </div>

      {/* Header Navigation */}
      <header className="bg-[#FFF8E7] border-b-5 border-candy-ink py-2.5 sm:py-3.5 sticky top-0 z-40 shadow-[0_5px_0_0_#2B2D42]">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 flex justify-between items-center gap-2">
          {/* Brand Logo & Fun Tag */}
          <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
            <Link
              href="/"
              className="hover:scale-105 transition-transform bg-candy-pink text-white font-display text-sm sm:text-xl md:text-2xl px-2.5 sm:px-4 md:px-5 py-1.5 sm:py-2 border-3 sm:border-4 border-candy-ink rounded-2xl transform -rotate-2 shadow-[2.5px_2.5px_0_0_#2B2D42] sm:shadow-[4px_4px_0_0_#2B2D42] flex items-center gap-1.5 sm:gap-2 whitespace-nowrap"
            >
              <CrownSvg
                size={20}
                className="sm:w-6 sm:h-6 drop-shadow-none shrink-0"
              />
              <span>{t("brand")}</span>
            </Link>
            <span className="hidden lg:inline-flex bg-candy-mint text-white font-display text-xs px-3.5 py-1.5 border-3 border-candy-ink rounded-full transform rotate-2 items-center gap-1.5 shadow-[2px_2px_0_0_#2B2D42]">
              <span>{t("taglineBadge")}</span>
              <SmileySvg size={16} />
            </span>
          </div>

          {/* Right Controls: Online Pill + Settings Gear + Language Switcher */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 md:gap-3 shrink-0">
            {/* Online Count Styled as Subway Surfers Coin/Trophy Pill */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-candy-yellow border-2.5 sm:border-3 md:border-4 border-candy-ink px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-2xl shadow-[2px_2px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] transform rotate-1 whitespace-nowrap shrink-0">
              <span className="relative flex h-2 w-2 sm:h-2.5 sm:w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-candy-red opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 sm:h-2.5 sm:w-2.5 bg-candy-red"></span>
              </span>
              <span className="font-display text-[10px] sm:text-xs md:text-sm tracking-tight text-candy-ink uppercase font-black">
                <span className="hidden md:inline">
                  {t("onlineCount", { count: "12,408" })}
                </span>
                <span className="md:hidden">12.4k Online</span>
              </span>
            </div>

            {/* Settings Arcade Button */}
            <Link
              href="/settings"
              className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-2xl bg-white hover:bg-candy-yellow border-2 sm:border-3 md:border-4 border-candy-ink text-candy-ink shadow-[2px_2px_0_0_#2B2D42] sm:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-none hover:scale-105 transition-all flex items-center justify-center shrink-0"
              aria-label={t("settings")}
            >
              <SettingsGearSvg
                size={16}
                className="sm:w-5 sm:h-5 md:w-[22px] md:h-[22px]"
              />
            </Link>

            {/* Language Switcher Toggle */}
            <LanguageToggle />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <section className="flex-grow py-8 md:py-12 px-4 md:px-8 relative z-10">
        <div className="max-w-6xl mx-auto w-full">
          {/* Goofy Hero Title Area */}
          <div className="text-center mb-8 md:mb-10 relative">
            <div className="inline-block select-none animate-bounce mb-1">
              <CrownSvg size={64} />
            </div>
            <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-candy-ink drop-shadow-[4px_4px_0_#FFE5EC] uppercase tracking-tight transform -rotate-1">
              {t("heroTitle")}
            </h1>
            <div className="mt-3 inline-flex items-center gap-2.5 bg-white border-3 border-candy-ink px-4 sm:px-5 py-1.5 rounded-full shadow-[3px_3px_0_0_#2B2D42] transform rotate-1 hover:rotate-0 transition-transform">
              <FlameSvg size={18} className="shrink-0" />
              <span className="font-display text-xs sm:text-sm md:text-base text-candy-ink uppercase font-black tracking-wide">
                {t("heroSubtitle")}
              </span>
              <BombSvg size={20} className="shrink-0" />
            </div>
          </div>

          {/* 2-Column Layout on Large Screens */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Quick Match & Room Control (7 cols) */}
            <div className="lg:col-span-7">
              <div className="jelly-card p-6 md:p-8 bg-white relative">
                {/* Subway Surfers Graffiti Accents */}
                <div className="absolute -top-3 -right-3 bg-candy-mint text-white font-display text-xs px-4 py-1.5 border-4 border-candy-ink rounded-xl transform rotate-6 shadow-[2px_2px_0_0_#000] flex items-center gap-1.5">
                  <span>{t("guestLogin")}</span>
                  <SparkleSmallSvg size={14} />
                </div>

                {/* Professor Attendance Desk / Greeting */}
                <ProfessorGreetingCard
                  nickname={nickname}
                  avatarName={currentAvatar.name}
                />

                <form onSubmit={handleQuickMatchSubmit} className="space-y-6">
                  <AvatarSelector
                    avatar={currentAvatar}
                    isAnimating={squash}
                    onPrevious={() => cycleAvatar(-1)}
                    onNext={() => cycleAvatar(1)}
                  />

                  {/* Comic-book style Callsign / Nickname Input */}
                  <div className="text-left">
                    <label
                      className="font-display text-sm text-candy-ink mb-2 uppercase tracking-wide flex items-center gap-1.5"
                      htmlFor="nickname"
                    >
                      <span>{t("nicknameLabel")}</span>
                      <FlameSvg size={18} />
                    </label>
                    <div className="relative">
                      <input
                        required
                        disabled={isSubmitting}
                        maxLength={16}
                        className="w-full bg-candy-cloud border-4 border-candy-ink text-candy-ink font-display text-xl rounded-2xl py-4 px-5 focus:ring-4 focus:ring-candy-pink/30 focus:border-candy-ink transition-all placeholder:text-candy-ink/45 outline-none disabled:opacity-50"
                        id="nickname"
                        placeholder={t("nicknamePlaceholder")}
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                      />
                      {username && (
                        <div
                          className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center text-candy-mint"
                          title={t("socketSynced")}
                        >
                          <UserCheckSvg size={20} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 space-y-4">
                    {/* Primary Giant 3D Play button */}
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full min-h-14 jelly-btn bg-candy-mint text-white font-display text-xl py-4 uppercase tracking-wide flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      <SwordsSvg size={24} className="shrink-0" />
                      <span>{t("enterArena")}</span>
                    </Button>

                    {/* Secondary private room bubble buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleCreateRoom}
                        className="w-full min-h-12 bg-white hover:bg-candy-cloud text-candy-ink font-display text-xs border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-black disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t("createRoom")}
                      </button>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setIsJoining(!isJoining)}
                        className="w-full min-h-12 bg-candy-cloud/40 hover:bg-candy-cloud text-candy-ink font-display text-xs border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-black disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t("joinRoom")}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Expansible Room Code form */}
                {isJoining && (
                  <div className="mt-6 space-y-3 text-left p-4 bg-candy-cloud border-4 border-candy-ink rounded-2xl animate-in slide-in-from-top duration-300">
                    <label
                      htmlFor="room-code"
                      className="block text-xs font-mono font-bold text-candy-ink uppercase tracking-wider"
                    >
                      {t("roomCode")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="room-code"
                        type="text"
                        disabled={isSubmitting}
                        placeholder={t("roomCodePlaceholder")}
                        maxLength={6}
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                        aria-label={t("roomCode")}
                        className="flex-1 h-12 px-4 rounded-xl bg-white border-3 border-candy-ink text-candy-ink placeholder:text-candy-ink/30 font-mono font-bold text-center tracking-widest text-sm uppercase focus:outline-none focus:border-candy-blue disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={handleJoinRoom}
                        className="min-h-12 px-5 rounded-xl bg-candy-blue border-3 border-candy-ink text-white hover:bg-candy-blue/90 shadow-[2px_2px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[0px_0px_0_0_#2B2D42] font-mono font-bold text-xs flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={t("joinRoom")}
                      >
                        <ArrowRightSvg size={20} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Game Modes & Hub (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              <DailyModeCard />
              <GameFeaturesBanner />
            </div>
          </div>
        </div>
      </section>

      {/* Footer Area */}
      <footer className="bg-candy-ink text-white w-full py-8 sm:py-10 border-t-4 border-candy-ink relative z-10 shadow-[0_-4px_0_0_#2B2D42]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center px-6 md:px-12 lg:px-16 gap-6">
          <div className="flex flex-col items-center md:items-start gap-1.5 text-center md:text-left">
            <div className="font-display font-black text-xl text-candy-yellow flex items-center gap-2.5 tracking-wide">
              <span className="w-8 h-8 rounded-xl bg-candy-yellow/20 border border-candy-yellow/40 flex items-center justify-center text-candy-yellow shadow-[1px_1px_0_0_#2B2D42]">
                <SwordsSvg size={18} />
              </span>
              <span>{t("brandFull")}</span>
            </div>
            <p className="font-mono text-xs font-semibold text-slate-300 flex items-center gap-2 flex-wrap justify-center md:justify-start">
              <span>{t("footerCopyright")}</span>
              <span className="inline-flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-md border border-white/15">
                <SmileySvg size={14} className="inline-block" />
                <FlameSvg
                  size={14}
                  className="inline-block text-candy-yellow"
                />
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => setActivePolicy("terms")}
              className="font-mono text-xs font-bold text-slate-200 bg-white/10 hover:bg-candy-yellow hover:text-candy-ink hover:border-candy-ink border border-white/20 rounded-xl px-4 py-2 shadow-[2px_2px_0_0_rgba(0,0,0,0.3)] transition-all cursor-pointer"
            >
              {t("terms")}
            </button>
            <button
              type="button"
              onClick={() => setActivePolicy("antiCheat")}
              className="font-mono text-xs font-bold text-slate-200 bg-white/10 hover:bg-candy-pink hover:text-white hover:border-candy-ink border border-white/20 rounded-xl px-4 py-2 shadow-[2px_2px_0_0_rgba(0,0,0,0.3)] transition-all cursor-pointer"
            >
              {t("antiCheat")}
            </button>
          </div>
        </div>
      </footer>

      {/* Terms of Battle / Anti-Cheat Policy Modal */}
      <PolicyModal
        isOpen={activePolicy !== null}
        type={activePolicy ?? "terms"}
        onClose={() => setActivePolicy(null)}
        onSelectType={(type) => setActivePolicy(type)}
      />

      {/* Matchmaking Queue Modal */}
      <MatchmakingModal />
    </main>
  );
}
