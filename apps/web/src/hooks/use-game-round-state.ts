import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONFIG, MatchStatus } from "@arena/shared";
import type {
  LastAnswerResult,
  Match,
  PendingAnswer,
} from "@/stores/socket-store.types";

interface UseGameRoundStateOptions {
  matchId: string;
  match: Match | null;
  pendingAnswer: PendingAnswer | null;
  lastAnswerResult: LastAnswerResult | null;
  isSpectator: boolean;
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
  const roundResultRevealRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const roundResultContinueRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (roundResultRevealRef.current) {
      clearTimeout(roundResultRevealRef.current);
      roundResultRevealRef.current = null;
    }
    if (roundResultContinueRef.current) {
      clearTimeout(roundResultContinueRef.current);
      roundResultContinueRef.current = null;
    }
  }, []);

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

  const calculateTimeLeft = useCallback(() => {
    if (!match?.roundEndTime) return roundDuration;
    return Math.max(0, Math.floor((match.roundEndTime - Date.now()) / 1000));
  }, [match?.roundEndTime, roundDuration]);

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

    const answerCodes = ["A", "B", "C", "D"];
    const rawAnswer = activeAnswerResult?.correctAnswer?.trim();

    if (rawAnswer) {
      if (answerCodes.includes(rawAnswer.toUpperCase())) {
        setRevealedCorrectAnswer(rawAnswer.toUpperCase());
        return;
      }
      const matchedIndex = options.findIndex(
        (opt) => opt.trim().toLowerCase() === rawAnswer.toLowerCase(),
      );
      if (matchedIndex >= 0 && answerCodes[matchedIndex]) {
        setRevealedCorrectAnswer(answerCodes[matchedIndex]);
        return;
      }
    }

    // Fallback: if server confirmed user's answer is correct, we know the correct answer code
    if (activeAnswerResult?.isCorrect && effectiveSelectedAnswer) {
      setRevealedCorrectAnswer(effectiveSelectedAnswer);
    }
  }, [
    isRoundResultPhase,
    activeAnswerResult,
    options,
    effectiveSelectedAnswer,
  ]);

  useEffect(() => clearTimers, [clearTimers]);

  const handleSelectAnswer = useCallback(
    (option: string) => {
      if (
        roundCompleted ||
        activePendingAnswer ||
        activeAnswerResult ||
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
    (answerCode: string) => {
      if (!roundCompleted) {
        if (effectiveSelectedAnswer === answerCode) {
          return "selected";
        }
        if (
          effectiveSelectedAnswer !== null ||
          activePendingAnswer !== null ||
          activeAnswerResult !== null
        ) {
          return "disabled";
        }
        return "default";
      }

      // During round results:
      const isThisCorrect =
        (revealedCorrectAnswer && answerCode === revealedCorrectAnswer) ||
        (activeAnswerResult?.isCorrect &&
          answerCode === effectiveSelectedAnswer);

      if (isThisCorrect) {
        return "correct";
      }

      if (answerCode === effectiveSelectedAnswer) {
        return "incorrect";
      }

      return "disabled";
    },
    [
      roundCompleted,
      revealedCorrectAnswer,
      effectiveSelectedAnswer,
      activePendingAnswer,
      activeAnswerResult,
    ],
  );

  return {
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
  };
}
