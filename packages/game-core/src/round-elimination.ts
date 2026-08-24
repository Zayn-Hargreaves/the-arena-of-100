import { ANSWER_CODES, type RoundState } from "@arena/shared";

export const UNAVAILABLE = Symbol("UNAVAILABLE");

export type RoundStartingPlayers = string[] | typeof UNAVAILABLE;

export type RoundWithEliminationInputs = RoundState & {
  correctAnswer: string;
  startingPlayers: string[];
};

/**
 * Checks if a submitted answer matches the correct answer.
 * Supports:
 * 1. Direct text match (case-insensitive, trimmed)
 * 2. Letter code ("A", "B", "C", "D") vs question options content
 * 3. Position index matching within options array
 */
export function isAnswerMatch(
  submittedAnswer: string | undefined | null,
  correctAnswer: string | undefined | null,
  options?: string[],
): boolean {
  if (!submittedAnswer || !correctAnswer) return false;
  const subClean = submittedAnswer.trim();
  const corrClean = correctAnswer.trim();

  // Direct case-insensitive match
  if (subClean.toLowerCase() === corrClean.toLowerCase()) {
    return true;
  }

  if (options && Array.isArray(options) && options.length > 0) {
    const subCodeIdx = ANSWER_CODES.indexOf(
      subClean.toUpperCase() as (typeof ANSWER_CODES)[number],
    );
    const corrCodeIdx = ANSWER_CODES.indexOf(
      corrClean.toUpperCase() as (typeof ANSWER_CODES)[number],
    );

    // 1. Submitted answer is a letter ("A", "B", "C", "D") and points to the option text that matches correctAnswer
    if (subCodeIdx >= 0 && options[subCodeIdx] !== undefined) {
      if (
        options[subCodeIdx].trim().toLowerCase() === corrClean.toLowerCase()
      ) {
        return true;
      }
    }

    // 2. Correct answer is a letter ("A", "B", "C", "D") and points to the option text that matches submittedAnswer
    if (corrCodeIdx >= 0 && options[corrCodeIdx] !== undefined) {
      if (
        options[corrCodeIdx].trim().toLowerCase() === subClean.toLowerCase()
      ) {
        return true;
      }
    }

    // 3. Both are matching option text in the options array
    const subIdx = options.findIndex(
      (opt) => opt.trim().toLowerCase() === subClean.toLowerCase(),
    );
    const corrIdx = options.findIndex(
      (opt) => opt.trim().toLowerCase() === corrClean.toLowerCase(),
    );
    if (subIdx >= 0 && corrIdx >= 0 && subIdx === corrIdx) {
      return true;
    }
  }

  return false;
}

export function eliminationsForRound(
  round: RoundWithEliminationInputs,
): string[] {
  return round.startingPlayers.filter((playerId) => {
    const answer = round.answers.get(playerId);
    if (!answer) return true;
    if (typeof answer.isCorrect === "boolean") {
      return !answer.isCorrect;
    }
    return !isAnswerMatch(
      answer.answer,
      round.correctAnswer,
      round.question?.options,
    );
  });
}
