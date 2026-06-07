import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  MatchStatus,
  PlayerStatus,
  RoomStatus,
  ServerEvent,
  getRoomChannel,
  RoomError,
  ErrorCode,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "../room/room.service";
import { RedisService } from "../redis/redis.service";

const COUNTDOWN_KEY_PREFIX = "room:countdown:";
const COUNTDOWN_INDEX_KEY = "room:countdowns";
// TTL longer than the longest possible countdown so a stale entry still
// exists for a small recovery window after a process restart.
const COUNTDOWN_REDIS_TTL_SEC = Math.ceil(
  (GAME_CONFIG.COUNTDOWN_DURATION_MS * 2) / 1000,
);

@Injectable()
export class GameLoopService implements OnModuleInit {
  private readonly logger = new Logger(GameLoopService.name);
  private activeTimers = new Map<string, Set<NodeJS.Timeout>>();
  private lobbyCountdowns = new Map<
    string,
    { timer: NodeJS.Timeout; countdownEndsAt: number }
  >();
  // F2: Track used question IDs per match to avoid repeats
  private usedQuestionIds = new Map<string, Set<string>>();
  // Add property for early termination (used by Task 7)
  private expectedAnswers = new Map<string, number>();
  private endingRounds = new Set<string>();
  private server?: Server;
  private recoveryInFlight = false;

