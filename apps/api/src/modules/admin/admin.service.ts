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
   * @param adminUserId The admin user ID captured from the JWT, used for the
   *   audit row. Required — the controller always supplies it (see
   *   admin.controller.ts) and this service throws on missing input.
   */
  async syncQuestions(clearExisting: boolean = true, adminUserId: string) {
    if (!adminUserId || adminUserId.trim() === "") {
      throw new Error("syncQuestions: adminUserId is required");
    }
    this.logger.log(
      `Starting programmatically sync questions (clearExisting: ${clearExisting})...`,
    );

    // PR 3 (Finding 4 follow-up): accumulators for the audit row.
    // Declared outside the try so the finally block can reference
    // them on the partial-failure path (when a mid-seed DB error
    // leaves some counts populated and others at their default).
    let seededQuestions = 0;
    let seededQuestionTags = 0;
    let allTagNamesArray: string[] = [];
    let success = false;
    let errorMessage: string | undefined;

    try {
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

      // Collect all unique tag names
      const allTagNames = new Set<string>();
      for (const question of questionSeeds) {
        const targetTags = question.tags
          ? question.tags.map((t) => normalizeString(t))
          : [];
        targetTags.forEach((tagName) => allTagNames.add(tagName));
      }

      allTagNamesArray = Array.from(allTagNames);

      // Batch create or fetch tags
      if (allTagNamesArray.length > 0) {
        await this.prisma.tag.createMany({
          data: allTagNamesArray.map((name) => ({ name })),
          skipDuplicates: true,
        });
      }

      const existingTags = await this.prisma.tag.findMany();
      const tagMap = new Map(existingTags.map((tag) => [tag.name, tag]));

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
        `Programmatic question sync successful: ${seededQuestions} questions, ${allTagNamesArray.length} tags, ${seededQuestionTags} tag relationships.`,
      );

      success = true;
    } catch (error) {
      // PR 3 (Finding 4 follow-up): log the failure with a stack
      // trace so the operator can correlate it with the audit row
      // the finally block will write. The error is re-thrown below
      // (outside the try/finally) so the controller still returns
      // 500 — the audit row is forensic, not a status override.
      errorMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `syncQuestions failed (clearExisting: ${clearExisting}): ${errorMessage}`,
        errStack,
      );
    } finally {
      // PR 3: append a best-effort audit row on BOTH success and
      // failure. The seed/sync operation mutates (or replaces, when
      // clearExisting=true) the question bank that every match
      // depends on, so it deserves an audit row even when the
      // operation aborts partway (e.g. after a successful clear but
      // before the seed completes — the bank would be left empty
      // with no record of who triggered the wipe). appendAudit is
      // best-effort and never throws (see helper).
      await this.appendAudit({
        adminUserId,
        eventType: "ADMIN_SYNC_QUESTIONS",
        payload: {
          success,
          clearExisting,
          questionsCount: seededQuestions,
          tagsCount: allTagNamesArray.length,
          relationshipsCount: seededQuestionTags,
          ...(errorMessage ? { error: errorMessage } : {}),
        },
      });
    }

    if (!success) {
      throw new Error(
        `syncQuestions failed: ${errorMessage ?? "unknown error"}`,
      );
    }

    return {
      success: true,
      questionsCount: seededQuestions,
      tagsCount: allTagNamesArray.length,
      relationshipsCount: seededQuestionTags,
    };
  }

  /**
   * Resets the entire match system by purging DB and Redis.
   * @param adminUserId The admin user ID captured from the JWT, used
   *   for the audit row. Required.
   */
  async resetSystem(adminUserId: string) {
    if (!adminUserId || adminUserId.trim() === "") {
      throw new Error("resetSystem: adminUserId is required");
    }
    this.logger.warn(
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
      ] = await this.prisma.$transaction([
        this.prisma.answer.deleteMany(),
        this.prisma.matchRound.deleteMany(),
        this.prisma.matchPlayer.deleteMany(),
        this.prisma.match.deleteMany(),
        this.prisma.roomPlayer.deleteMany(),
        this.prisma.room.deleteMany(),
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
      const client = this.redis.getClient();

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
        this.logger.log(
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
      this.logger.error(`resetSystem failed: ${errorMessage}`, errStack);
    } finally {
      // PR 3: write a follow-up audit row that captures the delete
      // counts AND the success/failure status. Audit rows are
      // intentionally NOT deleted by resetSystem, so the last reset
      // footprint stays queryable after the purge — including
      // failed resets, so the operator can see who tried to reset
      // and why it failed (with whatever partial counts the work
      // reached before throwing). appendAudit is best-effort and
      // never throws (see helper).
      await this.appendAudit({
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
  async terminateRoom(
    roomId: string,
    adminUserId: string,
    message?: string,
  ): Promise<TerminateRoomResult> {
    if (!adminUserId || adminUserId.trim() === "") {
      throw new Error("terminateRoom: adminUserId is required");
    }
    // PR 3: default reason for the audit row. Overridden to
    // "ALREADY_FINISHING" if the B1 guard aborts the kill-switch.
    let reasonForAudit: string = "KILL_SWITCH";

    // 1. Resolve room — throws RoomError(ROOM_NOT_FOUND) → 404
    const room = await this.roomService.getRoom(roomId);
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
      if (this.gameLoopService.isMatchFinishing(matchId)) {
        const terminatedAt = Date.now();
        this.logger.warn(
          `Admin termination of room ${roomId} aborted: match ${matchId} is already finishing naturally. The natural finish will complete on its own.`,
        );
        // PR 3: aborted kill-switches still deserve an audit row so
        // the operator can answer "did anyone try to terminate this
        // room while it was finishing?". appendAudit is best-effort
        // (see helper) so any throw is swallowed + logged.
        reasonForAudit = "ALREADY_FINISHING";
        await this.appendAudit({
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
        await this.matchService.finishMatch(matchId, null, roomId, true);
      } catch (error) {
        this.recordPartialTerminationFailure(
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
      await this.gameLoopService.stopRoomRuntime(roomId, matchId);
    } catch (error) {
      this.recordPartialTerminationFailure(
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
      this.gameLoopService.emitRoomTerminated(roomId, { matchId, message });
    } catch (error) {
      this.recordPartialTerminationFailure(
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
      await this.cleanupRoomRedisKeys(roomId, matchId);
    } catch (error) {
      this.recordPartialTerminationFailure(
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
      await this.roomService.disbandRoom(roomId);
    } catch (error) {
      this.recordPartialTerminationFailure(
        progress,
        `failed to disband room ${roomId} during admin termination${matchId ? ` (match ${matchId})` : ""}`,
        error,
      );
    }

    const terminatedAt = Date.now();
    this.logger.warn(
      `Room ${roomId} terminated by admin${matchId ? ` (match ${matchId})` : ""}${progress.partial ? " (partial: cleanup failed)" : ""}`,
    );

    // PR 3: append the audit row. Written LAST so the kill-switch can
    // record the final { success, partial, cleanupError, reason }
    // shape that the operator will see. If the audit insert itself
    // throws, appendAudit swallows + logs (audit is best-effort — see
    // the helper comment), so the kill-switch still returns the
    // correct TerminateRoomResult to the controller.
    await this.appendAudit({
      matchId,
      roomId,
      adminUserId,
      eventType: "ADMIN_TERMINATE_ROOM",
      payload: {
        success: !progress.partial,
        partial: progress.partial,
        reason: reasonForAudit,
        ...(progress.cleanupError
          ? { cleanupError: progress.cleanupError }
          : {}),
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

  private recordPartialTerminationFailure(
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

    this.logger.error(`Partial termination: ${context}: ${errMsg}`, errStack);
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
      this.logger.warn(
        `Failed to SREM room:countdowns for ${roomId}: ${errMsg}`,
      );
    }
  }

  // ============================================================
  // PR 3: Admin Audit Event helpers
  // ============================================================

  /**
   * Best-effort audit row append. The append NEVER throws — a failure
   * here would block the kill-switch / sync / reset from returning
   * the action result to the admin UI, which is worse than a missing
   * audit row. Operators observe the warning in the logs and can
   * replay manually if needed.
   *
   * Callers should pass at least one of { matchId, roomId,
   * adminUserId } so the audit row is queryable by at least one
   * filter. Production code always supplies adminUserId; the matchId
   * and roomId fields carry the action's scope.
   */
  private async appendAudit(params: {
    matchId?: string | null;
    roomId?: string | null;
    adminUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.eventLog.create({
        data: {
          matchId: params.matchId ?? null,
          roomId: params.roomId ?? null,
          adminUserId: params.adminUserId,
          eventType: params.eventType,
          payload: params.payload as object,
        },
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(
        `appendAudit: failed to write ${params.eventType} audit row (adminUserId=${params.adminUserId}, roomId=${params.roomId ?? "n/a"}, matchId=${params.matchId ?? "n/a"}): ${errMsg}`,
        errStack,
      );
    }
  }

  /**
   * PR 3: paginated, filterable query of admin audit rows. Backs the
   * GET /admin/audit-events endpoint. Always ordered by `createdAt
   * DESC` so the most recent action shows first.
   *
   * Validates limit/offset bounds at the call site (the Zod schema
   * in get-audit-events.dto.ts is the single source of truth — the
   * service trusts the caller). Returns `{ events, total }` so the
   * caller can render pagination controls without a second request.
   */
  async getAuditEvents(params: {
    limit: number;
    offset: number;
    roomId?: string;
    eventType?: string;
    adminUserId?: string;
  }): Promise<{ events: unknown[]; total: number }> {
    const where: {
      roomId?: string;
      eventType?: string;
      adminUserId?: string | { not: null };
    } = {};
    where.adminUserId = { not: null };
    if (params.roomId) where.roomId = params.roomId;
    if (params.eventType) where.eventType = params.eventType;
    if (params.adminUserId) where.adminUserId = params.adminUserId;

    const [events, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: params.offset,
        take: params.limit,
      }),
      this.prisma.eventLog.count({ where }),
    ]);

    return { events, total };
  }
}
