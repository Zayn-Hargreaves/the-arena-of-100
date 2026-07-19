import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  eliminationsForRound,
  MatchStateMachine,
  UNAVAILABLE,
  type RoundStartingPlayers,
} from "@arena/game-core";
import {
  GAME_CONFIG,
  MatchStatus,
  RoomStatus,
  RoomError,
  ErrorCode,
  type RoundState,
} from "@arena/shared";
import { MatchService, type PersistOutcome } from "./match.service";
import { MatchOwnershipService } from "./match-ownership.service";
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

type RecoveryRound = Pick<
  RoundState,
  | "matchId"
  | "roundNo"
  | "question"
  | "startedAt"
  | "endsAt"
  | "status"
  | "answers"
> & {
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
};

type RoundEndContext = {
  survivingIds: string[];
  eliminatedIds: string[];
  correctAnswer: string;
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
    // B2c: fence the three mutating boundaries. Passed from GameLoopService
    // (the runner is `new`'d there, not DI).
    private readonly ownership: MatchOwnershipService,
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

    // F6: Persist state machine to Redis. B2c: only broadcast MATCH_STARTED and
    // arm the countdown once the canonical write LANDS. A non-APPLIED outcome
    // (RETRY = never held / lost the lease; BLIND = no ownership snapshot) means
    // this node must not drive the loop — skip the broadcast and the countdown
    // so clients never see a match started on state we could not persist.
    const startOutcome = await this.matchService.persistStateMachine(matchId);
    if (startOutcome !== "APPLIED") {
      this.logger.warn(
        `startMatchLoop: persist ${startOutcome} for ${matchId} — no confirmed canonical write, skipping MATCH_STARTED broadcast and countdown`,
      );
      return;
    }

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
    // B2c fencing: validate ownership the moment this callback begins — BEFORE
    // any transition or persist. The countdown timer that scheduled us may have
    // fired on a node that has since lost the lease (expired / fence bumped by a
    // takeover); a non-owner must not drive the round.
    if (!(await this.ownership.assertOwnership(matchId))) {
      this.logger.warn(
        `executeRound: assertOwnership failed for ${matchId} — not owner, aborting before transition`,
      );
      return;
    }

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

    // F6: Persist after mutation. B2c: only broadcast ROUND_STARTED after the
    // canonical write LANDS. A non-APPLIED outcome (RETRY = lost the lease
    // between the assert above and the write; BLIND = no ownership snapshot)
    // means the new owner will drive this round — skip the broadcast and the
    // round timer so we don't emit or advance on state we could not persist.
    const startOutcome = await this.matchService.persistStateMachine(matchId);
    if (startOutcome !== "APPLIED") {
      this.logger.warn(
        `executeRound: persist ${startOutcome} for ${matchId} — no confirmed canonical write, skipping ROUND_STARTED broadcast and round timer`,
      );
      return;
    }

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
    // B2c fencing: only the lease-holding owner may end a round. A resurrected
    // old owner (lease expired / fence bumped by a takeover) fails the renew
    // and aborts before claiming the H1 guard, mutating state, or broadcasting.
    if (!(await this.ownership.assertOwnership(matchId))) {
      this.logger.warn(
        `endRound: assertOwnership failed for ${matchId} — not owner, aborting`,
      );
      return;
    }

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

      let roundEndContext: RoundEndContext | null = null;

      switch (state.status) {
        case MatchStatus.ROUND_ACTIVE:
          if (round.status !== "ACTIVE") {
            this.logger.warn(
              `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round.status}`,
            );
            return;
          }
          roundEndContext = await this.handleActiveRoundEnd(
            matchId,
            stateMachine,
          );
          break;
        case MatchStatus.ROUND_EVALUATING:
          if (round.status !== "COMPLETED") {
            this.logger.warn(
              `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round.status}`,
            );
            return;
          }
          roundEndContext = await this.handleRecoveredRoundEnd(
            matchId,
            stateMachine,
            state,
            round,
          );
          break;
        case MatchStatus.ROUND_RESULT:
          await this.scheduleMatchEndCheck(matchId, roomId, server);
          return;
        default:
          this.logger.warn(
            `endRound bypassed for match ${matchId}: state.status is ${state.status}, round status is ${round.status}`,
          );
          return;
      }

      if (!roundEndContext) {
        return;
      }

      const { survivingIds, eliminatedIds, correctAnswer } = roundEndContext;

      // H3 fix: PERSIST the round's DB writes BEFORE advancing the
      // state machine to ROUND_RESULT. If `saveRoundAndAnswers` throws,
      // the state machine stays in ROUND_EVALUATING so a retry does not
      // leave a ROUND_RESULT with no DB row. We re-throw so the timer
      // callback surfaces the failure loudly.
      // B2c: the single assertOwnership at the top of endRound does NOT
      // authorize the later async side effects (DB persist → transition →
      // broadcast). Capture and validate every canonical persist result; a
      // non-APPLIED outcome means the lease was lost mid-flight, so we stop
      // before advancing state or broadcasting and let the new owner finalize.
      let evalOutcome: PersistOutcome | undefined;
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
        evalOutcome = await this.matchService.persistStateMachine(matchId);
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

      if (evalOutcome !== "APPLIED") {
        this.logger.warn(
          `endRound: eval-phase persist ${evalOutcome} for ${matchId} — no confirmed canonical write, aborting before ROUND_RESULT transition/broadcast`,
        );
        return;
      }

      // 7. Transition to ROUND_RESULT — safe now that DB is consistent.
      stateMachine.transition(MatchStatus.ROUND_RESULT);
      const resultOutcome =
        await this.matchService.persistStateMachine(matchId);
      if (resultOutcome !== "APPLIED") {
        this.logger.warn(
          `endRound: result-phase persist ${resultOutcome} for ${matchId} — no confirmed canonical write, skipping ROUND_ENDED broadcast`,
        );
        return;
      }

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
          wasOnline: player.isOnline,
        });
      }

      // 11. Set 3s timer → checkMatchEnd
      await this.scheduleMatchEndCheck(matchId, roomId, server);
    } finally {
      this.timers.endEndRound(matchId);
    }
  }

  private async handleActiveRoundEnd(
    matchId: string,
    stateMachine: MatchStateMachine,
  ): Promise<RoundEndContext | null> {
    stateMachine.transition(MatchStatus.ROUND_EVALUATING);

    const evaluation = stateMachine.evaluateRound();

    // Fully snapshot the ROUND_EVALUATING state in Redis before database writes.
    // B2c: this is a canonical write. If it does not land (RETRY = lost the
    // lease mid-round; BLIND = no ownership snapshot) we must NOT go on to write
    // the round/answers to the DB or advance to ROUND_RESULT — abort here and
    // let the new owner finalize the round from canonical state. Returning null
    // makes endRound short-circuit before saveRoundAndAnswers.
    const outcome = await this.matchService.persistStateMachine(matchId);
    if (outcome !== "APPLIED") {
      this.logger.warn(
        `handleActiveRoundEnd: eval-snapshot persist ${outcome} for ${matchId} — no confirmed canonical write, aborting before DB write / ROUND_RESULT`,
      );
      return null;
    }

    return {
      survivingIds: evaluation.survivingIds,
      eliminatedIds: evaluation.eliminatedIds,
      correctAnswer: evaluation.correctAnswer,
    };
  }

  private async handleRecoveredRoundEnd(
    matchId: string,
    stateMachine: MatchStateMachine,
    state: ReturnType<MatchStateMachine["getState"]>,
    round: NonNullable<ReturnType<MatchStateMachine["getCurrentRound"]>>,
  ): Promise<RoundEndContext> {
    this.logger.log(
      `endRound entering recovery path for match ${matchId} round ${state.currentRoundNo}`,
    );

    const recoveryRound = round as typeof round & RecoveryRound;
    const survivingIds = [...state.survivingPlayerIds];
    let correctAnswer = recoveryRound.correctAnswer || "";

    if (!correctAnswer) {
      const questionObj = await this.questionService.findOne(round.question.id);
      if (questionObj) {
        correctAnswer = questionObj.correctAnswer;
      } else {
        this.logger.warn(
          `Failed to rehydrate correctAnswer in recovery: question ${round.question.id} not found in DB for match ${matchId} round ${round.roundNo}`,
        );
      }
    }

    const startingPlayers = this.getRecoveryStartingPlayers(
      recoveryRound,
      matchId,
    );
    const roundEvaluatedEvents = stateMachine
      .getEventLog()
      .filter(
        (e) =>
          e.type === "ROUND_EVALUATED" &&
          e.payload &&
          (e.payload as { roundNo?: number }).roundNo === round.roundNo,
      );
    const recoveredEliminatedIds = this.getRecoveryEliminatedIdsFromEventLog(
      roundEvaluatedEvents,
      recoveryRound,
      startingPlayers,
      correctAnswer,
      matchId,
    );

    if (recoveredEliminatedIds) {
      return {
        survivingIds,
        eliminatedIds: recoveredEliminatedIds,
        correctAnswer,
      };
    }

    if (startingPlayers === UNAVAILABLE) {
      // The round-start roster is not recoverable; do not infer eliminations
      // from cumulative state. Skip eliminating players this round and warn so
      // the operator can investigate the missing snapshot.
      this.logger.warn(
        `Recovery for match ${matchId} round ${round.roundNo} skipped eliminatedIds: startingPlayers is UNAVAILABLE`,
      );
      return { survivingIds, eliminatedIds: [], correctAnswer };
    }

    if (!correctAnswer) {
      // We can still derive the eliminated set from the persisted snapshot,
      // but we must not call the helper without an answer key.
      const survivingSet = new Set(survivingIds);
      return {
        survivingIds,
        eliminatedIds: startingPlayers.filter(
          (playerId) => !survivingSet.has(playerId),
        ),
        correctAnswer,
      };
    }

    return {
      survivingIds,
      eliminatedIds: eliminationsForRound({
        ...recoveryRound,
        correctAnswer,
        startingPlayers,
      }),
      correctAnswer,
    };
  }

  private async scheduleMatchEndCheck(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
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

  private getRecoveryEliminatedIdsFromEventLog(
    roundEvaluatedEvents: ReadonlyArray<{
      payload?: unknown;
    }>,
    recoveryRound: RecoveryRound,
    startingPlayers: string[] | typeof UNAVAILABLE,
    correctAnswer: string,
    matchId: string,
  ): string[] | null {
    if (roundEvaluatedEvents.length === 0) {
      return null;
    }

    if (roundEvaluatedEvents.length > 1) {
      this.logger.warn(
        `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ${roundEvaluatedEvents.length} ROUND_EVALUATED events`,
      );
      return null;
    }

    const payload = roundEvaluatedEvents[0]?.payload as {
      eliminatedIds?: unknown;
    };
    if (!Array.isArray(payload?.eliminatedIds)) {
      return null;
    }

    if (
      !payload.eliminatedIds.every((playerId) => typeof playerId === "string")
    ) {
      this.logger.warn(
        `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with non-string eliminatedIds`,
      );
      return null;
    }

    const eliminatedIds = payload.eliminatedIds;
    if (new Set(eliminatedIds).size !== eliminatedIds.length) {
      this.logger.warn(
        `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with duplicate eliminatedIds`,
      );
      return null;
    }

    if (startingPlayers === UNAVAILABLE || !correctAnswer) {
      return null;
    }

    const startingPlayerSet = new Set(startingPlayers);
    if (!eliminatedIds.every((playerId) => startingPlayerSet.has(playerId))) {
      this.logger.warn(
        `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event with out-of-round eliminatedIds`,
      );
      return null;
    }

    const expectedEliminatedIds = eliminationsForRound({
      ...recoveryRound,
      correctAnswer,
      startingPlayers,
    });
    const expectedSet = new Set(expectedEliminatedIds);
    const matchesExpected =
      expectedEliminatedIds.length === eliminatedIds.length &&
      eliminatedIds.every((playerId) => expectedSet.has(playerId));
    if (!matchesExpected) {
      this.logger.warn(
        `Recovery for match ${matchId} round ${recoveryRound.roundNo} ignored ROUND_EVALUATED event whose eliminatedIds did not match recomputed round results`,
      );
      return null;
    }

    return [...eliminatedIds];
  }

  // ============================================================
  // PHASE 4: CHECK MATCH END
  // ============================================================

  private async checkMatchEnd(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // B2c fencing: a non-owner must not decide match-end / drive the next round.
    if (!(await this.ownership.assertOwnership(matchId))) {
      this.logger.warn(
        `checkMatchEnd: assertOwnership failed for ${matchId} — not owner, aborting`,
      );
      return;
    }

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

    // B1.1: track the in-flight promise so concurrent callers (e.g.
    // `forceFinishMatchForDisband`) can `awaitFinish(matchId)` instead
    // of returning early and racing the in-flight persist. The wrapper
    // is registered AFTER `beginFinish` succeeds; resolved/rejected
    // inside the existing try/finally so the map entry is released
    // alongside the boolean guard.
    const finishPromise = this.runFinishTracked(matchId, roomId, server);
    this.timers.registerFinishPromise(matchId, finishPromise);
    await finishPromise;
  }

  private async runFinishTracked(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
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

  /**
   * Resolves when the in-flight `finishMatchLoop` for `matchId`
   * completes. Returns `Promise.resolve()` when no finish is in flight,
   * so callers can `await` unconditionally. Rejections from the natural
   * finish propagate to the awaiter.
   */
  awaitFinish(matchId: string): Promise<void> {
    return this.timers.awaitFinish(matchId);
  }

  private async finishMatchLoopInner(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // B2c fencing: only the owner finalizes the match.
    if (!(await this.ownership.assertOwnership(matchId))) {
      this.logger.warn(
        `finishMatchLoopInner: assertOwnership failed for ${matchId} — not owner, aborting`,
      );
      return;
    }

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

    // F6: Persist lần cuối, through the fenced CAS. B2c item 3: broadcast ONLY
    // after the canonical write lands — a RETRY means we lost the lease between
    // the assert and the write, so the new owner will finalize; skip finish+emit.
    const outcome = await this.matchService.persistStateMachine(matchId);
    if (outcome !== "APPLIED") {
      // Only a confirmed canonical write (APPLIED) authorizes the finish DB
      // update + MATCH_FINISHED broadcast. RETRY = lost the lease mid-finish;
      // BLIND = no ownership snapshot (must not finalize on an unfenced write).
      // Both defer to the owner rather than finish on unconfirmed state.
      this.logger.warn(
        `finishMatchLoopInner: fenced persist ${outcome} for ${matchId} — no confirmed canonical write, deferring finish/broadcast to the owner`,
      );
      return;
    }

    // 3. Persist match result to DB (updates room status, cleans memory + Redis).
    await this.matchService.finishMatch(matchId, winnerId, roomId, false);

    // 4. Broadcast MATCH_FINISHED
    emitMatchFinished(server, roomId, matchId, state, winnerId);

    // 5. Cleanup
    this.timers.disposeMatch(matchId);

    // B2b/B2c: release the owner lease + match:active index + in-memory owned
    // entry on natural completion, consistent with the kill-switch, disband, and
    // launch-rollback teardown paths. Without this the heartbeat would renew the
    // lease for a finished match forever, /health/cluster would keep listing it,
    // and B3b recovery could re-adopt it from match:active. Runs only after the
    // canonical write + DB finish succeeded above. release() is a no-op when this
    // node no longer owns the match, so it is safe if forceFinishMatchForDisband
    // already released.
    await this.ownership.release(matchId);

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

    // 5. Persist state machine. B2c: only broadcast the disconnect once the
    // canonical write lands — a non-APPLIED outcome (RETRY/BLIND = this node is
    // not the confirmed owner) means the mutation is not canonical, so skip the
    // broadcast rather than announce a disconnect the owner never recorded.
    const outcome = await this.matchService.persistStateMachine(matchId);
    if (outcome !== "APPLIED") {
      this.logger.warn(
        `handlePlayerDisconnect: persist ${outcome} for ${matchId} — no confirmed canonical write, skipping disconnect broadcast`,
      );
      return;
    }

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
