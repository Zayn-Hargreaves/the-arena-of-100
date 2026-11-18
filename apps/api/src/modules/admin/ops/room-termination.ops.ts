// ============================================================
// Room termination ops (admin kill-switch) — force-terminates one
// room and any active match in it: finish match, stop timers, notify
// clients, clean Redis, disband DB row, best-effort audited.
// Extracted verbatim from AdminService.terminateRoom + helpers.
// ============================================================

import { Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { RoomService } from "../../room/room.service";
import { MatchService } from "../../match/match.service";
import { GameLoopService } from "../../match/game-loop.service";
import { appendAudit } from "./admin-audit.ops";

export interface TerminateRoomResult {
  success: boolean;
  partial: boolean;
  roomId: string;
  matchId: string | null;
  message: string;
  terminatedAt: number;
  reason?: string;
  cleanupError?: string;
}

interface TerminationProgress {
  partial: boolean;
  cleanupError?: string;
}

export interface RoomTerminationDeps {
  prisma: PrismaService;
  redis: RedisService;
  roomService: RoomService;
  matchService: MatchService;
  gameLoopService: GameLoopService;
  logger: Logger;
}

/**
 * Executes a single termination step defensively: catches and logs any failure,
 * updates the partial progress accumulators, and allows the remaining cleanup
 * steps to proceed.
 */
async function executeTerminationStep(
  logger: Logger,
  progress: TerminationProgress,
  context: string,
  action: () => unknown,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    recordPartialTerminationFailure(logger, progress, context, error);
  }
}

/**
 * Handles match-specific termination logic: checks the natural-finish idempotency
 * guard (aborting if already finishing) and persists the match finish in the DB.
 */
async function handleActiveMatch(
  deps: RoomTerminationDeps,
  roomId: string,
  matchId: string,
  adminUserId: string,
  message: string | undefined,
  progress: TerminationProgress,
): Promise<TerminateRoomResult | null> {
  const { matchService, gameLoopService, logger } = deps;

  // B1 fix: idempotency gate between the natural finish path
  // (`GameLoopService.finishMatchLoop` triggered by
  // `checkMatchEnd` when survivors <= 1 or MAX_ROUNDS is hit)
  // and the admin kill-switch.
  if (gameLoopService.isMatchFinishing(matchId)) {
    const terminatedAt = Date.now();
    logger.warn(
      `Admin termination of room ${roomId} aborted: match ${matchId} is already finishing naturally. The natural finish will complete on its own.`,
    );
    await appendAudit(deps, {
      matchId,
      roomId,
      adminUserId,
      eventType: "ADMIN_TERMINATE_ROOM",
      payload: {
        success: false,
        partial: false,
        reason: "ALREADY_FINISHING",
        message: message ?? null,
      },
    });
    return {
      success: false,
      partial: false,
      roomId,
      matchId,
      reason: "ALREADY_FINISHING",
      message:
        "Match is already finishing naturally; admin kill-switch aborted to avoid double-write.",
      terminatedAt,
    };
  }

  try {
    // H2 + M4 follow-up: the H2 refactor requires finishMatch to
    // receive the roomId explicitly.
    await matchService.finishMatch(matchId, null, roomId, true);
  } catch (error) {
    recordPartialTerminationFailure(
      logger,
      progress,
      `Failed to finish match ${matchId} during admin termination of room ${roomId}`,
      error,
    );
  }

  return null;
}

/**
 * Force-terminates one room and any active match in it. Stops in-process
 * timers, notifies connected clients via ROOM_TERMINATED, cleans Redis
 * keys, and deletes the room from the database. Does not affect other
 * rooms. Used by the admin kill switch (POST /admin/rooms/:roomId/terminate).
 *
 * Throws RoomError(ROOM_NOT_FOUND) when the room does not exist.
 *
 * Returns a result object that distinguishes full success from partial
 * success: if the final DB `disbandRoom` step fails, `partial: true` is
 * set and `cleanupError` carries the underlying message. The room
 * channel has already been notified and timers/Redis have already been
 * cleaned by that point, so we cannot roll back — but the caller should
 * still know the DB record is stale and may need a follow-up sweep.
 */
