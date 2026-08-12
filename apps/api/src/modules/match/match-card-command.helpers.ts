import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import type { MatchStateMachine } from "@arena/game-core";
import {
  ClientEvent,
  ErrorCode,
  ERROR_MESSAGE_KEYS,
  RoomError,
  ServerEvent,
  type CardEffect,
} from "@arena/shared";

export interface CanonicalCardEvent {
  payload: Record<string, unknown>;
  seqNo: number;
  timestamp: number;
}

export function findCanonicalCardEvent(
  stateMachine: MatchStateMachine,
  type: "CARD_PICKED" | "CARD_RESOLVED",
  playerId: string,
  cardId: string,
  offerSeqNo: number,
): CanonicalCardEvent | null {
  let found: CanonicalCardEvent | null = null;
  stateMachine.forEachEvent((entry) => {
    if (entry.type !== type) return;
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const eventPlayerId =
      type === "CARD_PICKED" ? payload.playerId : payload.playedByPlayerId;
    const eventCardId =
      type === "CARD_PICKED" ? payload.selectedCardId : payload.cardId;
    if (
      eventPlayerId !== playerId ||
      eventCardId !== cardId ||
      payload.offerSeqNo !== offerSeqNo
    ) {
      return;
    }
    found = {
      payload,
      seqNo: entry.seqNo,
      timestamp: entry.timestamp,
    };
    return false;
  }, "reverse");
  return found;
}

export function emitPlayerCommandError(
  logger: Logger,
  server: Server,
  userId: string,
  failedEvent: ClientEvent,
  commandId: string,
  error: unknown,
): void {
  if (error instanceof RoomError) {
    server.to(`player:${userId}`).emit(ServerEvent.ERROR, {
      code: error.code,
      message: ERROR_MESSAGE_KEYS[error.code],
      failedEvent,
      commandId,
    });
    return;
  }
  const detail =
    error instanceof Error
      ? error.message
      : error == null
        ? "null"
        : String(error);
  logger.warn(
    `emitPlayerCommandError: non-RoomError for ${userId} on ${failedEvent}/${commandId}: ${detail}`,
  );
  server.to(`player:${userId}`).emit(ServerEvent.ERROR, {
    code: ErrorCode.INVALID_PAYLOAD,
    message: ERROR_MESSAGE_KEYS[ErrorCode.INVALID_PAYLOAD],
    failedEvent,
    commandId,
  });
}

export function sanitizeCardEffect(effect: CardEffect): CardEffect {
  switch (effect.kind) {
    case "OPTION_DISABLE":
      return { ...effect, indexes: [] };
    case "OPTION_FAKE":
      return { ...effect, indexes: [] };
    case "HINT_REVEAL":
      return { ...effect, partial: "" };
    case "HAND_DESTROY":
      return { ...effect, destroyedCardIds: [] };
    case "TIMER_MODIFY":
    case "OPTION_LOCK":
    case "DELAY_RENDER":
    case "VISUAL_OVERLAY":
    case "SEMANTIC_FLIP":
    case "QUESTION_REPLAY":
    case "SHIELD":
    case "SCORE_MULT":
    case "SECOND_CHANCE":
      return effect;
    default: {
      /* c8 ignore next 3 */
      const exhaustive: never = effect;
      void exhaustive;
      return effect;
    }
  }
}

export function emitCardResolved(
  logger: Logger,
  server: Server,
  roomId: string | undefined,
  payload: Record<string, unknown>,
): void {
  const targetPlayerIds = Array.isArray(payload.targetPlayerIds)
    ? payload.targetPlayerIds
    : [];
  const resolvedEffect = payload.effect as CardEffect | undefined;
  const matchId = payload.matchId as string | undefined;
  if (!roomId) {
    logger.warn(
      `emitCardResolved: replay skipped for ${matchId ?? "unknown"}: missing roomId`,
    );
    return;
  }
  if (resolvedEffect == null) {
    logger.warn(
      `emitCardResolved: replay skipped for ${matchId ?? "unknown"}: null resolvedEffect`,
    );
    return;
  }
  const baseFrame = {
    matchId,
    roundNo: payload.roundNo,
    cardId: payload.cardId as string,
    offerSeqNo: payload.offerSeqNo,
    playedByPlayerId: payload.playedByPlayerId as string,
    targetPlayerIds: targetPlayerIds.slice(),
    resolution: payload.resolution,
    serverTimestamp: payload.serverTimestamp,
    seqNo: payload.seqNo,
    expiresAtServer: payload.expiresAtServer,
    remainingMs: payload.remainingMs,
  };
  const fullEffectRooms = targetPlayerIds.map((id) => `player:${id}`);
  server
    .to(`room:${roomId}`)
    .except(fullEffectRooms)
    .emit(ServerEvent.CARD_RESOLVED, {
      ...baseFrame,
      effect: sanitizeCardEffect(resolvedEffect),
    });
  for (const targetId of targetPlayerIds) {
    server.to(`player:${targetId}`).emit(ServerEvent.CARD_RESOLVED, {
      ...baseFrame,
      effect: resolvedEffect,
    });
  }
}
