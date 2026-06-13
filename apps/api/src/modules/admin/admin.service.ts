// ============================================================
// Admin Service - Seeding, Database Cleanup, and System Reset
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { RoomService } from "../room/room.service";
import { MatchService } from "../match/match.service";
import { GameLoopService } from "../match/game-loop.service";
import { normalizeString, questionSeeds } from "../../prisma-seeds/questions";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  /**
   * Synchronizes the database questions with the questionSeeds.
   * @param clearExisting Whether to clear all existing questions before seeding.
   */
  async syncQuestions(clearExisting: boolean = true) {
    this.logger.log(
      `Starting programmatically sync questions (clearExisting: ${clearExisting})...`,
    );

    if (clearExisting) {
      this.logger.warn(
        "Deleting all existing questions, tags, and dependencies...",
      );
      // Prisma relations will handle cascading delete on QuestionTag, MatchRound questions are kept or protected.
      // Since match_rounds have on_delete: Restrict/Cascade, we'll perform a clean delete.
      // To avoid foreign key constraint violations if there are active matches referencing questions,
      // we must clear matches, rounds, answers first, or skip clearing those if it's production.
      // For general sync, clearing questions and tags is fully supported.
      await this.prisma.questionTag.deleteMany();
      await this.prisma.question.deleteMany();
      await this.prisma.tag.deleteMany();
    }

    let seededQuestions = 0;
    let seededTags = 0;
    let seededQuestionTags = 0;

    // Collect all unique tag names
    const allTagNames = new Set<string>();
    for (const question of questionSeeds) {
      const targetTags = question.tags
        ? question.tags.map((t) => normalizeString(t))
        : [];
      targetTags.forEach((tagName) => allTagNames.add(tagName));
    }

    const allTagNamesArray = Array.from(allTagNames);

    // Batch create or fetch tags
    if (allTagNamesArray.length > 0) {
      await this.prisma.tag.createMany({
        data: allTagNamesArray.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }

    const existingTags = await this.prisma.tag.findMany();
    const tagMap = new Map(existingTags.map((tag) => [tag.name, tag]));
    seededTags = existingTags.length;

    for (const question of questionSeeds) {
      const normalizedContent = question.content.trim();

      // Check if question already exists
      const existingQuestion = await this.prisma.question.findFirst({
        where: {
          content: normalizedContent,
        },
      });

      let createdQuestion;
      if (existingQuestion) {
        // Update existing question
        createdQuestion = await this.prisma.question.update({
          where: { id: existingQuestion.id },
          data: {
            options: question.options as string[],
            correctAnswer: question.correctAnswer,
            difficulty: question.difficulty,
            category: question.category,
            explanation: question.explanation,
            active: true,
          },
        });
      } else {
        // Create new question
        createdQuestion = await this.prisma.question.create({
          data: {
            content: normalizedContent,
            options: question.options as string[],
            correctAnswer: question.correctAnswer,
            difficulty: question.difficulty,
            category: question.category,
            explanation: question.explanation,
            active: true,
          },
        });
      }
      seededQuestions++;

      // Sync tags
      const targetTags = question.tags
        ? question.tags.map((t) => normalizeString(t))
        : [];

      const resolvedTags = targetTags
        .map((name) => tagMap.get(name))
        .filter((t): t is (typeof existingTags)[0] => !!t);

      if (resolvedTags.length > 0) {
        // Find existing question tags to avoid duplicate inserts
        const existingQuestionTags = await this.prisma.questionTag.findMany({
          where: { questionId: createdQuestion.id },
        });
        const existingTagIds = new Set(
          existingQuestionTags.map((qt) => qt.tagId),
        );
        const tagsToCreate = resolvedTags.filter(
          (tag) => !existingTagIds.has(tag.id),
        );

        if (tagsToCreate.length > 0) {
          await this.prisma.questionTag.createMany({
            data: tagsToCreate.map((tag) => ({
              questionId: createdQuestion.id,
              tagId: tag.id,
            })),
            skipDuplicates: true,
          });
          seededQuestionTags += tagsToCreate.length;
        }
      }
    }

    // Upsert admin user for safety
    await this.prisma.user.upsert({
      where: { username: "admin" },
      update: { role: "ADMIN" },
      create: {
        username: "admin",
        role: "ADMIN",
      },
    });

    this.logger.log(
      `Programmatic question sync successful: ${seededQuestions} questions, ${seededTags} tags, ${seededQuestionTags} tag relationships.`,
    );

    return {
      success: true,
      questionsCount: seededQuestions,
      tagsCount: seededTags,
      relationshipsCount: seededQuestionTags,
    };
  }

  /**
   * Resets the entire match system by purging DB and Redis.
   */
  async resetSystem() {
    this.logger.warn(
      "system-wide reset triggered! Purging all room, player, match state...",
    );

    // Delete DB entries in dependent order
    await this.prisma.eventLog.deleteMany();
    await this.prisma.answer.deleteMany();
    await this.prisma.matchRound.deleteMany();
    await this.prisma.matchPlayer.deleteMany();
    await this.prisma.match.deleteMany();
    await this.prisma.roomPlayer.deleteMany();
    await this.prisma.room.deleteMany();

    // Clear active lobby/match Redis keys using non-blocking SCAN approach
    const client = this.redis.getClient();
    let totalDeleted = 0;

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
    totalDeleted = roomDeleted + matchDeleted;

    if (totalDeleted > 0) {
      this.logger.log(
        `Purged ${totalDeleted} Redis keys from cache (${roomDeleted} room keys, ${matchDeleted} match keys).`,
      );
    }

    return {
      success: true,
      message:
        "System reset complete. All active rooms, players, matches, and Redis cache cleared successfully.",
    };
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
  async terminateRoom(roomId: string, message?: string) {
    // 1. Resolve room — throws RoomError(ROOM_NOT_FOUND) → 404
    const room = await this.roomService.getRoom(roomId);
    const matchId = room.currentMatchId;

    // 2. Persist match finish in DB (no winner on admin termination).
    // Failure here is logged but non-fatal — we still want to clean up
    // the room and its runtime state.
    if (matchId) {
      try {
        await this.matchService.finishMatch(matchId, null);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to finish match ${matchId} during admin termination of room ${roomId}: ${errMsg}`,
          error instanceof Error ? error.stack : undefined,
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
      await this.gameLoopService.stopRoomRuntime(roomId, matchId);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `stopRoomRuntime failed during admin termination of room ${roomId}${matchId ? ` (match ${matchId})` : ""}: ${errMsg}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    // 4. Emit ROOM_TERMINATED to the room channel. `emitRoomTerminated`
    // already guards against `!this.server` (logs a warn and returns), but
    // a misbehaving socket.io adapter could still throw on the actual
    // emit. Defensive catch so the rest of the kill-switch still runs.
    try {
      this.gameLoopService.emitRoomTerminated(roomId, { matchId, message });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `emitRoomTerminated failed during admin termination of room ${roomId}${matchId ? ` (match ${matchId})` : ""}: ${errMsg}`,
        error instanceof Error ? error.stack : undefined,
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
    let partial = false;
    let cleanupError: string | undefined;
    try {
      await this.cleanupRoomRedisKeys(roomId, matchId);
    } catch (error) {
      partial = true;
      const errMsg = error instanceof Error ? error.message : String(error);
      cleanupError = errMsg;
      this.logger.error(
        `Partial termination: failed to cleanup Redis keys for room ${roomId}${matchId ? ` (match ${matchId})` : ""}: ${errMsg}`,
        error instanceof Error ? error.stack : undefined,
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
      await this.roomService.disbandRoom(roomId);
    } catch (error) {
      partial = true;
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      // Prefer the first error encountered so the caller can act on a
      // stable field; the most recent error is still logged.
      if (!cleanupError) cleanupError = errMsg;
      this.logger.error(
        `Partial termination: failed to disband room ${roomId} during admin termination${matchId ? ` (match ${matchId})` : ""}: ${errMsg}`,
        errStack,
      );
    }

    const terminatedAt = Date.now();
    this.logger.warn(
      `Room ${roomId} terminated by admin${matchId ? ` (match ${matchId})` : ""}${partial ? " (partial: cleanup failed)" : ""}`,
    );

    return {
      success: !partial,
      partial,
      roomId,
      matchId,
      message: partial
        ? "Room terminated by admin (partial: cleanup failed)"
        : "Room terminated by admin",
      terminatedAt,
      ...(cleanupError ? { cleanupError } : {}),
    };
  }

  /**
   * Deletes the Redis keys associated with one room and (optionally) its
   * active match state. Mirrors the explicit, key-by-key approach used by
   * resetSystem rather than wildcard SCAN, so we never over-delete.
   */
  private async cleanupRoomRedisKeys(
    roomId: string,
    matchId: string | null,
  ): Promise<void> {
    const client = this.redis.getClient();
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
      if (keys.length) keysToDelete.push(...keys);
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
      this.logger.warn(
        `Failed to SREM room:countdowns for ${roomId}: ${errMsg}`,
      );
    }
  }
}
