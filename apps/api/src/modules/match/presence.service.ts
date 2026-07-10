import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Server } from "socket.io";
import { RoomService } from "../room/room.service";
import { LobbyCountdownService } from "./lobby-countdown.service";
import {
  ServerEvent,
  RoomStatus,
  type RoomPlayerLeftPayload,
} from "@arena/shared";
import { GameLoopService } from "./game-loop.service";

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private sweepInterval?: NodeJS.Timeout;
  private server?: Server;
  private isSweeping = false;

  constructor(
    private readonly roomService: RoomService,
    private readonly lobbyCountdownService: LobbyCountdownService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  onModuleInit() {
    this.sweepInterval = setInterval(async () => {
      if (this.isSweeping) return;
      this.isSweeping = true;
      try {
        await this.sweep();
      } catch (error) {
        this.logger.error(
          `Error during presence sweep: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        this.isSweeping = false;
      }
    }, 5000);
  }

  onModuleDestroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
    }
  }

  async updatePresence(roomId: string, userId: string) {
    await this.roomService.updatePresence(roomId, userId);
  }

  async clearPresence(roomId: string, userId: string) {
    await this.roomService.clearPresence(roomId, userId);
  }

  async isPresent(roomId: string, userId: string): Promise<boolean> {
    return this.roomService.checkPresence(roomId, userId);
  }

  private async sweep() {
    if (!this.server) return;

    const activeRooms = await this.roomService.getActiveRooms();
    for (const room of activeRooms) {
      // Check all players' presence in parallel (single round-trip per player
      // to Redis, but no longer N+1 sequential awaits per room). The N+1
      // pattern was making the 5s sweep scale linearly with room size.
      const presenceFlags = await Promise.all(
        room.players.map((rp) =>
          this.roomService
            .checkPresence(room.id, rp.userId)
            .then((isPresent) => ({ rp, isPresent })),
        ),
      );

      const stalePlayerIds: string[] = [];
      let isHostStale = false;
      for (const { rp, isPresent } of presenceFlags) {
        if (!isPresent) {
          stalePlayerIds.push(rp.userId);
          if (rp.userId === room.hostId) {
            isHostStale = true;
          }
        }
      }

      if (stalePlayerIds.length > 0) {
        if (room.type === "PRIVATE" && isHostStale) {
          this.logger.log(
            `Host stale in private room ${room.code}, disbanding...`,
          );
          await this.roomService.disbandRoom(room.id);
          this.server
            .to(`room:${room.id}`)
            .emit(ServerEvent.ROOM_COUNTDOWN_CANCELLED, {
              roomId: room.id,
              roomStatus: "WAITING",
              reason: "HOST_STALE",
              cancelledAt: Date.now(),
            });
          this.server.to(`room:${room.id}`).emit(ServerEvent.PLAYER_LEFT, {
            roomId: room.id,
            playerId: room.hostId,
            reason: "HOST_STALE",
          } satisfies RoomPlayerLeftPayload);
          continue;
        }

        this.logger.log(
          `Processing stale players in room ${room.code}: ${stalePlayerIds.join(", ")}`,
        );

        const isLobby =
          room.status === RoomStatus.WAITING ||
          room.status === RoomStatus.COUNTDOWN ||
          room.status === RoomStatus.STARTING;

        const executeWithRetry = async (
          fn: () => Promise<void>,
          retries = 3,
          delay = 50,
        ): Promise<void> => {
          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              await fn();
              return;
            } catch (error) {
              if (attempt === retries) throw error;
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        };

        if (isLobby) {
          for (const userId of stalePlayerIds) {
            try {
              // 1. Invoke the lobby countdown callback before committing removal, with immediate retries
              await executeWithRetry(() =>
                this.lobbyCountdownService.handleRoomPlayerLeft(
                  room.id,
                  this.server!,
                  [userId],
                ),
              );
              // 2. Commit that player's removal, with immediate retries
              await executeWithRetry(() =>
                this.roomService.removePlayerBatch(room.id, [userId]),
              );
              // 3. Emit PLAYER_LEFT event
              this.server!.to(`room:${room.id}`).emit(ServerEvent.PLAYER_LEFT, {
                roomId: room.id,
                playerId: userId,
                reason: "STALE",
              } satisfies RoomPlayerLeftPayload);
            } catch (err) {
              this.logger.error(
                `Failed to remove stale player ${userId} from lobby room ${room.code}:`,
                err,
              );
            }
          }
        } else if (
          (room.status === RoomStatus.IN_GAME ||
            room.status === RoomStatus.FINISHED) &&
          room.currentMatchId
        ) {
          for (const userId of stalePlayerIds) {
            try {
              // 1. Invoke match callback before committing removal, with immediate retries
              await executeWithRetry(() =>
                this.gameLoopService.handleMatchPlayerLeft(
                  room.currentMatchId!,
                  room.id,
                  userId,
                  this.server!,
                ),
              );
              // 2. Commit that player's removal, with immediate retries
              await executeWithRetry(() =>
                this.roomService.removePlayerBatch(room.id, [userId]),
              );
              // 3. Emit PLAYER_LEFT event
              this.server!.to(`room:${room.id}`).emit(ServerEvent.PLAYER_LEFT, {
                roomId: room.id,
                playerId: userId,
                reason: "STALE",
              } satisfies RoomPlayerLeftPayload);
            } catch (err) {
              this.logger.error(
                `Failed to remove stale player ${userId} from match room ${room.code}:`,
                err,
              );
            }
          }
        }
      }
    }
  }
}
