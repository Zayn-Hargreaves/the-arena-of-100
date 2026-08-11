import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import { resolveCardEffect } from "@arena/game-core";
import {
  ClientEvent,
  ErrorCode,
  PlayerStatus,
  RoomError,
  ServerEvent,
  type CardEffect,
  type CardId,
} from "@arena/shared";
import type { RedisService } from "../redis/redis.service";
import type { MatchService } from "./match.service";
import type { MatchOwnershipService } from "./match-ownership.service";
import type { CommandOutcome } from "./match-command.service";
import type {
  CardPickBody,
  CardPlayBody,
  CommandEnvelope,
} from "./dto/match-command.dto";
import {
  assertCardId,
  validateCardCommand,
  validateOfferCorrelation,
} from "./card-validator";
import {
  emitCardResolved,
  emitPlayerCommandError,
  findCanonicalCardEvent,
  sanitizeCardEffect,
} from "./match-card-command.helpers";
import { expandCardTargets, makeCardResolveRng } from "./match-card-targeting";

interface CardCommandContext {
  redis: RedisService;
  matchService: MatchService;
  ownership: MatchOwnershipService;
  logger: Logger;
}

type DuplicateRecovery =
  | "RECOVERED"
  | "UNVERIFIED"
  | "RETRY"
  | "DUPLICATE_EVENT";

const appliedSetKey = (matchId: string): string => `match:applied:${matchId}`;

async function recoverDuplicatePickEvent(
  context: CardCommandContext,
  env: CommandEnvelope<CardPickBody>,
  server: Server,
): Promise<DuplicateRecovery> {
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "DUPLICATE_EVENT";
  const canonical = findCanonicalCardEvent(
    stateMachine,
    "CARD_PICKED",
    env.body.userId,
    env.body.cardId,
    env.body.offerSeqNo,
  );
  if (!canonical) return "DUPLICATE_EVENT";
  if (
    canonical.payload.eventId !== env.eventId ||
    canonical.payload.commandId !== env.body.commandId
  ) {
    return "UNVERIFIED";
  }
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  const roomId = stateMachine.getState().roomId;
  if (roomId) {
    server.to(`room:${roomId}`).emit(ServerEvent.CARD_PICKED, {
      matchId: env.matchId,
      roundNo: canonical.payload.roundNo,
      playerId: canonical.payload.playerId,
      selectedCardId: canonical.payload.selectedCardId,
      offerSeqNo: canonical.payload.offerSeqNo,
    });
  }
  return "DUPLICATE_EVENT";
}

async function recoverDuplicatePlayEvent(
  context: CardCommandContext,
  env: CommandEnvelope<CardPlayBody>,
  server: Server,
): Promise<DuplicateRecovery> {
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "RETRY";
  const canonical = findCanonicalCardEvent(
    stateMachine,
    "CARD_RESOLVED",
    env.body.userId,
    env.body.cardId,
    env.body.offerSeqNo,
  );
  if (!canonical) return "DUPLICATE_EVENT";
  if (
    canonical.payload.eventId !== env.eventId ||
    canonical.payload.commandId !== env.body.commandId
  ) {
    return "UNVERIFIED";
  }
  if (context.ownership.currentFence(env.matchId) == null) return "RETRY";
  emitCardResolved(
    context.logger,
    server,
    stateMachine.getState().roomId,
    canonical.payload,
  );
  return "RECOVERED";
}

async function handleDuplicatePickRecovery(
  context: CardCommandContext,
  env: CommandEnvelope<CardPickBody>,
  server: Server,
): Promise<CommandOutcome> {
  const recovery = await recoverDuplicatePickEvent(context, env, server);
  if (recovery === "RECOVERED" || recovery === "DUPLICATE_EVENT") {
    return "DUPLICATE_EVENT";
  }
  if (recovery === "RETRY") return "RETRY";
  emitPlayerCommandError(
    context.logger,
    server,
    env.body.userId,
    ClientEvent.CARD_PICK,
    env.body.commandId,
    new RoomError(ErrorCode.COMMAND_ID_CONFLICT),
  );
  return "DUPLICATE_SUBMISSION";
}

async function handleDuplicatePlayRecovery(
  context: CardCommandContext,
  env: CommandEnvelope<CardPlayBody>,
  server: Server,
): Promise<CommandOutcome> {
  const recovery = await recoverDuplicatePlayEvent(context, env, server);
  if (recovery === "RECOVERED" || recovery === "DUPLICATE_EVENT") {
    return "DUPLICATE_EVENT";
  }
  if (recovery === "RETRY") return "RETRY";
  emitPlayerCommandError(
    context.logger,
    server,
    env.body.userId,
    ClientEvent.CARD_PLAY,
    env.body.commandId,
    new RoomError(ErrorCode.COMMAND_ID_CONFLICT),
  );
  return "DUPLICATE_SUBMISSION";
}

