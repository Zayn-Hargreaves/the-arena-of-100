import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import type { RedisService } from "../redis/redis.service";
import type { MatchService } from "./match.service";
import type { MatchOwnershipService } from "./match-ownership.service";
import type {
  CommandOutcome,
  CommandSideEffects,
} from "./match-command.service";
import type {
  CommandEnvelope,
  SubmitAnswerBody,
} from "./dto/match-command.dto";
import { appliedSetKey } from "./match-command.keys";

export interface AuthoritativeCommandContext {
  redis: RedisService;
  matchService: MatchService;
  ownership: MatchOwnershipService;
  sideEffects: CommandSideEffects | null;
  logger: Logger;
}

export async function applyDisconnectCommand(
  context: AuthoritativeCommandContext,
  env: CommandEnvelope,
  owner: { fence: number; leaseValue: string },
  server: Server,
): Promise<CommandOutcome> {
  if (!context.sideEffects?.handlePlayerDisconnect) return "RETRY";
  const applied = appliedSetKey(env.matchId);
  let alreadyApplied: boolean;
  try {
    alreadyApplied = await context.redis.sismember(applied, env.eventId);
  } catch (error) {
    context.logger.warn(
      `applyDisconnectAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "RETRY";
  }
  if (alreadyApplied) return "APPLIED";

  const outcome = await context.sideEffects.handlePlayerDisconnect(
    env,
    owner,
    server,
  );
  if (outcome === "APPLIED") {
    try {
      await context.redis.sadd(applied, env.eventId);
    } catch {
      // A redelivery is idempotent because the player is already disconnected.
    }
  }
  return outcome;
}

export async function applyAnswerCommand(
  context: AuthoritativeCommandContext,
  env: CommandEnvelope<SubmitAnswerBody>,
  server: Server,
): Promise<CommandOutcome> {
  if (!context.sideEffects) return "RETRY";
  const applied = appliedSetKey(env.matchId);
  let alreadyApplied: boolean;
  try {
    alreadyApplied = await context.redis.sismember(applied, env.eventId);
  } catch (error) {
    context.logger.warn(
      `applyAnswerAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "RETRY";
  }
  if (alreadyApplied) return recoverDuplicateAnswer(context, env, server);

  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "RETRY";
  const round = stateMachine.getCurrentRound();
  const existing = round?.answers.get(env.body.userId);
  if (existing?.submissionId === env.body.submissionId) {
    return recoverDuplicateAnswer(context, env, server);
  }

  let result;
  try {
    result = stateMachine.submitAnswer(
      env.body.userId,
      env.body.answer,
      Date.now(),
      env.body.submissionId,
    );
  } catch (error) {
    context.logger.warn(
      `applyAnswerAuthoritative: submitAnswer rejected for ${env.matchId}/${env.body.userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "DUPLICATE_SUBMISSION";
  }

  const persisted = await context.matchService.persistStateMachine(env.matchId);
  if (persisted !== "APPLIED") {
    context.matchService.evictStateMachine(env.matchId);
    return "RETRY";
  }

  const roomId = stateMachine.getState().roomId;
  const roundNo = round?.roundNo ?? stateMachine.getState().currentRoundNo;
  context.sideEffects.publishAnswerResult(env, roomId, result, roundNo, server);
  await context.sideEffects.checkEarlyTermination(env.matchId, roomId, server);
  try {
    await context.redis.sadd(applied, env.eventId);
  } catch (error) {
    context.logger.warn(
      `applyAnswerAuthoritative: sadd applied marker failed for ${env.matchId}/${env.eventId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return "APPLIED";
}

export async function recoverDuplicateAnswer(
  context: AuthoritativeCommandContext,
  env: CommandEnvelope<SubmitAnswerBody>,
  server: Server,
): Promise<CommandOutcome> {
  if (!context.sideEffects) return "RETRY";
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "DUPLICATE_EVENT";
  const round = stateMachine.getCurrentRound();
  const answer = round?.answers.get(env.body.userId);
  if (!answer) return "DUPLICATE_EVENT";
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  const roomId = stateMachine.getState().roomId;
  context.sideEffects.publishAnswerResult(
    env,
    roomId,
    answer,
    round?.roundNo ?? stateMachine.getState().currentRoundNo,
    server,
  );
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  await context.sideEffects.checkEarlyTermination(env.matchId, roomId, server);
  return "DUPLICATE_EVENT";
}
