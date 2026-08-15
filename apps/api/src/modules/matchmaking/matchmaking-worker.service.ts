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
  GAME_CONFIG,
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
import { ClusterService } from "../cluster/cluster.service";
import { roomPlayersKey } from "../room/room-cache.store";

const MATCHMAKING_LEADER_KEY = "matchmaking:leader";
const MATCHMAKING_LEADER_TTL_SEC = 5;
const MATCHMAKING_LEADER_FENCE_KEY = "matchmaking:leader:fence";

@Injectable()
export class MatchmakingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private server?: Server;
  private leaderToken?: string;

  constructor(
    private readonly queueStore: MatchmakingQueueStore,
    private readonly botService: BotService,
    private readonly roomService: RoomService,
    private readonly gameLoopService: GameLoopService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clusterService: ClusterService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, MATCHMAKING_CONFIG.TICK_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.leaderToken) {
      try {
        await this.redis.releaseLease(MATCHMAKING_LEADER_KEY, this.leaderToken);
      } catch {
        // best-effort cleanup on shutdown
      }
      this.leaderToken = undefined;
    }
  }

  /**
   * Acquire or renew matchmaking worker leadership across cluster instances.
   */
  private async acquireOrRenewLeadership(): Promise<string | null> {
    if (this.leaderToken) {
      const renewed = await this.redis.renewLease(
        MATCHMAKING_LEADER_KEY,
        this.leaderToken,
        MATCHMAKING_LEADER_TTL_SEC,
      );
      if (renewed) return this.leaderToken;
      this.leaderToken = undefined;
    }
    const fence = await this.redis.incr(MATCHMAKING_LEADER_FENCE_KEY);
    const token = `${this.clusterService.nodeId}:${fence}`;
    const acquired = await this.redis.acquireLease(
      MATCHMAKING_LEADER_KEY,
      token,
      MATCHMAKING_LEADER_TTL_SEC,
    );
    this.leaderToken = acquired ? token : undefined;
    return acquired ? token : null;
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
      const token = await this.acquireOrRenewLeadership();
      if (!token) return;

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
      const seedCategory = seed.category ?? "ALL";

      // Filter available candidates
      const candidates: MatchmakingTicket[] = [];
      for (const t of tickets) {
        if (matchedUserIds.has(t.userId)) continue;

        // Check category compatibility (normalized with fallback to ALL)
        const candidateCategory = t.category ?? "ALL";
        if (candidateCategory !== seedCategory) {
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

      // Re-verify / renew leadership lease before popping tickets and launching match
      const activeToken = await this.acquireOrRenewLeadership();
      if (!activeToken) {
        this.logger.warn(
          "Lost matchmaking leadership lease during queue processing; halting batch",
        );
        break;
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
        for (const ticket of popped) {
          await this.queueStore.addTicket(ticket);
        }
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

    const host = players[0];
    const category = host.category ?? "ALL";
    let room: Awaited<ReturnType<RoomService["createRoom"]>>;

    // 1. Create PUBLIC room in Postgres (pre-room creation phase)
    try {
      room = await this.roomService.createRoom(
        host.userId,
        "PUBLIC",
        GAME_CONFIG.MAX_PLAYERS,
        15,
        category,
      );
    } catch (error) {
      this.logger.error("Failed to create room for matched players", error);
      for (const player of players) {
        try {
          await this.queueStore.addTicket(player);
        } catch (reErr) {
          this.logger.warn(
            `Failed to re-enqueue ticket for user ${player.userId}`,
            reErr,
          );
        }
      }
      return;
    }

    // Post-room creation phase: room is created in DB; never re-enqueue tickets to queueStore
    try {
      const successfulPlayers: MatchmakingTicket[] = [host];

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
          successfulPlayers.push(player);
        } catch (err) {
          this.logger.warn(
            `Failed to add human player ${player.userId} to matched room ${room.id}`,
            err,
          );
        }
      }

      // 3. Auto-fill bots if enabled
      let botCount = 0;
      if (
        MATCHMAKING_CONFIG.AUTO_FILL_BOTS &&
        successfulPlayers.length < MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH
      ) {
        const neededBots =
          MATCHMAKING_CONFIG.TARGET_PLAYERS_PER_MATCH -
          successfulPlayers.length;
        const avgElo = Math.round(
          successfulPlayers.reduce((sum, p) => sum + p.elo, 0) /
            successfulPlayers.length,
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
            botCount++;
          } catch (err) {
            this.logger.warn(
              `Failed to add bot ${bot.username} to matched room ${room.id}`,
              err,
            );
          }
        }
        this.logger.log(
          `Filled room ${room.code} with ${botCount} AI bots (total ${successfulPlayers.length + botCount} players)`,
        );
      }

      // 4. Notify human clients via WebSocket
      const payload: MatchmakingMatchedPayload = {
        roomId: room.id,
        roomCode: room.code,
        matchId: null,
      };

      for (const player of successfulPlayers) {
        this.server
          .to(player.socketId)
          .emit(ServerEvent.MATCHMAKING_MATCHED, payload);
      }

      this.logger.log(
        `Match formed for room ${room.code} with ${successfulPlayers.length} real players. Starting match loop...`,
      );

      // 5. Trigger game loop launch
      await this.gameLoopService.forceStartRoomMatch(room.id, this.server);
    } catch (error) {
      this.logger.error(
        `Failed to complete post-creation launch for room ${room.id}`,
        error,
      );
    }
  }
}
