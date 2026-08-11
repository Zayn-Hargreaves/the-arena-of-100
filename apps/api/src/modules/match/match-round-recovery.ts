import type { Logger } from "@nestjs/common";
import {
  eliminationsForRound,
  type MatchStateMachine,
  type RoundStartingPlayers,
  UNAVAILABLE,
} from "@arena/game-core";
import type { RoundState } from "@arena/shared";
import type { QuestionService } from "../question/question.service";

type RecoveryRound = Pick<
  RoundState,
  | "matchId"
  | "roundNo"
  | "question"
  | "startedAt"
  | "endsAt"
  | "status"
  | "answers"
> & {
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
};

export interface RoundEndContext {
  survivingIds: string[];
  eliminatedIds: string[];
  correctAnswer: string;
}

interface RoundRecoveryContext {
  logger: Logger;
  questionService: QuestionService;
}

export async function recoverRoundEnd(
  context: RoundRecoveryContext,
  matchId: string,
  stateMachine: MatchStateMachine,
  state: ReturnType<MatchStateMachine["getState"]>,
  round: NonNullable<ReturnType<MatchStateMachine["getCurrentRound"]>>,
): Promise<RoundEndContext> {
  context.logger.log(
    `endRound entering recovery path for match ${matchId} round ${state.currentRoundNo}`,
  );

  const recoveryRound = round as typeof round & RecoveryRound;
  const survivingIds = [...state.survivingPlayerIds];
  let correctAnswer = recoveryRound.correctAnswer || "";

  if (!correctAnswer) {
    const question = await context.questionService.findOne(round.question.id);
    if (question) {
      correctAnswer = question.correctAnswer;
    } else {
      context.logger.warn(
        `Failed to rehydrate correctAnswer in recovery: question ${round.question.id} not found in DB for match ${matchId} round ${round.roundNo}`,
      );
    }
  }

  const startingPlayers = getRecoveryStartingPlayers(
    context,
    recoveryRound,
    matchId,
  );
  const roundEvaluatedEvents = stateMachine
    .getEventLog()
    .filter(
      (event) =>
        event.type === "ROUND_EVALUATED" &&
        event.payload &&
        (event.payload as { roundNo?: number }).roundNo === round.roundNo,
    );
  const recoveredEliminatedIds = getRecoveryEliminatedIdsFromEventLog(
    context,
    roundEvaluatedEvents,
    recoveryRound,
    startingPlayers,
    correctAnswer,
    matchId,
  );

  if (recoveredEliminatedIds) {
    return {
      survivingIds,
      eliminatedIds: recoveredEliminatedIds,
      correctAnswer,
    };
  }

  if (startingPlayers === UNAVAILABLE) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${round.roundNo} skipped eliminatedIds: startingPlayers is UNAVAILABLE`,
    );
    return { survivingIds, eliminatedIds: [], correctAnswer };
  }

  if (!correctAnswer) {
    const survivingSet = new Set(survivingIds);
    return {
      survivingIds,
      eliminatedIds: startingPlayers.filter(
        (playerId) => !survivingSet.has(playerId),
      ),
      correctAnswer,
    };
  }

  return {
    survivingIds,
    eliminatedIds: eliminationsForRound({
      ...recoveryRound,
      correctAnswer,
      startingPlayers,
    }),
    correctAnswer,
  };
}

function getRecoveryStartingPlayers(
  context: RoundRecoveryContext,
  round: RecoveryRound,
  matchId: string,
): string[] | typeof UNAVAILABLE {
  if (round.startingPlayers === UNAVAILABLE) {
    context.logger.warn(
      `Recovery round snapshot unavailable for match ${matchId} round ${round.roundNo}: startingPlayers is UNAVAILABLE`,
    );
    return UNAVAILABLE;
  }

  if (Array.isArray(round.startingPlayers)) {
    return round.startingPlayers;
  }

  context.logger.warn(
    `Recovery round snapshot unavailable for match ${matchId} round ${round.roundNo}: startingPlayers missing`,
  );
  return UNAVAILABLE;
}

export function getRecoveryEliminatedIdsFromEventLog(
  context: RoundRecoveryContext,
  roundEvaluatedEvents: ReadonlyArray<{ payload?: unknown }>,
  recoveryRound: RecoveryRound,
  startingPlayers: string[] | typeof UNAVAILABLE,
  correctAnswer: string,
  matchId: string,
): string[] | null {
  if (roundEvaluatedEvents.length === 0) return null;

  if (roundEvaluatedEvents.length > 1) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ${roundEvaluatedEvents.length} ROUND_EVALUATED events`,
    );
    return null;
  }

  const payload = roundEvaluatedEvents[0]?.payload as {
    eliminatedIds?: unknown;
  };
  if (!Array.isArray(payload?.eliminatedIds)) return null;

  if (
    !payload.eliminatedIds.every((playerId) => typeof playerId === "string")
  ) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with non-string eliminatedIds`,
    );
    return null;
  }

  const eliminatedIds = payload.eliminatedIds;
  if (new Set(eliminatedIds).size !== eliminatedIds.length) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with duplicate eliminatedIds`,
    );
    return null;
  }

  if (startingPlayers === UNAVAILABLE || !correctAnswer) return null;

  const startingPlayerSet = new Set(startingPlayers);
  if (!eliminatedIds.every((playerId) => startingPlayerSet.has(playerId))) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with out-of-round eliminatedIds`,
    );
    return null;
  }

  const expectedEliminatedIds = eliminationsForRound({
    ...recoveryRound,
    correctAnswer,
    startingPlayers,
  });
  const expectedSet = new Set(expectedEliminatedIds);
  const matchesExpected =
    expectedEliminatedIds.length === eliminatedIds.length &&
    eliminatedIds.every((playerId) => expectedSet.has(playerId));
  if (!matchesExpected) {
    context.logger.warn(
      `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event whose eliminatedIds did not match recomputed round results`,
    );
    return null;
  }

  return [...eliminatedIds];
}
