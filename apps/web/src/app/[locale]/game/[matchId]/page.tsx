"use client";

import React, { useState, useEffect, use, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
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
  CardHand,
  CardOfferOverlay,
  CardTargetPicker,
  CardAnimation,
  ClassBadge,
  CardGlyph,
} from "@/components/game";
import { ProfessorHudWidget } from "@/components/character/professor-hud-widget";

import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useGameRoundState } from "@/hooks/use-game-round-state";
import { useGamePageLifecycle } from "@/hooks/use-game-page-lifecycle";
import { INITIAL_CARD_STATE } from "@/stores/socket-store.types";
// "remaining / total" denominator in the header. GAME_CONFIG.MAX_PLAYERS
// is only the fallback when room capacity is not available.
import { GAME_CONFIG, type CardId } from "@arena/shared";

interface TimedEffectLike {
  cardId?: CardId;
  offerSeqNo?: number;
  sourceSeqNo?: number;
  expiresAtServer?: number | null;
  effect?: {
    kind: string;
    durationMs?: number;
    delayMs?: number;
  };
}

function useTimedEffectFlag(
  effect: TimedEffectLike | null | undefined,
  fallbackDuration: number | undefined,
  currentRoundNo: number,
): boolean {
  const [active, setActive] = useState(false);
  const sourceSeqNo = effect
    ? (effect.sourceSeqNo ??
      (effect.cardId !== undefined || effect.offerSeqNo !== undefined
        ? `${effect.cardId}-${effect.offerSeqNo}`
        : (effect.effect?.kind ?? "active")))
    : null;

  useEffect(() => {
    if (effect) {
      const fallback = fallbackDuration ?? 0;
      const remaining =
        effect.expiresAtServer != null
          ? Math.max(0, effect.expiresAtServer - Date.now())
          : fallback;
      if (remaining <= 0) {
        setActive(false);
        return undefined;
      }
      setActive(true);
      const timer = setTimeout(() => setActive(false), remaining);
      return () => clearTimeout(timer);
    } else {
      setActive(false);
      return undefined;
    }
  }, [currentRoundNo, sourceSeqNo, effect?.expiresAtServer, fallbackDuration]);

  return active;
}

interface GamePageProps {
  params: Promise<{ matchId: string; locale?: string }>;
}

