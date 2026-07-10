// ============================================================
// System reset ops — purges DB match/room state + Redis cache,
// best-effort audited. Extracted verbatim from AdminService.resetSystem.
// ============================================================

import { Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { appendAudit } from "./admin-audit.ops";

export interface SystemResetDeps {
  prisma: PrismaService;
  redis: RedisService;
  logger: Logger;
}

/**
 * Resets the entire match system by purging DB and Redis.
 * @param adminUserId The admin user ID captured from the JWT, used
 *   for the audit row. Required.
 */
export async function resetSystem(deps: SystemResetDeps, adminUserId: string) {
  const { prisma, redis, logger } = deps;
  if (!adminUserId || adminUserId.trim() === "") {
    throw new Error("resetSystem: adminUserId is required");
  }
  logger.warn(
    "system-wide reset triggered! Purging all room, player, match state...",
  );

  // PR 3 (Finding 4 follow-up): accumulators declared outside the
  // try so the finally block can reference them on the
  // partial-failure path. Defaults are zeros so the audit row is
  // well-formed even when the failure happens before any work
  // completed.
  let dbDeleted = {
    answers: 0,
    matchRounds: 0,
    matchPlayers: 0,
    matches: 0,
    roomPlayers: 0,
    rooms: 0,
  };
  let redisKeysDeleted = { room: 0, match: 0, total: 0 };
  let success = false;
  let errorMessage: string | undefined;

  try {
    // Delete DB entries in dependent order, atomically.
    // PR 3: each deleteMany now returns `{ count }` so we can capture
    // the exact number of rows wiped per table for the audit row.
    // Counts are merged into a follow-up audit row written AFTER
    // the deletes complete (the count is only meaningful once the
    // deletes have run).
    //
    // Wrapped in $transaction(array) so either every table is purged
    // or none is — preventing a half-reset state if a mid-sequence
    // delete fails (e.g. FK violation, transient DB error). Pattern
    // mirrors match.service.ts finishMatch.
    const [
      answersDeleted,
      matchRoundsDeleted,
      matchPlayersDeleted,
      matchesDeleted,
      roomPlayersDeleted,
      roomsDeleted,
    ] = await prisma.$transaction([
      prisma.answer.deleteMany(),
      prisma.matchRound.deleteMany(),
      prisma.matchPlayer.deleteMany(),
      prisma.match.deleteMany(),
      prisma.roomPlayer.deleteMany(),
      prisma.room.deleteMany(),
    ]);

    dbDeleted = {
      answers: answersDeleted.count,
      matchRounds: matchRoundsDeleted.count,
      matchPlayers: matchPlayersDeleted.count,
      matches: matchesDeleted.count,
      roomPlayers: roomPlayersDeleted.count,
      rooms: roomsDeleted.count,
    };

    // Clear active lobby/match Redis keys using non-blocking SCAN approach
    const client = redis.getClient();

    // Helper function to scan and delete keys in batches
    const scanAndDelete = async (pattern: string): Promise<number> => {
      let cursor = "0";
      let deletedCount = 0;

      do {
        const result = await client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          1000,
        );
        cursor = result[0];
        const keys = result[1];

        if (keys.length > 0) {
          const deleted = await client.del(...keys);
          deletedCount += deleted;
        }
      } while (cursor !== "0");

      return deletedCount;
    };

    // Scan and delete both room and match keys
    const roomDeleted = await scanAndDelete("room:*");
    const matchDeleted = await scanAndDelete("match:*");
    const totalDeleted = roomDeleted + matchDeleted;
    redisKeysDeleted = {
      room: roomDeleted,
      match: matchDeleted,
      total: totalDeleted,
    };

    if (totalDeleted > 0) {
      logger.log(
        `Purged ${totalDeleted} Redis keys from cache (${roomDeleted} room keys, ${matchDeleted} match keys).`,
      );
    }

    success = true;
  } catch (error) {
    // PR 3 (Finding 4 follow-up): log the failure with a stack
    // trace so the operator can correlate it with the audit row
    // the finally block will write. The error is re-thrown below
    // (outside the try/finally) so the controller still returns
    // 500 — the audit row is forensic, not a status override.
    errorMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error(`resetSystem failed: ${errorMessage}`, errStack);
  } finally {
    // PR 3: write a follow-up audit row that captures the delete
    // counts AND the success/failure status. Audit rows are
    // intentionally NOT deleted by resetSystem, so the last reset
    // footprint stays queryable after the purge — including
    // failed resets, so the operator can see who tried to reset
    // and why it failed (with whatever partial counts the work
    // reached before throwing). appendAudit is best-effort and
    // never throws (see helper).
    await appendAudit(deps, {
      adminUserId,
      eventType: "ADMIN_RESET_SYSTEM",
      payload: {
        success,
        dbDeleted,
        redisKeysDeleted,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });
  }

  if (!success) {
    throw new Error(`resetSystem failed: ${errorMessage ?? "unknown error"}`);
  }

  return {
    success: true,
    message:
      "System reset complete. All active rooms, players, matches, and Redis cache cleared successfully.",
  };
}
