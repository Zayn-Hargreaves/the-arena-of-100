import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type LeaveRoomPayload,
  RoomError,
} from "@arena/shared";
import { RoomService } from "../../modules/room/room.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class RoomHandler extends BaseHandler {
  private readonly logger = new Logger(RoomHandler.name);

  constructor(private readonly roomService: RoomService) {
    super();
  }

  async handleCreateRoom(client: Socket, payload: CreateRoomPayload) {
    try {
      const userId = this.requireAuth(client);
      const room = await this.roomService.createRoom(
        userId,
        payload.roomType,
        payload.maxPlayers,
      );

      client.join(`room:${room.id}`);
      client.emit(ServerEvent.ROOM_CREATED, {
        roomId: room.id,
        code: room.code,
        roomType: room.type,
      });

      this.logger.log(`Room created via socket: ${room.code}`);
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      let msg = error instanceof Error ? error.message : String(error);
      if (code === ErrorCode.INTERNAL_ERROR) {
        this.logger.error("Error creating room:", error);
        msg = "Internal server error";
      }
      this.emitError(client, code, msg);
    }
  }

  async handleJoinRoom(client: Socket, payload: JoinRoomPayload) {
    try {
      const userId = this.requireAuth(client);

      if (!payload.roomCode) throw new RoomError(ErrorCode.ROOM_NOT_FOUND);

      const room = await this.roomService.joinRoom(payload.roomCode, userId);

      client.join(`room:${room.id}`);
      client.to(`room:${room.id}`).emit(ServerEvent.PLAYER_JOINED, {
        playerId: userId,
        playerName: client.data.username,
      });
      client.emit(ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        code: room.code,
      });

      this.logger.log(`Player ${userId} joined room ${room.code} via socket`);
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      let msg = error instanceof Error ? error.message : String(error);
      if (code === ErrorCode.INTERNAL_ERROR) {
        this.logger.error("Error joining room:", error);
        msg = "Internal server error";
      }
      this.emitError(client, code, msg);
    }
  }

  async handleLeaveRoom(
    client: Socket,
    server: Server,
    payload: LeaveRoomPayload,
  ) {
    try {
      const userId = this.requireAuth(client);

      await this.roomService.leaveRoom(payload.roomId, userId);
      client.leave(`room:${payload.roomId}`);

      server.to(`room:${payload.roomId}`).emit(ServerEvent.PLAYER_LEFT, {
        playerId: userId,
        reason: "LEFT",
      });
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      let msg = error instanceof Error ? error.message : String(error);
      if (code === ErrorCode.INTERNAL_ERROR) {
        this.logger.error("Error leaving room:", error);
        msg = "Internal server error";
      }
      this.emitError(client, code, msg);
    }
  }
}
