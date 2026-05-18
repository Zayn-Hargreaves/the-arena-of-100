import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ServerEvent,
  ErrorCode,
  GAME_CONFIG,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
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
        throw new Error("Chỉ chủ phòng mới có thể bắt đầu");
      }

      const match = await this.matchService.createMatch(payload.roomId);

      server.to(`room:${payload.roomId}`).emit(ServerEvent.MATCH_STARTING, {
        matchId: match.id,
        countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      });

      this.logger.log(`Match starting: ${match.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && "code" in error
          ? (error.code as string) || ErrorCode.INTERNAL_ERROR
          : ErrorCode.INTERNAL_ERROR;
      this.emitError(client, code, msg);
    }
  }

  async handleSubmitAnswer(client: Socket, payload: SubmitAnswerPayload) {
    try {
      const userId = this.requireAuth(client);

      const stateMachine = this.matchService.getStateMachine(payload.matchId);
      if (!stateMachine) throw new Error(ErrorCode.MATCH_NOT_FOUND);

      const serverTimestamp = Date.now();
      const result = stateMachine.submitAnswer(
        userId,
        payload.answer,
        serverTimestamp,
      );

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
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && "code" in error
          ? (error.code as string) || ErrorCode.INTERNAL_ERROR
          : ErrorCode.INTERNAL_ERROR;
      this.emitError(client, code, msg);
    }
  }

  async handleRequestSnapshot(client: Socket, payload: RequestSnapshotPayload) {
    try {
      const userId = this.requireAuth(client);

      const stateMachine = this.matchService.getStateMachine(payload.matchId);
      if (!stateMachine) throw new Error(ErrorCode.MATCH_NOT_FOUND);

      const snapshot = stateMachine.getSnapshot(payload.lastSeenSeqNo);
      client.emit(ServerEvent.SNAPSHOT, snapshot);

      this.logger.log(
        `Snapshot sent to ${userId} for match ${payload.matchId}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && "code" in error
          ? (error.code as string) || ErrorCode.INTERNAL_ERROR
          : ErrorCode.INTERNAL_ERROR;
      this.emitError(client, code, msg);
    }
  }
}
