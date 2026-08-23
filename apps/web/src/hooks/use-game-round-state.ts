import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIG, MatchStatus } from "@arena/shared";
import type {
  LastAnswerResult,
  Match,
  PendingAnswer,
} from "@/stores/socket-store.types";
import {
  calculateRemainingSeconds,
  determineTileVariant,
  resolveRevealedCorrectAnswer,
} from "@/lib/game-round-helpers";

interface UseGameRoundStateOptions {
  matchId: string;
  match: Match | null;
  pendingAnswer: PendingAnswer | null;
  lastAnswerResult: LastAnswerResult | null;
  isSpectator?: boolean;
  hasSecondChance?: boolean;
  submitAnswer: (
    matchId: string,
    roundNo: number,
    answer: string,
  ) => string | null;
}

export function useGameRoundState({
  matchId,
  match,
  pendingAnswer,
  lastAnswerResult,
  isSpectator,
  hasSecondChance = false,
  submitAnswer,
}: UseGameRoundStateOptions) {
  const roundDuration = GAME_CONFIG.ROUND_DURATION_MS / 1000;
  const { hasCurrentQuestion, questionText, options } = useMemo(() => {
    const currentQuestion = match?.currentQuestion;
    return {
      hasCurrentQuestion: Boolean(currentQuestion),
      questionText: currentQuestion?.content ?? "",
      options: currentQuestion?.options ?? [],
    };
  }, [match?.currentQuestion]);

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

  const [timeLeft, setTimeLeft] = useState(roundDuration);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [roundCompleted, setRoundCompleted] = useState(false);
  const [revealedCorrectAnswer, setRevealedCorrectAnswer] = useState<
    string | null
  >(null);

  const effectiveSelectedAnswer =
    selectedAnswer ??
    activePendingAnswer?.answer ??
    activeAnswerResult?.submittedAnswer ??
    null;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearCountdownTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const lastTrackedRoundRef = useRef<number | null>(null);
  const prevStatusRef = useRef<MatchStatus | null>(null);

  // When round changes to a new active round, reset selectedAnswer, roundCompleted and revealedCorrectAnswer
  useEffect(() => {
    const isNowActive = match?.status === MatchStatus.ROUND_ACTIVE;
    const statusChangedToActive =
      isNowActive && prevStatusRef.current !== MatchStatus.ROUND_ACTIVE;
    prevStatusRef.current = match?.status ?? null;

    if (isNowActive) {
      if (
        activeRoundNo !== undefined &&
        (activeRoundNo !== lastTrackedRoundRef.current || statusChangedToActive)
      ) {
        lastTrackedRoundRef.current = activeRoundNo;
        setRoundCompleted(false);
        setRevealedCorrectAnswer(null);
        setSelectedAnswer(
          activePendingAnswer?.answer ??
            activeAnswerResult?.submittedAnswer ??
            null,
        );
      }
    }
  }, [
    match?.status,
    activeRoundNo,
    activePendingAnswer?.answer,
    activeAnswerResult?.submittedAnswer,
  ]);

  const calculateTimeLeft = useCallback(
    () => calculateRemainingSeconds(match?.roundEndTime, roundDuration),
    [match?.roundEndTime, roundDuration],
  );

  // Countdown timer: runs whenever status is ROUND_ACTIVE
  useEffect(() => {
    if (match?.status !== MatchStatus.ROUND_ACTIVE || roundCompleted) {
      clearCountdownTimer();
      return;
    }
    clearCountdownTimer();
    setTimeLeft(calculateTimeLeft());
    intervalRef.current = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    return clearCountdownTimer;
  }, [
    calculateTimeLeft,
    match?.status,
    roundCompleted,
    activeRoundNo,
    clearCountdownTimer,
  ]);

  const isRoundResultPhase =
    match?.status === MatchStatus.ROUND_RESULT && match.roundEndTime === null;

  useEffect(() => {
    if (!isRoundResultPhase) return;

    clearCountdownTimer();
    setRoundCompleted(true);
  }, [isRoundResultPhase, clearCountdownTimer]);

  useEffect(() => {
    if (!isRoundResultPhase) {
      setRevealedCorrectAnswer(null);
      return;
    }

    setRevealedCorrectAnswer(
      resolveRevealedCorrectAnswer(
        activeAnswerResult,
        options,
        effectiveSelectedAnswer,
      ),
    );
  }, [
    isRoundResultPhase,
    activeAnswerResult,
    options,
    effectiveSelectedAnswer,
  ]);

  const handleSelectAnswer = useCallback(
    (option: string) => {
      if (
        roundCompleted ||
        (!hasSecondChance && (activePendingAnswer || activeAnswerResult)) ||
        !match?.id ||
        match.currentRoundNo <= 0 ||
        isSpectator
      ) {
        return;
      }
      const prevAnswer = selectedAnswer;
      setSelectedAnswer(option);
      const subResult = submitAnswer(match.id, match.currentRoundNo, option);
      if (subResult === null) {
        setSelectedAnswer(prevAnswer);
      }
    },
    [
      roundCompleted,
      hasSecondChance,
      activePendingAnswer,
      activeAnswerResult,
      selectedAnswer,
      isSpectator,
      match?.id,
      match?.currentRoundNo,
      submitAnswer,
    ],
  );

  const getTileVariant = useCallback(
    (answerCode: string) =>
      determineTileVariant({
        answerCode,
        roundCompleted,
        hasSecondChance,
        revealedCorrectAnswer,
        effectiveSelectedAnswer,
        activePendingAnswer,
        activeAnswerResult,
      }),
    [
      roundCompleted,
      hasSecondChance,
      revealedCorrectAnswer,
      effectiveSelectedAnswer,
      activePendingAnswer,
      activeAnswerResult,
    ],
  );

  return {
    activeAnswerResult,
    activePendingAnswer,
    clearCountdownTimer,
    getTileVariant,
    handleSelectAnswer,
    hasCurrentQuestion,
    options,
    questionText,
    roundCompleted,
    roundDuration,
    timeLeft,
  };
}
