"use client";

import React, { useState, useEffect, useRef } from "react";
import { AvatarSelector } from "@/components/home/avatar-selector";
import { MatchmakingModal } from "@/components/matchmaking/matchmaking-modal";
import { Link, useRouter } from "@/i18n/routing";
import { MiniGlyph } from "@/components/ui/mini-glyph";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import { ArrowRight, UserCheck } from "lucide-react";

import { avatars, type AvatarOption } from "@/lib/avatars";
import type { CreateTypes } from "canvas-confetti";

export default function HomePage() {
  const router = useRouter();
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
    localStorage.setItem("callsign", name);
    localStorage.setItem("avatarSeed", opt.seed);
    localStorage.setItem("avatarEmoji", "");
    localStorage.setItem("avatarName", opt.name);
    localStorage.setItem("avatarIsAnimated", opt.isAnimated ? "true" : "false");
    localStorage.setItem(
      "avatarSpritesheet",
      opt.isAnimated && opt.spritesheet ? opt.spritesheet : "",
    );
    localStorage.setItem("petSeed", "");
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
        Skip to main content
      </a>
      <canvas
        ref={confettiCanvasRef}
        className="pointer-events-none fixed inset-0 z-50"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Playful Floating Emojis Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
        <div className="absolute top-[15%] left-[8%] text-7xl floating-candy opacity-25">
          🍬
        </div>
        <div className="absolute top-[20%] right-[10%] text-6xl floating-donut opacity-25">
          🍩
        </div>
        <div className="absolute bottom-[25%] left-[5%] text-7xl floating-star opacity-20">
          ⭐
        </div>
        <div className="absolute bottom-[15%] right-[8%] text-8xl floating-candy opacity-25">
          🎈
        </div>
        <div className="absolute top-[50%] left-[85%] text-5xl floating-star opacity-15">
          ✨
        </div>
      </div>

      {/* Header Navigation */}
      <header className="bg-[#FFF8E7] border-b-5 border-candy-ink py-4 sticky top-0 z-40 shadow-[0_5px_0_0_#2B2D42]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="hover:animate-bounce bg-candy-pink text-white font-display text-xl md:text-2xl px-5 py-2.5 border-4 border-candy-ink rounded-2xl transform -rotate-3 shadow-[4px_4px_0_0_#2B2D42] cursor-pointer flex items-center gap-2">
              <MiniGlyph variant="leaderboard" className="w-6 h-6 text-white" />
              <span>ARENA 100</span>
            </div>
            <span className="hidden md:inline-flex bg-candy-mint text-white font-display text-xs px-3 py-1.5 border-3 border-candy-ink rounded-full transform rotate-2 items-center gap-1.5">
              LỐ LĂNG • VÔ TRI <span aria-hidden="true">☺</span>
            </span>
          </div>

          {/* Online Count Styled as Bubbly Badge */}
          <div className="flex items-center gap-2 bg-candy-yellow border-4 border-candy-ink px-4 py-1.5 rounded-2xl shadow-[3px_3px_0_0_#2B2D42] transform rotate-1">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-candy-red opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-candy-red"></span>
            </span>
            <span className="font-display text-xs tracking-tight text-candy-ink uppercase">
              12,408 CON NGHÈO ĐANG ONLINE
            </span>
          </div>
        </div>
      </header>

      {/* Main Registration Area */}
      <section className="flex-grow flex items-center justify-center py-12 px-4 relative z-10">
        <div className="w-full max-w-lg">
          {/* Goofy Hero Title Area */}
          <div className="text-center mb-8 relative">
            <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 text-7xl select-none animate-bounce">
              👑
            </div>
            <h1 className="font-display text-4xl md:text-5xl text-candy-ink drop-shadow-[4px_4px_0_#FFE5EC] uppercase tracking-tight transform -rotate-2 mt-6">
              ĐẤU TRƯỜNG VÔ TRI
            </h1>
            <p className="font-hand text-3xl text-candy-orange mt-1 font-bold">
              Ai sai người đó bay màu! 🔥🎮
            </p>
          </div>

          {/* Giant Entry Card */}
          <div className="jelly-card p-6 md:p-8 bg-white relative">
            {/* Subway Surfers Graffiti Accents */}
            <div className="absolute -top-3 -right-3 bg-candy-mint text-white font-display text-xs px-4 py-1.5 border-4 border-candy-ink rounded-xl transform rotate-6 shadow-[2px_2px_0_0_#000] flex items-center gap-1">
              GUEST LOGIN OK ✨
            </div>

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
                  className="font-display text-sm text-candy-ink block mb-2 uppercase tracking-wide"
                  htmlFor="nickname"
                >
                  BIỆT DANH GIANG HỒ 🔥
                </label>
                <div className="relative">
                  <input
                    required
                    disabled={isSubmitting}
                    maxLength={16}
                    className="w-full bg-candy-cloud border-4 border-candy-ink text-candy-ink font-display text-xl rounded-2xl py-4 px-5 focus:ring-4 focus:ring-candy-pink/30 focus:border-candy-ink transition-all placeholder:text-candy-ink/45 outline-none disabled:opacity-50"
                    id="nickname"
                    placeholder="Gõ tên vô tri vào đây..."
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                  {username && (
                    <div
                      className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center text-candy-mint"
                      title="Đã đồng bộ socket"
                    >
                      <UserCheck className="w-5 h-5" />
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
                  <MiniGlyph variant="trend" className="w-5 h-5" />
                  VÀO ĐẤU TRƯỜNG
                </Button>

                {/* Secondary private room bubble button */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleCreateRoom}
                    className="w-full min-h-12 bg-white hover:bg-candy-cloud text-candy-ink font-display text-[11px] border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-bold leading-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    TẠO PHÒNG RIÊNG
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsJoining(!isJoining)}
                    className="w-full min-h-12 bg-candy-cloud/40 hover:bg-candy-cloud text-candy-ink font-display text-[11px] border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-bold leading-4 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Navigation links inside login container */}
            <div className="mt-6 pt-4 flex justify-center gap-6 text-xs font-mono border-t-3 border-candy-ink">
              <Link
                href="/rankings"
                className="text-candy-ink hover:text-candy-blue flex items-center gap-1.5 font-bold"
              >
                <MiniGlyph variant="leaderboard" className="w-4 h-4" />
                {t("rankings")}
              </Link>
              <span className="text-candy-ink/20">|</span>
              <Link
                href="/settings"
                className="text-candy-ink hover:text-candy-blue flex items-center gap-1.5 font-bold"
              >
                <MiniGlyph variant="settings" className="w-4 h-4" />
                {t("settings")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer Area */}
      <footer className="bg-candy-ink text-white w-full py-8 border-t-5 border-candy-ink relative z-10 shadow-[0_-5px_0_0_#2B2D42]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center px-4 md:px-8 gap-4 text-center">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="font-display text-xl text-candy-yellow flex items-center gap-2">
              <MiniGlyph variant="leaderboard" className="w-5 h-5" />
              <span>ARENA OF 100</span>
            </div>
            <span className="font-hand text-lg text-gray-400">
              © 2026 CYBER_ARENA. GAME VÔ TRI KHÔNG DÙNG NÃO! 🤪🔥
            </span>
          </div>
          <div className="flex gap-6 font-hand text-xl text-gray-300">
            <a
              className="hover:text-candy-yellow hover:underline transition-colors"
              href="#terms"
            >
              Điều khoản Đấu võ
            </a>
            <span>•</span>
            <a
              className="hover:text-candy-yellow hover:underline transition-colors"
              href="#rules"
            >
              Khai trừ Gian lận
            </a>
          </div>
        </div>
      </footer>

      {/* Matchmaking Queue Modal */}
      <MatchmakingModal />
    </main>
  );
}
