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

  constructor(
    private readonly roomService: RoomService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  setServer(server: Server) {
    this.server = server;
  }

  onModuleInit() {
    this.sweepInterval = setInterval(() => {
      this.sweep().catch((error) => {
        this.logger.error(
          `Error during presence sweep: ${error.message}`,
          error.stack,
        );
      });
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
      const stalePlayerIds: string[] = [];
      let isHostStale = false;

      for (const rp of room.players) {
        const isPresent = await this.roomService.checkPresence(
          room.id,
          rp.userId,
        );
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
