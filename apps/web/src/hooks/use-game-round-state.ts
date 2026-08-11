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

  useEffect(() => {
    if (!activePendingAnswer) return;
    setSelectedAnswer(activePendingAnswer.answer);
  }, [activePendingAnswer]);

  useEffect(() => {
    if (activePendingAnswer) return;
    if (activeAnswerResult?.isCorrect !== undefined) return;
    setSelectedAnswer(null);
  }, [activePendingAnswer, activeAnswerResult]);

  const calculateTimeLeft = useCallback(() => {
    if (!match?.roundEndTime) return roundDuration;
    return Math.max(0, Math.floor((match.roundEndTime - Date.now()) / 1000));
  }, [match?.roundEndTime, roundDuration]);

  useEffect(() => {
    if (roundCompleted) return;
    clearCountdownTimer();
    setTimeLeft(calculateTimeLeft());
    intervalRef.current = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    return clearCountdownTimer;
  }, [calculateTimeLeft, roundCompleted, clearCountdownTimer]);

  const isRoundResultPhase =
    match?.status === MatchStatus.ROUND_RESULT && match.roundEndTime === null;
  useEffect(() => {
    if (!isRoundResultPhase) return;

    clearTimers();
    setRoundCompleted(true);
    roundResultRevealRef.current = setTimeout(() => {
      roundResultContinueRef.current = setTimeout(() => {
        setTimeLeft(roundDuration);
        setSelectedAnswer(null);
        setRoundCompleted(false);
        setRevealedCorrectAnswer(null);
      }, 3000);
    }, 1000);

    return clearTimers;
  }, [isRoundResultPhase, activeRoundNo, clearTimers, roundDuration]);

  useEffect(() => {
    if (!isRoundResultPhase || !activeAnswerResult?.correctAnswer) return;
    const answerCodes = ["A", "B", "C", "D"];
    const rawAnswer = activeAnswerResult.correctAnswer;
    const matchedIndex = options.indexOf(rawAnswer);
    setRevealedCorrectAnswer(
      answerCodes.includes(rawAnswer) || matchedIndex < 0
        ? rawAnswer
        : (answerCodes[matchedIndex] ?? rawAnswer),
    );
  }, [isRoundResultPhase, activeAnswerResult, options]);

  useEffect(() => clearTimers, [clearTimers]);

  const handleSelectAnswer = useCallback(
    (option: string) => {
      if (
        roundCompleted ||
        activePendingAnswer ||
        activeAnswerResult ||
        isSpectator ||
        !match?.id ||
        match.currentRoundNo <= 0
      ) {
        return;
      }
      const submissionId = submitAnswer(match.id, match.currentRoundNo, option);
      if (submissionId) setSelectedAnswer(option);
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
      if (!roundCompleted) {
        return selectedAnswer === answerCode ? "selected" : "default";
      }
      if (revealedCorrectAnswer && answerCode === revealedCorrectAnswer) {
        return "correct";
      }
      return answerCode === selectedAnswer ? "incorrect" : "disabled";
    },
    [roundCompleted, revealedCorrectAnswer, selectedAnswer],
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
