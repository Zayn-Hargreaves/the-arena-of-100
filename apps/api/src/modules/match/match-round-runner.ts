import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  eliminationsForRound,
  UNAVAILABLE,
  type RoundStartingPlayers,
} from "@arena/game-core";
import {
  GAME_CONFIG,
  MatchStatus,
  RoomStatus,
  RoomError,
  ErrorCode,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "./../room/room.service";
import { MatchTimerRegistry } from "./match-timer.registry";
import { emitMatchStarted, emitRoomStatusUpdated } from "./game-loop.helpers";
import {
  emitMatchDisconnected,
  emitMatchFinished,
  emitMatchPlayerLeft,
  emitPlayerEliminated,
  emitRoundEnded,
  emitRoundStarted,
} from "./game-loop.events";

type RecoveryRound = {
  roundNo: number;
  question: { id: string };
  answers: Map<string, { answer: string }>;
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
};

// ============================================================
// MatchRoundRunner — the timer-driven match loop
//
// Extracted from GameLoopService. Owns everything that happens once a
// match is live: countdown → round → evaluate → result → next round →
// finish, plus the in-match player events (disconnect / voluntary
// leave / early termination). It owns the MatchTimerRegistry (timers +
// H1/B1 idempotency guards).
//
// GameLoopService owns this collaborator and drives it: `launchRoomMatch`
// calls `startMatchLoop`, the admin kill-switch calls `cancelMatchLoop`,
// and the socket handlers reach the in-match events through
// GameLoopService's thin facade. The runner never launches a match
// itself — that (and the DB/room orchestration around it) stays in
// GameLoopService.
// ============================================================

export class MatchRoundRunner {
  private readonly logger = new Logger(MatchRoundRunner.name);
  // In-memory per-match runtime bookkeeping: active timers, F2
  // used-question tracking, expected-answer counts, and the H1/B1
  // idempotency guards.
  private readonly timers = new MatchTimerRegistry();

  constructor(
    private readonly matchService: MatchService,
    private readonly questionService: QuestionService,
    private readonly roomService: RoomService,
  ) {}

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
      throw new RoomError(
        ErrorCode.MATCH_NOT_FOUND,
        `State machine not found for match ${matchId}`,
      );
    }

    await this.roomService.updateRoomStatus(
      roomId,
      RoomStatus.IN_GAME,
      matchId,
    );

    emitRoomStatusUpdated(server, {
      roomId,
      roomStatus: RoomStatus.IN_GAME,
      currentMatchId: matchId,
      updatedAt: Date.now(),
    });

    // 2. Transition to COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // F2: Init question tracking
    this.timers.initUsedQuestions(matchId);

    // F6: Persist state machine to Redis
    await this.matchService.persistStateMachine(matchId);

    // 3. Broadcast MATCH_STARTED
    emitMatchStarted(
      server,
      roomId,
      matchId,
      MatchStatus.COUNTDOWN,
      GAME_CONFIG.COUNTDOWN_DURATION_MS,
    );

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
    // M5 fix: register the timer set in `activeTimers` BEFORE setTimeout
    // returns, closing the window where `cancelMatchLoop` could iterate
    // the timers before the handle was tracked. Defence-in-depth: the
    // callback re-checks the state machine still exists.
    const timerSet = this.timers.ensureMatch(matchId);

    const timer = setTimeout(async () => {
      try {
        // M5 defence-in-depth: confirm the state machine still
        // exists. The match may have been torn down between
        // setTimeout firing and us reaching this line.
        const sm = await this.matchService.getStateMachine(matchId);
        if (!sm) {
          this.logger.log(
            `executeCountdown callback: state machine gone for match ${matchId}, skipping executeRound`,
          );
          return;
        }
        this.logger.log(`Countdown ended for match ${matchId}`);
        await this.executeRound(matchId, roomId, server);
      } catch (error) {
        this.logger.error(
          `Failed to execute round for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.COUNTDOWN_DURATION_MS);

    timerSet.add(timer);
  }

  // ============================================================
  // Cancel match (admin kill-switch / launch failure)
  // ============================================================

  cancelMatchLoop(matchId: string): void {
    this.timers.disposeMatch(matchId);
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
      const excludeIds = [
        ...(this.timers.getUsedQuestions(matchId) ?? new Set<string>()),
      ];
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
    this.timers.markQuestionUsed(matchId, question.id);

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
    this.timers.setExpectedAnswers(matchId, survivingCount);

    // 5. Broadcast ROUND_STARTED (STRIP correctAnswer from question!)
    const round = stateMachine.getCurrentRound()!;
    emitRoundStarted(
      server,
      roomId,
      matchId,
      state,
      {
        id: question.id,
        content: question.content,
        options: question.options,
        difficulty: question.difficulty,
      },
      round.endsAt,
    );

    // 6. Set 15s timer → endRound
    const timer = setTimeout(async () => {
      try {
        await this.endRound(matchId, roomId, server);
        /* c8 ignore next 3 */
      } catch (error) {
        this.logger.error(
          `Error in endRound timeout callback for match ${matchId}:`,
          error,
        );
      }
    }, GAME_CONFIG.ROUND_DURATION_MS);
    this.timers.addTimer(matchId, timer);
  }

  // ============================================================
  // PHASE 3: ROUND EVALUATING + RESULT DISPLAY (3 seconds)
  // ============================================================

  private async endRound(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // H1 fix (defensive double-check): the round-end guard is the
    // single source of truth for round-end idempotency. clearTimeout
    // does NOT cancel a callback already in Node's timer queue — so
    // `checkEarlyTermination` can race with the 15s timer: both reach
    // this method. The guard ensures only the first caller does work.
    if (!this.timers.beginEndRound(matchId)) {
      this.logger.warn(
        `endRound already in progress or completed for match ${matchId}`,
      );
      return;
    }

    try {
      // 1. Get state machine
      const stateMachine = await this.matchService.getStateMachine(matchId);
      if (!stateMachine) return;

      const state = stateMachine.getState();
      const round = stateMachine.getCurrentRound();
      if (!round) {
        this.logger.warn(
          `endRound bypassed for match ${matchId}: no current round`,
        );
        return;
      }

      let survivingIds: string[] = [];
      let eliminatedIds: string[] = [];
      let correctAnswer = "";

      if (
        state.status === MatchStatus.ROUND_ACTIVE &&
        round.status === "ACTIVE"
      ) {
        // --- Normal Flow: Transition and Evaluate ---
        stateMachine.transition(MatchStatus.ROUND_EVALUATING);

        const evaluation = stateMachine.evaluateRound();
        survivingIds = evaluation.survivingIds;
        eliminatedIds = evaluation.eliminatedIds;
        correctAnswer = evaluation.correctAnswer;

        // Fully snapshot the ROUND_EVALUATING state in Redis before database writes
        await this.matchService.persistStateMachine(matchId);
      } else if (
        state.status === MatchStatus.ROUND_EVALUATING &&
        round.status === "COMPLETED"
      ) {
        // --- Recovery Flow: State machine is already in ROUND_EVALUATING ---
        this.logger.log(
          `endRound entering recovery path for match ${matchId} round ${state.currentRoundNo}`,
        );

        // Reconstruct evaluation results
        survivingIds = [...state.survivingPlayerIds];
        const recoveryRound = round as typeof round & RecoveryRound;

        correctAnswer = recoveryRound.correctAnswer || "";
        if (!correctAnswer) {
          const questionObj = await this.questionService.findOne(
            round.question.id,
          );
          if (questionObj) {
            correctAnswer = questionObj.correctAnswer;
          } else {
            this.logger.warn(
              `Failed to rehydrate correctAnswer in recovery: question ${round.question.id} not found in DB for match ${matchId} round ${round.roundNo}`,
            );
          }
        }

        // Retrieve from stateMachine's eventLog if available
        const roundEvaluatedEvent = stateMachine
          .getEventLog()
          .find(
            (e) =>
              e.type === "ROUND_EVALUATED" &&
              e.payload &&
              (e.payload as { roundNo?: number }).roundNo === round.roundNo,
          );

        if (
          roundEvaluatedEvent &&
          roundEvaluatedEvent.payload &&
          Array.isArray(
            (roundEvaluatedEvent.payload as { eliminatedIds?: string[] })
              .eliminatedIds,
          )
        ) {
          eliminatedIds = (
            roundEvaluatedEvent.payload as { eliminatedIds: string[] }
          ).eliminatedIds;
        } else {
          const startingPlayers = this.getRecoveryStartingPlayers(
            recoveryRound,
            matchId,
          );

          if (startingPlayers === UNAVAILABLE) {
            // The round-start roster is not recoverable; do not
            // infer eliminations from cumulative state. Skip
            // eliminating players this round and warn so the
            // operator can investigate the missing snapshot.
            this.logger.warn(
              `Recovery for match ${matchId} round ${round.roundNo} skipped eliminatedIds: startingPlayers is UNAVAILABLE`,
            );
            eliminatedIds = [];
          } else if (!correctAnswer) {
            // We can still derive the eliminated set from the persisted
            // snapshot, but we must not call the helper without an answer key.
            const survivingSet = new Set(survivingIds);
            eliminatedIds = startingPlayers.filter(
              (playerId) => !survivingSet.has(playerId),
            );
          } else {
            eliminatedIds = eliminationsForRound({
              ...recoveryRound,
              correctAnswer,
              startingPlayers,
            });
          }
        }
      } else if (state.status === MatchStatus.ROUND_RESULT) {
        // Recovery path when we already successfully transitioned to ROUND_RESULT but crashed before/during checkMatchEnd
        this.logger.log(
          `endRound entering ROUND_RESULT recovery path for match ${matchId} round ${state.currentRoundNo}`,
        );
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
        this.timers.addTimer(matchId, timer);
        return;
      } else {
        // Guard: only execute if match is in ROUND_ACTIVE, ROUND_EVALUATING, or ROUND_RESULT
        this.logger.warn(
          `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round.status}`,
        );
        return;
      }

      // H3 fix: PERSIST the round's DB writes BEFORE advancing the
      // state machine to ROUND_RESULT. If `saveRoundAndAnswers` throws,
      // the state machine stays in ROUND_EVALUATING so a retry does not
      // leave a ROUND_RESULT with no DB row. We re-throw so the timer
      // callback surfaces the failure loudly.
      try {
        // 4. Save the round row + all answers atomically. The single
        //    $transaction means a failure on the answer batch rolls
        //    back the round row too, so a retry after a process
        //    restart does NOT hit @@unique([matchId, roundNo]).
        const currentRoundForSave = stateMachine.getCurrentRound()!;
        await this.matchService.saveRoundAndAnswers(
          matchId,
          state.currentRoundNo,
          currentRoundForSave.question.id,
          Array.from(currentRoundForSave.answers.entries()).map(
            ([playerId, answer]) => ({
              userId: playerId,
              answer: answer.answer,
              isCorrect: answer.isCorrect,
              responseTimeMs: answer.responseTimeMs,
            }),
          ),
        );

        // 6. Persist state machine (now that DB writes succeeded).
        await this.matchService.persistStateMachine(matchId);
      } catch (dbError) {
        // H3 fix: a DB failure here must not silently advance the
        // state machine. Log at error level and re-throw; the state
        // machine remains in ROUND_EVALUATING for a retry.
        this.logger.error(
          `H3: endRound DB persistence failed for match ${matchId} round ${state.currentRoundNo}; state machine will NOT advance to ROUND_RESULT`,
          dbError,
        );
        throw dbError;
      }

      // 7. Transition to ROUND_RESULT — safe now that DB is consistent.
      stateMachine.transition(MatchStatus.ROUND_RESULT);
      await this.matchService.persistStateMachine(matchId);

      // 8. Broadcast ROUND_ENDED (KHÔNG gửi correctAnswer trong question object)
      emitRoundEnded({
        server,
        roomId,
        matchId,
        state,
        correctAnswer,
        survivingIds,
        eliminatedIds,
      });

      // 10. Per-player eliminated notification
      for (const playerId of eliminatedIds) {
        const player = state.players.get(playerId);
        if (!player) continue;
        emitPlayerEliminated({
          server,
          roomId,
          matchId,
          state,
          playerId,
          playerName: player.name,
          answeredThisRound:
            stateMachine.getCurrentRound()?.answers.has(playerId) ?? false,
        });
      }

      // 11. Set 3s timer → checkMatchEnd
      const timer = setTimeout(async () => {
        try {
          await this.checkMatchEnd(matchId, roomId, server);
          /* c8 ignore next 3 */
        } catch (error) {
          this.logger.error(
            `Error in checkMatchEnd timeout callback for match ${matchId}:`,
            error,
          );
        }
      }, GAME_CONFIG.RESULT_DISPLAY_MS);
      this.timers.addTimer(matchId, timer);
    } finally {
      this.timers.endEndRound(matchId);
    }
  }

  private getRecoveryStartingPlayers(
    round: RecoveryRound,
    matchId: string,
  ): string[] | typeof UNAVAILABLE {
    if (round.startingPlayers === UNAVAILABLE) {
      this.logger.warn(
        `Recovery round snapshot unavailable for match ${matchId} round ${round.roundNo}: startingPlayers is UNAVAILABLE`,
      );
      return UNAVAILABLE;
    }

    if (Array.isArray(round.startingPlayers)) {
      return round.startingPlayers;
    }

    this.logger.warn(
      `Recovery round snapshot unavailable for match ${matchId} round ${round.roundNo}: startingPlayers missing`,
    );
    return UNAVAILABLE;
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

    // H5 fix: pass MAX_ROUNDS so the state machine can end the match
    // even if more than 1 player is still alive — a hard safety cap.
    if (stateMachine.shouldEndMatch(GAME_CONFIG.MAX_ROUNDS)) {
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
  ): Promise<void> {
    // B1 fix: idempotency guard. The match-finish path is reachable
    // from `checkMatchEnd` (timer-driven) and from the admin
    // kill-switch (`AdminService.terminateRoom` → `matchService.finishMatch`).
    // The second concurrent caller must be a no-op. Explicit try/finally
    // so a thrown error still releases the guard.
    if (!this.timers.beginFinish(matchId)) {
      this.logger.warn(
        `finishMatchLoop already in progress for match ${matchId}; second caller is a no-op`,
      );
      return;
    }

    try {
      await this.finishMatchLoopInner(matchId, roomId, server);
    } finally {
      this.timers.endFinish(matchId);
    }
  }

  /**
   * Public guard query used by `AdminService.terminateRoom` to abort
   * the kill-switch if a natural finish is already in flight for the
   * same match. Returns true while `finishMatchLoop` is mid-execution.
   */
  isMatchFinishing(matchId: string): boolean {
    return this.timers.isFinishing(matchId);
  }

  private async finishMatchLoopInner(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Transition to FINISHED
    stateMachine.transition(MatchStatus.FINISHED);

    // F1: finishMatch() returns void. winnerId is set internally on state.
    stateMachine.finishMatch();
    const state = stateMachine.getState();
    // B2 fix: `state.winnerId` is `string | null`. Convert defensively
    // to an explicit `null` for the wire + Prisma (Prisma silently drops
    // `undefined`, which would keep a stale winnerId).
    const winnerId: string | null = state.winnerId ?? null;

    // F6: Persist lần cuối
    await this.matchService.persistStateMachine(matchId);

    // 3. Persist match result to DB (updates room status, cleans memory + Redis).
    await this.matchService.finishMatch(matchId, winnerId, roomId, false);

    // 4. Broadcast MATCH_FINISHED
    emitMatchFinished(server, roomId, matchId, state, winnerId);

    // 5. Cleanup
    this.timers.disposeMatch(matchId);

    if (winnerId === null) {
      this.logger.warn(
        `Match ${matchId} finished with no winner (empty roster or unresolvable tie-break). Rounds: ${state.currentRoundNo}. Clients receive MATCH_FINISHED with winnerId: null.`,
      );
    } else {
      this.logger.log(
        `Match ${matchId} finished. Winner: ${winnerId}. Rounds: ${state.currentRoundNo}`,
      );
    }
  }

  // ============================================================
  // HANDLE PLAYER DISCONNECTION
  // ============================================================

  /**
   * Handles player disconnection during a match: marks the player
   * DISCONNECTED in the state machine, persists, and broadcasts.
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
    emitMatchDisconnected(server, roomId, userId);

    // 7. Log the disconnect
    this.logger.log(`Player ${userId} disconnected from match ${matchId}`);
  }

  // ============================================================
  // VOLUNTARY MATCH LEAVE
  // ============================================================

  /**
   * Called when a user explicitly sends `LEAVE_ROOM` while the room is
   * IN_GAME or FINISHED. This is the C1 cheating-vector fix: without it
   * the state machine keeps the player ACTIVE after their RoomPlayer row
   * is deleted, so the SUBMIT_ANSWER gate would keep accepting answers.
   * We mark them DISCONNECTED and persist; the match continues for the
   * remaining players.
   */
  async handleMatchPlayerLeft(
    matchId: string,
    roomId: string,
    userId: string,
    server: Server,
    reason: "LEFT" | "STALE" = "LEFT",
  ): Promise<void> {
    // 1. Get state machine. The match might already be FINISHED and the
    //    in-memory state machine gone; we still broadcast so other
    //    clients update their spectator list.
    const stateMachine = await this.matchService.getStateMachine(matchId);

    if (stateMachine) {
      // 2. Verify if the player is in the match roster.
      const state = stateMachine.getState();
      const player = state.players.get(userId);
      if (player) {
        // Mark DISCONNECTED (same path as the socket-disconnect handler)
        // so behaviour stays consistent: reconnect still possible,
        // evaluateRound skips them, submitAnswer gate rejects.
        stateMachine.disconnectPlayer(userId);
        await this.matchService.persistStateMachine(matchId);
      }
    } else {
      this.logger.warn(
        `handleMatchPlayerLeft: no state machine for match ${matchId} (likely already finished); skipping state update`,
      );
    }

    // 3. Broadcast PLAYER_LEFT (reason "LEFT"/"STALE") on the room channel so
    //    lobby + in-match views stay in sync. FINISHED matches receive
    //    it too so spectators update their "players still here" badge.
    emitMatchPlayerLeft(server, roomId, userId, reason);

    this.logger.log(
      `Player ${userId} left match ${matchId} (room ${roomId}) with reason ${reason}`,
    );
  }

  // ============================================================
  // CHECK EARLY TERMINATION
  // ============================================================

  /**
   * If all surviving players have answered, clear the 15s timer and end
   * the round immediately.
   */
  async checkEarlyTermination(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // H1 fix: explicit round-end guard. If a 15s timer is already in the
    // queue (last player submitted at T+14.9s), back off and let it fire.
    if (this.timers.isEndingRound(matchId)) {
      return;
    }

    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

    // 2. Get current round
    const round = stateMachine.getCurrentRound();
    const expected = this.timers.getExpectedAnswers(matchId);

    // 3. All surviving players answered while the round is still ACTIVE?
    if (
      round &&
      expected > 0 &&
      round.answers.size >= expected &&
      round.status === "ACTIVE"
    ) {
      this.logger.log(
        `Early termination triggered for match ${matchId} - all players answered`,
      );

      // Clear the 15s timer (scoped to this match) then end immediately.
      // The `endingRounds` guard inside endRound is defence-in-depth.
      this.timers.clearTimers(matchId);
      await this.endRound(matchId, roomId, server);
    }
  }
}
