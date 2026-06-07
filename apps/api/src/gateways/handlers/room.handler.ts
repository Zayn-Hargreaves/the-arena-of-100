import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  RoomStatus,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type LeaveRoomPayload,
  type RoomCreatedPayload,
  type RoomJoinedPayload,
  type RoomPlayerJoinedPayload,
  type RoomPlayerLeftPayload,
  RoomError,
  asRoomType,
} from "@arena/shared";
import { RoomService } from "../../modules/room/room.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { BaseHandler } from "./base.handler";

const asRoomStatus = (value: string): RoomStatus => value as RoomStatus;

@Injectable()
export class RoomHandler extends BaseHandler {
  private readonly logger = new Logger(RoomHandler.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly gameLoopService: GameLoopService,
  ) {
    super();
  }

  async handleCreateRoom(client: Socket, payload: CreateRoomPayload) {
    try {
      const userId = this.requireAuth(client);
      const room = await this.roomService.createRoom(
        userId,
        payload.roomType,
        payload.maxPlayers,
        payload.timeLimit,
        payload.category,
      );

      client.join(`room:${room.id}`);
      client.emit(ServerEvent.ROOM_CREATED, {
        roomId: room.id,
        code: room.code,
        hostId: room.hostId,
        roomType: asRoomType(room.type),
        roomStatus: RoomStatus.WAITING,
        currentMatchId: null,
        players: [
          {
            playerId: userId,
            playerName: client.data.username,
            isOnline: true,
          },
        ],
      } satisfies RoomCreatedPayload);

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
      if (room.joined) {
        client.to(`room:${room.id}`).emit(ServerEvent.PLAYER_JOINED, {
          roomId: room.id,
          playerId: userId,
          playerName: client.data.username,
          isOnline: true,
        } satisfies RoomPlayerJoinedPayload);
      }
      client.emit(ServerEvent.ROOM_JOINED, {
        roomId: room.id,
        code: room.code,
        hostId: room.hostId,
        roomType: asRoomType(room.type),
        roomStatus: asRoomStatus(room.status),
        currentMatchId: room.currentMatchId,
        countdownEndsAt: this.gameLoopService.getCountdownEnd(room.id),
        players: room.players.map((player) => {
          // RoomService.getRoom() always joins the user relation, so
          // `player.user` is guaranteed to be present. If it ever isn't, that
          // is a state-corruption bug — fail fast so the caller gets a
          // descriptive error and tests surface the regression immediately,
          // rather than silently emitting an empty playerName that clients
          // would render as a blank tile in the lobby.
          if (!player.user) {
            const message = `RoomPlayer ${player.userId} in room ${room.id} is missing its user relation; cannot resolve username`;
            this.logger.error(message);
            throw new Error(message);
          }
          return {
            playerId: player.userId,
            playerName:
              player.userId === userId
                ? client.data.username
                : player.user.username,
            isOnline: true,
          };
        }),
      } satisfies RoomJoinedPayload);

      if (room.joined) {
        await this.gameLoopService.maybeStartPublicCountdown(
          room.id,
          client.nsp.server,
        );
      }

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
        roomId: payload.roomId,
        playerId: userId,
        reason: "LEFT",
      } satisfies RoomPlayerLeftPayload);

      await this.gameLoopService.handleRoomPlayerLeft(payload.roomId, server);
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