export async function terminateRoom(
  deps: RoomTerminationDeps,
  roomId: string,
  adminUserId: string,
  message?: string,
): Promise<TerminateRoomResult> {
  const { roomService, gameLoopService, logger } = deps;
  if (!adminUserId || adminUserId.trim() === "") {
    throw new Error("terminateRoom: adminUserId is required");
  }

  // 1. Resolve room — throws RoomError(ROOM_NOT_FOUND) → 404
  const room = await roomService.getRoom(roomId);
  const matchId = room.currentMatchId;
  const matchSuffix = matchId ? ` (match ${matchId})` : "";

  // 2. Persist match finish in DB (no winner on admin termination).
  // Failure here is recorded as a partial result so the admin UI can
  // trigger a follow-up sweep — cleanup still runs regardless.
  const progress: TerminationProgress = { partial: false };

  if (matchId) {
    const abortResult = await handleActiveMatch(
      deps,
      roomId,
      matchId,
      adminUserId,
      message,
      progress,
    );
    if (abortResult) {
      return abortResult;
    }
  }

  // 3. Stop in-memory timers + lobby countdown. `stopRoomRuntime` reaches
  // Redis via `clearPersistedCountdown`, which can throw. We do not want
  // that to abort the rest of the kill-switch (Redis cleanup, DB
  // disband, room-channel notification).
  await executeTerminationStep(
    logger,
    progress,
    `stopRoomRuntime failed during admin termination of room ${roomId}${matchSuffix}`,
    () => gameLoopService.stopRoomRuntime(roomId, matchId),
  );

  // 4. Emit ROOM_TERMINATED to the room channel.
  await executeTerminationStep(
    logger,
    progress,
    `emitRoomTerminated failed during admin termination of room ${roomId}${matchSuffix}`,
    () => gameLoopService.emitRoomTerminated(roomId, { matchId, message }),
  );

  // 5. Clean Redis keys explicitly.
  await executeTerminationStep(
    logger,
    progress,
    `failed to cleanup Redis keys for room ${roomId}${matchSuffix}`,
    () => cleanupRoomRedisKeys(deps, roomId, matchId),
  );

  // 6. Disband room (DB). Surface partial-failure to the caller instead
  // of silently swallowing it.
  await executeTerminationStep(
    logger,
    progress,
    `failed to disband room ${roomId} during admin termination${matchSuffix}`,
    () => roomService.disbandRoom(roomId),
  );

  const terminatedAt = Date.now();
  const partialSuffix = progress.partial ? " (partial: cleanup failed)" : "";
  logger.warn(
    `Room ${roomId} terminated by admin${matchSuffix}${partialSuffix}`,
  );

  // PR 3: append the audit row. Written LAST so the kill-switch can
  // record the final { success, partial, cleanupError, reason }
  // shape that the operator will see.
  await appendAudit(deps, {
    matchId,
    roomId,
    adminUserId,
    eventType: "ADMIN_TERMINATE_ROOM",
    payload: {
      success: !progress.partial,
      partial: progress.partial,
      reason: "KILL_SWITCH",
      ...(progress.cleanupError ? { cleanupError: progress.cleanupError } : {}),
      message: message ?? null,
    },
  });

  return {
    success: !progress.partial,
    partial: progress.partial,
    roomId,
    matchId,
    message: progress.partial
      ? "Room terminated by admin (partial: cleanup failed)"
      : "Room terminated by admin",
    terminatedAt,
    ...(progress.cleanupError ? { cleanupError: progress.cleanupError } : {}),
  };
}

function recordPartialTerminationFailure(
  logger: Logger,
  progress: TerminationProgress,
  context: string,
  error: unknown,
) {
  progress.partial = true;
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStack = error instanceof Error ? error.stack : undefined;

  // Prefer the first error encountered so the caller can act on a
  // stable field; later failures are still logged for operators.
  if (!progress.cleanupError) {
    progress.cleanupError = errMsg;
  }

  logger.error(`Partial termination: ${context}: ${errMsg}`, errStack);
}

/**
 * Recursively scans and collects all room presence keys from Redis, avoiding
 * await-inside-loop patterns while handling cursor pagination.
 */
async function collectPresenceKeys(
  client: ReturnType<RedisService["getClient"]>,
  roomId: string,
  cursor = "0",
  accumulated: string[] = [],
): Promise<string[]> {
  const [next, keys] = await client.scan(
    cursor,
    "MATCH",
    `room:presence:${roomId}:*`,
    "COUNT",
    1000,
  );
  if (keys.length > 0) {
    accumulated.push(...keys);
  }
  if (next !== "0") {
    return collectPresenceKeys(client, roomId, next, accumulated);
  }
  return accumulated;
}

/**
 * Deletes the Redis keys associated with one room and (optionally) its
 * active match state. Mirrors the explicit, key-by-key approach used by
 * resetSystem rather than wildcard SCAN, so we never over-delete.
 */
async function cleanupRoomRedisKeys(
  deps: RoomTerminationDeps,
  roomId: string,
  matchId: string | null,
): Promise<void> {
  const { redis, logger } = deps;
  const client = redis.getClient();
  const keysToDelete: string[] = [
    `room:${roomId}`,
    `room:${roomId}:players`,
    `room:${roomId}:playerCount`,
    `room:countdown:${roomId}`,
  ];

  // SCAN+collect presence keys for this room (presence keys are per-user,
  // so we cannot enumerate them statically)
  const presenceKeys = await collectPresenceKeys(client, roomId);
  if (presenceKeys.length > 0) {
    keysToDelete.push(...presenceKeys);
  }

  if (matchId) {
    keysToDelete.push(`match:state:${matchId}`);
  }

  if (keysToDelete.length > 0) {
    await client.del(...keysToDelete);
  }

  // Remove from lobby countdowns index set (best-effort; key may not exist)
  try {
    await client.srem("room:countdowns", roomId);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to SREM room:countdowns for ${roomId}: ${errMsg}`);
  }
}
