"use client";

import React, { useEffect, useState, use } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "next/navigation";
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

interface AvatarOption {
  seed: string;
  name: string;
  isAnimated?: boolean;
  spritesheet?: string;
}

const avatars: AvatarOption[] = [
  { seed: "avatar-cat", name: "Mèo Ngáo" },
  {
    seed: "jellyfrog",
    name: "Ếch Thạch (Jelly)",
    isAnimated: true,
    spritesheet: "/arena_of_100/jellyfrog_spritesheet.webp",
  },
  {
    seed: "clippit",
    name: "Clippy Kỷ Niệm",
    isAnimated: true,
    spritesheet: "/arena_of_100/clippit_spritesheet.webp",
  },
  {
    seed: "dario",
    name: "CEO Dario",
    isAnimated: true,
    spritesheet: "/arena_of_100/dario_spritesheet.webp",
  },
  {
    seed: "dentist",
    name: "Nha Sĩ Chibi",
    isAnimated: true,
    spritesheet: "/arena_of_100/dentist_spritesheet.webp",
  },
  {
    seed: "nyakoshigure",
    name: "Mèo Nyako",
    isAnimated: true,
    spritesheet: "/arena_of_100/nyakoshigure_spritesheet.webp",
  },
  {
    seed: "slavik",
    name: "Slavik Tracksuit",
    isAnimated: true,
    spritesheet: "/arena_of_100/slavik_spritesheet.webp",
  },
  {
    seed: "tux",
    name: "Chim Cánh Cụt Tux",
    isAnimated: true,
    spritesheet: "/arena_of_100/tux_spritesheet.webp",
  },
  {
    seed: "yellingdario",
    name: "Dario Gào Thét",
    isAnimated: true,
    spritesheet: "/arena_of_100/yellingdario_spritesheet.webp",
  },
  {
    seed: "yorhasit2b",
    name: "Hiệp Sĩ 2B Ngơ",
    isAnimated: true,
    spritesheet: "/arena_of_100/yorhasit2b_spritesheet.webp",
  },
  {
    seed: "airring",
    name: "AirRing (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/airring_spritesheet.webp",
  },
  {
    seed: "ask-jeeves",
    name: "Ask Jeeves (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/ask-jeeves_spritesheet.webp",
  },
  {
    seed: "azure",
    name: "Azure (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/azure_spritesheet.webp",
  },
  {
    seed: "broom-belle",
    name: "Kiki (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/broom-belle_spritesheet.webp",
  },
  {
    seed: "capy-2",
    name: "Capy (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/capy-2_spritesheet.webp",
  },
  {
    seed: "cinder",
    name: "Cinder (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/cinder_spritesheet.webp",
  },
  {
    seed: "clawd",
    name: "Clawd (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/clawd_spritesheet.webp",
  },
  {
    seed: "clippy",
    name: "Clippy (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/clippy_spritesheet.webp",
  },
  {
    seed: "da-zhuang",
    name: "Đại Tráng (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/da-zhuang_spritesheet.webp",
  },
  {
    seed: "dev",
    name: "Dev (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/dev_spritesheet.webp",
  },
  {
    seed: "dewdrop",
    name: "Dewdrop (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/dewdrop_spritesheet.webp",
  },
  {
    seed: "doodlebob",
    name: "Doodle Bob (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/doodlebob_spritesheet.webp",
  },
  {
    seed: "dude",
    name: "Dude (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/dude_spritesheet.webp",
  },
  {
    seed: "duo",
    name: "Duo (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/duo_spritesheet.webp",
  },
  {
    seed: "einstein",
    name: "Einstein (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/einstein_spritesheet.webp",
  },
  {
    seed: "esheep64",
    name: "eSheep64 (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/esheep64_spritesheet.webp",
  },
  {
    seed: "finderguy",
    name: "Finder Guy (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/finderguy_spritesheet.webp",
  },
  {
    seed: "fine-pup",
    name: "Fine Pup (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/fine-pup_spritesheet.webp",
  },
  {
    seed: "goblin-goods",
    name: "Goblin Goods (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/goblin-goods_spritesheet.webp",
  },
  {
    seed: "goblin",
    name: "Goblin (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/goblin_spritesheet.webp",
  },
  {
    seed: "goose",
    name: "Goose (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/goose_spritesheet.webp",
  },
  {
    seed: "kwehlet",
    name: "Kwehlet (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/kwehlet_spritesheet.webp",
  },
  {
    seed: "mini-sama",
    name: "Mini Sama (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/mini-sama_spritesheet.webp",
  },
  {
    seed: "miss-minute",
    name: "Miss Minute (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/miss-minute_spritesheet.webp",
  },
  {
    seed: "pc-guy",
    name: "PC Guy (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/pc-guy_spritesheet.webp",
  },
  {
    seed: "pope-amodei",
    name: "Pope Amodei (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/pope-amodei_spritesheet.webp",
  },
  {
    seed: "rubick",
    name: "Rubick (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/rubick_spritesheet.webp",
  },
  {
    seed: "sumi",
    name: "Sumi (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/sumi_spritesheet.webp",
  },
  {
    seed: "super-piglet",
    name: "Super Piglet (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/super-piglet_spritesheet.webp",
  },
  {
    seed: "theo",
    name: "Theo (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/theo_spritesheet.webp",
  },
  {
    seed: "thragg",
    name: "Thragg (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/thragg_spritesheet.webp",
  },
  {
    seed: "tibo",
    name: "Tibo (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/tibo_spritesheet.webp",
  },
  {
    seed: "tom",
    name: "Tom (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/tom_spritesheet.webp",
  },
  {
    seed: "totoro",
    name: "Totoro (Community)",
    isAnimated: true,
    spritesheet: "/arena_of_100/totoro_spritesheet.webp",
  },
  { seed: "avatar-frog", name: "Ếch Cụ" },
  { seed: "avatar-octo", name: "Bạch Tuộc Nháy" },
  { seed: "avatar-dog", name: "Cún Ngơ" },
  { seed: "avatar-fox", name: "Cáo Xảo Quyệt" },
  { seed: "avatar-unicorn", name: "Kỳ Lân Bay Màu" },
  { seed: "avatar-ghost", name: "Ma Vui Vẻ" },
  { seed: "avatar-cosmo", name: "Người Ngoài Hành Tinh" },
];

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
  const showMockPlayers =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_ENABLE_LOBBY_MOCK_PLAYERS === "true";

  const playersList =
    room?.players ??
    (showMockPlayers
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
      : []);

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
    return avatars[index];
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
              {playersList.map((player) => {
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
              })}
            </div>
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
