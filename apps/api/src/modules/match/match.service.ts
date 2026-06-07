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

    try {
      const restored = MatchStateMachine.deserialize(json);
      this.stateMachines.set(matchId, restored);
      this.logger.log(`Match state restored from Redis: ${matchId}`);
      return restored;
    } catch (error) {
      this.logger.error(
        `Failed to deserialize match state for ${matchId}`,
        error,
      );
      // Optionally remove corrupted key
      await this.redis.del(`match:state:${matchId}`);
      return undefined;
    }
  }

  // Persist current state machine to Redis
  async persistStateMachine(matchId: string): Promise<void> {
    const machine = this.stateMachines.get(matchId);
    if (!machine) return;

    await this.redis.set(
      `match:state:${matchId}`,
      machine.serialize(),
      7200, // 2 hour TTL
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
  async finishMatch(matchId: string, winnerId: string) {
    // B2: Persist accumulated scores from in-memory state machine BEFORE cleanup
    const stateMachine = this.stateMachines.get(matchId);
    if (stateMachine) {
      const playerScores = stateMachine.getPlayerScores();
      if (playerScores.length > 0) {
        try {
          await this.prisma.$transaction(
            playerScores.map((p) =>
              this.prisma.matchPlayer.updateMany({
                where: { matchId, userId: p.userId },
                data: { score: p.score },
              }),
            ),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to persist match player scores for match ${matchId}: ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          // Do not throw — match result is still valid even if score persistence fails
        }
      }
    }

    const match = await this.prisma.match.update({
      where: { id: matchId },
      data: {
        status: MatchStatus.FINISHED,
        winnerId,
        endedAt: new Date(),
      },
    });

    // Update room status
    await this.prisma.room.update({
      where: { id: match.roomId },
      data: { status: RoomStatus.FINISHED },
    });

    // Clean up state machine
    this.stateMachines.delete(matchId);
    try {
      await this.redis.del(`match:state:${matchId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to delete Redis state for match ${matchId}: ${message}`,
      );
    }

    this.logger.log(`Match finished: ${matchId}, winner: ${winnerId}`);
    return match;
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