export async function applyCardPickCommand(
  context: CardCommandContext,
  env: CommandEnvelope<CardPickBody>,
  server: Server,
): Promise<CommandOutcome> {
  const applied = appliedSetKey(env.matchId);
  let alreadyApplied: boolean;
  try {
    alreadyApplied = await context.redis.sismember(applied, env.eventId);
  } catch (error) {
    context.logger.warn(
      `applyCardPickAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "RETRY";
  }
  if (alreadyApplied) {
    return handleDuplicatePickRecovery(context, env, server);
  }

  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "RETRY";
  const state = stateMachine.getState();
  const userId = env.body.userId;
  const player = state.players?.get(userId);
  if (!player) {
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PICK,
      env.body.commandId,
      new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER),
    );
    return "DUPLICATE_SUBMISSION";
  }
  if (
    player.status === PlayerStatus.ELIMINATED ||
    player.status === PlayerStatus.WINNER ||
    player.status === PlayerStatus.DISCONNECTED
  ) {
    const code =
      player.status === PlayerStatus.DISCONNECTED
        ? ErrorCode.PLAYER_DISCONNECTED
        : ErrorCode.SPECTATOR_CANNOT_ANSWER;
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PICK,
      env.body.commandId,
      new RoomError(code),
    );
    return "DUPLICATE_SUBMISSION";
  }

  try {
    assertCardId(env.body.cardId);
    const offeredCardIds =
      stateMachine.getCardOfferForPlayer(userId, env.body.offerSeqNo) ?? [];
    validateOfferCorrelation(env.body.cardId as CardId, offeredCardIds);
    stateMachine.pickCard(userId, env.body.cardId, env.body.offerSeqNo, {
      eventId: env.eventId,
      commandId: env.body.commandId,
    });
  } catch (error) {
    if (stateMachine.getPickedCards(userId).has(env.body.cardId as CardId)) {
      return handleDuplicatePickRecovery(context, env, server);
    }
    context.logger.warn(
      `applyCardPickAuthoritative: pickCard rejected for ${env.matchId}/${userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
    );
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PICK,
      env.body.commandId,
      error,
    );
    return "DUPLICATE_SUBMISSION";
  }

  const persisted = await context.matchService.persistStateMachine(env.matchId);
  if (persisted !== "APPLIED") {
    context.matchService.evictStateMachine(env.matchId);
    return "RETRY";
  }

  const roomId = state.roomId;
  if (roomId) {
    server.to(`room:${roomId}`).emit(ServerEvent.CARD_PICKED, {
      matchId: env.matchId,
      roundNo: stateMachine.getCurrentRound()?.roundNo ?? 0,
      playerId: userId,
      selectedCardId: env.body.cardId,
      offerSeqNo: env.body.offerSeqNo,
    });
  } else {
    context.logger.warn(
      `applyCardPickAuthoritative: missing roomId for ${env.matchId}, unable to broadcast CARD_PICKED`,
    );
  }

  try {
    await context.redis.sadd(applied, env.eventId);
  } catch {
    // A redelivery is healable from the persisted state-machine event.
  }
  return "APPLIED";
}

