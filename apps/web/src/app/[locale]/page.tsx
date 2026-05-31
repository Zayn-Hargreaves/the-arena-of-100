"use client";

import React, { useState, useEffect, useRef } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import {
  Swords,
  Trophy,
  Compass,
  ArrowRight,
  UserCheck,
  Sparkles,
  Smile,
} from "lucide-react";

import { avatars, type AvatarOption } from "@/lib/avatars";

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations("HomePage");
  const { toast } = useToast();
  const { username, connect, authenticate } = useSocketStore();

  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [avatarIndex, setAvatarIndex] = useState(0);
  const [squash, setSquash] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiInstanceRef = useRef<
    | (((options?: Record<string, unknown>) => Promise<unknown>) & {
        reset?: () => void;
      })
    | null
  >(null);

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
      confettiInstanceRef.current?.reset?.();
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

  const handleSaveNickname = () => {
    if (!nickname.trim()) return;
    authenticate(nickname.trim());
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
        "#A29BFE",
        "#FF7A00",
      ],
      origin,
    });
  };

  const triggerSubmitTransition = (
    e: React.FormEvent,
    callback: () => void,
  ) => {
    e.preventDefault();
    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNickname") });
      return;
    }

    const activeAvatar = avatars[avatarIndex];
    saveAvatarToLocalStorage(nickname.trim(), activeAvatar);
    handleSaveNickname();

    // Trigger confetti from screen coordinates of submit button
    const target = e.currentTarget as HTMLFormElement;
    const submitBtn = target.querySelector("button[type='submit']");
    if (submitBtn) {
      const rect = submitBtn.getBoundingClientRect();
      const clickX = rect.left + rect.width / 2 + window.scrollX;
      const clickY = rect.top + rect.height / 2 + window.scrollY;
      createConfetti(clickX, clickY);
    }

    setTimeout(callback, 650);
  };

  const handleQuickMatchSubmit = (e: React.FormEvent) => {
    triggerSubmitTransition(e, () => {
      router.push("/room/create");
    });
  };

  const handleCreateRoom = () => {
    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNicknameCreate") });
      return;
    }
    const activeAvatar = avatars[avatarIndex];
    saveAvatarToLocalStorage(nickname.trim(), activeAvatar);
    handleSaveNickname();
    router.push("/room/create");
  };

  const handleJoinRoom = () => {
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
    handleSaveNickname();
    router.push(`/lobby/${roomCode.trim().toUpperCase()}`);
  };

  const cycleAvatar = (direction: number) => {
    setSquash(true);
    setTimeout(() => {
      setAvatarIndex(
        (prev) => (prev + direction + avatars.length) % avatars.length,
      );
      setSquash(false);
    }, 100);
  };

  const currentAvatar = avatars[avatarIndex];

  return (
    <main className="text-candy-ink min-h-screen flex flex-col font-sans selection:bg-candy-pink selection:text-white relative bg-gradient-to-br from-[#FFF0F5] via-[#E6E6FA] to-[#E0F2FE] overflow-x-hidden antialiased">
      <canvas
        ref={confettiCanvasRef}
        className="pointer-events-none fixed inset-0 z-50"
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
              <Swords className="w-6 h-6 text-white" />
              <span>ARENA 100</span>
            </div>
            <span className="hidden md:inline-flex bg-candy-mint text-white font-display text-xs px-3 py-1.5 border-3 border-candy-ink rounded-full transform rotate-2 items-center gap-1.5">
              LỐ LĂNG • VÔ TRI <Smile className="w-3.5 h-3.5" />
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
      <main className="flex-grow flex items-center justify-center py-12 px-4 relative z-10">
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
              {/* Goofy Avatar Carousel Selector */}
              <div className="text-center">
                <label className="font-display text-sm text-candy-ink block mb-3 uppercase tracking-wider">
                  CHỌN HÌNH ĐẠI DIỆN
                </label>

                <div className="flex justify-center items-center gap-6">
                  {/* Left arrow button */}
                  <button
                    type="button"
                    onClick={() => cycleAvatar(-1)}
                    className="w-12 h-12 bg-candy-yellow border-4 border-candy-ink rounded-2xl flex items-center justify-center text-xl shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] hover:-translate-y-[2px] hover:shadow-[3px_5px_0_0_#2B2D42] transition-all"
                    aria-label="Avatar trước"
                  >
                    ◀
                  </button>

                  {/* Bouncy avatar circle wrapper */}
                  <div className="flex flex-col items-center">
                    <div
                      ref={containerRef}
                      className={`w-28 h-28 rounded-[2.2rem] bg-candy-cloud border-5 border-candy-ink flex items-center justify-center shadow-[4px_4px_0_0_#2B2D42] transition-transform duration-300 relative group overflow-hidden ${
                        squash
                          ? "scale-90 -rotate-6"
                          : "scale-105 rotate-3 hover:scale-110"
                      }`}
                    >
                      {currentAvatar.isAnimated && currentAvatar.spritesheet ? (
                        <AnimatedSprite
                          src={currentAvatar.spritesheet}
                          row={0}
                          scale={0.45}
                          width="86px"
                          height="86px"
                        />
                      ) : (
                        <Avatar
                          size="xl"
                          fallback={currentAvatar.name}
                          glow="none"
                          className="w-20 h-20 border-none bg-transparent"
                        />
                      )}
                    </div>
                    <span className="mt-3 bg-candy-pink text-white font-hand text-2xl px-4 py-0.5 border-3 border-candy-ink rounded-full shadow-[2px_2px_0_0_#000] transform -rotate-1">
                      {currentAvatar.name}
                    </span>
                  </div>

                  {/* Right arrow button */}
                  <button
                    type="button"
                    onClick={() => cycleAvatar(1)}
                    className="w-12 h-12 bg-candy-yellow border-4 border-candy-ink rounded-2xl flex items-center justify-center text-xl shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#2B2D42] hover:-translate-y-[2px] hover:shadow-[3px_5px_0_0_#2B2D42] transition-all"
                    aria-label="Avatar tiếp theo"
                  >
                    ▶
                  </button>
                </div>
              </div>

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
                    maxLength={16}
                    className="w-full bg-candy-cloud border-4 border-candy-ink text-candy-ink font-display text-xl rounded-2xl py-4 px-5 focus:ring-4 focus:ring-candy-pink/30 focus:border-candy-ink transition-all placeholder:text-candy-ink/45 outline-none"
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
                      <UserCheck className="w-6 h-6" />
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-4">
                {/* Primary Giant 3D Play button */}
                <Button
                  type="submit"
                  className="w-full h-14 jelly-btn bg-candy-mint text-white font-display text-xl py-4 uppercase tracking-wide flex items-center justify-center gap-3"
                >
                  <Sparkles className="w-5 h-5" />
                  VÀO ĐẤU TRƯỜNG
                </Button>

                {/* Secondary private room bubble button */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    className="w-full h-12 bg-white hover:bg-candy-cloud text-candy-ink font-display text-[11px] border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-bold"
                  >
                    TẠO PHÒNG RIÊNG
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsJoining(!isJoining)}
                    className="w-full h-12 bg-candy-cloud/40 hover:bg-candy-cloud text-candy-ink font-display text-[11px] border-4 border-candy-ink rounded-[1.5rem] shadow-[0_5px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[0_1px_0_0_#2B2D42] transition-all flex items-center justify-center gap-2 uppercase font-bold"
                  >
                    {t("joinRoom")}
                  </button>
                </div>
              </div>
            </form>

            {/* Expansible Room Code form */}
            {isJoining && (
              <div className="mt-6 space-y-3 text-left p-4 bg-candy-cloud border-4 border-candy-ink rounded-2xl animate-in slide-in-from-top duration-300">
                <label className="block text-xs font-mono font-bold text-candy-ink uppercase tracking-wider">
                  {t("roomCode")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t("roomCodePlaceholder")}
                    maxLength={6}
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    className="flex-1 h-12 px-4 rounded-xl bg-white border-3 border-candy-ink text-candy-ink placeholder:text-candy-ink/30 font-mono font-bold text-center tracking-widest text-sm uppercase focus:outline-none focus:border-candy-blue"
                  />
                  <button
                    onClick={handleJoinRoom}
                    className="px-5 rounded-xl bg-candy-blue border-3 border-candy-ink text-white hover:bg-candy-blue/90 shadow-[2px_2px_0_0_#2B2D42] active:translate-y-[2px] active:shadow-[0px_0px_0_0_#2B2D42] font-mono font-bold text-xs flex items-center justify-center transition-all"
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
                <Trophy className="w-4 h-4" />
                {t("rankings")}
              </Link>
              <span className="text-candy-ink/20">|</span>
              <Link
                href="/settings"
                className="text-candy-ink hover:text-candy-blue flex items-center gap-1.5 font-bold"
              >
                <Compass className="w-4 h-4" />
                {t("settings")}
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Area */}
      <footer className="bg-candy-ink text-white w-full py-8 border-t-5 border-candy-ink relative z-10 shadow-[0_-5px_0_0_#2B2D42]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center px-4 md:px-8 gap-4 text-center">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="font-display text-xl text-candy-yellow flex items-center gap-2">
              <Swords className="w-5 h-5" />
              <span>ARENA OF 100</span>
            </div>
            <span className="font-hand text-lg text-gray-400">
              © 2026 CYBER_ARENA. GAME VÔ TRI KHÔNG DÙNG NÃO! 🤪🔥
            </span>
          </div>
          <div className="flex gap-6 font-hand text-xl text-gray-300">
            <a
              className="hover:text-candy-yellow hover:underline transition-colors"
              href="#"
            >
              Điều khoản Đấu võ
            </a>
            <span>•</span>
            <a
              className="hover:text-candy-yellow hover:underline transition-colors"
              href="#"
            >
              Khai trừ Gian lận
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
