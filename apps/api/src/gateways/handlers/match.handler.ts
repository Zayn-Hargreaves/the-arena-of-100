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
import {
  MatchCommandService,
  makeCommandEnvelope,
} from "../../modules/match/match-command.service";
import { ClusterService } from "../../modules/cluster/cluster.service";
import { BaseHandler } from "./base.handler";

@Injectable()
export class MatchHandler extends BaseHandler {
  private readonly logger = new Logger(MatchHandler.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly gameLoopService: GameLoopService,
    // B4b: route SUBMIT_ANSWER to the owner via the durable command channel.
    private readonly matchCommand: MatchCommandService,
    private readonly cluster: ClusterService,
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

        // B4b single-writer: the SUBMIT_ANSWER can arrive on ANY node, but the
        // authoritative mutation of match:state must happen on the OWNER only
        // (two blind writes on two nodes lose an update). So this handler does
        // NOT apply/persist/emit locally — it durably forwards the command to
        // the per-match stream. The owner's consumer runs the fenced
        // authoritative apply and emits the canonical ANSWER_RESULT (delivered
        // cross-node via the Redis adapter). A non-owner never emits an
        // optimistic result the owner could later contradict.
        await this.matchCommand.forward(
          makeCommandEnvelope({
            matchId: payload.matchId,
            emittedByNodeId: this.cluster.nodeId,
            body: {
              type: "submit_answer",
              userId,
              answer: payload.answer,
              submissionId: payload.submissionId,
              clientTs: Date.now(),
            },
          }),
        );

        this.logger.log(
          `Answer forwarded to owner channel: ${userId} (match ${payload.matchId})`,
        );
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

        // Plan D: room authorization BEFORE any state-machine work.
        // Resolve roomId via a cache-first lookup on the in-memory
        // stateMachines map; on cache miss MatchService falls back to a
        // minimal `select: { roomId }` Prisma read. Either way, no
        // Redis deserialize / answer rehydrate runs for an unauthorized
        // client.
        const roomId = await this.matchService.getRoomIdByMatchId(
          payload.matchId,
        );
        if (!roomId) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

        // H6: socket channel membership. Players and drop-in spectators
        // both join `room:${roomId}` via JOIN_ROOM; outsiders are rejected.
        if (!client.rooms.has(`room:${roomId}`)) {
          throw new RoomError(ErrorCode.UNAUTHORIZED);
        }

        const stateMachine = await this.matchService.getStateMachine(
          payload.matchId,
        );
        if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

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
        this.emitError(client, code, msg, ClientEvent.REQUEST_SNAPSHOT);
      },
    );
  }
}
