import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import { MatchStateMachine } from "@arena/game-core";
import {
  GAME_CONFIG,
  MatchStatus,
  RoomStatus,
  RoomError,
  ErrorCode,
} from "@arena/shared";
import { MatchService, type PersistOutcome } from "./match.service";
import { MatchOwnershipService } from "./match-ownership.service";
import { QuestionService } from "../question/question.service";
import { RoomService } from "./../room/room.service";
import { MatchTimerRegistry } from "./match-timer.registry";
import { emitMatchStarted, emitRoomStatusUpdated } from "./game-loop.helpers";
import {
  emitMatchFinished,
  emitPlayerEliminated,
  emitRoundEnded,
  emitRoundStarted,
  emitTopicVotingStarted,
  emitTopicVotingFinished,
} from "./game-loop.events";
import { recoverRoundEnd, type RoundEndContext } from "./match-round-recovery";
import {
  disconnectMatchPlayer,
  leaveMatchPlayer,
} from "./match-player-lifecycle";

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
    // B4b: drop the per-match command stream + applied-eventId set on natural
    // finish. Optional so unit tests that do not exercise the command channel
    // can omit it. GameLoopService wires deregisterMatch + disposeStream.
    private readonly disposeCommandStream?: (matchId: string) => Promise<void>,
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

    // F2: Init question tracking
    this.timers.initUsedQuestions(matchId);

    const room = await this.roomService.getRoom(roomId);
    const isAllCategory = !room.category || room.category === "ALL";

    if (isAllCategory) {
      const candidates = stateMachine.initTopicVoting();
      const startOutcome = await this.matchService.persistStateMachine(matchId);
      if (startOutcome !== "APPLIED") {
        this.logger.warn(
          `startMatchLoop: persist ${startOutcome} for ${matchId} — no confirmed canonical write, skipping TOPIC_VOTING broadcast`,
        );
        return;
      }

      emitTopicVotingStarted(
        server,
        roomId,
        matchId,
        candidates,
        stateMachine.getState().phaseEndsAt ??
          Date.now() + GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
        GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
      );

      this.armPhaseTimer(
        matchId,
        this.topicVotingTimerCallback(matchId, roomId, server),
        GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
      );
      return;
    }

    // 2. Transition to COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);

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
    // Arm the COUNTDOWN → executeRound transition on the shared, M5-safe
    // registration path. B3a: `resumeMatchLoop` re-arms the exact same
    // callback with a `remaining` derived from the persisted deadline, so
    // the live and recovered paths stay identical.
    this.armPhaseTimer(
      matchId,
      this.countdownTimerCallback(matchId, roomId, server),
      GAME_CONFIG.COUNTDOWN_DURATION_MS,
    );
  }

  // ============================================================
  // Phase-timer registration + callbacks (shared by the live loop
  // and B3a `resumeMatchLoop`)
  // ============================================================

  /**
   * Register a phase timer on the M5-safe path: the match's timer set is
   * created (`ensureMatch`) BEFORE `setTimeout` returns, closing the window
   * where `cancelMatchLoop` could iterate the set before the handle was
   * tracked. `remaining` is the ms delay — a fixed phase duration on the live
   * path, or the clamped persisted-deadline remainder on the resume path.
   * Mirrors `lobby-countdown.service.ts:armLobbyCountdownTimer`.
   */
  private armPhaseTimer(
    matchId: string,
    callback: () => void,
    remaining: number,
  ): void {
    const timerSet = this.timers.ensureMatch(matchId);
    const timer = setTimeout(callback, remaining);
    timerSet.add(timer);
  }

  /**
   * TOPIC_VOTING expiry: resolve banned topics, transition to COUNTDOWN, and arm countdown timer.
   */
  private topicVotingTimerCallback(
    matchId: string,
    roomId: string,
    server: Server,
  ): () => Promise<void> {
    return async () => {
      try {
        if (!(await this.ownership.assertOwnership(matchId))) {
          this.logger.warn(
            `topicVoting callback: assertOwnership failed for ${matchId} — not owner, aborting`,
          );
          return;
        }

        const sm = await this.matchService.getStateMachine(matchId);
        if (!sm) {
          this.logger.log(
            `topicVoting callback: state machine gone for match ${matchId}`,
          );
          return;
        }
        this.logger.log(`Topic voting ended for match ${matchId}`);
        const result = sm.resolveTopicVoting();
        sm.transition(MatchStatus.COUNTDOWN);

        const persistOutcome =
          await this.matchService.persistStateMachine(matchId);
        if (persistOutcome !== "APPLIED") {
          this.logger.warn(
            `topicVoting callback: persistStateMachine returned ${persistOutcome} for ${matchId}, returning without publishing state`,
          );
          return;
        }

        emitTopicVotingFinished(
          server,
          roomId,
          matchId,
          result.bannedTopics,
          result.activeTopics,
          result.voteCounts,
        );

        emitMatchStarted(
          server,
          roomId,
          matchId,
          MatchStatus.COUNTDOWN,
          GAME_CONFIG.COUNTDOWN_DURATION_MS,
        );

        this.executeCountdown(matchId, roomId, server);
      } catch (error) {
        this.logger.error(
          `Failed to resolve topic voting for match ${matchId}:`,
          error,
        );
      }
    };
  }

  /**
   * COUNTDOWN expiry: advance the match into its first/next round.
   * Defence-in-depth (M5): re-check the state machine still exists — the
   * match may have been torn down between the timer firing and this line.
   */
  private countdownTimerCallback(
    matchId: string,
    roomId: string,
    server: Server,
  ): () => Promise<void> {
    return async () => {
      try {
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
    };
  }

  /** ROUND_ACTIVE expiry: end the round when the 15s window elapses. */
  private roundEndTimerCallback(
    matchId: string,
    roomId: string,
    server: Server,
  ): () => Promise<void> {
    return async () => {
      try {
        await this.endRound(matchId, roomId, server);
        /* c8 ignore next 6 */
      } catch (error) {
        this.logger.error(
          `Error in endRound timeout callback for match ${matchId}:`,
          error,
        );
      }
    };
  }

  /** ROUND_RESULT expiry: decide match-end / drive the next round. */
  private matchEndCheckCallback(
    matchId: string,
    roomId: string,
    server: Server,
  ): () => Promise<void> {
    return async () => {
      try {
        await this.checkMatchEnd(matchId, roomId, server);
        /* c8 ignore next 6 */
      } catch (error) {
        this.logger.error(
          `Error in checkMatchEnd timeout callback for match ${matchId}:`,
          error,
        );
      }
    };
  }

  // ============================================================
  // B3a: resume a running match from persisted state
  // ============================================================

  /**
   * Rebuild the in-memory runtime for a match this node just acquired the
   * lease for (boot or takeover — B3b is the caller) and arm the correct next
   * timer from persisted state. No new Redis keys.
   *
   * The caller (B3b) supplies the already-hydrated + revalidated state
   * machine: it acquires the lease, hydrates from the canonical `match:state`
   * blob, performs the final revalidation, and only then calls this. We do NOT
   * re-hydrate here — a second `getStateMachine` would reopen the TOCTOU
   * between B3b's revalidation and the timer arm. Undefined/missing state and
   * the `ownership.release` for it live at the caller; this method may assume a
   * valid hydrated state machine.
   */
  async resumeMatchLoop(
    matchId: string,
    hydratedSm: MatchStateMachine,
    roomId: string,
    server: Server,
  ): Promise<void> {
    const state = hydratedSm.getState();

    // F2: rebuild the used-question set from the event log — the one piece of
    // in-memory runtime not carried in state. Without it a resumed match could
    // re-serve a question it already used (breaks the F2 anti-repeat contract).
    this.timers.initUsedQuestions(matchId);
    for (const entry of hydratedSm.getEventLog()) {
      if (entry.type !== "ROUND_STARTED") continue;
      const questionId = (entry.payload as { questionId?: unknown })
        ?.questionId;
      if (typeof questionId === "string") {
        this.timers.markQuestionUsed(matchId, questionId);
      }
    }

    // Restore the early-termination expected-answer count if we resume mid-round.
    if (state.status === MatchStatus.ROUND_ACTIVE) {
      this.timers.setExpectedAnswers(matchId, state.survivingPlayerIds.length);
    }

    // Arm the next timer from status + the persisted deadline.
    switch (state.status) {
      case MatchStatus.TOPIC_VOTING:
        this.armPhaseTimer(
          matchId,
          this.topicVotingTimerCallback(matchId, roomId, server),
          this.resumePhaseRemaining(
            hydratedSm,
            MatchStatus.TOPIC_VOTING,
            GAME_CONFIG.TOPIC_VOTING_DURATION_MS,
          ),
        );
        return;
      case MatchStatus.COUNTDOWN:
        this.armPhaseTimer(
          matchId,
          this.countdownTimerCallback(matchId, roomId, server),
          this.resumePhaseRemaining(
            hydratedSm,
            MatchStatus.COUNTDOWN,
            GAME_CONFIG.COUNTDOWN_DURATION_MS,
          ),
        );
        return;
      case MatchStatus.ROUND_ACTIVE:
        this.armPhaseTimer(
          matchId,
          this.roundEndTimerCallback(matchId, roomId, server),
          this.resumePhaseRemaining(
            hydratedSm,
            MatchStatus.ROUND_ACTIVE,
            GAME_CONFIG.ROUND_DURATION_MS,
          ),
        );
        return;
      case MatchStatus.ROUND_EVALUATING:
        // Mid-evaluation on the previous owner: finish the round now via the
        // recovered path (endRound → handleRecoveredRoundEnd).
        await this.endRound(matchId, roomId, server);
        return;
      case MatchStatus.ROUND_RESULT:
        this.armPhaseTimer(
          matchId,
          this.matchEndCheckCallback(matchId, roomId, server),
          this.resumePhaseRemaining(
            hydratedSm,
            MatchStatus.ROUND_RESULT,
            GAME_CONFIG.RESULT_DISPLAY_MS,
          ),
        );
        return;
      case MatchStatus.FINISHED:
        // Already finished before we took over: nothing to drive. Drop the
        // in-memory runtime and release the lease so the heartbeat stops
        // renewing it and B3b recovery never re-adopts it from match:active.
        // Also drop match:cmd / match:applied so the consumer does not keep
        // polling a terminal match.
        this.timers.disposeMatch(matchId);
        await this.ownership.release(matchId);
        if (this.disposeCommandStream) {
          await this.disposeCommandStream(matchId);
        }
        return;
      default:
        // WAITING or any non-timed status: nothing to arm. Drop runtime
        // (used-question set was rebuilt above), command consumer, and lease
        // so a leaked registration/ownership cannot poll forever.
        this.logger.warn(
          `resumeMatchLoop: unexpected status ${state.status} for match ${matchId}, arming nothing`,
        );
        this.timers.disposeMatch(matchId);
        try {
          if (this.disposeCommandStream) {
            await this.disposeCommandStream(matchId);
          }
        } finally {
          await this.ownership.release(matchId);
        }
        return;
    }
  }

  /**
   * `remaining` ms until the current phase's deadline, clamped to
   * `[0, phaseMax]`. B3a fail-closed contract for a RESUMED phase: never grant
   * a fresh full `phaseMax` (that would silently extend a deadline that has
   * partly/fully elapsed). Use the canonical `phaseEndsAt`; if it is absent —
   * which B1b/B1c should make impossible — reconstruct from the persisted
   * phase-start anchor, and only if no anchor exists at all fire immediately
   * (`0`) rather than re-arming the whole window.
   */
  private resumePhaseRemaining(
    hydratedSm: MatchStateMachine,
    status: MatchStatus,
    phaseMax: number,
  ): number {
    const deadline = this.resolvePhaseDeadline(hydratedSm, status);
    if (deadline === null) {
      return 0;
    }
    return Math.min(Math.max(deadline - Date.now(), 0), phaseMax);
  }

  /**
   * The canonical epoch-ms deadline for `status`. Prefers `state.phaseEndsAt`
   * (B1b sets it on every transition; B1c backfills v1 blobs). Falls back to
   * the persisted phase-start anchor when it is somehow absent; returns null
   * when no anchor is reconstructable (caller then fires immediately).
   */
  private resolvePhaseDeadline(
    hydratedSm: MatchStateMachine,
    status: MatchStatus,
  ): number | null {
    const state = hydratedSm.getState();
    if (
      typeof state.phaseEndsAt === "number" &&
      Number.isFinite(state.phaseEndsAt)
    ) {
      return state.phaseEndsAt;
    }

    switch (status) {
      case MatchStatus.ROUND_ACTIVE: {
        const round = hydratedSm.getCurrentRound();
        return round && Number.isFinite(round.endsAt) ? round.endsAt : null;
      }
      case MatchStatus.TOPIC_VOTING:
        return typeof state.startedAt === "number" &&
          Number.isFinite(state.startedAt)
          ? state.startedAt + GAME_CONFIG.TOPIC_VOTING_DURATION_MS
          : null;
      case MatchStatus.COUNTDOWN:
        return typeof state.startedAt === "number" &&
          Number.isFinite(state.startedAt)
          ? state.startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS
          : null;
      case MatchStatus.ROUND_RESULT:
        return typeof state.roundResultStartedAt === "number" &&
          Number.isFinite(state.roundResultStartedAt)
          ? state.roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS
          : null;
      default:
        return null;
    }
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
      const state = stateMachine.getState();
      const allowedCategories =
        state.activeTopics && state.activeTopics.length > 0
          ? state.activeTopics
          : undefined;
      question = allowedCategories
        ? await this.questionService.getRandom(
            undefined,
            excludeIds,
            undefined,
            allowedCategories,
          )
        : await this.questionService.getRandom(undefined, excludeIds);
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

    // 6. Set 15s timer → endRound (shared registration path with resume).
    this.armPhaseTimer(
      matchId,
      this.roundEndTimerCallback(matchId, roomId, server),
      GAME_CONFIG.ROUND_DURATION_MS,
    );
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
    return recoverRoundEnd(
      { logger: this.logger, questionService: this.questionService },
      matchId,
      stateMachine,
      state,
      round,
    );
  }

  private async scheduleMatchEndCheck(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    this.armPhaseTimer(
      matchId,
      this.matchEndCheckCallback(matchId, roomId, server),
      GAME_CONFIG.RESULT_DISPLAY_MS,
    );
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

    // B4b: stop the command consumer + drop match:cmd / match:applied so a
    // finished match does not leave a polling consumer and Redis keys behind.
    // Mirrors stopRoomRuntime / forceFinishMatchForDisband cleanup.
    if (this.disposeCommandStream) {
      await this.disposeCommandStream(matchId);
    }

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
   *
   * Return contract (B5 hardening — symmetric with `submit_answer`):
   *   - "APPLIED" — fenced persist landed; PLAYER_LEFT broadcast.
   *   - "NOOP"    — pre-conditions failed (no state machine, unknown player);
   *                 nothing to persist, ackable as a no-op.
   *   - "RETRY" / "BLIND" — persist was NOT canonical (lease lost / fence bumped);
   *                 broadcast was skipped, the caller MUST NOT XACK so the next
   *                 owner re-evaluates. The command-stream wrapper maps this to
   *                 a "RETRY" CommandOutcome; the owner-local path ignores the
   *                 return value.
   */
  async handlePlayerDisconnect(
    matchId: string,
    userId: string,
    server: Server,
  ): Promise<PersistOutcome | "NOOP"> {
    return disconnectMatchPlayer(
      { logger: this.logger, matchService: this.matchService },
      matchId,
      userId,
      server,
    );
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
    return leaveMatchPlayer(
      { logger: this.logger, matchService: this.matchService },
      matchId,
      roomId,
      userId,
      server,
      reason,
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