export async function applyCardPlayCommand(
  context: CardCommandContext,
  env: CommandEnvelope<CardPlayBody>,
  server: Server,
): Promise<CommandOutcome> {
  const applied = appliedSetKey(env.matchId);
  let alreadyApplied: boolean;
  try {
    alreadyApplied = await context.redis.sismember(applied, env.eventId);
  } catch (error) {
    context.logger.warn(
      `applyCardPlayAuthoritative: dedup read failed for ${env.matchId} (RETRY): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "RETRY";
  }
  if (alreadyApplied) {
    return handleDuplicatePlayRecovery(context, env, server);
  }

  const stateMachine = await context.matchService.getStateMachine(env.matchId);
  if (!stateMachine) return "RETRY";
  const state = stateMachine.getState();
  const userId = env.body.userId;
  const player = state.players?.get(userId);
  if (!player) {
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PLAY,
      env.body.commandId,
      new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER),
    );
    return "DUPLICATE_SUBMISSION";
  }
  if (
    player.status === PlayerStatus.ELIMINATED ||
    player.status === PlayerStatus.WINNER ||
    player.status === PlayerStatus.DISCONNECTED
  ) {
    const code =
      player.status === PlayerStatus.DISCONNECTED
        ? ErrorCode.PLAYER_DISCONNECTED
        : ErrorCode.SPECTATOR_CANNOT_ANSWER;
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PLAY,
      env.body.commandId,
      new RoomError(code),
    );
    return "DUPLICATE_SUBMISSION";
  }

  const pickedCards = Array.from(stateMachine.getPickedCards(userId));
  const offeredCardIds =
    stateMachine.getCardOfferForPlayer(userId, env.body.offerSeqNo) ?? [];
  const currentRoundNo = stateMachine.getCurrentRound()?.roundNo ?? 0;
  let validated;
  try {
    validated = validateCardCommand({
      cardId: env.body.cardId,
      offeredCardIds: offeredCardIds as CardId[],
      targetPlayerId: env.body.targetPlayerId,
      rosterPlayerIds: new Set(state.players.keys()),
      currentAoeCount: stateMachine.getAoeCountForRound(currentRoundNo),
      playedCardIds: stateMachine.getPlayedCards(userId),
      pickedCards,
      actingPlayerId: userId,
    });
  } catch (error) {
    context.logger.warn(
      `applyCardPlayAuthoritative: validateCardCommand rejected for ${env.matchId}/${userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
    );
    if (stateMachine.getPlayedCards(userId).has(env.body.cardId as CardId)) {
      return handleDuplicatePlayRecovery(context, env, server);
    }
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PLAY,
      env.body.commandId,
      error,
    );
    return "DUPLICATE_SUBMISSION";
  }

  const resolveRng = makeCardResolveRng(
    env.matchId,
    userId,
    currentRoundNo,
    env.body.offerSeqNo,
    env.body.cardId,
  );
  let resolved: CardEffect;
  try {
    resolved = resolveCardEffect(
      validated.cardId,
      validated.template,
      resolveRng,
      {
        targetHand: env.body.targetPlayerId
          ? stateMachine.getHand(env.body.targetPlayerId)
          : undefined,
        options: stateMachine.getCurrentRound()?.question.options,
        correctAnswer: stateMachine.getCorrectAnswer(),
        currentRoundNo,
      },
    );
  } catch (error) {
    /* c8 ignore next 13 */
    context.logger.warn(
      `applyCardPlayAuthoritative: resolveCardEffect rejected for ${env.matchId}/${userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
    );
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PLAY,
      env.body.commandId,
      error,
    );
    return "DUPLICATE_SUBMISSION";
  }

  const targetPlayerIds = expandCardTargets(
    env.matchId,
    validated.cardId,
    userId,
    env.body.targetPlayerId,
    currentRoundNo,
    env.body.offerSeqNo,
    stateMachine,
  );
  const serverNow = Date.now();
  let result;
  try {
    result = stateMachine.playCard(
      userId,
      validated.cardId,
      env.body.offerSeqNo,
      resolved,
      targetPlayerIds,
      serverNow,
      { eventId: env.eventId, commandId: env.body.commandId },
    );
  } catch (error) {
    context.logger.warn(
      `applyCardPlayAuthoritative: playCard rejected for ${env.matchId}/${userId} (acking as no-op): ${error instanceof Error ? error.message : String(error)}`,
    );
    /* c8 ignore next 3 */
    if (stateMachine.getPlayedCards(userId).has(env.body.cardId as CardId)) {
      return handleDuplicatePlayRecovery(context, env, server);
    }
    emitPlayerCommandError(
      context.logger,
      server,
      userId,
      ClientEvent.CARD_PLAY,
      env.body.commandId,
      error,
    );
    return "DUPLICATE_SUBMISSION";
  }

  const persisted = await context.matchService.persistStateMachine(env.matchId);
  if (persisted !== "APPLIED") {
    context.matchService.evictStateMachine(env.matchId);
    return "RETRY";
  }

  const roomId = state.roomId;
  if (roomId) {
    const basePayload = {
      seqNo: result.seqNo,
      matchId: env.matchId,
      roundNo: currentRoundNo,
      cardId: env.body.cardId,
      offerSeqNo: env.body.offerSeqNo,
      playedByPlayerId: userId,
      targetPlayerIds,
      resolution:
        result.expiresAtServer === null
          ? ("MUTATION" as const)
          : ("TEMPORARY" as const),
      serverTimestamp: serverNow,
      expiresAtServer: result.expiresAtServer,
      remainingMs: result.remainingMs,
    };
    const fullEffectRooms = targetPlayerIds.map((id) => `player:${id}`);
    server
      .to(`room:${roomId}`)
      .except(fullEffectRooms)
      .emit(ServerEvent.CARD_RESOLVED, {
        ...basePayload,
        effect: sanitizeCardEffect(resolved),
      });
    for (const targetId of targetPlayerIds) {
      server.to(`player:${targetId}`).emit(ServerEvent.CARD_RESOLVED, {
        ...basePayload,
        effect: resolved,
      });
    }
  } else {
    context.logger.warn(
      `applyCardPlayAuthoritative: missing roomId for ${env.matchId}, unable to broadcast CARD_RESOLVED`,
    );
  }

  try {
    await context.redis.sadd(applied, env.eventId);
  } catch {
    // A redelivery is healable from the persisted state-machine event.
  }
  return "APPLIED";
}
