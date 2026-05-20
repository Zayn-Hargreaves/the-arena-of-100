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
