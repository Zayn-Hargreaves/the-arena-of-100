// ============================================================
// Matchmaking Service - Core Queue Management & Business Logic
// ============================================================

import { Injectable, Logger } from "@nestjs/common";
import {
  MatchmakingQueueStore,
  type MatchmakingTicket,
} from "./matchmaking-queue.store";
import {
  DEFAULT_ELO,
  MATCHMAKING_CONFIG,
  type MatchmakingStatusPayload,
} from "@arena/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    private readonly queueStore: MatchmakingQueueStore,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Add a player to the matchmaking queue.
   */
  async joinQueue(
    user: { id: string; username: string; elo?: number },
    socketId: string,
    category?: string,
  ): Promise<MatchmakingStatusPayload> {
    let playerElo = user.elo;
    if (playerElo === undefined) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { elo: true },
      });
      playerElo = dbUser?.elo ?? DEFAULT_ELO;
    }

    const existingTicket = await this.queueStore.getTicket(user.id);
    const joinedAt = existingTicket ? existingTicket.joinedAt : Date.now();

    const ticket: MatchmakingTicket = {
      userId: user.id,
      username: user.username,
      elo: playerElo,
      socketId,
      category,
      joinedAt,
    };

    await this.queueStore.addTicket(ticket);
    this.logger.log(
      `Player ${user.username} (${user.id}) joined matchmaking queue [ELO: ${playerElo}]`,
    );

    return this.getQueueStatus(user.id);
  }

  /**
   * Remove a player from the matchmaking queue.
   */
  async leaveQueue(userId: string): Promise<boolean> {
    const removed = await this.queueStore.removeTicket(userId);
    if (removed) {
      this.logger.log(`Player ${userId} left matchmaking queue`);
    }
    return removed;
  }

  /**
   * Get current queue status for a player.
   */
  async getQueueStatus(userId: string): Promise<MatchmakingStatusPayload> {
    const ticket = await this.queueStore.getTicket(userId);
    const count = await this.queueStore.getQueueCount();

    if (!ticket) {
      return {
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 15,
        playersInQueue: count,
      };
    }

    const elapsedMs = Math.max(0, Date.now() - ticket.joinedAt);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    return {
      isQueued: true,
      queuedAt: ticket.joinedAt,
      elapsedSeconds,
      estimatedWaitSeconds: Math.max(
        5,
        Math.floor(MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS / 1000) - elapsedSeconds,
      ),
      playersInQueue: count,
    };
  }
}
