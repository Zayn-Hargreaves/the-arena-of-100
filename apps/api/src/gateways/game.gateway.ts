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
  type HeartbeatPayload,
  type AuthenticatePayload,
} from "@arena/shared";
import { AuthHandler, RoomHandler, MatchHandler } from "./handlers";
import { AuthService } from "../modules/auth/auth.service";
import { PresenceService } from "../modules/match/presence.service";
import { GameLoopService } from "../modules/match/game-loop.service";
import { WsValidationPipe } from "../common/pipes/ws-validation.pipe";
import {
  AuthenticatePayloadSchema,
  CreateRoomPayloadSchema,
  HeartbeatPayloadSchema,
  JoinRoomPayloadSchema,
  LeaveRoomPayloadSchema,
  RequestSnapshotPayloadSchema,
  StartMatchPayloadSchema,
  SubmitAnswerPayloadSchema,
} from "@arena/shared";

// Per-event validation pipe instances. Each one is a thin wrapper around
// the corresponding Zod schema. Cached at module level so a single
// instance is shared across all incoming events (the pipe is stateless).
//
// Why this matters (C2): previously the gateway passed the raw payload
// straight to the handler with no runtime validation. A client could
// send { answer: { inject: true } } and corrupt downstream Prisma
// string-column writes, or send { matchId: 123 } (a number) and use it
// as a Redis key. Now any malformed payload is rejected with
// ErrorCode.INVALID_PAYLOAD before any handler code runs.
const AuthenticatePayloadPipe = new WsValidationPipe<AuthenticatePayload>(
  AuthenticatePayloadSchema,
);
const CreateRoomPayloadPipe = new WsValidationPipe<CreateRoomPayload>(
  CreateRoomPayloadSchema,
);
const JoinRoomPayloadPipe = new WsValidationPipe<JoinRoomPayload>(
  JoinRoomPayloadSchema,
);
const LeaveRoomPayloadPipe = new WsValidationPipe<LeaveRoomPayload>(
  LeaveRoomPayloadSchema,
);
const StartMatchPayloadPipe = new WsValidationPipe<{ roomId: string }>(
  StartMatchPayloadSchema,
);
const SubmitAnswerPayloadPipe = new WsValidationPipe<SubmitAnswerPayload>(
  SubmitAnswerPayloadSchema,
);
const RequestSnapshotPayloadPipe = new WsValidationPipe<RequestSnapshotPayload>(
  RequestSnapshotPayloadSchema,
);
const HeartbeatPayloadPipe = new WsValidationPipe<HeartbeatPayload>(
  HeartbeatPayloadSchema,
);

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
    private readonly presenceService: PresenceService,
    private readonly gameLoopService: GameLoopService,
  ) {}

  afterInit(server: Server) {
    this.presenceService.setServer(server);
    this.gameLoopService.setServer(server);
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
    @MessageBody(AuthenticatePayloadPipe) payload: AuthenticatePayload,
  ) {
    return this.authHandler.handleAuthenticate(client, payload);
  }

  @SubscribeMessage(ClientEvent.CREATE_ROOM)
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody(CreateRoomPayloadPipe) payload: CreateRoomPayload,
  ) {
    return this.roomHandler.handleCreateRoom(client, payload);
  }

  @SubscribeMessage(ClientEvent.JOIN_ROOM)
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody(JoinRoomPayloadPipe) payload: JoinRoomPayload,
  ) {
    return this.roomHandler.handleJoinRoom(client, payload);
  }

  @SubscribeMessage(ClientEvent.LEAVE_ROOM)
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody(LeaveRoomPayloadPipe) payload: LeaveRoomPayload,
  ) {
    return this.roomHandler.handleLeaveRoom(client, this._server, payload);
  }

  @SubscribeMessage(ClientEvent.START_MATCH)
  handleStartMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody(StartMatchPayloadPipe) payload: { roomId: string },
  ) {
    return this.matchHandler.handleStartMatch(client, this._server, payload);
  }

  @SubscribeMessage(ClientEvent.SUBMIT_ANSWER)
  handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody(SubmitAnswerPayloadPipe) payload: SubmitAnswerPayload,
  ) {
    return this.matchHandler.handleSubmitAnswer(client, payload);
  }

  @SubscribeMessage(ClientEvent.REQUEST_SNAPSHOT)
  handleRequestSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody(RequestSnapshotPayloadPipe) payload: RequestSnapshotPayload,
  ) {
    return this.matchHandler.handleRequestSnapshot(client, payload);
  }

  @SubscribeMessage(ClientEvent.PING)
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit(ServerEvent.PONG, { timestamp: Date.now() });
  }

  @SubscribeMessage(ClientEvent.HEARTBEAT)
  async handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody(HeartbeatPayloadPipe) payload: HeartbeatPayload,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !payload.roomId) return;

    try {
      // Verify the user actually belongs to this room before touching presence.
      // We use the socket's own `rooms` set (kept in sync by Socket.IO on
      // join/leave) instead of querying the DB via getUserActiveRooms, which
      // would overwhelm DB/CPU at scale when heartbeats fire every few seconds
      // per player. The handler that joined the room already gated membership
      // server-side, so this client.rooms.has() check is authoritative for
      // the lifetime of the socket.
      if (!client.rooms.has(`room:${payload.roomId}`)) return;

      await this.presenceService.updatePresence(payload.roomId, userId);
    } catch (error) {
      this.logger.warn(
        `Heartbeat presence update failed for user ${userId} in room ${payload.roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
