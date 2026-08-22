"use client";

import React, { useEffect, useRef, useState, use, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Users, AlertCircle, Eye, Trophy } from "lucide-react";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useToast } from "@/hooks/use-toast";
import { RoomStatus, GAME_CONFIG } from "@arena/shared";
import { RoomCodeCard } from "@/components/atoms/room-code-card";
import {
  LobbyHeader,
  LobbyPlayerGrid,
  LeaveRoomModal,
  LobbyCountdownOverlay,
  LobbyStartControls,
  LobbyProfessorBriefing,
} from "@/components/lobby";
import { useLobbyLifecycle } from "@/hooks/use-lobby-lifecycle";

interface LobbyPageProps {
  params: Promise<{ roomCode: string }>;
}

// -- Helpers extracted to reduce Cognitive Complexity of LobbyPage -------

type TranslatorFn = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

function getRoomStatusMessage(
  roomStatus: RoomStatus | undefined,
  countdownRemainingSeconds: number | null,
  isPrivateRoom: boolean,
  playersCount: number,
  tStatus: TranslatorFn,
): string {
  if (roomStatus === RoomStatus.COUNTDOWN) {
    return tStatus("countdown", { seconds: countdownRemainingSeconds ?? 0 });
  }
  if (roomStatus === RoomStatus.STARTING) {
    return tStatus("starting");
  }
  if (roomStatus === RoomStatus.IN_GAME) {
    return tStatus("inGame");
  }
  if (isPrivateRoom) {
    return playersCount < 2
      ? tStatus("privateNeedPlayers")
      : tStatus("privateCanStart");
  }
  return playersCount < 2
    ? tStatus("publicNeedPlayers")
    : tStatus("publicCanStart");
}

function getConnectionStatusText(
  joinError: string | null | undefined,
  displayJoinError: string,
  joining: boolean,
  isConnected: boolean,
  roomStatusMessage: string,
  t: TranslatorFn,
): string {
  if (joinError) {
    return t("joinError", {
      message: displayJoinError,
    });
  }
  if (joining) return t("joining");
  if (isConnected) return roomStatusMessage;
  return t("reconnecting");
}

