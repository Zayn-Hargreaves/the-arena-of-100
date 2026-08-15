// ============================================================
// Matchmaking Worker Service - Background Matchmaker Loop
// ============================================================

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Server } from "socket.io";
import {
  MATCHMAKING_CONFIG,
  ServerEvent,
  type MatchmakingMatchedPayload,
} from "@arena/shared";
import {
  MatchmakingQueueStore,
  type MatchmakingTicket,
} from "./matchmaking-queue.store";
import { BotService } from "./bot.service";
import { RoomService } from "../room/room.service";
import { GameLoopService } from "../match/game-loop.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { roomPlayersKey } from "../room/room-cache.store";

@Injectable()
export class MatchmakingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private server?: Server;

  constructor(
    private readonly queueStore: MatchmakingQueueStore,
    private readonly botService: BotService,
    private readonly roomService: RoomService,
    private readonly gameLoopService: GameLoopService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, MATCHMAKING_CONFIG.TICK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic matchmaker tick.
   */
  async tick(): Promise<void> {
    if (!this.server || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      await this.processQueue();
    } catch (err) {
      this.logger.error("Error during matchmaking worker tick", err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQueue(): Promise<void> {
    const tickets = await this.queueStore.getAllTickets();
    if (tickets.length === 0) {
      return;
    }

    // Sort by joinedAt ascending (longest waiting player first)
    tickets.sort((a, b) => a.joinedAt - b.joinedAt);

    const now = Date.now();
    const matchedUserIds = new Set<string>();

    for (const seed of tickets) {
      if (matchedUserIds.has(seed.userId)) {
        continue;
      }

      const seedWaitMs = Math.max(0, now - seed.joinedAt);
      const expansionSteps = Math.floor(
        seedWaitMs / MATCHMAKING_CONFIG.ELO_EXPANSION_INTERVAL_MS,
      );
      const seedEloWindow =
        MATCHMAKING_CONFIG.INITIAL_ELO_WINDOW +
        expansionSteps * MATCHMAKING_CONFIG.ELO_EXPANSION_STEP;

      const isTimedOut = seedWaitMs >= MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS;

      // Filter available candidates
      const candidates: MatchmakingTicket[] = [];
      for (const t of tickets) {
        if (matchedUserIds.has(t.userId)) continue;

        // Check category compatibility if specified
        if (seed.category && t.category && seed.category !== t.category) {
          continue;
        }

        const eloDiff = Math.abs(t.elo - seed.elo);
        if (isTimedOut || eloDiff <= seedEloWindow) {
          candidates.push(t);
        }
      }

      // Check if we can form a match
      const shouldMatch =
        candidates.length >= MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH ||
        (isTimedOut &&
          candidates.length >= MATCHMAKING_CONFIG.MIN_PLAYERS_TO_MATCH);

      if (!shouldMatch) {
        continue;
      }

      // Select group of players
      const selected = candidates.slice(
        0,
        MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH,
      );
      const selectedIds = selected.map((p) => p.userId);

      // Atomically pop selected tickets from Redis
      const popped = await this.queueStore.atomicPopTickets(selectedIds);
      if (popped.length < MATCHMAKING_CONFIG.MIN_PLAYERS_TO_MATCH) {
        continue;
      }

      for (const p of popped) {
        matchedUserIds.add(p.userId);
      }

      // Launch match asynchronously for this group
      await this.launchMatchedGame(popped);
    }
  }

  private async launchMatchedGame(players: MatchmakingTicket[]): Promise<void> {
    if (!this.server || players.length === 0) return;

    try {
      const host = players[0];
      const category = host.category ?? "ALL";

      // 1. Create PUBLIC room in Postgres
      const room = await this.roomService.createRoom(
        host.userId,
        "PUBLIC",
        100,
        15,
        category,
      );

      // 2. Add remaining human players to the room
      for (let i = 1; i < players.length; i++) {
        const player = players[i];
        try {
          await this.prisma.roomPlayer.create({
            data: {
              roomId: room.id,
              userId: player.userId,
            },
          });
          await this.redis.sadd(roomPlayersKey(room.id), player.userId);
        } catch (err) {
          this.logger.warn(
            `Failed to add human player ${player.userId} to matched room ${room.id}`,
            err,
          );
        }
      }

      // 3. Auto-fill bots if enabled
      if (
        MATCHMAKING_CONFIG.AUTO_FILL_BOTS &&
        players.length < MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH
      ) {
        const neededBots =
          MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH - players.length;
        const avgElo = Math.round(
          players.reduce((sum, p) => sum + p.elo, 0) / players.length,
        );

        const bots = await this.botService.ensureBotUsers(neededBots, avgElo);
        for (const bot of bots) {
          try {
            await this.prisma.roomPlayer.create({
              data: {
                roomId: room.id,
                userId: bot.id,
              },
            });
            await this.redis.sadd(roomPlayersKey(room.id), bot.id);
          } catch (err) {
            this.logger.warn(
              `Failed to add bot ${bot.username} to matched room ${room.id}`,
              err,
            );
          }
        }
        this.logger.log(
          `Filled room ${room.code} with ${bots.length} AI bots (total ${players.length + bots.length} players)`,
        );
      }

      // 4. Notify human clients via WebSocket
      const payload: MatchmakingMatchedPayload = {
        roomId: room.id,
        roomCode: room.code,
        matchId: null,
      };

      for (const player of players) {
        this.server
          .to(player.socketId)
          .emit(ServerEvent.MATCHMAKING_MATCHED, payload);
      }

      this.logger.log(
        `Match formed for room ${room.code} with ${players.length} real players. Starting match loop...`,
      );

      // 5. Trigger game loop launch
      await this.gameLoopService.forceStartRoomMatch(room.id, this.server);
    } catch (error) {
      this.logger.error("Failed to launch matched game", error);
    }
  }
}
