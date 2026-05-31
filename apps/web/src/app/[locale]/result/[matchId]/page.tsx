"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { Avatar } from "@/components/ui/avatar";
import { API_URL } from "@/lib/api";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Home,
  RotateCcw,
  Zap,
  Target,
  Hourglass,
  Swords,
} from "lucide-react";

interface ResultPageProps {
  params: Promise<{ matchId: string }>;
}

interface MatchResultApiResponse {
  winner?: {
    userId?: string;
    name?: string;
    avatarSeed?: string;
    spritesheet?: string;
    isAnimated?: boolean;
    totalScore?: number;
    averageSpeed?: string;
    accuracy?: string;
    survivedRounds?: string;
  };
  yourPerformance?: {
    userId?: string;
    name?: string;
    rank?: number;
    score?: number;
    speed?: string;
    accuracy?: string;
    eliminatedRound?: number | null;
  };
  players?: Array<{
    userId?: string;
    score?: number;
    user?: { id?: string; username?: string };
  }>;
  winnerId?: string | null;
}

type LoadState =
  | "loading"
  | "ready"
  | "not_found"
  | "unauthorized"
  | "network_error";

export default function ResultPage({ params }: ResultPageProps) {
  const { matchId } = use(params);
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [payload, setPayload] = useState<MatchResultApiResponse | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    const fetchResults = async () => {
      setLoadState("loading");

      try {
        const endpoints = [
          `${API_URL}/matches/${matchId}/results`,
          `${API_URL}/matches/${matchId}`,
        ];

        let response: Response | null = null;
        for (const endpoint of endpoints) {
          response = await fetch(endpoint, {
            credentials: "include",
            signal: abortController.signal,
          });

          // Fallback to /matches/:id when /results is not implemented.
          if (response.status !== 404) break;
        }

        if (!response) {
          setLoadState("network_error");
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setLoadState("unauthorized");
          return;
        }

        if (response.status === 404) {
          setLoadState("not_found");
          return;
        }

        if (!response.ok) {
          setLoadState("network_error");
          return;
        }

        const data = (await response.json()) as MatchResultApiResponse;
        setPayload(data);
        setLoadState("ready");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadState("network_error");
      }
    };

    void fetchResults();

    return () => {
      abortController.abort();
    };
  }, [matchId]);

  const winner = useMemo(() => {
    const players = (payload?.players ?? []).map((player) => ({
      id: player.userId ?? player.user?.id ?? "",
      name: player.user?.username ?? "Unknown",
      score: player.score ?? 0,
    }));
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const topPlayer = sorted[0];

    return {
      name: payload?.winner?.name ?? topPlayer?.name ?? "Đang cập nhật",
      spritesheet:
        payload?.winner?.spritesheet ??
        "/arena_of_100/jellyfrog_spritesheet.webp",
      isAnimated: payload?.winner?.isAnimated ?? true,
      totalScore: payload?.winner?.totalScore ?? topPlayer?.score ?? 0,
      averageSpeed: payload?.winner?.averageSpeed ?? "--",
      accuracy: payload?.winner?.accuracy ?? "--",
      survivedRounds: payload?.winner?.survivedRounds ?? "--",
    };
  }, [payload]);

  const yourPerformance = useMemo(() => {
    if (payload?.yourPerformance) {
      return {
        name: payload.yourPerformance.name ?? "Khách Đấu Thủ",
        rank: payload.yourPerformance.rank ?? 0,
        score: payload.yourPerformance.score ?? 0,
        speed: payload.yourPerformance.speed ?? "--",
        accuracy: payload.yourPerformance.accuracy ?? "--",
        eliminatedRound: payload.yourPerformance.eliminatedRound,
      };
    }

    const players = (payload?.players ?? []).map((player) => ({
      id: player.userId ?? player.user?.id ?? "",
      name: player.user?.username ?? "Khách Đấu Thủ",
      score: player.score ?? 0,
    }));
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const winnerId = payload?.winnerId ?? payload?.winner?.userId;
    const fallbackPlayer =
      sorted.find((player) => player.id !== winnerId) ?? sorted[0];
    const rank = fallbackPlayer
      ? sorted.findIndex((player) => player.id === fallbackPlayer.id) + 1
      : 0;

    return {
      name: fallbackPlayer?.name ?? "Khách Đấu Thủ",
      rank,
      score: fallbackPlayer?.score ?? 0,
      speed: "--",
      accuracy: "--",
      eliminatedRound: null,
    };
  }, [payload]);

  if (loadState === "loading") {
    return (
      <AppShellLayout>
        <div className="max-w-4xl mx-auto w-full pt-8 text-center font-display font-black text-candy-ink uppercase">
          Đang tải kết quả trận đấu...
        </div>
      </AppShellLayout>
    );
  }

  if (loadState === "not_found") {
    return (
      <AppShellLayout>
        <div className="max-w-4xl mx-auto w-full pt-8 text-center space-y-4">
          <p className="font-display font-black text-candy-ink uppercase">
            Không tìm thấy kết quả cho trận đấu này.
          </p>
          <button
            onClick={() => router.replace("/")}
            className="h-11 px-6 bg-candy-blue text-candy-ink border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase"
          >
            Về Trang Chủ
          </button>
        </div>
      </AppShellLayout>
    );
  }

  if (loadState === "unauthorized") {
    return (
      <AppShellLayout>
        <div className="max-w-4xl mx-auto w-full pt-8 text-center space-y-4">
          <p className="font-display font-black text-candy-ink uppercase">
            Bạn không có quyền xem kết quả trận này.
          </p>
          <button
            onClick={() => router.replace("/")}
            className="h-11 px-6 bg-candy-pink text-candy-ink border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase"
          >
            Quay Lại
          </button>
        </div>
      </AppShellLayout>
    );
  }

  if (loadState === "network_error") {
    return (
      <AppShellLayout>
        <div className="max-w-4xl mx-auto w-full pt-8 text-center space-y-4">
          <p className="font-display font-black text-candy-ink uppercase">
            Không thể tải dữ liệu trận đấu. Vui lòng thử lại.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="h-11 px-6 bg-candy-yellow text-candy-ink border-[3px] border-candy-ink rounded-2xl font-display font-black text-xs uppercase"
          >
            Tải Lại
          </button>
        </div>
      </AppShellLayout>
    );
  }

  return (
    <AppShellLayout>
      <div className="max-w-4xl mx-auto w-full space-y-8 pt-2 select-none animate-slide-up">
        {/* Banner Announcement */}
        <div className="text-center space-y-1">
          <span className="font-display font-black text-[10px] text-candy-pink uppercase tracking-widest animate-pulse">
            BẢN BÁO CÁO SAU TRẬN ĐẤU
          </span>
          <h1 className="font-display font-black text-4xl md:text-5xl text-candy-ink uppercase drop-shadow-[0_3px_0_rgba(0,0,0,0.05)]">
            KẾT QUẢ ĐẦU TRƯỜNG
          </h1>
          <p className="font-mono text-[9px] text-candy-ink/60 uppercase font-black tracking-widest">
            MATCH ID: {matchId.toUpperCase()}
          </p>
        </div>

        {/* Winner Highlight (Crown Card) */}
        <div className="p-6 md:p-8 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] flex flex-col md:flex-row items-center gap-6 relative overflow-hidden transition-all hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42]">
          {/* Winner Banner */}
          <div className="bg-candy-yellow text-candy-ink border-[2.5px] border-candy-ink px-3 py-1 text-[9px] font-display font-black tracking-wider rounded-lg absolute top-3 right-3 shadow-[2px_2px_0_0_#2B2D42]">
            QUÁN QUÂN ĐẦU TRƯỜNG
          </div>

          <div className="relative shrink-0">
            {winner.isAnimated ? (
              <div className="w-24 h-24 border-[3.5px] border-candy-ink rounded-2xl bg-candy-cloud overflow-hidden flex items-center justify-center relative shadow-[4px_4px_0_0_#2B2D42]">
                <AnimatedSprite
                  src={winner.spritesheet}
                  scale={3.8}
                  row={0}
                  speed={120}
                />
              </div>
            ) : (
              <Avatar
                size="xl"
                fallback={winner.name}
                className="border-[3.5px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42]"
              />
            )}
            <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-candy-yellow text-candy-ink flex items-center justify-center border-[3px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
              <Trophy className="w-5 h-5 fill-candy-ink stroke-[2.5]" />
            </div>
          </div>

          <div className="flex-1 space-y-4 text-center md:text-left">
            <div className="space-y-1">
              <h2 className="font-display font-black text-2xl text-candy-pink uppercase tracking-wider">
                {winner.name}
              </h2>
              <p className="font-sans font-bold text-sm text-candy-ink/75 leading-relaxed">
                Đã đánh bại 99 đối thủ khác để giành ngôi vị quán quân duy nhất!
              </p>
            </div>
            {/* Winner detailed metrics */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2.5 bg-candy-cloud border-[2px] border-candy-ink rounded-xl shadow-[2px_2px_0_0_#2B2D42]">
                <span className="block text-[8px] text-candy-ink/65 uppercase font-display font-black">
                  Điểm Số
                </span>
                <span className="font-display font-black text-sm text-candy-pink">
                  {winner.totalScore}
                </span>
              </div>
              <div className="p-2.5 bg-candy-cloud border-[2px] border-candy-ink rounded-xl shadow-[2px_2px_0_0_#2B2D42]">
                <span className="block text-[8px] text-candy-ink/65 uppercase font-display font-black">
                  Tỉ Lệ Đúng
                </span>
                <span className="font-display font-black text-sm text-candy-blue">
                  {winner.accuracy}
                </span>
              </div>
              <div className="p-2.5 bg-candy-cloud border-[2px] border-candy-ink rounded-xl shadow-[2px_2px_0_0_#2B2D42]">
                <span className="block text-[8px] text-candy-ink/65 uppercase font-display font-black">
                  Phản Xạ
                </span>
                <span className="font-display font-black text-[10px] text-candy-mint truncate block mt-0.5">
                  {winner.averageSpeed}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Your Performance Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42] space-y-4 md:col-span-2">
            <h3 className="font-display font-black text-base text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
              <Swords className="w-5 h-5 text-candy-pink stroke-[2.5]" />
              Thành Tích Của Bạn
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-candy-pink/10 border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1">
                <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none">
                  <Trophy className="w-4 h-4 text-candy-pink stroke-[2.5]" />
                  Hạng Chung Cuộc
                </span>
                <span className="font-display font-black text-2xl text-candy-ink block pt-1">
                  #{yourPerformance.rank}
                </span>
              </div>

              <div className="p-4 bg-candy-cloud border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1">
                <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase leading-none">
                  Điểm
                </span>
                <span className="font-display font-black text-2xl text-candy-ink block pt-1">
                  {yourPerformance.score}
                </span>
              </div>

              <div className="p-4 bg-candy-blue/10 border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1">
                <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none">
                  <Hourglass className="w-4 h-4 text-candy-blue stroke-[2.5]" />
                  Vòng Bị Loại
                </span>
                <span className="font-display font-black text-2xl text-candy-ink block pt-1">
                  {yourPerformance.eliminatedRound
                    ? `Vòng ${yourPerformance.eliminatedRound}`
                    : "--"}
                </span>
              </div>

              <div className="p-4 bg-candy-yellow/10 border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1">
                <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none">
                  <Target className="w-4 h-4 text-candy-orange stroke-[2.5]" />
                  Độ Chính Xác
                </span>
                <span className="font-display font-black text-2xl text-candy-ink block pt-1">
                  {yourPerformance.accuracy}
                </span>
              </div>

              <div className="p-4 bg-candy-mint/10 border-[3px] border-candy-ink rounded-2xl shadow-[3px_3px_0_0_#2B2D42] space-y-1">
                <span className="text-[10px] text-candy-ink/75 font-display font-black uppercase flex items-center gap-1.5 leading-none">
                  <Zap className="w-4 h-4 text-candy-mint stroke-[2.5]" />
                  Tốc Độ Phản Xạ
                </span>
                <span className="font-display font-black text-2xl text-candy-ink block pt-1">
                  {yourPerformance.speed}
                </span>
              </div>
            </div>
          </div>

          {/* Action options */}
          <div className="p-6 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud flex flex-col justify-center gap-4 shadow-[6px_6px_0_0_#2B2D42]">
            <button
              onClick={() => router.push("/room/create")}
              className="w-full h-12 bg-candy-pink text-candy-ink border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none"
            >
              <RotateCcw className="w-4 h-4 mr-2 stroke-[2.5]" />
              Tái Đấu Trận Mới
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full h-12 bg-candy-blue text-candy-ink border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none"
            >
              <Home className="w-4 h-4 mr-2 stroke-[2.5]" />
              Về Trang Chủ
            </button>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