export default function LobbyPage({ params }: Readonly<LobbyPageProps>) {
  const { roomCode } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const {
    match,
    leaveRoom,
    startMatch,
    roomTerminated,
    roomTerminationMessage,
    room,
  } = useSocketStore();
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const t = useTranslations("lobby.page");
  const tStatus = useTranslations("lobby.status");
  const tPlayerGrid = useTranslations("lobby.playerGrid");
  const tTermination = useTranslations("lobby.termination");
  const tSpectator = useTranslations("lobby.spectator");

  const {
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

  // Drop-in spectating baseline (PR): a late-joiner who lands on this
  // page is automatically joined as SPECTATOR when the room is already
  // IN_GAME or FINISHED. We expose that as derived booleans and route
  // the user accordingly:
  //   - FINISHED → /result/[matchId] so they see the result UI
  //   - IN_GAME  → render a banner + manual "Vào xem" button that takes
  //                them to /game/[matchId] (we don't auto-navigate to
  //                /game from /lobby because the lobby page is meant
  //                for pre-game UX; the user is given an explicit
  //                opt-in to leave the lobby and enter the spectator
  //                view of the live match)
  const isSpectator = room?.joinMode === "SPECTATOR";
  const isFinished = roomStatus === RoomStatus.FINISHED;

  // Auto-redirect FINISHED spectators to the result page. The plan
  // locks this in as the FINISHED UX; we only fire once per mount.
  const finishedRedirectedRef = useRef(false);
  useEffect(() => {
    if (
      !isFinished ||
      !isSpectator ||
      finishedRedirectedRef.current ||
      !room?.currentMatchId
    ) {
      return;
    }
    finishedRedirectedRef.current = true;
    router.replace(`/result/${room.currentMatchId}`);
  }, [isFinished, isSpectator, room?.currentMatchId, router]);

  // Toast once when the user lands on the lobby page as a spectator of
  // an IN_GAME room. useRef guards against React strict-mode double-
  // invoke and any future re-renders. Localized to keep the surface
  // consistent with the rest of the lobby's i18n namespaces.
  const spectatorNotifiedRef = useRef(false);
  useEffect(() => {
    if (
      !isSpectator ||
      isFinished ||
      !isInGame ||
      spectatorNotifiedRef.current
    ) {
      return;
    }
    spectatorNotifiedRef.current = true;
    toast({
      title: tSpectator("toastTitle"),
      description: tSpectator("toastDescription"),
    });
  }, [isSpectator, isFinished, isInGame, toast, tSpectator]);

  // Existing player redirect to /game when a match starts. We do NOT
  // redirect spectators here because the plan keeps them in the lobby
  // until they explicitly click "Vào xem" (or until FINISHED redirects
  // them to /result).
  useEffect(() => {
    if (isSpectator) return;
    if (
      match?.id &&
      room?.code === roomCode &&
      room?.currentMatchId === match.id
    ) {
      router.push(`/game/${match.id}`);
    }
  }, [
    match?.id,
    room?.code,
    room?.currentMatchId,
    roomCode,
    router,
    isSpectator,
  ]);

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

  // Drop-in spectator entry: the user explicitly opts to leave the
  // lobby and enter the read-only game view. The result page for
  // FINISHED rooms is auto-handled by a separate useEffect above; this
  // button is for the IN_GAME case where the spectator wants to watch
  // the live match.
  const handleWatchMatch = useCallback(() => {
    if (room?.currentMatchId) {
      router.push(`/game/${room.currentMatchId}`);
    }
  }, [room?.currentMatchId, router]);

  const handleViewResult = useCallback(() => {
    if (room?.currentMatchId) {
      router.push(`/result/${room.currentMatchId}`);
    }
  }, [room?.currentMatchId, router]);

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

  const roomStatusMessage = getRoomStatusMessage(
    roomStatus,
    countdownRemainingSeconds,
    isPrivateRoom,
    playersList.length,
    tStatus,
  );

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

        {/* Drop-in spectating banner: shown when the auto-join has
            classified the current socket as a spectator. We hide the
            banner for FINISHED rooms because the auto-redirect effect
            above immediately takes the user to /result/[matchId]. */}
        {isSpectator && !isFinished && (
          <div
            data-testid="lobby-spectator-banner"
            className="jelly-card p-5 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud shadow-[5px_5px_0_0_#2B2D42] flex flex-col md:flex-row gap-4 items-start md:items-center justify-between"
          >
            <div className="flex items-start gap-3">
              <Eye className="w-6 h-6 text-candy-blue stroke-[2.5] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="font-display font-black text-base text-candy-ink uppercase tracking-wider">
                  {tSpectator("bannerTitle")}
                </h2>
                <p className="text-xs font-semibold text-candy-ink/70 leading-relaxed">
                  {tSpectator("bannerBody")}
                </p>
              </div>
            </div>
            <button
              onClick={isInGame ? handleWatchMatch : handleViewResult}
              className="h-11 px-5 bg-candy-blue text-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center gap-2 cursor-pointer transition-all outline-none"
            >
              {isInGame ? (
                <>
                  <Eye className="w-4 h-4 stroke-[2.5]" />
                  {tSpectator("watchButton")}
                </>
              ) : (
                <>
                  <Trophy className="w-4 h-4 stroke-[2.5]" />
                  {tSpectator("resultButton")}
                </>
              )}
            </button>
          </div>
        )}

        {/* Grid Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left panel: Room Details & Actions (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            <div className="jelly-card p-6 space-y-5 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[6px_6px_0_0_#2B2D42]">
              <RoomCodeCard roomCode={roomCode} />

              {/* Stats / Player Counts */}
              <div className="flex items-center justify-between p-3.5 bg-candy-cloud/40 rounded-2xl border-[2.5px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
                <span className="text-xs font-display font-black text-candy-ink uppercase flex items-center gap-2">
                  <Users className="w-4 h-4 text-candy-pink stroke-[2.5]" />
                  {t("opponentsCount")}
                </span>
                <span className="font-display font-black text-lg px-2.5 py-0.5 rounded-xl bg-candy-pink text-white border-[1.5px] border-candy-ink shadow-[1px_1px_0_0_#2B2D42]">
                  {playersList.length} / {GAME_CONFIG.MAX_PLAYERS}
                </span>
              </div>

              {/* Connection Status Indicator */}
              <div className="flex items-center gap-2.5 px-3 py-2 bg-white rounded-xl border-[2px] border-candy-ink/20 text-xs">
                <span
                  className={`w-3 h-3 rounded-full border border-candy-ink shrink-0 ${isConnected ? "bg-candy-mint animate-pulse" : "bg-candy-red animate-ping"}`}
                />
                <span className="font-sans font-bold text-candy-ink/80 text-[11px] leading-tight">
                  {getConnectionStatusText(
                    joinError,
                    displayJoinError,
                    joining,
                    isConnected,
                    roomStatusMessage,
                    t,
                  )}
                </span>
              </div>

              {/* Giant Host Launch Action — suppressed for spectators */}
              {!isSpectator && (
                <LobbyStartControls
                  isHost={isHost}
                  isPrivateRoom={isPrivateRoom}
                  canHostStart={canHostStart}
                  roomStatus={roomStatus}
                  countdownRemainingSeconds={countdownRemainingSeconds}
                  onStart={handleStartGame}
                />
              )}
            </div>

            {/* Professor Briefing on Exam Regulations */}
            <LobbyProfessorBriefing playersCount={playersList.length} />

            {/* Match Rules Card */}
            <div className="p-5 rounded-3xl border-[3px] border-candy-ink bg-white shadow-[4px_4px_0_0_#2B2D42] space-y-3">
              <h3 className="font-display font-black text-xs text-candy-ink uppercase tracking-wider flex items-center gap-2">
                <Trophy className="w-4 h-4 text-candy-yellow fill-candy-yellow shrink-0" />
                {tPlayerGrid("playerRoster")}
              </h3>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-candy-cloud/50 border-[1.5px] border-candy-ink/30 space-y-0.5">
                  <span className="text-candy-ink/60 font-semibold block uppercase text-[9px] font-mono">
                    {tPlayerGrid("scaleLabel")}
                  </span>
                  <span className="font-display font-black text-candy-ink">
                    {tPlayerGrid("scaleValue", {
                      count: GAME_CONFIG.MAX_PLAYERS,
                    })}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-candy-cloud/50 border-[1.5px] border-candy-ink/30 space-y-0.5">
                  <span className="text-candy-ink/60 font-semibold block uppercase text-[9px] font-mono">
                    {tPlayerGrid("timeLabel")}
                  </span>
                  <span className="font-display font-black text-candy-ink">
                    {tPlayerGrid("timeValue", {
                      seconds: Math.round(GAME_CONFIG.ROUND_DURATION_MS / 1000),
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Tips */}
            {isSpectator ? (
              <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-candy-cloud flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
                <Eye className="w-5 h-5 text-candy-blue shrink-0 mt-0.5 stroke-[2.5]" />
                <p className="text-xs font-semibold leading-relaxed text-candy-ink">
                  <strong>{tSpectator("bannerTitle")}.</strong>{" "}
                  {tSpectator("bannerBody")}
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
                <AlertCircle className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
                <p className="text-xs font-semibold leading-relaxed text-candy-ink">
                  <strong>{t("tipsTitle")}</strong> {t("tipsBody")}
                </p>
              </div>
            )}
          </div>

          {/* Right panel: Active Players grid (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between pb-1">
              <h2 className="font-display font-black text-lg text-candy-ink uppercase tracking-wider flex items-center gap-2 drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
                <Users className="w-5 h-5 text-candy-pink stroke-[2.5]" />
                {t("opponentsSection")}
              </h2>
              <span className="text-xs font-mono font-bold text-candy-ink/60 bg-white px-2.5 py-1 rounded-xl border-[2px] border-candy-ink shadow-[2px_2px_0_0_#2B2D42]">
                {tPlayerGrid("online", {
                  count: playersList.filter((p) => p.isOnline).length,
                })}
              </span>
            </div>

            <LobbyPlayerGrid
              players={playersList}
              currentUserId={userId}
              hostId={roomHostId}
              emptyStateMessage={tPlayerGrid("empty")}
              capacity={GAME_CONFIG.MAX_PLAYERS}
            />
          </div>
        </div>
      </div>
    </AppShellLayout>
  );
}
