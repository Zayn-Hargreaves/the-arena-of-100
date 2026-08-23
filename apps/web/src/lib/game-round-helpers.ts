import { ANSWER_CODES } from "@arena/shared";
import type {
  LastAnswerResult,
  PendingAnswer,
} from "@/stores/socket-store.types";

export type TileVariant =
  | "default"
  | "selected"
  | "correct"
  | "incorrect"
  | "disabled";

export function calculateRemainingSeconds(
  roundEndTime: number | null | undefined,
  roundDurationSeconds: number,
  now = Date.now(),
): number {
  if (!roundEndTime) return roundDurationSeconds;
  return Math.max(0, Math.floor((roundEndTime - now) / 1000));
}

export function resolveRevealedCorrectAnswer(
  activeAnswerResult: LastAnswerResult | null,
  options: string[],
  effectiveSelectedAnswer: string | null,
): string | null {
  const rawAnswer = activeAnswerResult?.correctAnswer?.trim();

  if (rawAnswer) {
    if ((ANSWER_CODES as readonly string[]).includes(rawAnswer.toUpperCase())) {
      return rawAnswer.toUpperCase();
    }
    const matchedIndex = options.findIndex(
      (opt) => opt.trim().toLowerCase() === rawAnswer.toLowerCase(),
    );
    if (matchedIndex >= 0 && ANSWER_CODES[matchedIndex]) {
      return ANSWER_CODES[matchedIndex];
    }
  }

  // Fallback: if server confirmed user's answer is correct, we know the correct answer code
  if (activeAnswerResult?.isCorrect && effectiveSelectedAnswer) {
    return effectiveSelectedAnswer;
  }

  return null;
}

export function determineTileVariant({
  answerCode,
  roundCompleted,
  hasSecondChance,
  revealedCorrectAnswer,
  effectiveSelectedAnswer,
  activePendingAnswer,
  activeAnswerResult,
}: {
  answerCode: string;
  roundCompleted: boolean;
  hasSecondChance: boolean;
  revealedCorrectAnswer: string | null;
  effectiveSelectedAnswer: string | null;
  activePendingAnswer: PendingAnswer | null;
  activeAnswerResult: LastAnswerResult | null;
}): TileVariant {
  if (!roundCompleted) {
    if (effectiveSelectedAnswer === answerCode) {
      return "selected";
    }
    if (
      !hasSecondChance &&
      (effectiveSelectedAnswer !== null ||
        activePendingAnswer !== null ||
        activeAnswerResult !== null)
    ) {
      return "disabled";
    }
    return "default";
  }

  // During round results:
  const isThisCorrect = Boolean(
    (revealedCorrectAnswer && answerCode === revealedCorrectAnswer) ||
    (activeAnswerResult?.isCorrect && answerCode === effectiveSelectedAnswer),
  );

  if (isThisCorrect) {
    return "correct";
  }

  if (answerCode === effectiveSelectedAnswer) {
    return "incorrect";
  }

  return "disabled";
}
