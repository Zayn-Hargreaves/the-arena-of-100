"use client";

import React, { useEffect, useState, use } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Users, AlertCircle, Gamepad } from "lucide-react";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { RoomStatus } from "@arena/shared";
import { RoomCodeCard } from "@/components/atoms/room-code-card";
import {
  LobbyHeader,
  LobbyPlayerGrid,
  LeaveRoomModal,
  LobbyCountdownOverlay,
} from "@/components/lobby";

interface LobbyPageProps {
  params: Promise<{ roomCode: string }>;
}

export default function LobbyPage({ params }: LobbyPageProps) {
  const { roomCode } = use(params);
  const router = useRouter();
  const {
    room,
    userId,
    username,
    isConnected,
    joinRoom,
    startMatch,
    match,
    leaveRoom,
  } = useSocketStore();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [showLeaveModal, setShowLeaveModal] = useState(false);

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

  useEffect(() => {
    if (!room?.countdownEndsAt) {
      return;
    }

    setCountdownNow(Date.now());
    const interval = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [room?.countdownEndsAt]);

  const handleStartGame = () => {
    if (room?.id) {
      startMatch(room.id);
    }
  };

  const handleLeaveRoom = () => {
    if (room?.id) {
      leaveRoom(room.id);
      router.push("/room/create");
    }
  };

  const roomHostId = room?.hostId ?? null;
  const isHost = Boolean(userId && roomHostId && userId === roomHostId);
  const isPrivateRoom = room?.roomType === "PRIVATE";
  const roomStatus = room?.status ?? RoomStatus.WAITING;
  const countdownRemainingMs = room?.countdownEndsAt
    ? Math.max(room.countdownEndsAt - countdownNow, 0)
    : 0;
  const countdownRemainingSeconds = Math.ceil(countdownRemainingMs / 1000);

  const isStarting =
    roomStatus === RoomStatus.COUNTDOWN || roomStatus === RoomStatus.STARTING;
  const isInGame = roomStatus === RoomStatus.IN_GAME;

  const realPlayers = room?.players ?? [];
  const playersList =
    process.env.NODE_ENV === "development" && realPlayers.length === 0
      ? [
          {
            id: userId || "1",
            name: username || "Bạn",
            status: "READY",
            score: 0,
            isOnline: true,
          },
          {
            id: "mock2",
            name: "Alpha_Net",
            status: "READY",
            score: 0,
            isOnline: true,
          },
          {
            id: "mock3",
            name: "Glitch_Runner",
            status: "READY",
            score: 0,
            isOnline: true,
          },
          {
            id: "mock4",
            name: "Neon_Ghost",
            status: "READY",
            score: 0,
            isOnline: true,
          },
          {
            id: "mock5",
            name: "Pixel_Hustler",
            status: "READY",
            score: 0,
            isOnline: true,
          },
        ]
      : realPlayers;

  const canHostStart =
    isHost &&
    isPrivateRoom &&
    roomStatus === RoomStatus.WAITING &&
    playersList.length >= 2 &&
    !joining;

  const roomStatusMessage =
    roomStatus === RoomStatus.COUNTDOWN
      ? `Trận đấu sẽ bắt đầu sau ${countdownRemainingSeconds}s`
      : roomStatus === RoomStatus.STARTING
        ? "Đang đồng bộ người chơi và câu hỏi..."
        : roomStatus === RoomStatus.IN_GAME
          ? "Đã có match, đang chuyển màn chơi..."
          : isPrivateRoom
            ? playersList.length < 2
              ? "Cần ít nhất 2 người để host bắt đầu trận đấu"
              : "Host có thể bắt đầu trận đấu bất cứ lúc nào"
            : playersList.length < 2
              ? "Cần thêm người chơi để tự động bắt đầu"
              : "Đủ người chơi, server sẽ tự bắt đầu trận đấu";

  return (
    <AppShellLayout>
      <LobbyCountdownOverlay
        secondsRemaining={countdownRemainingSeconds}
        isStarting={isStarting}
        isInGame={isInGame}
      />

      <LeaveRoomModal
        open={showLeaveModal}
        onOpenChange={setShowLeaveModal}
        onConfirm={handleLeaveRoom}
        isHost={isHost}
      />

      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        <LobbyHeader
          roomStatus={roomStatus}
          onLeave={() => setShowLeaveModal(true)}
        />

        {/* Grid Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Room Details & Actions */}
          <div className="lg:col-span-1 space-y-6">
            <div className="jelly-card p-6 space-y-6 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42]">
              <RoomCodeCard roomCode={roomCode} />

              {/* Stats / Player Counts */}
              <div className="flex items-center justify-between p-4 border-b-[3px] border-candy-ink/10">
                <span className="text-sm font-bold text-candy-ink/80 flex items-center gap-2">
                  <Users className="w-4 h-4 text-candy-pink stroke-[2.5]" />
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
                        ? roomStatusMessage
                        : "Đang kết nối lại..."}
                </span>
              </div>

              {/* Giant Host Launch Action */}
              {isHost && isPrivateRoom && (
                <button
                  onClick={handleStartGame}
                  disabled={!canHostStart}
                  className="w-full h-14 bg-candy-mint text-candy-ink border-[3.5px] border-candy-ink shadow-[6px_6px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-2px] hover:shadow-[8px_8px_0_0_#2B2D42] active:translate-y-[4px] active:shadow-[2px_2px_0_0_#2B2D42] font-display font-black text-sm tracking-widest uppercase flex items-center justify-center cursor-pointer transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Gamepad className="w-5 h-5 mr-2 animate-bounce stroke-[2.5]" />
                  {roomStatus === RoomStatus.COUNTDOWN
                    ? `ĐANG ĐẾM NGƯỢC ${countdownRemainingSeconds}s`
                    : roomStatus === RoomStatus.STARTING
                      ? "ĐANG KHỞI TẠO..."
                      : roomStatus === RoomStatus.IN_GAME
                        ? "ĐANG CHUYỂN TRẬN..."
                        : "BẮT ĐẦU TRẬN ĐẤU"}
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

            <LobbyPlayerGrid
              players={playersList}
              currentUserId={userId}
              hostId={roomHostId}
              emptyStateMessage="Đang chờ người chơi tham gia..."
            />
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
