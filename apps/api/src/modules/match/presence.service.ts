import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Server } from "socket.io";
import { RoomService } from "../room/room.service";
import { GameLoopService } from "./game-loop.service";
import { ServerEvent, type RoomPlayerLeftPayload } from "@arena/shared";

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private sweepInterval?: NodeJS.Timeout;
  private server?: Server;
  private isSweeping = false;

  constructor(
    private readonly roomService: RoomService,
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
          `Removing stale players from room ${room.code}: ${stalePlayerIds.join(", ")}`,
        );
        await this.roomService.removePlayerBatch(room.id, stalePlayerIds);

        for (const userId of stalePlayerIds) {
          this.server!.to(`room:${room.id}`).emit(ServerEvent.PLAYER_LEFT, {
            roomId: room.id,
            playerId: userId,
            reason: "STALE",
          } satisfies RoomPlayerLeftPayload);
        }

        await this.gameLoopService.handleRoomPlayerLeft(room.id, this.server);
      }
    }
  }
}
