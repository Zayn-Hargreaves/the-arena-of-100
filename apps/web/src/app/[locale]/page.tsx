"use client";

import React, { useState, useEffect, useRef } from "react";
import { MatchmakingModal } from "@/components/matchmaking/matchmaking-modal";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { useSocketStore } from "@/stores/socket-store";
import { avatars, type AvatarOption } from "@/lib/avatars";
import { apiSendJson } from "@/lib/api-client";
import { DailyModeCard } from "@/components/home/daily-mode-card";
import { GameFeaturesBanner } from "@/components/home/game-features-banner";
import { HomeHeader } from "@/components/home/home-header";
import { HomeHero } from "@/components/home/home-hero";
import { HomeArenaCard } from "@/components/home/home-arena-card";
import { HomeFooter } from "@/components/home/home-footer";
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

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (username) {
      setNickname(username);
    }
  }, [username]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedName = localStorage.getItem("callsign");
      const savedSeed = localStorage.getItem("avatarSeed");
      if (savedName) setNickname(savedName);
      if (savedSeed) {
        const idx = avatars.findIndex((a) => a.seed === savedSeed);
        if (idx !== -1) setAvatarIndex(idx);
      }
    } catch {
      // Storage unavailable or SecurityError
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

  const syncAvatarOnServer = async (opt: AvatarOption) => {
    const token = useSocketStore.getState().accessToken;
    if (token) {
      await apiSendJson(
        "/api/v1/users/me/avatar",
        "PATCH",
        { avatar: opt.seed },
        token,
      );
    }
  };

  const runAuthFlow = async (
    action: () => void | Promise<void>,
    activeAvatar?: AvatarOption,
  ) => {
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
        const avatarToSync = activeAvatar ?? avatars[avatarIndex];
        try {
          await syncAvatarOnServer(avatarToSync);
        } catch (err) {
          console.error("Failed to sync avatar:", err);
          toast({
            variant: "error",
            description: getAuthErrorMessage(err),
          });
          return;
        }
        saveAvatarToLocalStorage(nickname.trim(), avatarToSync);
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
    }, activeAvatar);
  };

  const handleCreateRoom = () => {
    if (isSubmitting) return;
    if (!nickname.trim()) {
      toast({ description: t("alerts.enterNicknameCreate") });
      return;
    }
    const activeAvatar = avatars[avatarIndex];
    void runAuthFlow(() => {
      router.push("/room/create");
    }, activeAvatar);
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
    void runAuthFlow(() => {
      router.push(`/lobby/${roomCode.trim().toUpperCase()}`);
    }, activeAvatar);
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

      <HomeHeader />

      {/* Main Content Area */}
      <section className="flex-grow py-8 md:py-12 px-4 md:px-8 relative z-10">
        <div className="max-w-6xl mx-auto w-full">
          <HomeHero />

          {/* 2-Column Layout on Large Screens */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Quick Match & Room Control (7 cols) */}
            <div className="lg:col-span-7">
              <HomeArenaCard
                nickname={nickname}
                setNickname={setNickname}
                roomCode={roomCode}
                setRoomCode={setRoomCode}
                isJoining={isJoining}
                setIsJoining={setIsJoining}
                isSubmitting={isSubmitting}
                avatar={currentAvatar}
                squash={squash}
                cycleAvatar={cycleAvatar}
                username={username}
                onQuickMatchSubmit={handleQuickMatchSubmit}
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
              />
            </div>

            {/* Right Column: Game Modes & Hub (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              <DailyModeCard />
              <GameFeaturesBanner />
            </div>
          </div>
        </div>
      </section>

      <HomeFooter />

      {/* Matchmaking Queue Modal */}
      <MatchmakingModal />
    </main>
  );
}
