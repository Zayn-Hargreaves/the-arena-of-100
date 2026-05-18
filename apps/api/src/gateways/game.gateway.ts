// ============================================================
// Game WebSocket Gateway - Real-time Communication
// Socket.io Gateway Pattern
// ============================================================

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { AuthService } from "../modules/auth/auth.service";
import { RoomService } from "../modules/room/room.service";
import { MatchService } from "../modules/match/match.service";
import {
  ClientEvent,
  ServerEvent,
  ErrorCode,
  GAME_CONFIG,
  type JoinRoomPayload,
  type CreateRoomPayload,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
} from "@arena/shared";

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  },
  namespace: "/game",
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private _server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  private readonly connectedPlayers = new Map<
    string,
    { socketId: string; userId: string }
  >();

  constructor(
    private readonly authService: AuthService,
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
  ) {}

  // Connection handler
  async handleConnection(@ConnectedSocket() client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  // Disconnection handler
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    const playerData = Array.from(this.connectedPlayers.entries()).find(
      ([, v]) => v.socketId === client.id,
    );

    if (playerData) {
      const [userId] = playerData;
      this.connectedPlayers.delete(userId);
      this.logger.log(`Player disconnected: ${userId}`);
    }
  }

  // Authenticate
  @SubscribeMessage(ClientEvent.AUTHENTICATE)
  async handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string },
  ) {
    try {
      const decoded = this.authService.verifyToken(payload.token);
      this.connectedPlayers.set(decoded.userId, {
        socketId: client.id,
        userId: decoded.userId,
      });

      client.data.userId = decoded.userId;
      client.data.username = decoded.username;

      client.emit(ServerEvent.AUTHENTICATED, {
        userId: decoded.userId,
        username: decoded.username,
      });

      this.logger.log(`Player authenticated: ${decoded.username}`);
    } catch {
      client.emit(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: "Token không hợp lệ",
      });
    }
  }

  // Create Room
  @SubscribeMessage(ClientEvent.CREATE_ROOM)
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateRoomPayload,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      const room = await this.roomService.createRoom(
        userId,
        payload.roomType,
        payload.maxPlayers,
      );

      // Join socket room
      client.join(`room:${room.id}`);

      client.emit(ServerEvent.ROOM_CREATED, {
        roomId: room.id,
        code: room.code,
        roomType: room.type,
      });

      this.logger.log(`Room created via socket: ${room.code}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      client.emit(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: errorMessage,
      });
    }
  }

  // Join Room
  @SubscribeMessage(ClientEvent.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      let room;
      if (payload.roomCode) {
        room = await this.roomService.joinRoom(payload.roomCode, userId);
      } else {
        throw new Error(ErrorCode.ROOM_NOT_FOUND);
      }

      // Join socket room
      client.join(`room:${room.id}`);

      // Notify others
      client.to(`room:${room.id}`).emit(ServerEvent.PLAYER_JOINED, {
        playerId: userId,
        playerName: client.data.username,
      });

      client.emit(ServerEvent.PLAYER_JOINED, {
        roomId: room.id,
        code: room.code,
      });

      this.logger.log(`Player ${userId} joined room ${room.code} via socket`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode =
        errorMessage === ErrorCode.ROOM_NOT_FOUND
          ? ErrorCode.ROOM_NOT_FOUND
          : ErrorCode.INTERNAL_ERROR;
      client.emit(ServerEvent.ERROR, {
        code: errorCode,
        message: errorMessage,
      });
    }
  }

  // Leave Room
  @SubscribeMessage(ClientEvent.LEAVE_ROOM)
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) return;

      await this.roomService.leaveRoom(payload.roomId, userId);

      client.leave(`room:${payload.roomId}`);

      this._server.to(`room:${payload.roomId}`).emit(ServerEvent.PLAYER_LEFT, {
        playerId: userId,
        reason: "LEFT",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      client.emit(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: errorMessage,
      });
    }
  }

  // Start Match
  @SubscribeMessage(ClientEvent.START_MATCH)
  async handleStartMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      // Verify host
      const room = await this.roomService.getRoom(payload.roomId);
      if (room.hostId !== userId) {
        throw new Error("Chỉ chủ phòng mới có thể bắt đầu");
      }

      // Create match
      const match = await this.matchService.createMatch(payload.roomId);

      // Notify room
      this._server
        .to(`room:${payload.roomId}`)
        .emit(ServerEvent.MATCH_STARTING, {
          matchId: match.id,
          countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
        });

      this.logger.log(`Match starting: ${match.id}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      client.emit(ServerEvent.ERROR, {
        code: ErrorCode.INTERNAL_ERROR,
        message: errorMessage,
      });
    }
  }

  // Submit Answer
  @SubscribeMessage(ClientEvent.SUBMIT_ANSWER)
  async handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubmitAnswerPayload,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      const stateMachine = await this.matchService.getStateMachine(
        payload.matchId,
      );
      if (!stateMachine) {
        throw new Error(ErrorCode.MATCH_NOT_FOUND);
      }

      // Server timestamp for anti-cheat
      const serverTimestamp = Date.now();

      // Submit answer through state machine
      const result = stateMachine.submitAnswer(
        userId,
        payload.answer,
        serverTimestamp,
      );

      // Persist state after mutation
      await this.matchService.persistStateMachine(payload.matchId);

      // Send result to player
      client.emit(ServerEvent.ANSWER_RESULT, {
        matchId: payload.matchId,
        roundNo: payload.roundNo,
        isCorrect: result.isCorrect,
        responseTimeMs: result.responseTimeMs,
      });

      this.logger.log(
        `Answer submitted: ${userId} - ${result.isCorrect ? "correct" : "wrong"}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      client.emit(ServerEvent.ERROR, {
        code: errorMessage || ErrorCode.INTERNAL_ERROR,
        message: errorMessage,
      });
    }
  }

  // Request Snapshot (for reconnect)
  @SubscribeMessage(ClientEvent.REQUEST_SNAPSHOT)
  async handleRequestSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RequestSnapshotPayload,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        throw new Error(ErrorCode.UNAUTHORIZED);
      }

      const stateMachine = await this.matchService.getStateMachine(
        payload.matchId,
      );
      if (!stateMachine) {
        throw new Error(ErrorCode.MATCH_NOT_FOUND);
      }

      const snapshot = stateMachine.getSnapshot(payload.lastSeenSeqNo);

      client.emit(ServerEvent.SNAPSHOT, snapshot);

      this.logger.log(
        `Snapshot sent to ${userId} for match ${payload.matchId}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      client.emit(ServerEvent.ERROR, {
        code: errorMessage || ErrorCode.INTERNAL_ERROR,
        message: errorMessage,
      });
    }
  }

  // Ping/Pong
  @SubscribeMessage(ClientEvent.PING)
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit(ServerEvent.PONG, { timestamp: Date.now() });
  }
}
