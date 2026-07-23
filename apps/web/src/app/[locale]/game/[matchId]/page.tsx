"use client";

import React, {
  useState,
  useEffect,
  use,
  useRef,
  useCallback,
  useMemo,
} from "react";
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
} from "@/components/game";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
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
  } = useSocketStore();
  const tTermination = useTranslations("Game.termination");

  // Drop-in spectating baseline: a late-joiner entered the room as
  // SPECTATOR and is viewing the match read-only. The server enforces
  // the same gate independently (see MatchHandler.handleSubmitAnswer)
  // — this derivation only drives the UI.
  const isSpectator = room?.joinMode === "SPECTATOR";

  // Single source of truth for the round duration, mirroring the
  // server's GAME_CONFIG.ROUND_DURATION_MS (used to compute
  // roundEndTime in match-round-runner.ts) instead of a
  // disconnected magic number.
  const roundDuration = GAME_CONFIG.ROUND_DURATION_MS / 1000;

  const { hasCurrentQuestion, questionText, options } = useMemo(() => {
    const has = Boolean(match?.currentQuestion);
    return {
      hasCurrentQuestion: has,
      questionText: has ? (match?.currentQuestion?.content ?? "") : "",
      options: has ? (match?.currentQuestion?.options ?? []) : [],
    };
  }, [match?.currentQuestion]);

  // Server-authoritative state
  const [timeLeft, setTimeLeft] = useState(roundDuration);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [roundCompleted, setRoundCompleted] = useState(false);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<
    string | null
  >(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  const activeRoundNo = match?.currentRoundNo;
  const activePendingAnswer =
    pendingAnswer?.matchId === matchId &&
    pendingAnswer.roundNo === activeRoundNo
      ? pendingAnswer
      : null;
  const activeAnswerResult =
    lastAnswerResult?.matchId === matchId &&
    lastAnswerResult.roundNo === activeRoundNo
      ? lastAnswerResult
      : null;

  useEffect(() => {
    if (!activePendingAnswer) return;
    setSelectedAnswer(activePendingAnswer.answer);
  }, [activePendingAnswer]);

  useEffect(() => {
    if (activePendingAnswer) return;
    if (activeAnswerResult?.isCorrect !== undefined) return;
    setSelectedAnswer(null);
  }, [activePendingAnswer, activeAnswerResult]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // F3 fix: split the round-result sequence into two independent
  // refs. The previous code nested two setTimeout calls under
  // `timerRef`, which meant:
  //
  //   - the outer 1s reveal wrote `timerRef.current`
  //   - the inner 3s continue ALSO wrote `timerRef.current`,
  //     overwriting the outer reference
  //   - `clearTimers` only clears the latest ref, so the outer
  //     timer could fire after the inner was cleared (or vice
  //     versa) depending on which one was assigned last
  //
  // Splitting into two refs lets each timer be cleared
  // independently. This matters most when the effect is re-run
  // mid-sequence (e.g. ROUND_ENDED fires twice in quick
  // succession, or React 18 strict-mode double-invoke in dev) —
  // the cleanup function can now cancel both, and a new sequence
  // can start without orphaning the previous one.
  const roundResultRevealRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const roundResultContinueRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    // F3 fix: also clear the round-result sequence refs so we
    // don't leak a pending timer across rapid ROUND_ENDED events
    // or component unmounts.
    if (roundResultRevealRef.current) {
      clearTimeout(roundResultRevealRef.current);
      roundResultRevealRef.current = null;
    }
    if (roundResultContinueRef.current) {
      clearTimeout(roundResultContinueRef.current);
      roundResultContinueRef.current = null;
    }
  }, []);

  // Drop-in spectating baseline: hydrate the match UI on mount when
  // the store has no match state yet. This is the case the
  // REQUEST_SNAPSHOT backend path was added for — a late-joiner
  // enters an IN_GAME room as SPECTATOR, navigates from the lobby
  // to /game/[matchId], and lands with `match === null` because no
  // ROUND_STARTED has fired for them yet. Without this, they see a
  // blank/stale screen until the next round starts.
  //
  // Plan D delta resync: we send our delta cursor (`lastSeenSeqNo`)
  // rather than a hardcoded 0. It is 0 when we have no state yet (a
  // late-joiner / fresh page load) so the server full-hydrates us via
  // SNAPSHOT; when the store survived a client-side navigation the
  // cursor is our last applied seqNo, so the server replies with a
  // lightweight EVENT_BATCH delta instead of the whole roster.
  //
  // Firing when `match` already exists is now safe: applying a delta is
  // non-destructive (it preserves the in-flight `lastAnswerResult` /
  // `remainingCount`, unlike the full SNAPSHOT handler which resets them
  // to null). The `snapshotHydratedRef` guard fires this once per mount
  // and survives React 18 strict-mode double-invoke during development.
  const snapshotHydratedRef = useRef(false);
  useEffect(() => {
    if (snapshotHydratedRef.current) return;
    if (!matchId) return;
    snapshotHydratedRef.current = true;
    requestSnapshot(matchId, useSocketStore.getState().lastSeenSeqNo);
  }, [matchId, requestSnapshot]);

  // Calculate time left based on server timestamp
  const calculateTimeLeft = useCallback(() => {
    if (!match?.roundEndTime) return roundDuration;

    const now = Date.now();
    const endTime = match.roundEndTime;
    const timeDiff = Math.max(0, Math.floor((endTime - now) / 1000));
    return timeDiff;
  }, [match?.roundEndTime, roundDuration]);

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

  // Handle round completion (when server sends ROUND_ENDED).
  // F7 fix: drive the round-completed effect from server-authoritative
  // match state (`status === "ROUND_RESULT"` + `roundEndTime === null`)
  // instead of `lastAnswerResult?.correctAnswer`. The previous signal
  // was unreliable: if the server sent an empty / missing
  // `correctAnswer` (e.g. question row missing the answer key), the
  // truthy check failed and the page never transitioned to
  // `roundCompleted`, leaving the user stuck on the "select answer"
  // screen with no progression.
  //
  // The new signal is what the server actually means by "round is
  // over": the state machine transitioned to ROUND_RESULT and the
  // per-round timer was cleared (`roundEndTime: null`). This is
  // emitted by the ROUND_ENDED handler in the socket store
  // (`socket-store.ts:515-555`).
  const isRoundResultPhase =
    match?.status === "ROUND_RESULT" && match?.roundEndTime === null;
  useEffect(() => {
    if (!isRoundResultPhase || roundCompleted) {
      return;
    }

    clearTimers();
    setRoundCompleted(true);
    // The correct answer still comes from `lastAnswerResult` (set by
    // ROUND_ENDED) — we use it purely for display, not as a trigger.
    if (lastAnswerResult?.correctAnswer) {
      const rawAnswer = lastAnswerResult.correctAnswer;
      const ANSWER_CODES = ["A", "B", "C", "D"];
      let normalizedAnswer = rawAnswer;
      if (!ANSWER_CODES.includes(rawAnswer)) {
        const matchedIdx = options.indexOf(rawAnswer);
        if (matchedIdx >= 0 && matchedIdx < ANSWER_CODES.length) {
          normalizedAnswer = ANSWER_CODES[matchedIdx];
        }
      }
      setRevealedCorrectAnswer(normalizedAnswer);
    }

    // F3 fix: outer 1s reveal → inner 3s continue, each with its
    // own ref so a mid-sequence re-run or strict-mode double-invoke
    // can't leave either timer orphaned.
    roundResultRevealRef.current = setTimeout(() => {
      // F2 fix: removed the magic-number redirect on
      // `remainingCount <= 12`. The server-authoritative
      // `match?.status === "FINISHED"` effect (below) is the
      // single source of truth for navigating to /result.
      roundResultContinueRef.current = setTimeout(() => {
        // Reset for next round. The next ROUND_STARTED broadcast
        // will populate `match.currentQuestion` and
        // `match.roundEndTime` from the server, so we only need to
        // clear local UI state here.
        setTimeLeft(roundDuration);
        setSelectedAnswer(null);
        setRoundCompleted(false);
        setRevealedCorrectAnswer(null);
      }, 3000);
    }, 1000);

    return () => {
      // F3 fix: cleanup both refs so a re-run (or unmount) does
      // not leak either timer.
      if (roundResultRevealRef.current) {
        clearTimeout(roundResultRevealRef.current);
        roundResultRevealRef.current = null;
      }
      if (roundResultContinueRef.current) {
        clearTimeout(roundResultContinueRef.current);
        roundResultContinueRef.current = null;
      }
    };
  }, [
    isRoundResultPhase,
    lastAnswerResult,
    roundCompleted,
    clearTimers,
    roundDuration,
    options,
    // Note: we intentionally do NOT depend on `matchId`,
    // `currentLocale`, or `router` — the legacy dependency list
    // was overly broad and contributed to unnecessary re-runs
    // during the round-result sequence. The new effect only
    // depends on the state it reads.
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

  const handleSelectAnswer = useCallback(
    (option: string) => {
      if (roundCompleted || activePendingAnswer || activeAnswerResult) return;
      // Drop-in spectating baseline: spectators cannot submit answers. The
      // server enforces the same gate (MatchHandler.handleSubmitAnswer) so
      // this is a UX-only short-circuit — a malicious client would still
      // be rejected by the server, but we hide the interactive control
      // entirely so the spectator UI stays read-only.
      if (isSpectator) return;

      // Submit answer to socket-store.
      // F6 fix: send the actual `currentRoundNo` (which may be 0
      // during the COUNTDOWN phase or after a fresh MATCH_STARTED
      // that has not yet broadcast ROUND_STARTED). The previous
      // `currentRoundNo || 1` would lie to the wire — sending 1
      // when the server is actually in round 0. The server's
      // answer-submit gate already reads the round from the
      // authoritative state machine and ignores the client value
      // for state lookup, but the dead data is still misleading
      // for log analysis and would mask a real client/server
      // round-mismatch bug if it ever occurred. We now short-
      // circuit when the round is not yet known (the next
      // ROUND_STARTED broadcast will re-enable submission).
      if (match?.id && match.currentRoundNo > 0) {
        const submissionId = submitAnswer(
          match.id,
          match.currentRoundNo,
          option,
        );
        if (submissionId) setSelectedAnswer(option);
      }
    },
    [
      roundCompleted,
      activePendingAnswer,
      activeAnswerResult,
      isSpectator,
      match?.id,
      match?.currentRoundNo,
      submitAnswer,
    ],
  );

  const getTileVariant = useCallback(
    (answerCode: string) => {
      if (roundCompleted) {
        if (revealedCorrectAnswer && answerCode === revealedCorrectAnswer) {
          return "correct";
        }
        if (answerCode === selectedAnswer) return "incorrect";
        return "disabled";
      }
      return selectedAnswer === answerCode ? "selected" : "default";
    },
    [roundCompleted, revealedCorrectAnswer, selectedAnswer],
  );

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
