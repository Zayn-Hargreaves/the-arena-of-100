import { Injectable, Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  GAME_CONFIG,
  MatchStatus,
  PlayerStatus,
  ServerEvent,
  getRoomChannel,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";

@Injectable()
export class GameLoopService {
  private readonly logger = new Logger(GameLoopService.name);
  private activeTimers = new Map<string, Set<NodeJS.Timeout>>();
  // F2: Track used question IDs per match to avoid repeats
  private usedQuestionIds = new Map<string, Set<string>>();
  // Add property for early termination (used by Task 7)
  private expectedAnswers = new Map<string, number>();

  constructor(
    private readonly matchService: MatchService,
    private readonly questionService: QuestionService,
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
      return;
    }

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
    await this.executeCountdown(matchId, roomId, server);
  }

  // ============================================================
  // PHASE 1: COUNTDOWN (5 seconds)
  // ============================================================

  private async executeCountdown(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        this.logger.log(`Countdown ended for match ${matchId}`);
        await this.executeRound(matchId, roomId, server);
        resolve();
      }, GAME_CONFIG.COUNTDOWN_DURATION_MS);

      this.addTimer(matchId, timer);
    });
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
      await this.endRound(matchId, roomId, server);
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
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

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
    const state = stateMachine.getState();
    const currentRound = stateMachine.getCurrentRound()!;
    const roundRecord = await this.matchService.saveRound(
      matchId,
      state.currentRoundNo,
      currentRound.question.id,
    );
    // F5: roundRecord.id is available from Prisma create return
    for (const [playerId, answer] of currentRound.answers) {
      await this.matchService.saveAnswer(
        matchId,
        roundRecord.id,
        playerId,
        answer.answer,
        answer.isCorrect,
        answer.responseTimeMs,
      );
    }

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
        playerId,
        playerName: player.name,
        reason: currentRound.answers.has(playerId) ? "WRONG_ANSWER" : "TIMEOUT",
      });
    }

    // 9. Set 3s timer → checkMatchEnd
    const timer = setTimeout(async () => {
      await this.checkMatchEnd(matchId, roomId, server);
    }, GAME_CONFIG.RESULT_DISPLAY_MS);
    this.addTimer(matchId, timer);
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
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) return;

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

    // 3. Get roomId from state.roomId
    const roomId = state.roomId;

    // 4. Mark player as DISCONNECTED in state machine (update player.status and player.isOnline)
    const player = state.players.get(userId);
    if (player) {
      player.status = PlayerStatus.DISCONNECTED;
      player.isOnline = false;
    }

    // 5. Persist state machine
    await this.matchService.persistStateMachine(matchId);

    // 6. Broadcast PLAYER_LEFT with reason field
    const channel = getRoomChannel(roomId);
    server.to(channel).emit(ServerEvent.PLAYER_LEFT, {
      matchId,
      playerId: userId,
      playerName: player?.name || "Unknown Player",
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
