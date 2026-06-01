"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Timer } from "@/components/game/timer";
import { AnswerTile } from "@/components/game/answer-tile";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { usePathname } from "next/navigation";
import { Users, ShieldAlert, Swords } from "lucide-react";
import { avatars } from "@/lib/avatars";

interface GamePageProps {
  params: Promise<{ matchId: string; locale?: string }>;
}

export default function GamePage({ params }: GamePageProps) {
  const resolvedParams = use(params);
  const { matchId, locale } = resolvedParams;
  const router = useRouter();
  const pathname = usePathname();
  const { match, submitAnswer, userId, lastAnswerResult } = useSocketStore();

  // Extract locale from pathname if not provided
  const currentLocale = locale || pathname.split("/")[1] || "vi";

  // Server-authoritative state
  const [timeLeft, setTimeLeft] = useState(15);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [roundCompleted, setRoundCompleted] = useState(false);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<
    string | null
  >(null);
  const [remainingCount, setRemainingCount] = useState(100);

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

      // Show results for 3 seconds then transition
      timerRef.current = setTimeout(() => {
        // Update remaining count (this should ideally come from server)
        setRemainingCount((prev) => {
          const newCount = Math.max(1, Math.round(prev * 0.4));
          return newCount;
        });

        // Check if match should end
        timerRef.current = setTimeout(() => {
          // For now we'll use the existing logic as placeholder
          // In a full implementation, this would be driven by MATCH_FINISHED event
          if (remainingCount <= 12) {
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
    remainingCount,
    router,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const handleSelectAnswer = (option: string) => {
    if (roundCompleted) return;
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

  const questionText =
    match?.currentQuestion?.content ||
    "Trong kiến trúc hệ thống monorepo sử dụng pnpm & Turborepo, thư mục nào chứa các code logic thuần túy (pure domain logic state machine) không phụ thuộc vào framework?";
  const options = match?.currentQuestion?.options || [
    "apps/api (NestJS)",
    "apps/web (Next.js)",
    "packages/game-core (Domain state machine)",
    "packages/shared (Types / Events)",
  ];

  return (
    <AppShellLayout>
      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        {/* Game State Ribbon */}
        <div className="border-[3.5px] border-candy-ink bg-white rounded-3xl shadow-[5px_5px_0_0_#2B2D42] p-5 flex flex-col md:flex-row gap-4 items-center justify-between relative overflow-hidden">
          {/* Subtle decorative stripe */}
          <div className="absolute top-0 left-0 right-0 h-[6px] bg-gradient-to-r from-candy-pink via-candy-yellow to-candy-mint" />

          <div className="flex items-center gap-6 w-full md:w-auto">
            <div>
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                Trận Đấu Đang Diễn Ra
              </span>
              <span className="font-display font-black text-2xl text-candy-pink drop-shadow-[0_2px_0_rgba(0,0,0,0.02)]">
                VÒNG {match?.currentRoundNo || 1}
              </span>
            </div>
            <div className="h-10 w-[3px] bg-candy-ink/10 hidden sm:block" />
            <div className="hidden sm:block">
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                Độ Phức Tạp Vòng
              </span>
              <span className="font-sans text-sm font-bold text-candy-orange bg-candy-yellow/15 border-[2px] border-candy-orange/30 px-2.5 py-0.5 rounded-lg inline-block">
                Cấp độ: Cực Hạn
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
                Còn Lại
              </span>
              <span className="font-display font-black text-3xl text-candy-blue">
                {remainingCount} / 100
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
                QUY TẮC PHÒNG ĐẤU // CÂU HỎI HỆ THỐNG
              </div>
              <div className="absolute top-3 right-4 text-xs font-display font-black text-candy-pink animate-pulse flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-candy-pink border border-candy-ink" />
                {roundCompleted ? "ĐÃ KHÓA ĐÁP ÁN" : "ĐANG ĐỢI..."}
              </div>

              <h2 className="font-sans font-bold text-lg md:text-2xl text-candy-ink leading-relaxed tracking-wide pt-8">
                {questionText}
              </h2>
            </div>

            {/* Answer Options Grid */}
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
          </div>

          {/* Sidebar Panel: Live Feed & Eliminators */}
          <div className="lg:col-span-1 space-y-6">
            <div className="p-5 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[5px_5px_0_0_#2B2D42] space-y-4">
              <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
                <Swords className="w-4.5 h-4.5 text-candy-red stroke-[2.5]" />
                ĐỐI THỦ XUNG QUANH
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
                        {avatarDetail.isAnimated ? (
                          <div className="w-8 h-8 shrink-0 border-[1.5px] border-candy-ink rounded-lg bg-white overflow-hidden flex items-center justify-center relative shadow-[1px_1px_0_0_#2B2D42]">
                            <AnimatedSprite
                              src={avatarDetail.spritesheet!}
                              scale={1.8}
                              row={0}
                              speed={120}
                            />
                          </div>
                        ) : (
                          <Avatar
                            size="xs"
                            fallback={avatarDetail.seed}
                            className="border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42]"
                          />
                        )}
                        <span className="font-display font-black text-candy-ink truncate max-w-[80px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="shrink-0 ml-1">
                        {isAlive ? (
                          <span className="text-[9px] font-display font-black text-candy-ink bg-candy-mint border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                            SỐNG
                          </span>
                        ) : (
                          <span className="text-[9px] font-display font-black text-white bg-candy-red border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                            LOẠI
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
                <strong>Hệ thống Chống Hack:</strong> Thời gian phản hồi được
                máy chủ ghi nhận và so sánh độ lệch ping để đảm bảo tính công
                bằng tuyệt đối.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
