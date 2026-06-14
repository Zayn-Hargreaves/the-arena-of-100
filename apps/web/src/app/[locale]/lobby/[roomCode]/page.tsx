"use client";

import React, { useEffect, useRef, useState, use } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Users, AlertCircle } from "lucide-react";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useToast } from "@/hooks/use-toast";
import { RoomStatus } from "@arena/shared";
import { RoomCodeCard } from "@/components/atoms/room-code-card";
import {
  LobbyHeader,
  LobbyPlayerGrid,
  LeaveRoomModal,
  LobbyCountdownOverlay,
  LobbyStartControls,
} from "@/components/lobby";
import { useLobbyLifecycle } from "@/hooks/use-lobby-lifecycle";

interface LobbyPageProps {
  params: Promise<{ roomCode: string }>;
}

export default function LobbyPage({ params }: LobbyPageProps) {
  const { roomCode } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const {
    match,
    leaveRoom,
    startMatch,
    roomTerminated,
    roomTerminationMessage,
  } = useSocketStore();
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const t = useTranslations("lobby.page");
  const tStatus = useTranslations("lobby.status");
  const tPlayerGrid = useTranslations("lobby.playerGrid");
  const tTermination = useTranslations("lobby.termination");

  const {
    room,
    userId,
    isConnected,
    isHost,
    isPrivateRoom,
    roomStatus,
    countdownRemainingSeconds,
    isStarting,
    isInGame,
    playersList,
    canHostStart,
    joining,
    joinError,
    roomHostId,
  } = useLobbyLifecycle(roomCode);

  // Redirect to active game screen once match starts
  useEffect(() => {
    if (match?.id) {
      router.push(`/game/${match.id}`);
    }
  }, [match, router]);

  // Server has force-terminated this room (admin kill-switch). Toast once
  // and bounce the user back to the home page. useRef guards against
  // React strict-mode double-invoke and any future re-renders.
  const terminationNotifiedRef = useRef(false);
  useEffect(() => {
    if (!roomTerminated || terminationNotifiedRef.current) return;
    terminationNotifiedRef.current = true;

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
  }, [roomTerminated, roomTerminationMessage, router, toast, tTermination]);

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

  // The hook surfaces either a real Error.message or the sentinel key
  // "lobby.unknownError" (when the thrown value is not an Error instance).
  // Resolve the sentinel through next-intl so the user sees a localized
  // fallback rather than a raw key. Also normalize an empty Error.message
  // (some Error subclasses throw with "") to undefined so the rendering
  // branch can fall back to the localized message.
  const displayJoinError =
    joinError === "lobby.unknownError" || !joinError
      ? t("joinFailedFallback")
      : joinError;

  const roomStatusMessage =
    roomStatus === RoomStatus.COUNTDOWN
      ? tStatus("countdown", { seconds: countdownRemainingSeconds })
      : roomStatus === RoomStatus.STARTING
        ? tStatus("starting")
        : roomStatus === RoomStatus.IN_GAME
          ? tStatus("inGame")
          : isPrivateRoom
            ? playersList.length < 2
              ? tStatus("privateNeedPlayers")
              : tStatus("privateCanStart")
            : playersList.length < 2
              ? tStatus("publicNeedPlayers")
              : tStatus("publicCanStart");

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
                  {t("opponentsCount")}
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
                    ? t("joinError", {
                        message: displayJoinError ?? t("joinFailedFallback"),
                      })
                    : joining
                      ? t("joining")
                      : isConnected
                        ? roomStatusMessage
                        : t("reconnecting")}
                </span>
              </div>

              {/* Giant Host Launch Action */}
              <LobbyStartControls
                isHost={isHost}
                isPrivateRoom={isPrivateRoom}
                canHostStart={canHostStart}
                roomStatus={roomStatus}
                countdownRemainingSeconds={countdownRemainingSeconds}
                onStart={handleStartGame}
              />
            </div>

            {/* Quick Tips */}
            <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
              <AlertCircle className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
              <p className="text-xs font-semibold leading-relaxed text-candy-ink">
                <strong>{t("tipsTitle")}</strong> {t("tipsBody")}
              </p>
            </div>
          </div>

          {/* Right panel: Active Players grid */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2 drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
              <Users className="w-5 h-5 text-candy-pink stroke-[2.5]" />
              {t("opponentsSection")}
            </h3>

            <LobbyPlayerGrid
              players={playersList}
              currentUserId={userId}
              hostId={roomHostId}
              emptyStateMessage={tPlayerGrid("empty")}
            />
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
