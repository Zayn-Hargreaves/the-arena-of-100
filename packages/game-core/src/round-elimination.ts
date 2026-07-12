import type { RoundState } from "@arena/shared";

export const UNAVAILABLE = Symbol("UNAVAILABLE");

export type RoundStartingPlayers = string[] | typeof UNAVAILABLE;

export type RoundWithEliminationInputs = RoundState & {
  correctAnswer: string;
  startingPlayers: string[];
};

export function eliminationsForRound(
  round: RoundWithEliminationInputs,
): string[] {
  return round.startingPlayers.filter((playerId) => {
    const answer = round.answers.get(playerId);
    return !answer || answer.answer !== round.correctAnswer;
  });
}
