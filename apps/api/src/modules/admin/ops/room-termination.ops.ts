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
  const { roomService, matchService, gameLoopService, logger } = deps;
  if (!adminUserId || adminUserId.trim() === "") {
    throw new Error("terminateRoom: adminUserId is required");
  }
  // PR 3: default reason for the audit row. Overridden to
  // "ALREADY_FINISHING" if the B1 guard aborts the kill-switch.
  let reasonForAudit: string = "KILL_SWITCH";

  // 1. Resolve room — throws RoomError(ROOM_NOT_FOUND) → 404
  const room = await roomService.getRoom(roomId);
  const matchId = room.currentMatchId;

  // 2. Persist match finish in DB (no winner on admin termination).
  // Failure here is recorded as a partial result so the admin UI can
  // trigger a follow-up sweep — cleanup still runs regardless.
  const progress: TerminationProgress = { partial: false };

  if (matchId) {
    // B1 fix: idempotency gate between the natural finish path
    // (`GameLoopService.finishMatchLoop` triggered by
    // `checkMatchEnd` when survivors <= 1 or MAX_ROUNDS is hit)
    // and the admin kill-switch. If a natural finish is already
    // in flight for this matchId, the timer path is mid-write on
    // the Match row + mid-emit on MATCH_FINISHED. Letting the
    // admin path proceed would produce:
    //
    //   - two DB writes to the same Match row with conflicting
    //     winnerId (string from the natural path, null from
    //     admin termination)
    //   - two conflicting broadcasts (MATCH_FINISHED with the
    //     winner, then ROOM_TERMINATED for the same room)
    //   - a `disbandRoom` call against a Room row the natural
    //     path is still treating as live
    //
    // Aborting the whole kill-switch with a typed reason lets the
    // admin UI report the situation deterministically and lets the
    // natural finish complete on its own. The client already
    // gets a MATCH_FINISHED, so the user-visible end-state is
    // correct.
    if (gameLoopService.isMatchFinishing(matchId)) {
      const terminatedAt = Date.now();
      logger.warn(
        `Admin termination of room ${roomId} aborted: match ${matchId} is already finishing naturally. The natural finish will complete on its own.`,
      );
      // PR 3: aborted kill-switches still deserve an audit row so
      // the operator can answer "did anyone try to terminate this
      // room while it was finishing?". appendAudit is best-effort
      // (see helper) so any throw is swallowed + logged.
      reasonForAudit = "ALREADY_FINISHING";
      await appendAudit(deps, {
        matchId,
        roomId,
        adminUserId,
        eventType: "ADMIN_TERMINATE_ROOM",
        payload: {
          success: false,
          partial: false,
          reason: reasonForAudit,
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
      // receive the roomId explicitly (it used to look it up
      // itself inside the transaction, which Prisma's typed
      // transaction API makes awkward). The admin path has the
      // roomId in scope from the resolved room, so this is
      // straightforward.
      await matchService.finishMatch(matchId, null, roomId, true);
    } catch (error) {
      recordPartialTerminationFailure(
        logger,
        progress,
        `Failed to finish match ${matchId} during admin termination of room ${roomId}`,
        error,
      );
    }
  }

  // 3. Stop in-memory timers + lobby countdown. `stopRoomRuntime` reaches
  // Redis via `clearPersistedCountdown`, which can throw. We do not want
  // that to abort the rest of the kill-switch (Redis cleanup, DB
  // disband, room-channel notification) — the room must still be torn
  // down from the caller's perspective. The error is logged with
  // context so it can be correlated with the room/match in observability.
  try {
    await gameLoopService.stopRoomRuntime(roomId, matchId);
  } catch (error) {
    recordPartialTerminationFailure(
      logger,
      progress,
      `stopRoomRuntime failed during admin termination of room ${roomId}${matchId ? ` (match ${matchId})` : ""}`,
      error,
    );
  }

  // 4. Emit ROOM_TERMINATED to the room channel. `emitRoomTerminated`
  // already guards against `!this.server` (logs a warn and returns), but
  // a misbehaving socket.io adapter could still throw on the actual
  // emit. Defensive catch so the rest of the kill-switch still runs.
  try {
    gameLoopService.emitRoomTerminated(roomId, { matchId, message });
  } catch (error) {
    recordPartialTerminationFailure(
      logger,
      progress,
      `emitRoomTerminated failed during admin termination of room ${roomId}${matchId ? ` (match ${matchId})` : ""}`,
      error,
    );
  }

  // 5. Clean Redis keys explicitly. `cleanupRoomRedisKeys` performs
  // SCAN + DEL against the room/match prefixes; if Redis is unreachable
  // here, the connection error must not abort the kill-switch before
  // step 6 (DB disband). The room channel has already been notified
  // (step 4) and timers already stopped (step 3), so the players are
  // already kicked — we still need the DB record cleaned up and the
  // admin UI informed via the `{ partial: true, cleanupError }`
  // response contract (see apps/web/src/app/[locale]/admin/page.tsx).
  // The error is also surfaced to the caller (not just logged) so the
  // admin UI can report a partial result and trigger a follow-up sweep
  // if needed.
  try {
    await cleanupRoomRedisKeys(deps, roomId, matchId);
  } catch (error) {
    recordPartialTerminationFailure(
      logger,
      progress,
      `failed to cleanup Redis keys for room ${roomId}${matchId ? ` (match ${matchId})` : ""}`,
      error,
    );
  }

  // 6. Disband room (DB). Surface partial-failure to the caller instead
  // of silently swallowing it: the room channel has been notified and
  // timers/Redis have been cleaned, so we cannot roll back, but the
  // admin UI still needs to know the DB record is stale. Errors here
  // are merged into the same `partial`/`cleanupError` flags so the
  // caller sees a single consistent partial-success signal regardless
  // of which step failed.
  try {
    await roomService.disbandRoom(roomId);
  } catch (error) {
    recordPartialTerminationFailure(
      logger,
      progress,
      `failed to disband room ${roomId} during admin termination${matchId ? ` (match ${matchId})` : ""}`,
      error,
    );
  }

  const terminatedAt = Date.now();
  logger.warn(
    `Room ${roomId} terminated by admin${matchId ? ` (match ${matchId})` : ""}${progress.partial ? " (partial: cleanup failed)" : ""}`,
  );

  // PR 3: append the audit row. Written LAST so the kill-switch can
  // record the final { success, partial, cleanupError, reason }
  // shape that the operator will see. If the audit insert itself
  // throws, appendAudit swallows + logs (audit is best-effort — see
  // the helper comment), so the kill-switch still returns the
  // correct TerminateRoomResult to the controller.
  await appendAudit(deps, {
    matchId,
    roomId,
    adminUserId,
    eventType: "ADMIN_TERMINATE_ROOM",
    payload: {
      success: !progress.partial,
      partial: progress.partial,
      reason: reasonForAudit,
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
  let cursor = "0";
  do {
    const [next, keys] = await client.scan(
      cursor,
      "MATCH",
      `room:presence:${roomId}:*`,
      "COUNT",
      1000,
    );
    cursor = next;
    if (keys.length > 0) keysToDelete.push(...keys);
  } while (cursor !== "0");

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
