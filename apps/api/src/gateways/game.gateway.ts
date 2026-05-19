import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import {
  ClientEvent,
  ServerEvent,
  type JoinRoomPayload,
  type CreateRoomPayload,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
  type LeaveRoomPayload,
} from "@arena/shared";
import { AuthHandler, RoomHandler, MatchHandler } from "./handlers";
import { RoomService } from "../modules/room/room.service";
import { MatchService } from "../modules/match/match.service";
import { AuthService } from "../modules/auth/auth.service";

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  },
  namespace: "/game",
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private _server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly authHandler: AuthHandler,
    private readonly roomHandler: RoomHandler,
    private readonly matchHandler: MatchHandler,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly authService: AuthService,
  ) {}

  afterInit(server: Server) {
    server.use((socket: Socket, next: (err?: Error) => void) => {
      let token = socket.handshake.auth?.token;

      if (!token) {
        const authHeader = socket.handshake.headers?.authorization;
        if (authHeader) {
          token = authHeader.startsWith("Bearer ")
            ? authHeader.replace("Bearer ", "").trim()
            : authHeader.trim();
        }
      }

      if (token) {
        try {
          const decoded = this.authService.verifyToken(token);
          socket.data.userId = decoded.userId;
          socket.data.username = decoded.username;
          this.logger.log(
            `Handshake authentication successful for user: ${decoded.username}`,
          );
        } catch (error) {
          this.logger.warn(
            `Handshake authentication failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      next();
    });
  }

  async handleConnection(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Handle reconnection sync
    try {
      const userId = client.data.userId;
      if (userId) {
        this.logger.log(`Reconnection detected for user: ${userId}`);

        // Find active rooms where this user is a player
        const userActiveRooms =
          await this.roomService.getUserActiveRooms(userId);

        // Process all active rooms found for the user
        for (const roomPlayer of userActiveRooms) {
          const room = roomPlayer.room;

          // Rejoin the room channel
          client.join(`room:${room.id}`);

          // Emit room update to restore UI state
          client.emit(ServerEvent.PLAYER_JOINED, {
            roomId: room.id,
            code: room.code,
            players: room.players.map((p) => ({
              id: p.userId,
              name: p.user.username,
            })),
          });

          // Check if there's an active match for this room
          if (room.currentMatchId) {
            const stateMachine = await this.matchService.getStateMachine(
              room.currentMatchId,
            );
            if (stateMachine) {
              // Emit match update to restore UI state
              const snapshot = stateMachine.getSnapshot(0);
              client.emit(ServerEvent.SNAPSHOT, snapshot);
            }
          }

          this.logger.log(`Reconnected user ${userId} to room ${room.id}`);
        }
      }
    } catch (error) {
      this.logger.error("Error handling reconnection:", error);
    }
  }

  async handleDisconnect(@ConnectedSocket() client: Socket) {
    this.authHandler.handleDisconnect(client);
  }

  @SubscribeMessage(ClientEvent.AUTHENTICATE)
  handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string },
  ) {
    return this.authHandler.handleAuthenticate(client, payload);
  }

  @SubscribeMessage(ClientEvent.CREATE_ROOM)
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateRoomPayload,
  ) {
    return this.roomHandler.handleCreateRoom(client, payload);
  }

  @SubscribeMessage(ClientEvent.JOIN_ROOM)
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    return this.roomHandler.handleJoinRoom(client, payload);
  }

  @SubscribeMessage(ClientEvent.LEAVE_ROOM)
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LeaveRoomPayload,
  ) {
    return this.roomHandler.handleLeaveRoom(client, this._server, payload);
  }

  @SubscribeMessage(ClientEvent.START_MATCH)
  handleStartMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    return this.matchHandler.handleStartMatch(client, this._server, payload);
  }

  @SubscribeMessage(ClientEvent.SUBMIT_ANSWER)
  handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubmitAnswerPayload,
  ) {
    return this.matchHandler.handleSubmitAnswer(client, payload);
  }

  @SubscribeMessage(ClientEvent.REQUEST_SNAPSHOT)
  handleRequestSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RequestSnapshotPayload,
  ) {
    return this.matchHandler.handleRequestSnapshot(client, payload);
  }

  @SubscribeMessage(ClientEvent.PING)
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit(ServerEvent.PONG, { timestamp: Date.now() });
  }
}
