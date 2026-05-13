// ============================================================
// Match Service - Match Management Logic
// ============================================================

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MatchStateMachine } from '@arena/game-core';
import { MatchStatus, RoomStatus, PlayerStatus, ErrorCode, type PlayerInfo } from '@arena/shared';

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
      throw new BadRequestException('Cần ít nhất 2 người chơi');
    }

    // Create match in DB
    const match = await this.prisma.match.create({
      data: {
        roomId: room.id,
        status: MatchStatus.CREATED,
      },
    });

    // Create player records
    const playerInfos: PlayerInfo[] = room.players.map((p: any) => ({
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
      data: room.players.map((p: any) => ({
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
      data: { status: RoomStatus.IN_GAME, currentMatchId: match.id },
    });

    // Cache match state in Redis
    await this.redis.setJSON(`match:${match.id}`, stateMachine.getSnapshot(0), 7200);

    this.logger.log(`Match created: ${match.id} for room ${roomId}`);
    return match;
  }

  // Get state machine for match
  getStateMachine(matchId: string): MatchStateMachine | undefined {
    return this.stateMachines.get(matchId);
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
    await this.redis.del(`match:${matchId}`);

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
  async saveAnswer(matchId: string, roundId: string, userId: string, answer: string, isCorrect: boolean, responseTimeMs: number) {
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
}