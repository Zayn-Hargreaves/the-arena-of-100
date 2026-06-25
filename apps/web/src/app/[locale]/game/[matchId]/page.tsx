"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { AppShellLayout } from "@/components/ui/app-shell-layout";
import { Timer } from "@/components/game/timer";
import { AnswerTile } from "@/components/game/answer-tile";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/ui/avatar-frame";
import { AnimatedSprite } from "@/components/ui/animated-sprite";
import { LeaveMatchModal } from "@/components/game/leave-match-modal";
import { useSocketStore } from "@/stores/socket-store";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { Users, ShieldAlert, Swords, LogOut, Trophy, Eye } from "lucide-react";
import { avatars } from "@/lib/avatars";
// F4 fix: room.maxPlayers is the source of truth for the
// "remaining / total" denominator in the header. GAME_CONFIG.MAX_PLAYERS
// is only the fallback when room capacity is not available.
import { GAME_CONFIG } from "@arena/shared";

interface GamePageProps {
  params: Promise<{ matchId: string; locale?: string }>;
}

export default function GamePage({ params }: GamePageProps) {
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
    roomTerminated,
    roomTerminationMessage,
    room,
    requestSnapshot,
  } = useSocketStore();
  const t = useTranslations("Game");
  const tTermination = useTranslations("Game.termination");
  const tSpectator = useTranslations("Game.dropInSpectator");

  // Drop-in spectating baseline: a late-joiner entered the room as
  // SPECTATOR and is viewing the match read-only. The server enforces
  // the same gate independently (see MatchHandler.handleSubmitAnswer)
  // — this derivation only drives the UI.
  const isSpectator = room?.joinMode === "SPECTATOR";

  // Server-authoritative state
  const [timeLeft, setTimeLeft] = useState(15);
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
  // We only fire when `match` is null: for an active player who
  // already received MATCH_STARTED/ROUND_STARTED, the local state
  // is fresh and a redundant snapshot would wipe the in-flight
  // `lastAnswerResult` / `remainingCount` (the SNAPSHOT handler
  // resets those to null). The `snapshotHydratedRef` guard makes
  // the intent explicit and survives React 18 strict-mode double-
  // invoke during development.
  const snapshotHydratedRef = useRef(false);
  useEffect(() => {
    if (snapshotHydratedRef.current) return;
    if (match) return;
    if (!matchId) return;
    snapshotHydratedRef.current = true;
    requestSnapshot(matchId, 0);
  }, [matchId, match, requestSnapshot]);

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
      setRevealedCorrectAnswer(lastAnswerResult.correctAnswer);
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
        setTimeLeft(15);
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

  const handleSelectAnswer = (option: string) => {
    if (roundCompleted || activePendingAnswer || activeAnswerResult) return;
    // Drop-in spectating baseline: spectators cannot submit answers. The
    // server enforces the same gate (MatchHandler.handleSubmitAnswer) so
    // this is a UX-only short-circuit — a malicious client would still
    // be rejected by the server, but we hide the interactive control
    // entirely so the spectator UI stays read-only.
    if (isSpectator) return;
    setSelectedAnswer(option);

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
      submitAnswer(match.id, match.currentRoundNo, option);
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

  // F5 fix: when there is no current question yet (late hydration,
  // pre-ROUND_STARTED, or a snapshot gap), render a loading
  // skeleton instead of the hardcoded monorepo-package names that
  // previously showed as "fallback question" content. The
  // skeleton is purely presentational — it does not change any
  // business logic — and it makes the empty state honest to the
  // user.
  const hasCurrentQuestion = Boolean(match?.currentQuestion);
  const questionText = hasCurrentQuestion
    ? (match?.currentQuestion?.content ?? "")
    : "";
  const options = hasCurrentQuestion
    ? (match?.currentQuestion?.options ?? [])
    : [];

  const maxPlayers = room?.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS;
  const livePlayerCount = remainingCount ?? match?.players?.length ?? 0;

  return (
    <AppShellLayout>
      {isEliminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="jelly-card p-6 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-3 animate-bounce-in pointer-events-auto">
            <div className="flex justify-center">
              <Trophy className="w-12 h-12 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
            </div>
            <h2 className="font-display font-black text-2xl tracking-wide uppercase text-candy-ink">
              {t("eliminatedOverlay.title")}
            </h2>
            <p className="font-sans text-sm font-bold text-candy-ink/70">
              {t("eliminatedOverlay.subtitle")}
            </p>
          </div>
        </div>
      )}

      {/* Drop-in spectator banner: a thin top-of-page strip telling the
          user they joined as a late spectator. We keep this lighter than
          the isEliminated fullscreen overlay because the spectator still
          has useful work to do (read the live question, follow the
          round, plan to leave). It also surfaces below the leave CTA
          so the user can leave at any time without dismissing first. */}
      {isSpectator && !isEliminated && (
        <div
          data-testid="game-spectator-banner"
          className="max-w-6xl mx-auto w-full mb-4 mt-2 px-4 py-3 rounded-2xl border-[3px] border-candy-ink bg-candy-blue/15 flex items-start gap-3 shadow-[3px_3px_0_0_#2B2D42]"
        >
          <Eye className="w-5 h-5 text-candy-blue stroke-[2.5] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider">
              {tSpectator("bannerTitle")}
            </h3>
            <p className="text-xs font-semibold text-candy-ink/70 leading-relaxed">
              {tSpectator("bannerBody")}
            </p>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-6 pt-2 select-none animate-slide-up">
        {/* Game State Ribbon */}
        <div className="border-[3.5px] border-candy-ink bg-white rounded-3xl shadow-[5px_5px_0_0_#2B2D42] p-5 flex flex-col md:flex-row gap-4 items-center justify-between relative overflow-hidden">
          {/* Subtle decorative stripe */}
          <div className="absolute top-0 left-0 right-0 h-[6px] bg-gradient-to-r from-candy-pink via-candy-yellow to-candy-mint" />

          <div className="flex items-center gap-6 w-full md:w-auto">
            <div>
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                {t("matchingTitle")}
              </span>
              <span className="font-display font-black text-2xl text-candy-pink drop-shadow-[0_2px_0_rgba(0,0,0,0.02)]">
                {t("roundLabel")} {match?.currentRoundNo || 1}
              </span>
            </div>
            <div className="h-10 w-[3px] bg-candy-ink/10 hidden sm:block" />
            <div className="hidden sm:block">
              <span className="block text-[10px] text-candy-ink/65 uppercase font-display font-black tracking-wider">
                {t("roundComplexity")}
              </span>
              <span className="font-sans text-sm font-bold text-candy-orange bg-candy-yellow/15 border-[2px] border-candy-orange/30 px-2.5 py-0.5 rounded-lg inline-block">
                {t("roundLevelExtreme")}
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
                {t("remainingLabel")}
              </span>
              <span className="font-display font-black text-3xl text-candy-blue">
                {livePlayerCount} / {maxPlayers}
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
                {t("rulesHeader")}
              </div>
              <div className="absolute top-3 right-4 text-xs font-display font-black text-candy-pink animate-pulse flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-candy-pink border border-candy-ink" />
                {roundCompleted ? t("lockedAnswer") : t("waiting")}
              </div>

              <h2 className="font-sans font-bold text-lg md:text-2xl text-candy-ink leading-relaxed tracking-wide pt-8">
                {/* F5 fix: render a loading skeleton when the
                    current question is not yet available, instead
                    of the previous hardcoded monorepo-package
                    strings that briefly appeared during late
                    hydration. The skeleton uses a pulse animation
                    + i18n string for accessibility. */}
                {hasCurrentQuestion ? (
                  questionText
                ) : (
                  <div
                    data-testid="loading-question"
                    className="animate-pulse text-center text-candy-ink/50 py-4"
                  >
                    {t("loadingQuestion")}
                  </div>
                )}
              </h2>
            </div>

            {/* Answer Options Grid or Spectator View. The isEliminated
                branch is the original spectator-on-elimination UI. The
                isSpectator branch is the new drop-in spectator path
                (late-joiner). Both render the same read-only block but
                with different copy so the user knows why they cannot
                answer. */}
            {isEliminated || isSpectator ? (
              <div className="p-8 rounded-3xl border-[3.5px] border-candy-ink bg-candy-cloud text-candy-ink shadow-[6px_6px_0_0_#2B2D42] flex flex-col items-center justify-center min-h-[220px] text-center space-y-4">
                <Swords className="w-12 h-12 text-candy-red stroke-[2]" />
                <h3 className="font-display font-black text-xl uppercase tracking-wide">
                  {isSpectator
                    ? tSpectator("bannerTitle")
                    : t("spectatorMode.title")}
                </h3>
                <p className="font-sans text-sm text-candy-ink/70">
                  {isSpectator
                    ? tSpectator("bannerBody")
                    : t("spectatorMode.subtitle")}
                </p>
              </div>
            ) : (
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
            )}
          </div>

          {/* Sidebar Panel: Live Feed & Eliminators */}
          <div className="lg:col-span-1 space-y-6">
            <div className="p-5 rounded-3xl border-[3.5px] border-candy-ink bg-white shadow-[5px_5px_0_0_#2B2D42] space-y-4">
              <h3 className="font-display font-black text-sm text-candy-ink uppercase tracking-wider flex items-center gap-2 border-b-[3px] border-candy-ink pb-2">
                <Swords className="w-4 h-4 text-candy-red stroke-[2.5]" />
                {t("opponentsTitle")}
              </h3>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {/* F1 fix: the sidebar used to render a hardcoded
                    list of mock opponents (`Zero_Cool`, `Acid_Burn`,
                    `Lord_Nikon`, `Cereal_Killer`, `Crash_Override`)
                    that was a flat-out deception to the user. The
                    list now reads from the server-authoritative
                    `match.players` array, with the per-round
                    ELIMINATED state stamped by the socket store's
                    ROUND_ENDED + PLAYER_ELIMINATED handlers.

                    Sort: alive (ACTIVE / DISCONNECTED) first,
                    eliminated last. Within each group, keep the
                    server's relative order (it's deterministic —
                    based on join order).

                    If `match.players` is empty (e.g. late-joiner
                    who hasn't received a snapshot yet), fall back
                    to a neutral "waiting for player list" hint
                    instead of mock data. */}
                {(() => {
                  const players = match?.players ?? [];
                  if (players.length === 0) {
                    return (
                      <div
                        data-testid="opponents-empty"
                        className="text-xs text-candy-ink/50 italic px-2 py-3 text-center"
                      >
                        {t("opponentsEmpty")}
                      </div>
                    );
                  }
                  const sorted = [...players].sort((a, b) => {
                    const aEliminated = a.status === "ELIMINATED";
                    const bEliminated = b.status === "ELIMINATED";
                    if (aEliminated !== bEliminated) {
                      return aEliminated ? 1 : -1;
                    }
                    return 0;
                  });
                  return sorted.map((player) => {
                    const avatarDetail = getPlayerAvatar(
                      player.name,
                      player.id,
                    );
                    const isAlive = player.status !== "ELIMINATED";

                    return (
                      <div
                        key={player.id}
                        data-testid={`opponent-${player.id}`}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-candy-cloud border-[2px] border-candy-ink text-xs shadow-[2px_2px_0_0_#2B2D42]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AvatarFrame size="xs" className="bg-white">
                            {avatarDetail.isAnimated &&
                            avatarDetail.spritesheet ? (
                              <AnimatedSprite
                                src={avatarDetail.spritesheet}
                                scale={1.8}
                                row={0}
                                speed={120}
                              />
                            ) : (
                              <Avatar
                                size="xs"
                                fallback={avatarDetail.seed}
                                className="border-0 shadow-none"
                              />
                            )}
                          </AvatarFrame>
                          <span className="font-display font-black text-candy-ink truncate max-w-[80px]">
                            {player.name}
                          </span>
                        </div>
                        <div className="shrink-0 ml-1">
                          {isAlive ? (
                            <span className="text-[9px] font-display font-black text-candy-ink bg-candy-mint border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                              {t("aliveStatus")}
                            </span>
                          ) : (
                            <span className="text-[9px] font-display font-black text-white bg-candy-red border-[1.5px] border-candy-ink px-1.5 py-0.5 rounded-md shadow-[1px_1px_0_0_#2B2D42]">
                              {t("eliminatedStatus")}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="p-4 rounded-2xl border-[3px] border-candy-ink bg-[#FFF8E7] flex gap-3 shadow-[4px_4px_0_0_#2B2D42]">
              <ShieldAlert className="w-5 h-5 text-candy-yellow shrink-0 mt-0.5 stroke-[2.5]" />
              <p className="text-[10px] leading-relaxed text-candy-ink font-semibold">
                <strong>{t("antiHackDescription")}:</strong>{" "}
                {t("antiHackDetails")}
              </p>
            </div>

            {/* Leave Match Button */}
            <button
              onClick={() => setShowLeaveModal(true)}
              className="w-full h-12 bg-candy-red text-white border-[3px] border-candy-ink shadow-[4px_4px_0_0_#2B2D42] rounded-2xl hover:translate-y-[-1.5px] hover:shadow-[5px_5px_0_0_#2B2D42] active:translate-y-[2.5px] active:shadow-[1.5px_1.5px_0_0_#2B2D42] font-display font-black text-xs tracking-wider uppercase flex items-center justify-center cursor-pointer transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={roundCompleted || match?.status === "FINISHED"}
            >
              <LogOut className="w-4 h-4 mr-2 stroke-[2.5]" />
              {t("leaveMatchButton")}
            </button>
          </div>
        </div>
      </div>

      {/* Match Finished Overlay */}
      {match?.status === "FINISHED" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="jelly-card p-8 rounded-3xl border-[4px] border-candy-ink bg-white shadow-[8px_8px_0_0_#2B2D42] text-center space-y-4 animate-bounce-in">
            <div className="flex justify-center">
              <Trophy className="w-16 h-16 text-candy-yellow animate-bounce stroke-[2] fill-candy-ink/10" />
            </div>
            <h2 className="font-display font-black text-3xl tracking-wide uppercase text-candy-ink drop-shadow-[0_2px_0_rgba(0,0,0,0.05)]">
              {t("matchFinishedOverlay.title")}
            </h2>
            <p className="font-sans text-sm font-bold text-candy-ink/70">
              {t("matchFinishedOverlay.subtitle")}
            </p>
          </div>
        </div>
      )}

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
