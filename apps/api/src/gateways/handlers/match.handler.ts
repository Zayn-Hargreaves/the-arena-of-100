import { Injectable, Logger } from "@nestjs/common";
import { Socket, Server } from "socket.io";
import {
  ClientEvent,
  ServerEvent,
  ErrorCode,
  PlayerStatus,
  RoomStatus,
  getCardDefinition,
  type CardId,
  type CardEffect,
  type MatchState,
  type SubmitAnswerPayload,
  type RequestSnapshotPayload,
  type CardPickPayload,
  type CardPlayPayload,
  RoomError,
  ERROR_MESSAGE_KEYS,
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
import {
  assertValidCommandId,
  assertCardId,
  validateCardCommand,
} from "../../modules/match/card-validator";
import { resolveCardEffect, deriveSubstream } from "@arena/game-core";
import type { MatchStateMachine } from "@arena/game-core";

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
            ? ERROR_MESSAGE_KEYS[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error starting match:", error);
          msg = ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR];
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
        if (player?.status === PlayerStatus.DISCONNECTED) {
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
        let msg = ERROR_MESSAGE_KEYS[code] ?? this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error submitting answer:", error);
          msg = ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR];
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
            ? ERROR_MESSAGE_KEYS[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error sending snapshot:", error);
          msg = ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR];
        }
        this.emitError(client, code, msg, ClientEvent.REQUEST_SNAPSHOT);
      },
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Class + Card Hybrid handlers (sub-task D).
  // Source of truth: memory-bank/spec/class-cards-phase.md §5.2 sub-task D.
  //
  // These are ADDITIVE — they do not touch `handleStartMatch`,
  // `handleSubmitAnswer`, or `handleRequestSnapshot`. They follow the
  // same pattern as `handleSubmitAnswer` for the roomId authorization
  // gate + the durable command-forward path.
  // -------------------------------------------------------------------------

  // `handleCardPick` — client picked one of the offered cards.
  // The card is removed from the player's hand (single-use per match).
  // The event is appended to the event log via the state machine
  // (`pickCard`); the same shape is broadcast for live viewers.
  async handleCardPick(
    client: Socket,
    server: Server,
    payload: CardPickPayload,
  ) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);
        assertValidCommandId(payload.commandId);
        assertCardId(payload.cardId);

        const roomId = await this.matchService.getRoomIdByMatchId(
          payload.matchId,
        );
        if (!roomId) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);
        if (!client.rooms.has(`room:${roomId}`)) {
          throw new RoomError(ErrorCode.UNAUTHORIZED);
        }
        const stateMachine = await this.matchService.getStateMachine(
          payload.matchId,
        );
        if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

        const state = stateMachine.getState();
        this.assertActivePlayer(state, userId);

        // The state machine validates the offer correlation
        // (cardId must be in the player's current hand) and
        // appends CARD_PICKED. `assertCardId` already narrows
        // the schema-bound `payload.cardId` to `CardId`, so the
        // state-machine call passes the value through directly.
        stateMachine.pickCard(userId, payload.cardId, payload.offerSeqNo);

        // Broadcast to the room channel so other clients see the
        // player's hand update.
        server.to(`room:${roomId}`).emit(ServerEvent.CARD_PICKED, {
          matchId: payload.matchId,
          roundNo: stateMachine.getCurrentRound()?.roundNo ?? 0,
          playerId: userId,
          selectedCardId: payload.cardId,
          offerSeqNo: payload.offerSeqNo,
        });
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? ERROR_MESSAGE_KEYS[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error handling card pick:", error);
          msg = ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR];
        }
        client.emit(ServerEvent.ERROR, {
          code,
          message: msg,
          failedEvent: ClientEvent.CARD_PICK,
          commandId: payload.commandId,
        });
      },
    );
  }

  // `handleCardPlay` — apply the picked card. The boundary
  // validates the command, the resolver expands the template
  // into a concrete `CardEffect`, then the state machine
  // appends `CARD_RESOLVED`.
  async handleCardPlay(
    client: Socket,
    server: Server,
    payload: CardPlayPayload,
  ) {
    return this.runSafely(
      client,
      async () => {
        const userId = this.requireAuth(client);
        assertValidCommandId(payload.commandId);

        const roomId = await this.matchService.getRoomIdByMatchId(
          payload.matchId,
        );
        if (!roomId) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);
        if (!client.rooms.has(`room:${roomId}`)) {
          throw new RoomError(ErrorCode.UNAUTHORIZED);
        }
        const stateMachine = await this.matchService.getStateMachine(
          payload.matchId,
        );
        if (!stateMachine) throw new RoomError(ErrorCode.MATCH_NOT_FOUND);

        const state = stateMachine.getState();
        this.assertActivePlayer(state, userId);

        const pickedCards = Array.from(stateMachine.getPickedCards(userId));
        const offeredCardIds =
          stateMachine.getCardOfferForPlayer(userId, payload.offerSeqNo) ??
          ([] as CardId[]);
        const roster = new Set(state.players.keys());
        const playedSet = stateMachine.getPlayedCards(userId);
        const currentRoundNo = stateMachine.getCurrentRound()?.roundNo ?? 0;
        const aoeCount = stateMachine.getAoeCountForRound(currentRoundNo);

        const validated = validateCardCommand({
          cardId: payload.cardId,
          offeredCardIds,
          targetPlayerId: payload.targetPlayerId,
          rosterPlayerIds: roster,
          currentAoeCount: aoeCount,
          playedCardIds: playedSet,
          pickedCards,
          actingPlayerId: userId,
        });

        // Resolve the template server-side (3 cards consume RNG).
        const resolveRng = this.makeResolveRng(
          state.id,
          userId,
          currentRoundNo,
          payload.offerSeqNo,
          payload.cardId,
        );

        const correctAnswer = this.peekCorrectAnswer(stateMachine);
        const resolved = resolveCardEffect(
          validated.cardId,
          validated.template,
          resolveRng,
          {
            targetHand: payload.targetPlayerId
              ? stateMachine.getHand(payload.targetPlayerId)
              : undefined,
            options: stateMachine.getCurrentRound()?.question.options,
            correctAnswer,
            currentRoundNo,
            partial: correctAnswer ? correctAnswer[0] : "",
          },
        );

        const targetPlayerIds = this.expandTargets(
          validated.cardId,
          userId,
          payload.targetPlayerId,
          stateMachine,
          resolveRng,
        );

        const serverNow = Date.now();
        const result = stateMachine.playCard(
          userId,
          validated.cardId,
          payload.offerSeqNo,
          resolved,
          targetPlayerIds,
          serverNow,
        );

        const basePayload = {
          seqNo: result.seqNo,
          matchId: payload.matchId,
          roundNo: currentRoundNo,
          cardId: payload.cardId,
          offerSeqNo: payload.offerSeqNo,
          playedByPlayerId: userId,
          targetPlayerIds,
          resolution:
            result.expiresAtServer === null
              ? ("MUTATION" as const)
              : ("TEMPORARY" as const),
          serverTimestamp: serverNow,
          expiresAtServer: result.expiresAtServer,
          remainingMs: result.remainingMs,
        };

        const sanitizedEffect = this.sanitizeEffect(resolved);

        // Full resolved effect is delivered only to the concrete
        // targetPlayerIds. A self-targeting actor IS already in this
        // set (expandTargets returns the actor for self-only cards),
        // so we do not add `userId` separately — that would expose
        // target-private fields (e.g. OPTION_FAKE.indexes) to a
        // non-target actor.
        const fullEffectRooms = targetPlayerIds.map((id) => `player:${id}`);

        // Broadcast sanitized effect to room excluding direct receivers
        // to avoid duplicate seqNo frames.
        server
          .to(`room:${roomId}`)
          .except(fullEffectRooms)
          .emit(ServerEvent.CARD_RESOLVED, {
            ...basePayload,
            effect: sanitizedEffect,
          });

        // Broadcast full effect with details to each target player.
        for (const targetId of targetPlayerIds) {
          server.to(`player:${targetId}`).emit(ServerEvent.CARD_RESOLVED, {
            ...basePayload,
            effect: resolved,
          });
        }
      },
      (error) => {
        const code = this.getErrorCode(error);
        let msg =
          error instanceof RoomError
            ? ERROR_MESSAGE_KEYS[error.code]
            : this.getErrorMessage(error);
        if (code === ErrorCode.INTERNAL_ERROR) {
          this.logger.error("Error handling card play:", error);
          msg = ERROR_MESSAGE_KEYS[ErrorCode.INTERNAL_ERROR];
        }
        client.emit(ServerEvent.ERROR, {
          code,
          message: msg,
          failedEvent: ClientEvent.CARD_PLAY,
          commandId: payload.commandId,
        });
      },
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers (sub-task D)
  // -------------------------------------------------------------------------

  private makeResolveRng(
    matchId: string,
    userId: string,
    roundNo: number,
    offerSeqNo: number,
    cardId: string,
  ): () => number {
    const stream = deriveSubstream(
      `${matchId}|${userId}|${roundNo}|${offerSeqNo}|${cardId}`,
      `resolve|${cardId}`,
    );
    let local = stream;
    return () => {
      local = (local + 0x6d2b79f5) >>> 0;
      let t = local;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private peekCorrectAnswer(
    stateMachine: MatchStateMachine,
  ): string | undefined {
    return stateMachine.getCorrectAnswer();
  }

  private expandTargets(
    cardId: CardId,
    playedByPlayerId: string,
    targetPlayerId: string | undefined,
    stateMachine: MatchStateMachine,
    rng: () => number,
  ): string[] {
    const def = getCardDefinition(cardId);
    const template = def.effectTemplate as { targetCount?: number };
    const count = template.targetCount ?? 1;

    if (count > 1) {
      const players = stateMachine.getState().players;
      const eligible = Array.from(players.entries())
        .filter(
          ([id, p]) =>
            id !== playedByPlayerId &&
            p.status !== PlayerStatus.ELIMINATED &&
            p.status !== PlayerStatus.WINNER &&
            p.status !== PlayerStatus.DISCONNECTED,
        )
        .map(([id]) => id)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

      const selected: string[] = [];
      const numToPick = Math.min(count, eligible.length);
      const remaining = eligible.slice();
      for (let i = 0; i < numToPick; i++) {
        const u = rng();
        const idx = Math.floor(u * remaining.length);
        selected.push(remaining[idx]!);
        remaining.splice(idx, 1);
      }
      return selected;
    }
    if (targetPlayerId) return [targetPlayerId];
    return [playedByPlayerId];
  }

  // Per-kind allowlist for fields that contain data derived from
  // the correct answer (or otherwise target-private). Anything
  // listed here is cleared for the room-wide sanitized event;
  // kinds not listed pass through unchanged. Adding a new
  // `CardEffect` variant will leave the default branch untouched
  // until the kind is explicitly classified here.
  private sanitizeEffect(effect: CardEffect): CardEffect {
    switch (effect.kind) {
      case "OPTION_DISABLE":
        return { ...effect, indexes: [] };
      case "OPTION_FAKE":
        return { ...effect, indexes: [] };
      case "HINT_REVEAL":
        return { ...effect, partial: "" };
      case "HAND_DESTROY":
        return { ...effect, destroyedCardIds: [] };
      case "TIMER_MODIFY":
      case "OPTION_LOCK":
      case "DELAY_RENDER":
      case "VISUAL_OVERLAY":
      case "SEMANTIC_FLIP":
      case "QUESTION_REPLAY":
      case "SHIELD":
      case "SCORE_MULT":
      case "SECOND_CHANCE":
        return effect;
      default: {
        const _exhaustive: never = effect;
        void _exhaustive;
        return effect;
      }
    }
  }

  private assertActivePlayer(
    state: MatchState | null | undefined,
    userId: string,
  ): void {
    if (!state?.players) {
      throw new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER);
    }
    const player = state.players.get(userId);
    if (!player) {
      throw new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER);
    }
    if (
      player.status === PlayerStatus.ELIMINATED ||
      player.status === PlayerStatus.WINNER
    ) {
      throw new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER);
    }
    if (player.status === PlayerStatus.DISCONNECTED) {
      throw new RoomError(ErrorCode.PLAYER_DISCONNECTED);
    }
  }
}
