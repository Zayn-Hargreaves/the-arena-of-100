import { Injectable, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  ERROR_MESSAGES,
  RoomJoinedPayload,
  asRoomTypeOrDefault,
} from "@arena/shared";
import { AuthService } from "../../modules/auth/auth.service";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { PresenceService } from "../../modules/match/presence.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class AuthHandler extends BaseHandler {
  private readonly logger = new Logger(AuthHandler.name);
  private readonly connectedPlayers = new Map<string, string>();

  constructor(
    private readonly authService: AuthService,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
    private readonly presenceService: PresenceService,
  ) {
    super();
  }

  async handleAuthenticate(client: Socket, payload: { token: string }) {
    try {
      const decoded = this.authService.verifyToken(payload.token);

      // Kick existing connection of this user if exists (O(1) lookup)
      const oldSocketId = this.connectedPlayers.get(decoded.userId);
      if (oldSocketId && oldSocketId !== client.id) {
        const oldSocket = client.nsp?.sockets.get(oldSocketId);
        if (oldSocket) {
          this.logger.log(
            `Kicking old socket: ${oldSocketId} for user: ${decoded.userId}`,
          );
          oldSocket.emit(ServerEvent.ERROR, {
            code: ErrorCode.UNAUTHORIZED,
            message: ERROR_MESSAGES[ErrorCode.UNAUTHORIZED],
          });
          oldSocket.disconnect(true);
        }
      }

      this.connectedPlayers.set(decoded.userId, client.id);

      client.data.userId = decoded.userId;
      client.data.username = decoded.username;

      client.emit(ServerEvent.AUTHENTICATED, {
        userId: decoded.userId,
        username: decoded.username,
      });

      this.logger.log(`Player authenticated: ${decoded.username}`);

      // Reconnection sync: restore room/match state
      await this.syncReconnection(client, decoded.userId);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          `Token verification failed: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(`Token verification failed: ${String(error)}`);
      }
      this.emitError(
        client,
        ErrorCode.INVALID_TOKEN,
        ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      );
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      const currentSocketId = this.connectedPlayers.get(userId);
      // Only delete from map if the disconnected socket is the active session
      if (currentSocketId === client.id) {
        this.connectedPlayers.delete(userId);

        // NEW: Notify active matches
        try {
          const userActiveRooms =
            await this.roomService.getUserActiveRooms(userId);
          for (const rp of userActiveRooms) {
            if (rp.room.currentMatchId) {
              await this.gameLoopService.handlePlayerDisconnect(
                rp.room.currentMatchId,
                userId,
                client.nsp.server,
              );
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to notify match of disconnect for ${userId}`,
            error,
          );
        }

        this.logger.log(`Player disconnected: ${userId}`);
      }
    }
  }

  private async syncReconnection(client: Socket, userId: string) {
    try {
      const userActiveRooms = await this.roomService.getUserActiveRooms(userId);
      if (userActiveRooms.length === 0) return;

      // Only synchronize the latest active room (take 1) to avoid stale/abandoned room issues
      // and prevent multiple concurrent Socket.io room joins causing client store conflicts
      const roomPlayer = [...userActiveRooms].sort(
        (a, b) => b.joinedAt.getTime() - a.joinedAt.getTime(),
      )[0];

      const room = roomPlayer.room;
      client.join(`room:${room.id}`);

      // Fetch the real countdown end time from GameLoopService
      const countdownEndsAt = this.gameLoopService.getCountdownEnd(room.id);

      // Update presence state for the reconnecting user first so the subsequent
      // players list reflects the new online status immediately
      await this.presenceService.updatePresence(room.id, userId);

      // Map room players to check presence dynamically
      const players = await Promise.all(
        room.players.map(async (p) => {
          const isOnline = await this.presenceService.isPresent(
            room.id,
            p.userId,
          );
          return {
            playerId: p.userId,
            playerName: p.user.username,
            isOnline,
          };
        }),
      );

      // Emit ROOM_JOINED with the list of players to avoid N+1 socket emits.
      // Reconnect path: the user already has a RoomPlayer row, so they
      // are joining as PLAYER, not as a drop-in spectator. The host
      // controls the room, the snapshot is replayed from the match
      // state machine, and answer submission is allowed.
      client.emit(ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        code: room.code,
        hostId: room.hostId,
        roomType: asRoomTypeOrDefault(room.type),
        roomStatus: room.status as import("@arena/shared").RoomStatus,
        currentMatchId: room.currentMatchId,
        countdownEndsAt,
        joinedAs: "PLAYER",
        players,
      } satisfies RoomJoinedPayload);

      if (room.currentMatchId) {
        const stateMachine = await this.matchService.getStateMachine(
          room.currentMatchId,
        );
        if (stateMachine) {
          stateMachine.reconnectPlayer(userId);
          await this.matchService.persistStateMachine(room.currentMatchId);
          client.emit(ServerEvent.SNAPSHOT, stateMachine.getSnapshot(0));
        }
      }

      this.logger.log(`Reconnected user ${userId} to room ${room.id}`);
    } catch (error) {
      this.logger.error("Error during reconnection sync:", error);
    }
  }
}
