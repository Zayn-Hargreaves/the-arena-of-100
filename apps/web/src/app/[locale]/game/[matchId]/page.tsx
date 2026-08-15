"use client";

import React, { useState, use } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import {
  EliminatedOverlay,
  SpectatorBanner,
  GameStateRibbon,
  QuestionCard,
  AnswerPanel,
  OpponentsSidebar,
  AntiHackNote,
  LeaveMatchButton,
  MatchFinishedOverlay,
  LeaveMatchModal,
  TopicVotingOverlay,
} from "@/components/game";

import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useGameRoundState } from "@/hooks/use-game-round-state";
import { useGamePageLifecycle } from "@/hooks/use-game-page-lifecycle";
// F4 fix: room.maxPlayers is the source of truth for the
// "remaining / total" denominator in the header. GAME_CONFIG.MAX_PLAYERS
// is only the fallback when room capacity is not available.
import { GAME_CONFIG } from "@arena/shared";

interface GamePageProps {
  params: Promise<{ matchId: string; locale?: string }>;
}

export default function GamePage({ params }: Readonly<GamePageProps>) {
  const resolvedParams = use(params);
  const { matchId } = resolvedParams;
  const router = useRouter();
  const {
    match,
    submitAnswer,
    userId,
    lastAnswerResult,
    pendingAnswer,
    remainingCount,
    leaveRoom,
    isEliminated,
    eliminationReason,
    roomTerminated,
    roomTerminationMessage,
    room,
    requestSnapshot,
    topicVoting,
  } = useSocketStore();

  // Drop-in spectating baseline: a late-joiner entered the room as
  // SPECTATOR and is viewing the match read-only. The server enforces
  // the same gate independently (see MatchHandler.handleSubmitAnswer)
  // — this derivation only drives the UI.
  const isSpectator = room?.joinMode === "SPECTATOR";

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const {
    activeAnswerResult,
    activePendingAnswer,
    clearTimers,
    getTileVariant,
    handleSelectAnswer,
    hasCurrentQuestion,
    options,
    questionText,
    roundCompleted,
    roundDuration,
    timeLeft,
  } = useGameRoundState({
    matchId,
    match,
    pendingAnswer,
    lastAnswerResult,
    isSpectator,
    submitAnswer,
  });

  useGamePageLifecycle({
    matchId,
    matchStatus: match?.status,
    roomTerminated,
    roomTerminationMessage,
    requestSnapshot,
    clearTimers,
  });

  // F5 fix: when there is no current question yet (late hydration,
  // pre-ROUND_STARTED, or a snapshot gap), render a loading
  // skeleton instead of the hardcoded monorepo-package names that
  // previously showed as "fallback question" content. The
  // skeleton is purely presentational — it does not change any
  // business logic — and it makes the empty state honest to the
  // user.

  const maxPlayers = room?.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS;
  const livePlayerCount = remainingCount ?? match?.players?.length ?? 0;

  return (
    <AppShellLayout>
      {isEliminated && <EliminatedOverlay reason={eliminationReason} />}

      {/* Pre-Match Topic Ban Draft Overlay */}
      {Boolean(
        match?.id && topicVoting && topicVoting.matchId === match.id,
      ) && <TopicVotingOverlay />}

      {/* Drop-in spectator banner: a thin top-of-page strip telling the
          user they joined as a late spectator. Lighter than the
          isEliminated fullscreen overlay because the spectator can still
          follow the round and leave at will. */}
      {isSpectator && !isEliminated && <SpectatorBanner />}

      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        <GameStateRibbon
          roundNo={match?.currentRoundNo || 1}
          timeLeft={timeLeft}
          roundDuration={roundDuration}
          livePlayerCount={livePlayerCount}
          maxPlayers={maxPlayers}
        />

        {/* Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Question & Answer Panel */}
          <div className="lg:col-span-3 space-y-6">
            <QuestionCard
              hasCurrentQuestion={hasCurrentQuestion}
              questionText={questionText}
              roundCompleted={roundCompleted}
            />

            <AnswerPanel
              isEliminated={isEliminated}
              isSpectator={isSpectator}
              options={options}
              getTileVariant={getTileVariant}
              onSelect={handleSelectAnswer}
              disabled={
                roundCompleted ||
                activePendingAnswer !== null ||
                activeAnswerResult !== null ||
                !match?.id ||
                match?.currentRoundNo <= 0
              }
            />
          </div>

          {/* Sidebar Panel: Live Feed & Eliminators */}
          <div className="lg:col-span-1 space-y-6">
            <OpponentsSidebar players={match?.players ?? []} userId={userId} />

            <AntiHackNote />

            <LeaveMatchButton
              onClick={() => setShowLeaveModal(true)}
              disabled={roundCompleted || match?.status === "FINISHED"}
            />
          </div>
        </div>
      </div>

      {match?.status === "FINISHED" && <MatchFinishedOverlay />}

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
