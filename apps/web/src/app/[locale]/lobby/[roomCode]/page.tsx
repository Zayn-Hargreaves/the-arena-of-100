"use client";

import React, { useEffect, useState, use } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
  Copy,
  Check,
  Users,
  AlertCircle,
  ArrowLeft,
  Gamepad,
} from "lucide-react";

interface LobbyPageProps {
  params: Promise<{ roomCode: string }>;
}

import { avatars } from "@/lib/avatars";

export default function LobbyPage({ params }: LobbyPageProps) {
  const { roomCode } = use(params);
  const router = useRouter();
  const { room, userId, username, isConnected, joinRoom, startMatch, match } =
    useSocketStore();

  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Auto join room if not already in store
  useEffect(() => {
    if (!isConnected || (room && room.code === roomCode)) return;

    let cancelled = false;

    const autoJoin = async () => {
      setJoining(true);
      setJoinError(null);

      try {
        await joinRoom(roomCode);
      } catch (error) {
        if (!cancelled) {
          setJoinError(
            error instanceof Error
              ? error.message
              : "Không thể tham gia phòng. Vui lòng thử lại.",
          );
        }
      } finally {
        if (!cancelled) {
          setJoining(false);
        }
      }
    };

    void autoJoin();

    return () => {
      cancelled = true;
    };
  }, [isConnected, roomCode, room, joinRoom]);

  // Redirect to active game screen once match starts
  useEffect(() => {
    if (match?.id) {
      router.push(`/game/${match.id}`);
    }
  }, [match, router]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartGame = () => {
    if (room?.id) {
      startMatch(room.id);
    }
  };

  const roomHostId = room?.hostId ?? null;
  const isHost = Boolean(userId && roomHostId && userId === roomHostId);

  // Mock players only in local dev when the real players list is empty
  const realPlayers = room?.players ?? [];
  const playersList =
    process.env.NODE_ENV === "development" && realPlayers.length === 0
      ? [
          {
            id: userId || "1",
            name: username || "Bạn",
            status: "READY",
            score: 0,
          },
          { id: "mock2", name: "Alpha_Net", status: "READY", score: 0 },
          { id: "mock3", name: "Glitch_Runner", status: "READY", score: 0 },
          { id: "mock4", name: "Neon_Ghost", status: "READY", score: 0 },
          { id: "mock5", name: "Pixel_Hustler", status: "READY", score: 0 },
        ]
      : realPlayers;

  // Get deterministic or local saved avatar details
  const getPlayerAvatar = (player: { id: string; name: string }) => {
    if (player.id === userId && typeof window !== "undefined") {
      const seed = localStorage.getItem("avatarSeed") || "jellyfrog";
      const name = localStorage.getItem("avatarName") || "Ếch Thạch (Jelly)";
      const isAnimated = localStorage.getItem("avatarIsAnimated") === "true";
      const spritesheet = localStorage.getItem("avatarSpritesheet") || "";
      return { seed, name, isAnimated, spritesheet };
    }

    const hash = player.name
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = hash % avatars.length;
    const avatar = avatars[index];
    // Normalize avatar data to ensure consistent shape
    return {
      seed: avatar.seed,
      name: avatar.name,
      isAnimated: Boolean(avatar.isAnimated),
      spritesheet: avatar.spritesheet || "",
    };
  };

  return (
    <AppShellLayout>
      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        {/* Top bar back option */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/room/create")}
            className="flex items-center gap-2 px-4 py-2 border-[3px] border-candy-ink bg-white text-candy-ink font-display font-black text-xs uppercase rounded-xl hover:translate-y-[-1.5px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1.5px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all cursor-pointer outline-none"
          >
            <ArrowLeft className="w-4 h-4 mr-1 stroke-[2.5]" />
            Quay lại cài đặt
          </button>
        </div>

        {/* Grid Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Room Details & Actions */}
          <div className="lg:col-span-1 space-y-6">
            <div className="jelly-card p-6 space-y-6 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42]">
              <div className="space-y-1">
                <span className="font-display font-black text-[10px] text-candy-pink uppercase tracking-wider">
                  Đang Chờ Trận Đấu
                </span>
                <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
                  PHÒNG CHỜ
                </h2>
              </div>

              {/* Room Code Card */}
              <div className="p-4 bg-candy-cloud border-[3px] border-candy-ink rounded-2xl space-y-2 shadow-[4px_4px_0_0_#2B2D42]">
                <span className="text-xs font-bold text-candy-ink/75 font-sans">
                  Mã Phòng Đấu
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-black text-3xl text-candy-blue tracking-widest uppercase select-all">
                    {roomCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="p-2.5 rounded-xl border-[3px] border-candy-ink bg-white text-candy-ink hover:translate-y-[-1px] hover:shadow-[3px_3px_0_0_#2B2D42] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#2B2D42] shadow-[2px_2px_0_0_#2B2D42] transition-all outline-none cursor-pointer"
                    title="Sao chép mã"
                  >
                    {copied ? (
                      <Check className="w-4.5 h-4.5 text-candy-mint stroke-[2.5]" />
                    ) : (
                      <Copy className="w-4.5 h-4.5 stroke-[2.5]" />
                    )}
                  </button>
                </div>
              </div>

              {/* Stats / Player Counts */}
              <div className="flex items-center justify-between p-4 border-b-[3px] border-candy-ink/10">
                <span className="text-sm font-bold text-candy-ink/80 flex items-center gap-2">
                  <Users className="w-4.5 h-4.5 text-candy-pink stroke-[2.5]" />
                  Đối thủ hiện tại
                </span>
                <span className="font-display font-black text-xl text-candy-pink">
                  {playersList.length} / 100
                </span>
              </div>

              {/* Connection Status Indicator */}
              <div className="flex items-center gap-2.5 px-2 py-1 text-xs">
                <span
                  className={`w-3 h-3 rounded-full border border-candy-ink ${isConnected ? "bg-candy-mint animate-pulse" : "bg-candy-red animate-ping"}`}
                />
                <span className="font-sans font-bold text-candy-ink/70">
                  {joinError
                    ? `Không thể vào phòng: ${joinError}`
                    : joining
                      ? "Đang vào phòng..."
                      : isConnected
                        ? "Mạng Đấu Trường Ổn Định"
                        : "Đang kết nối lại..."}
                </span>
              </div>

              {/* Giant Host Launch Action */}
              {isHost && (
                <button
                  onClick={handleStartGame}
                  className="w-full h-14 bg-candy-mint text-candy-ink border-[3.5px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-sm tracking-widest uppercase flex items-center justify-center cursor-pointer transition-all select-none"
                >
                  <Gamepad className="w-5 h-5 mr-2 animate-bounce stroke-[2.5]" />
                  BẮT ĐẦU TRẬN ĐẤU
                </button>
              )}
            </div>

            {/* Quick Tips */}
            <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
              <AlertCircle className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
              <p className="text-xs font-semibold leading-relaxed text-candy-ink">
                <strong>Gợi ý:</strong> Chia sẻ Mã Phòng với bạn bè để họ cùng
                tham chiến. Chỉ người trả lời nhanh nhất và chính xác nhất mới
                sống sót qua 100 vòng đấu!
              </p>
            </div>
          </div>

          {/* Right panel: Active Players grid */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2 drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
              <Users className="w-5 h-5 text-candy-pink stroke-[2.5]" />
              ĐỐI THỦ TRONG PHÒNG
            </h3>

            {/* Grid list of guests showcasing beautiful animations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {playersList.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-16 px-4 rounded-2xl border-[3px] border-dashed border-candy-ink/20 bg-white/50">
                  <Users className="w-10 h-10 text-candy-ink/20 stroke-[1.5] mb-3" />
                  <p className="font-display font-black text-base text-candy-ink/30 uppercase tracking-wider text-center">
                    Đang chờ người chơi tham gia...
                  </p>
                  <p className="font-sans text-xs text-candy-ink/20 mt-1">
                    Chia sẻ mã phòng để bắt đầu
                  </p>
                </div>
              ) : (
                playersList
                  .filter(
                    (
                      player,
                    ): player is {
                      id: string;
                      name: string;
                      status: string;
                      score: number;
                    } =>
                      typeof player === "object" &&
                      player !== null &&
                      typeof player.id === "string" &&
                      typeof player.name === "string" &&
                      typeof player.status === "string" &&
                      typeof player.score === "number",
                  )
                  .map((player) => {
                    const playerAvatar = getPlayerAvatar(player);
                    const isCurrent = player.id === userId;

                    return (
                      <div
                        key={player.id}
                        className={`p-4 flex items-center gap-3 rounded-2xl border-[3px] border-candy-ink transition-all shadow-[4px_4px_0_0_#2B2D42] hover:translate-y-[-2px] hover:shadow-[6px_6px_0_0_#2B2D42] ${
                          isCurrent
                            ? "bg-candy-pink text-candy-ink"
                            : "bg-white text-candy-ink"
                        }`}
                      >
                        {playerAvatar.isAnimated ? (
                          <div className="w-12 h-12 shrink-0 border-[2.5px] border-candy-ink rounded-xl bg-candy-cloud overflow-hidden flex items-center justify-center relative shadow-[2px_2px_0_0_#2B2D42]">
                            <AnimatedSprite
                              src={playerAvatar.spritesheet!}
                              scale={2.2}
                              row={0}
                              speed={120}
                            />
                          </div>
                        ) : (
                          <Avatar
                            size="md"
                            fallback={playerAvatar.seed}
                            status={isCurrent ? "online" : "offline"}
                            className="border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-sm truncate uppercase tracking-wide">
                            {player.name}
                          </p>
                          <p
                            className={cn(
                              "font-mono text-[9px] uppercase tracking-widest font-black opacity-80",
                              isCurrent ? "text-candy-ink" : "text-candy-pink",
                            )}
                          >
                            {isCurrent ? "BẠN (HOST)" : "ĐÃ SẴN SÀNG"}
                          </p>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