export default function GamePage({ params }: Readonly<GamePageProps>) {
  const resolvedParams = use(params);
  const { matchId } = resolvedParams;
  const router = useRouter();
  const t = useTranslations("Game");
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
    cardState = INITIAL_CARD_STATE,
    pickCard,
    playCard,
    dismissCardOffer,
    clearResolvedCardEffect,
  } = useSocketStore();

  const [pickingTarget, setPickingTarget] = useState<{
    cardId: CardId;
    offerSeqNo: number;
  } | null>(null);

  // Drop-in spectating baseline: a late-joiner entered the room as
  // SPECTATOR and is viewing the match read-only. The server enforces
  // the same gate independently (see MatchHandler.handleSubmitAnswer)
  // — this derivation only drives the UI.
  const isSpectator = room?.joinMode === "SPECTATOR";
  const isObserving = isSpectator || isEliminated;

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isSpectatingAfterElimination, setIsSpectatingAfterElimination] =
    useState(false);

  // Active temporary card visual effects targeting the local player (active players only)
  const roundEffects = cardState.activeRoundEffects;
  const myRoundEffects = useMemo(() => {
    if (isObserving || !userId || !roundEffects || roundEffects.length === 0)
      return [];
    return roundEffects.filter(
      (eff) =>
        eff.targetPlayerIds?.includes(userId) ||
        (eff.playedByPlayerId === userId && eff.targetPlayerIds?.length === 0),
    );
  }, [isObserving, roundEffects, userId]);

  const activeEffect = cardState.lastResolvedEffect;
  const currentRoundNo = match?.currentRoundNo ?? 0;

  const hasSecondChance = Boolean(
    userId &&
    (myRoundEffects.some(
      (e) => e.playedByPlayerId === userId && e.effect.kind === "SECOND_CHANCE",
    ) ||
      (activeEffect?.playedByPlayerId === userId &&
        activeEffect?.effect.kind === "SECOND_CHANCE" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) ===
          currentRoundNo)),
  );

  const handleSubmitAnswer = useCallback(
    (mId: string, rNo: number, ans: string) => {
      return submitAnswer(mId, rNo, ans);
    },
    [submitAnswer],
  );

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
    isSpectator: isObserving,
    hasSecondChance,
    submitAnswer: handleSubmitAnswer,
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
  const livePlayerCount =
    remainingCount ??
    match?.players?.filter((p) => p.status !== "ELIMINATED").length ??
    0;

  const isTargetOfActiveEffect = Boolean(
    !isObserving &&
    activeEffect &&
    userId &&
    (activeEffect.targetPlayerIds?.includes(userId) ||
      (activeEffect.playedByPlayerId === userId &&
        activeEffect.targetPlayerIds?.length === 0)),
  );

  const [timeDelta, setTimeDelta] = useState<{
    deltaSeconds: number;
    key: number;
  } | null>(null);

  // Compute a single offset from myRoundEffects
  const timeOffsetSeconds = useMemo(() => {
    // If server provides roundEndTime, server has authoritative timing
    // so we maintain server-authoritative time calculation
    if (match?.roundEndTime) return 0;

    const timerEff = myRoundEffects.find(
      (e) =>
        e.effect.kind === "TIMER_MODIFY" || e.effect.kind === "QUESTION_REPLAY",
    );
    if (timerEff) {
      const deltaMs =
        timerEff.effect.kind === "TIMER_MODIFY"
          ? (timerEff.effect.deltaMs ?? 0)
          : ((timerEff.effect as { extraMs?: number }).extraMs ?? 0);
      return Math.round(deltaMs / 1000);
    }
    return 0;
  }, [match?.roundEndTime, myRoundEffects]);

  // Trigger time delta animation when activeEffect lands during round
  React.useEffect(() => {
    if (!activeEffect || !userId) return;
    const isTarget =
      activeEffect.targetPlayerIds?.includes(userId) ||
      (activeEffect.playedByPlayerId === userId &&
        activeEffect.targetPlayerIds?.length === 0);

    if (
      isTarget &&
      (activeEffect.effect.kind === "TIMER_MODIFY" ||
        activeEffect.effect.kind === "QUESTION_REPLAY") &&
      (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
    ) {
      const deltaMs =
        activeEffect.effect.kind === "TIMER_MODIFY"
          ? (activeEffect.effect.deltaMs ?? 0)
          : ((activeEffect.effect as { extraMs?: number }).extraMs ?? 0);
      const deltaSec = Math.round(deltaMs / 1000);
      if (deltaSec !== 0) {
        setTimeDelta({ deltaSeconds: deltaSec, key: Date.now() });
      }
    }
  }, [activeEffect, userId, currentRoundNo]);

  const displayTimeLeft = Math.max(0, timeLeft + timeOffsetSeconds);

  // 1. OPTION_LOCK: auto-unlocks after remaining server time or durationMs
  const lockEff = useMemo(
    () => myRoundEffects.find((e) => e.effect.kind === "OPTION_LOCK") ?? null,
    [myRoundEffects],
  );
  const isOptionLocked = useTimedEffectFlag(
    lockEff,
    lockEff?.effect.kind === "OPTION_LOCK"
      ? lockEff.effect.durationMs
      : undefined,
    currentRoundNo,
  );

  // 2. VISUAL_OVERLAY (Brain Fog): auto-clears after remaining server time or durationMs
  const fogEff = useMemo(
    () =>
      myRoundEffects.find((e) => e.effect.kind === "VISUAL_OVERLAY") ?? null,
    [myRoundEffects],
  );
  const isFoggy = useTimedEffectFlag(
    fogEff,
    fogEff?.effect.kind === "VISUAL_OVERLAY"
      ? fogEff.effect.durationMs
      : undefined,
    currentRoundNo,
  );

  // 3. DELAY_RENDER: reveals after remaining server time or delayMs
  const delayEff = useMemo(
    () => myRoundEffects.find((e) => e.effect.kind === "DELAY_RENDER") ?? null,
    [myRoundEffects],
  );
  const isDelayRender = useTimedEffectFlag(
    delayEff,
    delayEff?.effect.kind === "DELAY_RENDER"
      ? delayEff.effect.delayMs
      : undefined,
    currentRoundNo,
  );

  // 4. SEMANTIC_FLIP: resets after remaining server time or durationMs
  const flipEff = useMemo(
    () => myRoundEffects.find((e) => e.effect.kind === "SEMANTIC_FLIP") ?? null,
    [myRoundEffects],
  );
  const isSemanticFlipped = useTimedEffectFlag(
    flipEff,
    flipEff?.effect.kind === "SEMANTIC_FLIP"
      ? flipEff.effect.durationMs
      : undefined,
    currentRoundNo,
  );

  // 5. OPTION_FAKE: auto-clears after remaining server time or durationMs
  const fakeEff = useMemo(
    () =>
      (myRoundEffects.find((e) => e.effect.kind === "OPTION_FAKE") ||
        (isTargetOfActiveEffect &&
        activeEffect?.effect.kind === "OPTION_FAKE" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
          ? activeEffect
          : null)) ??
      null,
    [myRoundEffects, isTargetOfActiveEffect, activeEffect, currentRoundNo],
  );
  const activeFake = useTimedEffectFlag(
    fakeEff,
    fakeEff?.effect.kind === "OPTION_FAKE"
      ? fakeEff.effect.durationMs
      : undefined,
    currentRoundNo,
  );

  const hintPartial = useMemo(() => {
    const eff =
      (myRoundEffects.find((e) => e.effect.kind === "HINT_REVEAL") ||
        (isTargetOfActiveEffect &&
        activeEffect?.effect.kind === "HINT_REVEAL" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
          ? activeEffect
          : null)) ??
      null;
    return eff?.effect.kind === "HINT_REVEAL" ? eff.effect.partial : null;
  }, [myRoundEffects, isTargetOfActiveEffect, activeEffect, currentRoundNo]);

  const disabledOptionCodes = useMemo(() => {
    const eff =
      (myRoundEffects.find((e) => e.effect.kind === "OPTION_DISABLE") ||
        (userId &&
        activeEffect?.playedByPlayerId === userId &&
        activeEffect?.effect.kind === "OPTION_DISABLE" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
          ? activeEffect
          : null)) ??
      null;
    if (eff && eff.effect.kind === "OPTION_DISABLE" && eff.effect.indexes) {
      const CODES = ["A", "B", "C", "D"];
      return eff.effect.indexes
        .map((idx: number) => CODES[idx])
        .filter((code: string | undefined): code is string => Boolean(code));
    }
    return [];
  }, [myRoundEffects, userId, activeEffect, currentRoundNo]);

  const fakeFlaggedIndexes = useMemo(() => {
    if (!activeFake || !fakeEff || fakeEff.effect.kind !== "OPTION_FAKE") {
      return [];
    }
    return fakeEff.effect.indexes ?? [];
  }, [activeFake, fakeEff]);

  const burningCardId = useMemo(() => {
    const eff =
      (myRoundEffects.find((e) => e.effect.kind === "HAND_DESTROY") ||
        (isTargetOfActiveEffect &&
        activeEffect?.effect.kind === "HAND_DESTROY" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
          ? activeEffect
          : null)) ??
      null;
    return eff?.effect.kind === "HAND_DESTROY"
      ? ((eff.effect.destroyedCardIds?.[0] as CardId) ?? null)
      : null;
  }, [myRoundEffects, isTargetOfActiveEffect, activeEffect, currentRoundNo]);

  const hasShield = Boolean(
    userId &&
    (myRoundEffects.some(
      (e) => e.playedByPlayerId === userId && e.effect.kind === "SHIELD",
    ) ||
      (activeEffect?.playedByPlayerId === userId &&
        activeEffect?.effect.kind === "SHIELD" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) ===
          currentRoundNo)),
  );

  const scoreMultiplier = useMemo(() => {
    const eff =
      (myRoundEffects.find(
        (e) => e.playedByPlayerId === userId && e.effect.kind === "SCORE_MULT",
      ) ||
        (userId &&
        activeEffect?.playedByPlayerId === userId &&
        activeEffect?.effect.kind === "SCORE_MULT" &&
        (activeEffect.targetRoundNo ?? activeEffect.roundNo) === currentRoundNo
          ? activeEffect
          : null)) ??
      null;
    return eff?.effect.kind === "SCORE_MULT" ? eff.effect.factor : null;
  }, [myRoundEffects, userId, activeEffect, currentRoundNo]);

  return (
    <AppShellLayout>
      {isEliminated && !isSpectatingAfterElimination && (
        <EliminatedOverlay
          reason={eliminationReason}
          onSpectate={() => setIsSpectatingAfterElimination(true)}
          onLeave={() => setShowLeaveModal(true)}
        />
      )}

      {/* Pre-Match Topic Ban Draft Overlay */}
      {Boolean(
        match?.id &&
        topicVoting &&
        topicVoting.matchId === match.id &&
        !topicVoting.isFinished,
      ) && <TopicVotingOverlay />}

      {/* Phase 2: Milestone Card Offer Overlay */}
      {Boolean(
        cardState.currentOffer &&
        match?.id &&
        cardState.currentOffer.matchId === match.id &&
        !isObserving,
      ) && (
        <CardOfferOverlay
          roundNo={cardState.currentOffer!.roundNo}
          offeredCardIds={cardState.currentOffer!.offeredCardIds}
          offerSeqNo={cardState.currentOffer!.offerSeqNo}
          expiresAt={cardState.currentOffer!.expiresAt}
          onPickCard={(cardId, offerSeqNo) => {
            pickCard(cardId, offerSeqNo);
          }}
          onDismiss={dismissCardOffer}
        />
      )}

      {/* Phase 2: Card Target Picker Overlay */}
      {pickingTarget && (
        <CardTargetPicker
          cardId={pickingTarget.cardId}
          offerSeqNo={pickingTarget.offerSeqNo}
          targets={(match?.players ?? room?.players ?? [])
            .filter((p) => p.id !== userId && p.status === "ACTIVE")
            .map((p) => ({ playerId: p.id, name: p.name }))}
          onPick={(targetPlayerId) => {
            playCard(
              pickingTarget.cardId,
              pickingTarget.offerSeqNo,
              targetPlayerId,
            );
            setPickingTarget(null);
          }}
          onCancel={() => setPickingTarget(null)}
        />
      )}

      {/* Phase 2: Card Animation Banner */}
      {cardState.lastResolvedEffect && (
        <CardAnimation
          event={cardState.lastResolvedEffect}
          userId={userId}
          players={match?.players ?? room?.players ?? []}
          onComplete={clearResolvedCardEffect}
        />
      )}

      {/* Spectator banner: shown for drop-in spectators or eliminated players who chose to spectate */}
      {(isSpectator || (isEliminated && isSpectatingAfterElimination)) && (
        <SpectatorBanner isEliminated={isEliminated} />
      )}

      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1 w-full">
            <GameStateRibbon
              roundNo={match?.currentRoundNo || 1}
              timeLeft={displayTimeLeft}
              roundDuration={roundDuration}
              livePlayerCount={livePlayerCount}
              maxPlayers={maxPlayers}
              timeDelta={timeDelta}
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {hasShield && (
              <div className="flex items-center gap-1.5 bg-candy-mint px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs animate-pulse">
                <CardGlyph
                  variant="shield"
                  size={18}
                  className="text-candy-ink"
                />
                <span>{t("shieldActive")}</span>
              </div>
            )}
            {scoreMultiplier && (
              <div className="flex items-center gap-1.5 bg-candy-yellow px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs animate-bounce">
                <CardGlyph
                  variant="doubleScore"
                  size={18}
                  className="text-candy-ink"
                />
                <span>{t("scoreMultiplier", { factor: scoreMultiplier })}</span>
              </div>
            )}
            {hasSecondChance && (
              <div className="flex items-center gap-1.5 bg-candy-pink px-3.5 py-2.5 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42] text-candy-ink font-display font-black text-xs">
                <CardGlyph
                  variant="secondChance"
                  size={18}
                  className="text-candy-ink"
                />
                <span>{t("secondChance")}</span>
              </div>
            )}
            {cardState.classId && (
              <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-2xl border-[3px] border-candy-ink shadow-[3px_3px_0_0_#2B2D42]">
                <span className="text-xs font-bold text-candy-ink/70">
                  {t("classLabel")}
                </span>
                <ClassBadge classId={cardState.classId} variant="strong" />
              </div>
            )}
          </div>
        </div>

        {/* Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Question & Answer Panel */}
          <div className="lg:col-span-3 space-y-6">
            <QuestionCard
              hasCurrentQuestion={hasCurrentQuestion}
              questionText={questionText}
              roundCompleted={roundCompleted}
              hasAnswered={
                activePendingAnswer !== null || activeAnswerResult !== null
              }
              isFoggy={isFoggy}
              isDelayRender={isDelayRender}
              isSemanticFlipped={isSemanticFlipped}
              hintPartial={hintPartial}
            />

            <AnswerPanel
              isEliminated={isEliminated}
              isSpectator={isSpectator}
              options={options}
              getTileVariant={getTileVariant}
              onSelect={handleSelectAnswer}
              disabled={
                roundCompleted ||
                (!isObserving &&
                  !hasSecondChance &&
                  (activePendingAnswer !== null ||
                    activeAnswerResult !== null)) ||
                !match?.id ||
                (match?.currentRoundNo ?? 0) <= 0
              }
              disabledOptionCodes={disabledOptionCodes}
              isOptionLocked={isOptionLocked}
              fakeFlaggedIndexes={fakeFlaggedIndexes}
            />

            {/* Phase 2: Player's Card Hand */}
            {!isObserving && cardState.hand.length > 0 && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl border-[3px] border-candy-ink p-4 shadow-[4px_4px_0_0_#2B2D42] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-candy-ink tracking-wider flex items-center gap-1.5">
                    <CardGlyph
                      variant="cards"
                      size={16}
                      className="text-candy-ink"
                    />
                    {t("cardsInHand", { count: cardState.hand.length })}
                  </span>
                  <span className="text-[11px] text-candy-ink/60">
                    {t("cardActivationPrompt")}
                  </span>
                </div>
                <CardHand
                  hand={cardState.hand}
                  playedCardIds={cardState.playedCardIds}
                  classId={cardState.classId}
                  onPickCard={(cardId) => {
                    const offerSeqNo = cardState.offerSeqNoByCardId[cardId];
                    if (!offerSeqNo || offerSeqNo <= 0) return;
                    setPickingTarget({
                      cardId,
                      offerSeqNo,
                    });
                  }}
                  disabled={roundCompleted || isObserving}
                  burningCardId={burningCardId}
                />
              </div>
            )}
          </div>

          {/* Sidebar Panel: Live Feed & Eliminators */}
          <div className="lg:col-span-1 space-y-6">
            {/* Professor Exam Supervisor Widget */}
            <ProfessorHudWidget
              timeLeft={displayTimeLeft}
              hasAnswered={
                activePendingAnswer !== null || activeAnswerResult !== null
              }
              isCorrect={activeAnswerResult?.isCorrect ?? null}
              isEliminated={isEliminated}
            />

            <OpponentsSidebar
              players={
                match?.players?.length ? match.players : (room?.players ?? [])
              }
              userId={userId}
            />

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
