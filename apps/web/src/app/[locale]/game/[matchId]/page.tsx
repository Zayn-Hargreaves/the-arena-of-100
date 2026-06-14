"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Timer } from "@/components/game/timer";
import { AnswerTile } from "@/components/game/answer-tile";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/ui/avatar-frame";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { LeaveMatchModal } from "@/components/game/leave-match-modal";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { Users, ShieldAlert, Swords, LogOut, Trophy, Eye } from "lucide-react";
import { avatars } from "@/lib/avatars";

interface GamePageProps {
  params: Promise<{ matchId: string; locale?: string }>;
}

export default function GamePage({ params }: GamePageProps) {
  const resolvedParams = use(params);
  const { matchId, locale } = resolvedParams;
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const {
    match,
    submitAnswer,
    userId,
    lastAnswerResult,
    remainingCount,
    leaveRoom,
    isEliminated,
    roomTerminated,
    roomTerminationMessage,
    room,
  } = useSocketStore();
  const t = useTranslations("Game");
  const tTermination = useTranslations("Game.termination");
  const tSpectator = useTranslations("Game.dropInSpectator");

  // Drop-in spectating baseline: a late-joiner entered the room as
  // SPECTATOR and is viewing the match read-only. The server enforces
  // the same gate independently (see MatchHandler.handleSubmitAnswer)
  // — this derivation only drives the UI.
  const isSpectator = room?.joinMode === "SPECTATOR";

  // Extract locale from pathname if not provided
  const currentLocale = locale || pathname.split("/")[1] || "vi";

  // Server-authoritative state
  const [timeLeft, setTimeLeft] = useState(15);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [roundCompleted, setRoundCompleted] = useState(false);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<
    string | null
  >(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Calculate time left based on server timestamp
  const calculateTimeLeft = useCallback(() => {
    if (!match?.roundEndTime) return 15;

    const now = Date.now();
    const endTime = match.roundEndTime;
    const timeDiff = Math.max(0, Math.floor((endTime - now) / 1000));
    return timeDiff;
  }, [match?.roundEndTime]);

  // Update time left based on server timestamp
  useEffect(() => {
    if (roundCompleted) return;

    // Clear existing timer
    clearTimers();

    // Set initial time
    setTimeLeft(calculateTimeLeft());

    // Update time every second
    intervalRef.current = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);

      // When time runs out, let server events handle the transition
      // We don't manually trigger round end anymore
    }, 1000);

    return () => {
      clearTimers();
    };
  }, [calculateTimeLeft, roundCompleted, clearTimers, match?.roundEndTime]);

  // Handle round completion (when server sends ROUND_ENDED via lastAnswerResult)
  useEffect(() => {
    // When we receive a round ended event (via lastAnswerResult with correctAnswer)
    if (lastAnswerResult?.correctAnswer && !roundCompleted) {
      clearTimers();
      setRoundCompleted(true);
      setRevealedCorrectAnswer(lastAnswerResult.correctAnswer);

      // Show results for 1 second then transition
      timerRef.current = setTimeout(() => {
        // Read the server-authoritative remaining count at fire-time to
        // avoid a stale closure over the selector value.
        const newCount = useSocketStore.getState().remainingCount;

        // Check if match should end
        timerRef.current = setTimeout(() => {
          if (newCount !== null && newCount <= 12) {
            router.push(`/result/${matchId}`);
            return;
          }

          // Reset for next round (this will be handled by server events)
          setTimeLeft(15);
          setSelectedAnswer(null);
          setRoundCompleted(false);
          setRevealedCorrectAnswer(null);
        }, 3000);
      }, 1000);
    }
  }, [
    lastAnswerResult,
    roundCompleted,
    clearTimers,
    matchId,
    currentLocale,
    router,
  ]);

  // Server has force-terminated this room (admin kill-switch). Toast once
  // and bounce the user back to the home page. useRef guards against
  // React strict-mode double-invoke and any future re-renders. We also
  // clear the component-level timers/intervals so the question card does
  // not keep ticking against a dead match.
  // Mirrors apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx (lobby
  // termination handler) so the same UX fires from both surfaces.
  const terminationNotifiedRef = useRef(false);
  useEffect(() => {
    if (!roomTerminated || terminationNotifiedRef.current) return;
    terminationNotifiedRef.current = true;

    // Stop the round timer / interval so the frozen question card does
    // not keep counting down after the room is gone.
    clearTimers();

    toast({
      title: tTermination("toastTitle"),
      description: roomTerminationMessage ?? tTermination("toastDefault"),
      variant: "error",
    });

    const redirectTimer = window.setTimeout(() => {
      router.push("/");
    }, 1500);

    return () => {
      window.clearTimeout(redirectTimer);
      useSocketStore.setState({
        roomTerminated: false,
        roomTerminationMessage: null,
      });
    };
  }, [
    roomTerminated,
    roomTerminationMessage,
    router,
    toast,
    tTermination,
    clearTimers,
  ]);

  // Auto-redirect to results page when match finishes
  useEffect(() => {
    if (match?.status !== "FINISHED") return;

    const redirectTimer = setTimeout(() => {
      router.push(`/result/${matchId}`);
    }, 3000); // Show "Match Finished" overlay for 3 seconds

    return () => clearTimeout(redirectTimer);
  }, [match?.status, matchId, router]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const handleSelectAnswer = (option: string) => {
    if (roundCompleted) return;
    // Drop-in spectating baseline: spectators cannot submit answers. The
    // server enforces the same gate (MatchHandler.handleSubmitAnswer) so
    // this is a UX-only short-circuit — a malicious client would still
    // be rejected by the server, but we hide the interactive control
    // entirely so the spectator UI stays read-only.
    if (isSpectator) return;
    setSelectedAnswer(option);

    // Submit answer to socket-store
    if (match?.id) {
      submitAnswer(match.id, match.currentRoundNo || 1, option);
    }
  };

  const getTileVariant = (option: string) => {
    if (roundCompleted) {
      if (revealedCorrectAnswer && option === revealedCorrectAnswer) {
        return "correct";
      }
      if (option === selectedAnswer) return "incorrect";
      return "disabled";
    }
    return selectedAnswer === option ? "selected" : "default";
  };

  const getPlayerAvatar = (name: string, id: string) => {
    if (id === userId && typeof window !== "undefined") {
      const seed = localStorage.getItem("avatarSeed") || "jellyfrog";
      const isAnimated = localStorage.getItem("avatarIsAnimated") === "true";
      const spritesheet = localStorage.getItem("avatarSpritesheet") || "";
      return { seed, isAnimated, spritesheet };
    }
    const hash = name
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = hash % avatars.length;
    const avatar = avatars[index];
    // Normalize avatar data to ensure consistent shape
    return {
      seed: avatar.seed,
      isAnimated: Boolean(avatar.isAnimated),
      spritesheet: avatar.spritesheet || "",
    };
  };

  const questionText = match?.currentQuestion?.content || t("fallbackQuestion");
  const options = match?.currentQuestion?.options || [
    "apps/api (NestJS)",
    "apps/web (Next.js)",
    "packages/game-core (Domain state machine)",
    "packages/shared (Types / Events)",
  ];

  return (
    <AppShellLayout>
      {isEliminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="jelly-card p-6 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-3 animate-bounce-in pointer-events-auto">
            <div className="flex justify-center">
              <Trophy className="w-12 h-12 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
            </div>
            <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink">
              {t("eliminatedOverlay.title")}
            </h2>
            <p className="font-sans text-sm font-bold text-candy-ink/70">
              {t("eliminatedOverlay.subtitle")}
            </p>
          </div>
        </div>
      )}

      {/* Drop-in spectator banner: a thin top-of-page strip telling the
          user they joined as a late spectator. We keep this lighter than
          the isEliminated fullscreen overlay because the spectator still
          has useful work to do (read the live question, follow the
          round, plan to leave). It also surfaces below the leave CTA
          so the user can leave at any time without dismissing first. */}
      {isSpectator && !isEliminated && (
        <div
          data-testid="game-spectator-banner"
          className="max-w-6xl mx-auto w-full mb-4 mt-2 px-4 py-3 rounded-2xl border-[3px] border-candy-ink bg-candy-blue/15 flex items-start gap-3 shadow-[3px_3px_0_0_#2B2D42]"
        >
          <Eye className="w-5 h-5 text-candy-blue stroke-[2.5] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider">
              {tSpectator("bannerTitle")}
            </h3>
            <p className="text-xs font-semibold text-candy-ink/70 leading-relaxed">
              {tSpectator("bannerBody")}
            </p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        {/* Game State Ribbon */}
        <div className="border-[3.5px] border-candy-ink bg-white rounded-3xl shadow-[5px_5px_0_0_#2B2D42] p-5 flex flex-col md:flex-row gap-4 items-center justify-between relative overflow-hidden">
          {/* Subtle decorative stripe */}
          <div className="absolute top-0 left-0 right-0 h-[6px] bg-gradient-to-r from-candy-pink via-candy-yellow to-candy-mint" />

          <div className="flex items-center gap-6 w-full md:w-auto">
            <div>
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                {t("matchingTitle")}
              </span>
              <span className="font-display font-black text-2xl text-candy-pink drop-shadow-[0_2px_0_rgba(0,0,0,0.02)]">
                {t("roundLabel")} {match?.currentRoundNo || 1}
              </span>
            </div>
            <div className="h-10 w-[3px] bg-candy-ink/10 hidden sm:block" />
            <div className="hidden sm:block">
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                {t("roundComplexity")}
              </span>
              <span className="font-sans text-sm font-bold text-candy-orange bg-candy-yellow/15 border-[2px] border-candy-orange/30 px-2.5 py-0.5 rounded-lg inline-block">
                {t("roundLevelExtreme")}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto border-t-[2.5px] border-candy-ink/10 md:border-0 pt-4 md:pt-0">
            {/* Active countdown circular timer component */}
            <Timer duration={15} timeLeft={timeLeft} size={72} height={72} />

            <div className="h-10 w-[3px] bg-candy-ink/10" />

            <div className="text-right">
              <span className="text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider flex items-center gap-1 justify-end">
                <Users className="w-3.5 h-3.5 text-candy-blue stroke-[2.5]" />
                {t("remainingLabel")}
              </span>
              <span className="font-display font-black text-3xl text-candy-blue">
                {remainingCount ?? match?.players?.length ?? 100} / 100
              </span>
            </div>
          </div>
        </div>

        {/* Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Question & Answer Panel */}
          <div className="lg:col-span-3 space-y-6">
            {/* Question Card */}
            <div className="p-8 md:p-10 rounded-3xl border-[3.5px] border-candy-ink bg-candy-yellow text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col justify-between min-h-[220px] relative overflow-hidden">
              <div className="bg-white border-[2.5px] border-candy-ink px-3 py-1 text-[9px] font-mono text-candy-ink font-black tracking-wider rounded-lg absolute top-3 left-4 shadow-[1.5px_1.5px_0_0_#2B2D42]">
                {t("rulesHeader")}
              </div>
              <div className="absolute top-3 right-4 text-xs font-display font-black text-candy-pink animate-pulse flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-candy-pink border border-candy-ink" />
                {roundCompleted ? t("lockedAnswer") : t("waiting")}
              </div>

              <h2 className="font-sans font-bold text-lg md:text-2xl text-candy-ink leading-relaxed tracking-wide pt-8">
                {questionText}
              </h2>
            </div>

            {/* Answer Options Grid or Spectator View. The isEliminated
                branch is the original spectator-on-elimination UI. The
                isSpectator branch is the new drop-in spectator path
                (late-joiner). Both render the same read-only block but
                with different copy so the user knows why they cannot
                answer. */}
            {isEliminated || isSpectator ? (
              <div className="p-8 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col items-center justify-center min-h-[220px] text-center space-y-4">
                <Swords className="w-12 h-12 text-candy-red stroke-[2]" />
                <h3 className="font-display font-black text-xl uppercase tracking-wide">
                  {isSpectator
                    ? tSpectator("bannerTitle")
                    : t("spectatorMode.title")}
                </h3>
                <p className="font-sans text-sm text-candy-ink/70">
                  {isSpectator
                    ? tSpectator("bannerBody")
                    : t("spectatorMode.subtitle")}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {options.map((option, idx) => {
                  const charCode = String.fromCharCode(65 + idx); // A, B, C, D
                  return (
                    <AnswerTile
                      key={charCode}
                      option={charCode}
                      content={option}
                      variant={getTileVariant(charCode)}
                      onClick={() => handleSelectAnswer(charCode)}
                      disabled={roundCompleted}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar Panel: Live Feed & Eliminators */}
          <div className="lg:col-span-1 space-y-6">
            <div className="p-5 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[5px_5px_0_0_#2B2D42] space-y-4">
              <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
                <Swords className="w-4 h-4 text-candy-red stroke-[2.5]" />
                {t("opponentsTitle")}
              </h3>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {[
                  {
                    name: "Zero_Cool",
                    state: "OK",
                    round: "18",
                    id: "sidebar1",
                  },
                  {
                    name: "Acid_Burn",
                    state: "OK",
                    round: "18",
                    id: "sidebar2",
                  },
                  {
                    name: "Lord_Nikon",
                    state: "ELIMINATED",
                    round: "14",
                    id: "sidebar3",
                  },
                  {
                    name: "Cereal_Killer",
                    state: "OK",
                    round: "18",
                    id: "sidebar4",
                  },
                  {
                    name: "Crash_Override",
                    state: "ELIMINATED",
                    round: "8",
                    id: "sidebar5",
                  },
                ].map((item, idx) => {
                  const avatarDetail = getPlayerAvatar(item.name, item.id);
                  const isAlive = item.state === "OK";

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-candy-cloud border-[2px] border-candy-ink text-xs shadow-[2px_2px_0_0_#2B2D42]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarFrame size="xs" className="bg-white">
                          {avatarDetail.isAnimated &&
                          avatarDetail.spritesheet ? (
                            <AnimatedSprite
                              src={avatarDetail.spritesheet}
                              scale={1.8}
                              row={0}
                              speed={120}
                            />
                          ) : (
                            <Avatar
                              size="xs"
                              fallback={avatarDetail.seed}
                              className="border-0 shadow-none"
                            />
                          )}
                        </AvatarFrame>
                        <span className="font-display font-black text-candy-ink truncate max-w-[80px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="shrink-0 ml-1">
                        {isAlive ? (
                          <span className="text-[9px] font-display font-black text-candy-ink bg-candy-mint border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                            {t("aliveStatus")}
                          </span>
                        ) : (
                          <span className="text-[9px] font-display font-black text-white bg-candy-red border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                            {t("eliminatedStatus")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
              <ShieldAlert className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
              <p className="text-[10px] leading-relaxed text-candy-ink font-semibold">
                <strong>{t("antiHackDescription")}:</strong>{" "}
                {t("antiHackDetails")}
              </p>
            </div>

            {/* Leave Match Button */}
            <button
              onClick={() => setShowLeaveModal(true)}
              className="w-full h-12 bg-candy-red text-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={roundCompleted || match?.status === "FINISHED"}
            >
              <LogOut className="w-4 h-4 mr-2 stroke-[2.5]" />
              {t("leaveMatchButton")}
            </button>
          </div>
        </div>
      </div>

      {/* Match Finished Overlay */}
      {match?.status === "FINISHED" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="jelly-card p-8 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-4 animate-bounce-in">
            <div className="flex justify-center">
              <Trophy className="w-16 h-16 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
            </div>
            <h2 className="font-display font-black text-3xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
              {t("matchFinishedOverlay.title")}
            </h2>
            <p className="font-sans text-sm font-bold text-candy-ink/70">
              {t("matchFinishedOverlay.subtitle")}
            </p>
          </div>
        </div>
      )}

      {/* Leave Match Modal */}
      <LeaveMatchModal
        open={showLeaveModal}
        onOpenChange={setShowLeaveModal}
        onConfirm={() => {
          const currentRoomId = useSocketStore.getState().room?.id;
          if (currentRoomId) {
            leaveRoom(currentRoomId);
          }
          router.push("/room/create");
        }}
      />
    </AppShellLayout>
  );
}
