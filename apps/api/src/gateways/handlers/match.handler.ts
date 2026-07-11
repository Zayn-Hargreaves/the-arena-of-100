import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ClientEvent,
  ServerEvent,
  ErrorCode,
  PlayerStatus,
  RoomStatus,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
  RoomError,
  ERROR_MESSAGES,
} from "@arena/shared";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class MatchHandler extends BaseHandler {
  private readonly logger = new Logger(MatchHandler.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
  ) {
    super();
  }

  async handleStartMatch(
    client: Socket,
    server: Server,
    payload: { roomId: string },
  ) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);

        const room = await this.roomService.getRoom(payload.roomId);
        if (room.hostId !== userId) {
          throw new RoomError(ErrorCode.NOT_ROOM_HOST);
        }

        if (room.type !== "PRIVATE") {
          throw new RoomError(ErrorCode.INVALID_ROOM_TYPE);
        }

        if (room.status !== RoomStatus.WAITING) {
          throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
        }

        const match = await this.gameLoopService.forceStartRoomMatch(
          payload.roomId,
          server,
        );

        this.logger.log(`Match starting: ${match.id}`);
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? ERROR_MESSAGES[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error starting match:", error);
          msg = "Internal server error";
        }
        this.emitError(client, code, msg);
      },
    );
  }

  async handleSubmitAnswer(client: Socket, payload: SubmitAnswerPayload) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);

        const stateMachine = await this.matchService.getStateMachine(
          payload.matchId,
        );
        if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

        // Drop-in spectating baseline: gate answer submission on the
        // server so a late-joiner who is not a registered player in the
        // match cannot submit answers even if they emit SUBMIT_ANSWER.
        // The state machine is the source of truth for the player roster.
        const isPlayerInMatch = stateMachine.getState().players.has(userId);
        if (!isPlayerInMatch) {
          throw new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER);
        }

        // M6 fix: emit a distinct error code for DISCONNECTED players.
        // Without this, a player who just lost their socket (e.g.
        // brief network blip) would see "Bạn không ở trong phòng này"
        // — confusing because they ARE in the room, just temporarily
        // offline. The frontend can use PLAYER_DISCONNECTED to drive
        // a reconnect flow instead of an error toast.
        const player = stateMachine.getState().players.get(userId);
        if (player && player.status === PlayerStatus.DISCONNECTED) {
          throw new RoomError(ErrorCode.PLAYER_DISCONNECTED);
        }

        const currentRoundBefore = stateMachine.getCurrentRound();
        const existingAnswerBefore = currentRoundBefore?.answers.get(userId);
        const serverTimestamp = Date.now();
        const result = stateMachine.submitAnswer(
          userId,
          payload.answer,
          serverTimestamp,
          payload.submissionId,
        );

        // Persist state after mutation so a retry after a crash still sees
        // the accepted submission in Redis before the answer is emitted.
        await this.matchService.persistStateMachine(payload.matchId);

        // Get roomId from state for early termination check
        const roomId = stateMachine.getState().roomId;

        client.emit(ServerEvent.ANSWER_RESULT, {
          matchId: payload.matchId,
          submissionId: result.submissionId,
          // L4 fix: read roundNo from the state machine, not from the
          // client payload. The previous `?? payload.roundNo` fallback
          // never fired in practice and trusting the client's roundNo
          // was a UX trap. The state machine is the source of truth.
          //
          // Reuse `currentRoundBefore` (captured before submitAnswer)
          // instead of re-calling getCurrentRound() after the persist
          // await. During that await the round can transition (timer
          // fires -> endRound), so a fresh getCurrentRound() may return
          // null or a different roundNo — crashing via the `!`
          // assertion or emitting the wrong round. currentRoundBefore
          // is guaranteed non-null here because submitAnswer throws
          // ROUND_NOT_ACTIVE when currentRound is null.
          roundNo: currentRoundBefore!.roundNo,
          isCorrect: result.isCorrect,
          responseTimeMs: result.responseTimeMs,
        });

        this.logger.log(
          `Answer submitted: ${userId} - ${result.isCorrect ? "correct" : "wrong"}`,
        );

        // Replay check must require a real existing answer with a
        // defined submissionId. Without the explicit guards,
        // `undefined === undefined` would be true for the first
        // submission whose payload also omits submissionId, falsely
        // skipping the termination check below. The state machine
        // guards the same comparison with `if (submissionId && ...)`
        // (see match-state-machine.ts); this handler mirrors that
        // guard so the wire path and the state-machine path agree.
        const isReplay =
          existingAnswerBefore !== undefined &&
          existingAnswerBefore.submissionId !== undefined &&
          existingAnswerBefore.submissionId === payload.submissionId;

        // Only the first accepted submission should trigger termination
        // checks. Duplicate retries with the same submissionId replay the
        // canonical answer result but skip the side effect.
        if (!isReplay) {
          // Check for early termination - all players answered
          // Pass the server instance from the client's namespace
          try {
            await this.gameLoopService.checkEarlyTermination(
              payload.matchId,
              roomId,
              client.nsp.server,
            );
          } catch (error) {
            this.logger.error("Error checking early termination:", error);
          }
        }
      },
      (error) => {
        const rawCode = error instanceof RoomError ? error.code : null;
        const code = rawCode ?? this.getErrorCode(error);
        let msg = ERROR_MESSAGES[code] ?? this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error submitting answer:", error);
          msg = "Internal server error";
        }
        client.emit(ServerEvent.ERROR, {
          code,
          message: msg,
          failedEvent: ClientEvent.SUBMIT_ANSWER,
          submissionId: payload.submissionId,
        });
      },
    );
  }

  async handleRequestSnapshot(client: Socket, payload: RequestSnapshotPayload) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);

        const stateMachine = await this.matchService.getStateMachine(
          payload.matchId,
        );
        if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

        // H6 fix: room-membership gate. Previously this handler was
        // fully open to any authenticated user that knew the matchId
        // — a leak risk for the player roster, the in-flight question,
        // and the per-player score. The previous comment said
        // "spectators use this exact path" and explicitly opted out
        // of a player-roster check, but the right check is socket
        // channel membership: both players AND drop-in spectators
        // (who entered via JOIN_ROOM → handleJoinRoom) end up in the
        // `room:${roomId}` channel. Anyone who has not joined the
        // room — even with a valid token — is rejected.
        const roomId = stateMachine.getState().roomId;
        if (!client.rooms.has(`room:${roomId}`)) {
          throw new RoomError(ErrorCode.UNAUTHORIZED);
        }

        // The snapshot is already client-safe: MatchStateMachine.getSnapshot
        // returns only the question (no correctAnswer), so no answer leak
        // is possible through this endpoint. We intentionally do NOT check
        // whether the requester is in the player roster here, because
        // spectators are exactly the new caller profile that the baseline
        // unlocks.
        // Delta replay contract (Plan D): decide delta vs full from the
        // client's `lastSeenSeqNo` cursor and the current event-log
        // window. Emit a delta EVENT_BATCH only when the cursor is
        // in-range — the client has applied events up to `cursor` and
        // the log still retains everything after it. Otherwise fall
        // back to a full SNAPSHOT: fresh hydrate (cursor 0), a cursor
        // older than the retained log (missed events are gone), a
        // cursor ahead of head (corrupt client state), or an empty log.
        const head = stateMachine.getHeadSeqNo();
        const floor = stateMachine.getFloorSeqNo();
        const cursor = payload.lastSeenSeqNo;
        const canDelta =
          cursor > 0 && head > 0 && cursor >= floor && cursor <= head;

        if (canDelta) {
          const events = stateMachine.getDelta(cursor);
          client.emit(ServerEvent.EVENT_BATCH, {
            matchId: payload.matchId,
            events,
          });
          this.logger.log(
            `Delta sent to ${userId} for match ${payload.matchId} ` +
              `(${events.length} events, cursor ${cursor}→${head})`,
          );
        } else {
          // Pass `head` (not the client's cursor) so the snapshot's
          // lastEventSeqNo reflects the real log head — that is how the
          // client learns which cursor to send on its next reconnect.
          const snapshot = stateMachine.getSnapshot(head);
          client.emit(ServerEvent.SNAPSHOT, snapshot);
          this.logger.log(
            `Snapshot sent to ${userId} for match ${payload.matchId}`,
          );
        }
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? ERROR_MESSAGES[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error sending snapshot:", error);
          msg = "Internal server error";
        }
        this.emitError(client, code, msg);
      },
    );
  }
}
