import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  GAME_CONFIG,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
  RoomError,
  ERROR_MESSAGES,
} from "@arena/shared";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class MatchHandler extends BaseHandler {
  private readonly logger = new Logger(MatchHandler.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
  ) {
    super();
  }

  async handleStartMatch(
    client: Socket,
    server: Server,
    payload: { roomId: string },
  ) {
    try {
      const userId = this.requireAuth(client);

      const room = await this.roomService.getRoom(payload.roomId);
      if (room.hostId !== userId) {
        throw new RoomError(ErrorCode.NOT_ROOM_HOST);
      }

      const match = await this.matchService.createMatch(payload.roomId);

      server.to(`room:${payload.roomId}`).emit(ServerEvent.MATCH_STARTING, {
        matchId: match.id,
        countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      });

      this.logger.log(`Match starting: ${match.id}`);
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      const msg =
        error instanceof RoomError
          ? ERROR_MESSAGES[error.code]
          : error instanceof Error
            ? error.message
            : String(error);
      this.emitError(client, code, msg);
    }
  }

  async handleSubmitAnswer(client: Socket, payload: SubmitAnswerPayload) {
    try {
      const userId = this.requireAuth(client);

      const stateMachine = await this.matchService.getStateMachine(
        payload.matchId,
      );
      if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

      const serverTimestamp = Date.now();
      const result = stateMachine.submitAnswer(
        userId,
        payload.answer,
        serverTimestamp,
      );

      // Persist state after mutation
      await this.matchService.persistStateMachine(payload.matchId);

      client.emit(ServerEvent.ANSWER_RESULT, {
        matchId: payload.matchId,
        roundNo: stateMachine.getCurrentRound()?.roundNo ?? payload.roundNo,
        isCorrect: result.isCorrect,
        responseTimeMs: result.responseTimeMs,
      });

      this.logger.log(
        `Answer submitted: ${userId} - ${result.isCorrect ? "correct" : "wrong"}`,
      );
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      const msg =
        error instanceof RoomError
          ? ERROR_MESSAGES[error.code]
          : error instanceof Error
            ? error.message
            : String(error);
      this.emitError(client, code, msg);
    }
  }

  async handleRequestSnapshot(client: Socket, payload: RequestSnapshotPayload) {
    try {
      const userId = this.requireAuth(client);

      const stateMachine = await this.matchService.getStateMachine(
        payload.matchId,
      );
      if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

      const snapshot = stateMachine.getSnapshot(payload.lastSeenSeqNo);
      client.emit(ServerEvent.SNAPSHOT, snapshot);

      this.logger.log(
        `Snapshot sent to ${userId} for match ${payload.matchId}`,
      );
    } catch (error) {
      const code =
        error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
      const msg =
        error instanceof RoomError
          ? ERROR_MESSAGES[error.code]
          : error instanceof Error
            ? error.message
            : String(error);
      this.emitError(client, code, msg);
    }
  }
}
