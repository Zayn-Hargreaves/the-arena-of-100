// ============================================================
// Match Service - Match Management Logic
// ============================================================

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchStatus,
  RoomStatus,
  PlayerStatus,
  ErrorCode,
  type PlayerInfo,
  RoomError,
} from "@arena/shared";

@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);
  private readonly stateMachines = new Map<string, MatchStateMachine>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Create match from room
  async createMatch(roomId: string) {
    // Get room with players
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
      },
    });

    if (!room) {
      throw new NotFoundException(ErrorCode.ROOM_NOT_FOUND);
    }

    if (room.players.length < 2) {
      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }

    // Create match in DB
    const match = await this.prisma.match.create({
      data: {
        roomId: room.id,
        status: MatchStatus.CREATED,
      },
    });

    // Create player records
    const playerInfos: PlayerInfo[] = room.players.map((p) => ({
      id: p.user.id,
      name: p.user.username,
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    }));

    // Create match players
    await this.prisma.matchPlayer.createMany({
      data: room.players.map((p) => ({
        matchId: match.id,
        userId: p.user.id,
      })),
    });

    // Initialize state machine
    const stateMachine = new MatchStateMachine(match.id, roomId, playerInfos);
    this.stateMachines.set(match.id, stateMachine);

    // Update room status
    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        status: RoomStatus.STARTING,
        currentMatchId: match.id,
      },
    });

    // Persist state machine to Redis for crash recovery
    try {
      await this.persistStateMachine(match.id);
    } catch (error) {
      this.logger.error(
        `Failed to persist state machine to Redis for match ${match.id} — state exists in-memory only`,
        error,
      );
    }

    this.logger.log(`Match created: ${match.id} for room ${roomId}`);
    return match;
  }

  // Get state machine for match (restores from Redis if not in memory)
  async getStateMachine(
    matchId: string,
  ): Promise<MatchStateMachine | undefined> {
    const cached = this.stateMachines.get(matchId);
    if (cached) return cached;

    // Try restore from Redis
    const json = await this.redis.get(`match:state:${matchId}`);
    if (!json) return undefined;

    let restored: MatchStateMachine;
    try {
      restored = MatchStateMachine.deserialize(json);
      this.logger.log(`Match state restored from Redis: ${matchId}`);
    } catch (error) {
      this.logger.error(
        `Failed to deserialize match state for ${matchId}`,
        error,
      );
      // Optionally remove corrupted key
      await this.redis.del(`match:state:${matchId}`);
      return undefined;
    }

    // L3 fix: re-attach the correct answer from the DB. The
    // serialized state in Redis no longer contains correctAnswer
    // (it was a leak vector), so any in-flight round would fail
    // to grade without this lookup. The questionId is on the
    // restored state; we read the Question row to get the answer
    // key. The Question table has stricter access than the Redis
    // cache and is the natural single source of truth.
    await this.rehydrateCorrectAnswer(restored);

    this.stateMachines.set(matchId, restored);
    return restored;
  }

  // Look up the correct answer for the in-flight round's question
  // and attach it to the state machine. No-op if there is no
  // in-flight round or the round is already past ACTIVE.
  private async rehydrateCorrectAnswer(sm: MatchStateMachine): Promise<void> {
    const round = sm.getCurrentRound();
    if (!round) return;
    if (round.status !== "ACTIVE") return;
    const questionId = round.question?.id;
    if (!questionId) return;

    try {
      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { correctAnswer: true },
      });
      if (!question) {
        this.logger.warn(
          `rehydrateCorrectAnswer: Question ${questionId} not found in DB; state machine will not be able to grade round ${round.roundNo}`,
        );
        return;
      }
      sm.attachCorrectAnswer(question.correctAnswer);
      this.logger.log(
        `rehydrateCorrectAnswer: attached correct answer for question ${questionId} to round ${round.roundNo}`,
      );
    } catch (error) {
      this.logger.error(
        `rehydrateCorrectAnswer: DB lookup failed for question ${questionId}`,
        error,
      );
    }
  }

  // Persist current state machine to Redis
  // H5 fix: 24-hour TTL (was 2h). The previous 2h TTL was too short
  // for long matches with extended pauses. The match state machine
  // is the only authoritative in-memory representation of an
  // in-flight match; losing it to a Redis expiry leaves a match
  // with a DB row but no runtime state. 24h is a generous upper
  // bound — no legitimate match should run that long. The state
  // machine is also deleted explicitly in finishMatch, so the TTL
  // is only the safety net for the crash-recovery case.
  async persistStateMachine(matchId: string): Promise<void> {
    const machine = this.stateMachines.get(matchId);
    if (!machine) return;

    await this.redis.set(
      `match:state:${matchId}`,
      machine.serialize(),
      86400, // 24 hour TTL
    );
  }

  // Get match by ID
  async getMatch(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: {
          include: { user: { select: { id: true, username: true } } },
        },
        rounds: true,
      },
    });

    if (!match) {
      throw new NotFoundException(ErrorCode.MATCH_NOT_FOUND);
    }

    return match;
  }

  // Save match result
  //
  // H2 + M4 fix: the score persistence, the match status update, and
  // the room status update now run inside a SINGLE Prisma
  // transaction. Previously they were three separate awaits, so a
  // partial failure (DB blip between the second and third await)
  // could leave the database in an inconsistent state where the
  // match was FINISHED in the Match table but the Room was still
  // IN_GAME (or vice versa). Players would see a finished match
  // but the room would still be playable.
  //
  // The cleanup order is also fixed: Redis delete runs BEFORE the
  // in-memory stateMachines.delete. The old order meant a Redis
  // failure left a zombie state in Redis pointing at a deleted
  // in-memory entry; getStateMachine would then restore a stale
  // state on the next call. The new order ensures Redis is clean
  // before the in-memory map is, so a late getStateMachine call
  // (after finishMatch) returns undefined and the handler short-
  // circuits cleanly.
  //
  // The `roomId` argument replaces an inline DB lookup. The caller
  // (GameLoopService or AdminService) has it on hand: the game loop
  // gets it from the state machine, the admin path gets it via a
  // one-shot match query. This keeps the transaction list short
  // and avoids a `findUnique` inside `$transaction` (which is
  // awkward in Prisma's typed transaction API).
  async finishMatch(matchId: string, winnerId: string | null, roomId: string) {
    // B2: Persist accumulated scores from in-memory state machine BEFORE cleanup.
    // Skipped for admin termination (winnerId === null) — the match was
    // force-stopped and the state machine reference is dropped without
    // computing final scores.
    const scoreUpdateOps =
      winnerId !== null ? await this.buildScoreUpdateOps(matchId) : [];

    // H2: ONE transaction. Either all of {scores, match, room} commit
    // or none do. If Prisma throws, the database is left untouched.
    //
    // Prisma's $transaction returns results in the same order as
    // the input array. With the `...scoreUpdateOps` spread the
    // match.update operation lives at index `scoreUpdateOps.length`
    // (which is 0 for the admin-termination path and N for the
    // normal-finish path). Destructuring `[match]` would grab the
    // first score-update result (or undefined if the array is
    // empty) — a subtle bug that returned the wrong object from
    // this function. The fix is an explicit index lookup.
    const txResults = await this.prisma.$transaction([
      ...scoreUpdateOps,
      this.prisma.match.update({
        where: { id: matchId },
        data: {
          status: MatchStatus.FINISHED,
          winnerId,
          endedAt: new Date(),
        },
      }),
      this.prisma.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.FINISHED },
      }),
    ]);
    const match = txResults[scoreUpdateOps.length];

    // M4 fix: Redis cleanup BEFORE in-memory cleanup. If Redis throws,
    // the in-memory state is still present, so getStateMachine will
    // keep returning the (now-fully-FINISHED) machine and the API
    // stays consistent. Operators see a logged warning; the state
    // is functionally clean for new requests.
    try {
      await this.redis.del(`match:state:${matchId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to delete Redis state for match ${matchId} (will be cleaned on next Redis flush): ${message}`,
      );
    }

    // Only after Redis is clean do we drop the in-memory entry.
    this.stateMachines.delete(matchId);

    this.logger.log(
      `Match finished: ${matchId}${winnerId ? `, winner: ${winnerId}` : " (admin termination, no winner)"}`,
    );
    return match;
  }

  // Build the score-update Prisma operations for the transaction.
  // Returns an empty array if the state machine is gone or has no
  // players. Extracted to keep finishMatch's transaction list
  // readable.
  private async buildScoreUpdateOps(matchId: string) {
    const stateMachine = this.stateMachines.get(matchId);
    if (!stateMachine) return [];
    const playerScores = stateMachine.getPlayerScores();
    if (playerScores.length === 0) return [];
    return playerScores.map((p) =>
      this.prisma.matchPlayer.updateMany({
        where: { matchId, userId: p.userId },
        data: { score: p.score },
      }),
    );
  }

  // Save round result
  async saveRound(matchId: string, roundNo: number, questionId: string) {
    return this.prisma.matchRound.create({
      data: {
        matchId,
        roundNo,
        questionId,
      },
    });
  }

  // Save the round row and its batched answers in a single Prisma
  // $transaction. Used by GameLoopService.endRound so a partial
  // failure (e.g. saveAnswers throws after saveRound commits) can
  // never leave the database in a state where the round row exists
  // without its answers — which would (a) silently lose answer
  // history for the round and (b) trip @@unique([matchId, roundNo])
  // on the next retry after a process restart (Redis still holds
  // the pre-transition state, the timer re-fires endRound, and
  // P2002 on the second create would permanently stall the match).
  //
  // Returns the created round row so the caller can correlate the
  // result with subsequent answer writes (the roundId is also
  // stamped onto every Answer row inside the transaction).
  async saveRoundAndAnswers(
    matchId: string,
    roundNo: number,
    questionId: string,
    answers: Array<{
      userId: string;
      answer: string;
      isCorrect: boolean;
      responseTimeMs: number;
    }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const round = await tx.matchRound.create({
        data: { matchId, roundNo, questionId },
      });
      if (answers.length > 0) {
        await tx.answer.createMany({
          data: answers.map((a) => ({
            matchId,
            roundId: round.id,
            userId: a.userId,
            answer: a.answer,
            isCorrect: a.isCorrect,
            responseTimeMs: a.responseTimeMs,
          })),
        });
      }
      return round;
    });
  }

  // Save answer
  async saveAnswer(
    matchId: string,
    roundId: string,
    userId: string,
    answer: string,
    isCorrect: boolean,
    responseTimeMs: number,
  ) {
    return this.prisma.answer.create({
      data: {
        matchId,
        roundId,
        userId,
        answer,
        isCorrect,
        responseTimeMs,
      },
    });
  }

  // Save multiple answers in a single batch
  async saveAnswers(
    answers: Array<{
      matchId: string;
      roundId: string;
      userId: string;
      answer: string;
      isCorrect: boolean;
      responseTimeMs: number;
    }>,
  ) {
    if (answers.length === 0) return { count: 0 };
    return this.prisma.answer.createMany({
      data: answers,
    });
  }
}