  constructor(
    private readonly matchService: MatchService,
    private readonly questionService: QuestionService,
    private readonly roomService: RoomService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Inject the Socket.io server so we can recover lobby countdowns on boot
   * (the in-memory timer map does not survive a process restart, but the
   * persisted Redis state does). Called once during application bootstrap.
   */
  setServer(server: Server) {
    this.server = server;
  }

  /**
   * On startup, scan Redis for any rooms that were in COUNTDOWN when the
   * previous process died. For each one whose `countdownEndsAt` is still in
   * the future, re-arm a timer to launch the match. For those that have
   * already expired, immediately launch the match (best-effort). This
   * prevents rooms being stuck in COUNTDOWN indefinitely with no live timer.
   */
  async onModuleInit() {
    if (this.recoveryInFlight) return;
    this.recoveryInFlight = true;
    try {
      const client = this.redis.getClient();
      const roomIds = await client.smembers(COUNTDOWN_INDEX_KEY);
      if (roomIds.length === 0) return;

      this.logger.log(
        `Recovering ${roomIds.length} lobby countdown(s) from Redis...`,
      );
      const now = Date.now();

      for (const roomId of roomIds) {
        try {
          const raw = await client.get(`${COUNTDOWN_KEY_PREFIX}${roomId}`);
          if (!raw) {
            await client.srem(COUNTDOWN_INDEX_KEY, roomId);
            continue;
          }
          const countdownEndsAt = Number.parseInt(raw, 10);
          if (!Number.isFinite(countdownEndsAt)) {
            await this.clearPersistedCountdown(roomId);
            continue;
          }
          const remaining = Math.max(countdownEndsAt - now, 0);
          if (remaining === 0) {
            // Countdown already expired while the process was down — launch
            // the match immediately (if the server is wired up).
            if (this.server) {
              void this.launchRoomMatch(roomId, this.server, {
                isAutoStart: true,
              }).catch((error) => {
                this.logger.error(
                  `Recovery launch failed for room ${roomId}:`,
                  error,
                );
              });
            } else {
              this.logger.warn(
                `Cannot launch recovered match for room ${roomId}: server not ready`,
              );
              // Server is not yet wired up and the countdown has already
              // expired — drop the persisted entry so the next restart
              // does not re-issue the same warning, and so the room is not
              // stuck in COUNTDOWN indefinitely waiting for a recovery
              // launch that we can never perform from this process.
              void this.clearPersistedCountdown(roomId).catch((error) => {
                this.logger.error(
                  `Failed to clear persisted countdown for room ${roomId}:`,
                  error,
                );
              });
            }
          } else {
            this.armLobbyCountdownTimer(roomId, countdownEndsAt);
          }
        } catch (error) {
          this.logger.error(
            `Failed to recover countdown for room ${roomId}:`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error("Lobby countdown recovery failed:", error);
    } finally {
      this.recoveryInFlight = false;
    }
  }

  async maybeStartPublicCountdown(roomId: string, server: Server) {
    const room = await this.roomService.getRoom(roomId);
    if (room.type !== "PUBLIC") return null;
    if (room.status !== RoomStatus.WAITING) return null;
    if (room.players.length < GAME_CONFIG.MIN_PLAYERS_TO_START) return null;
    if (this.lobbyCountdowns.has(roomId)) {
      return this.lobbyCountdowns.get(roomId) ?? null;
    }

    // Reserve the slot atomically before any await to prevent race conditions
    const startedAt = Date.now();
    const countdownEndsAt = startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS;
    this.lobbyCountdowns.set(roomId, {
      // Placeholder; replaced by the real timer below before any await.
      timer: setTimeout(() => undefined, 0) as unknown as NodeJS.Timeout,
      countdownEndsAt,
    });

    try {
      await this.roomService.updateRoomStatus(roomId, RoomStatus.COUNTDOWN);

      const channel = getRoomChannel(roomId);

      server.to(channel).emit(ServerEvent.ROOM_STATUS_UPDATED, {
        roomId,
        roomStatus: RoomStatus.COUNTDOWN,
        currentMatchId: null,
        updatedAt: startedAt,
      });

      server.to(channel).emit(ServerEvent.ROOM_COUNTDOWN_STARTED, {
        roomId,
        roomStatus: RoomStatus.COUNTDOWN,
        countdownEndsAt,
        countdownMs: GAME_CONFIG.COUNTDOWN_DURATION_MS,
        startedAt,
      });

      this.armLobbyCountdownTimer(roomId, countdownEndsAt, server);
      // Persist to Redis so a process restart can recover and re-arm the
      // timer (or launch the match if it expired while we were down).
      await this.persistLobbyCountdown(roomId, countdownEndsAt);
      return { countdownEndsAt };
    } catch (error) {
      this.lobbyCountdowns.delete(roomId);
      void this.clearPersistedCountdown(roomId);
      throw error;
    }
  }

  /**
   * Re-arms the in-memory timer that fires `launchRoomMatch` when the lobby
   * countdown ends. Used by both the live `maybeStartPublicCountdown` path
   * (where the caller passes the active `server`) and the boot-time
   * `onModuleInit` recovery path (where `server` is omitted and we fall back
   * to the gateway's stored server reference).
   *
   * If no server is resolvable (gateway hasn't wired us up yet, and no
   * caller-provided `server` is available) we cannot fire `launchRoomMatch`,
   * so we log the error, drop any pending `lobbyCountdowns` entry, and clear
   * the persisted Redis entry. This prevents the same broken countdown from
   * being re-introduced on the next process restart.
   */
  private armLobbyCountdownTimer(
    roomId: string,
    countdownEndsAt: number,
    server?: Server,
  ) {
    const targetServer = server ?? this.server;
    if (!targetServer) {
      this.logger.error(
        `Cannot arm lobby countdown for room ${roomId}: server not set`,
      );
      this.lobbyCountdowns.delete(roomId);
      void this.clearPersistedCountdown(roomId);
      return;
    }

    const remaining = Math.max(countdownEndsAt - Date.now(), 0);
    const timer = setTimeout(() => {
      void this.launchRoomMatch(roomId, targetServer, {
        isAutoStart: true,
      }).catch((error) => {
        this.logger.error(
          `Failed to auto-start lobby countdown for room ${roomId}`,
          error,
        );
      });
    }, remaining);

    this.lobbyCountdowns.set(roomId, { timer, countdownEndsAt });
  }

  private async persistLobbyCountdown(
    roomId: string,
    countdownEndsAt: number,
  ): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client
        .multi()
        .set(
          `${COUNTDOWN_KEY_PREFIX}${roomId}`,
          countdownEndsAt.toString(),
          "EX",
          COUNTDOWN_REDIS_TTL_SEC,
        )
        .sadd(COUNTDOWN_INDEX_KEY, roomId)
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to persist lobby countdown for room ${roomId}:`,
        error,
      );
    }
  }

  private async clearPersistedCountdown(roomId: string): Promise<void> {
    try {
      const client = this.redis.getClient();
      await client
        .multi()
        .del(`${COUNTDOWN_KEY_PREFIX}${roomId}`)
        .srem(COUNTDOWN_INDEX_KEY, roomId)
        .exec();
    } catch (error) {
      this.logger.warn(
        `Failed to clear persisted countdown for room ${roomId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  getCountdownEnd(roomId: string): number | null {
    return this.lobbyCountdowns.get(roomId)?.countdownEndsAt ?? null;
  }

  async handleRoomPlayerLeft(roomId: string, server: Server) {
    const countdown = this.lobbyCountdowns.get(roomId);
    if (!countdown) return;

    const room = await this.roomService.getRoom(roomId);
    if (
      room.status !== RoomStatus.COUNTDOWN ||
      room.players.length >= GAME_CONFIG.MIN_PLAYERS_TO_START
    ) {
      return;
    }

    clearTimeout(countdown.timer);
    this.lobbyCountdowns.delete(roomId);
    await this.clearPersistedCountdown(roomId);

    await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);

    const updatedAt = Date.now();
    const channel = getRoomChannel(roomId);

    server.to(channel).emit(ServerEvent.ROOM_COUNTDOWN_CANCELLED, {
      roomId,
      roomStatus: RoomStatus.WAITING,
      reason: "PLAYER_LEFT",
      cancelledAt: updatedAt,
    });

    server.to(channel).emit(ServerEvent.ROOM_STATUS_UPDATED, {
      roomId,
      roomStatus: RoomStatus.WAITING,
      currentMatchId: null,
      updatedAt,
    });
  }

  async forceStartRoomMatch(roomId: string, server: Server) {
    return this.launchRoomMatch(roomId, server, { isAutoStart: false });
  }

  private async launchRoomMatch(
    roomId: string,
    server: Server,
    options: { isAutoStart: boolean },
  ) {
    let room = await this.roomService.getRoom(roomId);

    if (
      room.status !== RoomStatus.WAITING &&
      room.status !== RoomStatus.COUNTDOWN
    ) {
      throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
    }

    const countdown = this.lobbyCountdowns.get(roomId);
    if (countdown) {
      clearTimeout(countdown.timer);
      this.lobbyCountdowns.delete(roomId);
      await this.clearPersistedCountdown(roomId);
    }

    if (room.players.length < GAME_CONFIG.MIN_PLAYERS_TO_START) {
      if (room.status !== RoomStatus.WAITING) {
        await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
      }

      if (options.isAutoStart) {
        const updatedAt = Date.now();
        server
          .to(getRoomChannel(roomId))
          .emit(ServerEvent.ROOM_COUNTDOWN_CANCELLED, {
            roomId,
            roomStatus: RoomStatus.WAITING,
            reason: "NOT_ENOUGH_PLAYERS",
            cancelledAt: updatedAt,
          });
        server
          .to(getRoomChannel(roomId))
          .emit(ServerEvent.ROOM_STATUS_UPDATED, {
            roomId,
            roomStatus: RoomStatus.WAITING,
            currentMatchId: null,
            updatedAt,
          });
      }

      throw new RoomError(ErrorCode.NOT_ENOUGH_PLAYERS);
    }

    try {
      // Re-fetch room state just before calling updateRoomStatus to handle races
      room = await this.roomService.getRoom(roomId);
      if (
        room.status !== RoomStatus.WAITING &&
        room.status !== RoomStatus.COUNTDOWN
      ) {
        throw new RoomError(ErrorCode.ROOM_ALREADY_STARTED);
      }

      await this.roomService.updateRoomStatus(roomId, RoomStatus.STARTING);

      const channel = getRoomChannel(roomId);
      server.to(channel).emit(ServerEvent.ROOM_STATUS_UPDATED, {
        roomId,
        roomStatus: RoomStatus.STARTING,
        currentMatchId: room.currentMatchId ?? null,
        updatedAt: Date.now(),
      });

      const match = await this.matchService.createMatch(roomId);

      server.to(channel).emit(ServerEvent.MATCH_STARTING, {
        matchId: match.id,
        countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
      });

      await this.startMatchLoop(match.id, roomId, server);
      return match;
    } catch (error) {
      // Rollback on error
      await this.roomService.updateRoomStatus(roomId, RoomStatus.WAITING);
      server.to(getRoomChannel(roomId)).emit(ServerEvent.ROOM_STATUS_UPDATED, {
        roomId,
        roomStatus: RoomStatus.WAITING,
        currentMatchId: null,
        updatedAt: Date.now(),
      });
      throw error;
    }
  }

  // ============================================================
  // ENTRY POINT
  // ============================================================

  async startMatchLoop(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) {
      this.logger.error(`State machine not found for match ${matchId}`);
      return;
    }

    await this.roomService.updateRoomStatus(
      roomId,
      RoomStatus.IN_GAME,
      matchId,
    );

    server.to(getRoomChannel(roomId)).emit(ServerEvent.ROOM_STATUS_UPDATED, {
      roomId,
      roomStatus: RoomStatus.IN_GAME,
      currentMatchId: matchId,
      updatedAt: Date.now(),
    });

    // 2. Transition to COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // F2: Init question tracking
    this.usedQuestionIds.set(matchId, new Set());

    // F6: Persist state machine to Redis
    await this.matchService.persistStateMachine(matchId);

    // 3. Broadcast MATCH_STARTED
    const channel = getRoomChannel(roomId);
    server.to(channel).emit(ServerEvent.MATCH_STARTED, {
      matchId,
      roomId,
      status: "COUNTDOWN",
      countdownMs: GAME_CONFIG.COUNTDOWN_DURATION_MS,
    });

    // 4. Start countdown timer
    this.executeCountdown(matchId, roomId, server);
  }

  // ============================================================
  // PHASE 1: COUNTDOWN (5 seconds)
  // ============================================================

  private executeCountdown(
    matchId: string,
    roomId: string,
    server: Server,
  ): void {
    const timer = setTimeout(async () => {
      try {
        this.logger.log(`Countdown ended for match ${matchId}`);
        await this.executeRound(matchId, roomId, server);
      } catch (error) {
        this.logger.error(
          `Failed to execute round for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.COUNTDOWN_DURATION_MS);

    this.addTimer(matchId, timer);
  }

  // ============================================================
  // TIMER MANAGEMENT
  // ============================================================

  private addTimer(matchId: string, timer: NodeJS.Timeout): void {
    if (!this.activeTimers.has(matchId)) {
      this.activeTimers.set(matchId, new Set());
    }
    this.activeTimers.get(matchId)!.add(timer);
  }

  private clearTimers(matchId: string): void {
    const timers = this.activeTimers.get(matchId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.activeTimers.delete(matchId);
    }
  }

  // ============================================================
  // PUBLIC: Cancel match (called from handler on error)
  // ============================================================

  cancelMatchLoop(matchId: string): void {
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.expectedAnswers.delete(matchId);
    this.logger.warn(`Match loop cancelled: ${matchId}`);
  }

  // ============================================================
  // PHASE 2: ROUND ACTIVE (15 seconds)
  // ============================================================

  private async executeRound(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Transition to ROUND_ACTIVE
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);

    // F7: Fetch question with error handling
    let question;
    try {
      // F2: Exclude already-used question IDs
      const excludeIds = [...(this.usedQuestionIds.get(matchId) ?? new Set())];
      question = await this.questionService.getRandom(undefined, excludeIds);
    } catch (error) {
      this.logger.error(
        `Failed to fetch question for match ${matchId} — ending match`,
        error,
      );
      // End match gracefully if no questions available
      await this.finishMatchLoop(matchId, roomId, server);
      return;
    }

    // F2: Track used question
    this.usedQuestionIds.get(matchId)!.add(question.id);

    // 3. Start round in state machine (pass correctAnswer internally)
    const questionState = {
      id: question.id,
      content: question.content,
      options: question.options,
      correctAnswer: question.correctAnswer, // used internally by state machine
      difficulty: question.difficulty,
    };
    stateMachine.startRound(questionState);

    // F6: Persist after mutation
    await this.matchService.persistStateMachine(matchId);

    // 4. Count surviving players BEFORE broadcast (for early termination tracking)
    const state = stateMachine.getState();
    const survivingCount = state.survivingPlayerIds.length;
    // Store expected answer count (used by Task 7)
    this.expectedAnswers?.set(matchId, survivingCount);

    // 5. Broadcast ROUND_STARTED (STRIP correctAnswer from question!)
    const channel = getRoomChannel(roomId);
    const round = stateMachine.getCurrentRound()!;
    const clientQuestion = {
      id: question.id,
      content: question.content,
      options: question.options,
      difficulty: question.difficulty,
    };
    server.to(channel).emit(ServerEvent.ROUND_STARTED, {
      matchId,
      roundNo: state.currentRoundNo,
      question: clientQuestion,
      endsAt: round.endsAt,
      roundDurationMs: GAME_CONFIG.ROUND_DURATION_MS,
    });

    // 6. Set 15s timer → endRound
    const timer = setTimeout(async () => {
      try {
        await this.endRound(matchId, roomId, server);
      } catch (error) {
        this.logger.error(
          `Error in endRound timeout callback for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.ROUND_DURATION_MS);
    this.addTimer(matchId, timer);
  }

  // ============================================================
  // PHASE 3: ROUND EVALUATING + RESULT DISPLAY (3 seconds)
  // ============================================================

  private async endRound(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    if (this.endingRounds.has(matchId)) {
      this.logger.warn(
        `endRound already in progress or completed for match ${matchId}`,
      );
      return;
    }
    this.endingRounds.add(matchId);

    try {
      // 1. Get state machine
      const stateMachine = await this.matchService.getStateMachine(matchId);
      if (!stateMachine) return;

      // Guard: only execute if match is ROUND_ACTIVE and round status is ACTIVE
      const state = stateMachine.getState();
      const round = stateMachine.getCurrentRound();
      if (
        state.status !== MatchStatus.ROUND_ACTIVE ||
        !round ||
        round.status !== "ACTIVE"
      ) {
        this.logger.warn(
          `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round?.status ?? "none"}`,
        );
        return;
      }

      // 2. Transition to ROUND_EVALUATING
      stateMachine.transition(MatchStatus.ROUND_EVALUATING);

      // 3. Evaluate round
      const { survivingIds, eliminatedIds, correctAnswer } =
        stateMachine.evaluateRound();

      // 4. Transition to ROUND_RESULT
      stateMachine.transition(MatchStatus.ROUND_RESULT);

      // F6: Persist after mutation
      await this.matchService.persistStateMachine(matchId);

      // 5. Save round + answers to DB (Task 5)
      const currentRound = stateMachine.getCurrentRound()!;
      const roundRecord = await this.matchService.saveRound(
        matchId,
        state.currentRoundNo,
        currentRound.question.id,
      );
      // F5: roundRecord.id is available from Prisma create return
      const answersToSave = Array.from(currentRound.answers.entries()).map(
        ([playerId, answer]) => ({
          matchId,
          roundId: roundRecord.id,
          userId: playerId,
          answer: answer.answer,
          isCorrect: answer.isCorrect,
          responseTimeMs: answer.responseTimeMs,
        }),
      );
      await this.matchService.saveAnswers(answersToSave);

      // 6. Convert Maps to arrays for Socket.io serialization
      const playerInfos = Array.from(state.players.values());

      // 7. Broadcast ROUND_ENDED (KHÔNG gửi correctAnswer trong question object)
      const channel = getRoomChannel(roomId);
      server.to(channel).emit(ServerEvent.ROUND_ENDED, {
        matchId,
        roundNo: state.currentRoundNo,
        correctAnswer, // standalone field, NOT inside question
        survivingPlayerIds: survivingIds,
        eliminatedPlayerIds: eliminatedIds,
        playerResults: playerInfos,
      });

      // 8. Per-player eliminated notification
      for (const playerId of eliminatedIds) {
        const player = state.players.get(playerId);
        if (!player) continue;
        server.to(channel).emit(ServerEvent.PLAYER_ELIMINATED, {
          matchId,
          roundNo: state.currentRoundNo,
          playerId,
          playerName: player.name,
          reason: currentRound.answers.has(playerId)
            ? "WRONG_ANSWER"
            : "TIMEOUT",
        });
      }

      // 9. Set 3s timer → checkMatchEnd
      const timer = setTimeout(async () => {
        try {
          await this.checkMatchEnd(matchId, roomId, server);
        } catch (error) {
          this.logger.error(
            `Error in checkMatchEnd timeout callback for match ${matchId}:`,
            error,
          );
        }
      }, GAME_CONFIG.RESULT_DISPLAY_MS);
      this.addTimer(matchId, timer);
    } finally {
      this.endingRounds.delete(matchId);
    }
  }

  // ============================================================
  // PHASE 4: CHECK MATCH END
  // ============================================================

  private async checkMatchEnd(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    if (stateMachine.shouldEndMatch()) {
      await this.finishMatchLoop(matchId, roomId, server);
    } else {
      // Loop: next round
      await this.executeRound(matchId, roomId, server);
    }
  }

  // ============================================================
  // FINAL: MATCH FINISH
  // ============================================================

  private async finishMatchLoop(
    matchId: string,
    roomId: string,
    server: Server,
    serverOrContext: unknown = null,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    if (serverOrContext) {
      this.logger.debug(
        `finishMatchLoop called with context: ${JSON.stringify(serverOrContext)}`,
      );
    }

    // 2. Transition to FINISHED
    stateMachine.transition(MatchStatus.FINISHED);

    // F1: finishMatch() returns void. winnerId is set internally on state.
    stateMachine.finishMatch();
    const state = stateMachine.getState();
    const winnerId = state.winnerId!;

    // F6: Persist lần cuối
    await this.matchService.persistStateMachine(matchId);

    // 3. Persist match result to DB (updates room status, cleans memory + Redis)
    await this.matchService.finishMatch(matchId, winnerId);

    // 4. Broadcast MATCH_FINISHED
    const channel = getRoomChannel(roomId);
    const playerInfos = Array.from(state.players.values());
    server.to(channel).emit(ServerEvent.MATCH_FINISHED, {
      matchId,
      winnerId,
      totalRounds: state.currentRoundNo,
      players: playerInfos,
    });

    // 5. Cleanup
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.expectedAnswers.delete(matchId);

    this.logger.log(
      `Match ${matchId} finished. Winner: ${winnerId}. Rounds: ${state.currentRoundNo}`,
    );
  }

  // ============================================================
  // HANDLE PLAYER DISCONNECTION
  // ============================================================

  /**
   * Handles player disconnection during a match
   * - Marks player as DISCONNECTED in state machine
   * - Broadcasts PLAYER_LEFT event
   * - Persists state machine
   */
  async handlePlayerDisconnect(
    matchId: string,
    userId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Get current state
    const state = stateMachine.getState();

    // 3. Check if player exists
    const player = state.players.get(userId);
    if (!player) {
      this.logger.warn(`Player ${userId} not found in match ${matchId}`);
      return;
    }

    // 4. Mark player as DISCONNECTED in state machine
    stateMachine.disconnectPlayer(userId);

    // 5. Persist state machine
    await this.matchService.persistStateMachine(matchId);

    // 6. Broadcast PLAYER_LEFT with reason field
    const roomId = state.roomId;
    const channel = getRoomChannel(roomId);
    server.to(channel).emit(ServerEvent.PLAYER_LEFT, {
      matchId,
      playerId: userId,
      playerName: player.name,
      reason: PlayerStatus.DISCONNECTED,
    });

    // 7. Log the disconnect
    this.logger.log(`Player ${userId} disconnected from match ${matchId}`);
  }

  // ============================================================
  // CHECK EARLY TERMINATION
  // ============================================================

  /**
   * Checks if all surviving players have answered
   * - If so, clears timers and calls endRound immediately
   */
  async checkEarlyTermination(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Get current round
    const round = stateMachine.getCurrentRound();
    const expected = this.expectedAnswers.get(matchId) || 0;

    // 3. Check if all surviving players have answered
    // Use the exact condition: round exists, enough answers submitted, and round is still active
    if (round && round.answers.size >= expected && round.status === "ACTIVE") {
      this.logger.log(
        `Early termination triggered for match ${matchId} - all players answered`,
      );

      // Clear existing timers
      this.clearTimers(matchId);

      // End round immediately
      await this.endRound(matchId, roomId, server);
    }
  }
}
