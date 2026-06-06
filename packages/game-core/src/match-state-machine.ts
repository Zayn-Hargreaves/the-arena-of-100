// ============================================================
// Match State Machine - Game Đấu Trường 100
// State Pattern: Encapsulates match state transitions
// ============================================================

import {
  MatchStatus,
  PlayerStatus,
  type MatchState,
  type PlayerInfo,
  type RoundState,
  type AnswerState,
  GAME_CONFIG,
  ErrorCode,
} from "@arena/shared";
import { computeRoundScore } from "./scoring";
interface DeserializedMatch {
  state: {
    id: string;
    roomId: string;
    status: MatchStatus;
    currentRoundNo: number;
    totalRounds: number;
    players: [string, PlayerInfo][];
    survivingPlayerIds: string[];
    eliminatedPlayerIds: string[];
    winnerId: string | null;
    startedAt: number;
    endedAt: number | null;
  };
  currentRound:
    | (RoundState & { correctAnswer: string; answers: [string, AnswerState][] })
    | null;
  eventLog: { type: string; payload?: unknown; timestamp: number }[];
}

// State Transition Handler (Strategy Pattern)
export interface StateTransitionHandler {
  canTransition(from: MatchStatus, to: MatchStatus): boolean;
  onEnter(matchState: MatchState): void;
  onExit(matchState: MatchState): void;
}

// Valid State Transitions
const VALID_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  [MatchStatus.CREATED]: [MatchStatus.COUNTDOWN],
  [MatchStatus.COUNTDOWN]: [MatchStatus.ROUND_ACTIVE, MatchStatus.FINISHED],
  [MatchStatus.ROUND_ACTIVE]: [
    MatchStatus.ROUND_EVALUATING,
    MatchStatus.FINISHED,
  ],
  [MatchStatus.ROUND_EVALUATING]: [
    MatchStatus.ROUND_RESULT,
    MatchStatus.FINISHED,
  ],
  [MatchStatus.ROUND_RESULT]: [MatchStatus.ROUND_ACTIVE, MatchStatus.FINISHED],
  [MatchStatus.FINISHED]: [],
};

// Match State Machine
export class MatchStateMachine {
  private state: MatchState;
  private currentRound: RoundState | null = null;
  private eventLog: Array<{
    type: string;
    payload?: unknown;
    timestamp: number;
  }> = [];

  constructor(matchId: string, roomId: string, players: PlayerInfo[]) {
    this.state = {
      id: matchId,
      roomId,
      status: MatchStatus.CREATED,
      currentRoundNo: 0,
      totalRounds: 0,
      players: new Map(players.map((p) => [p.id, { ...p }])),

      survivingPlayerIds: players.map((p) => p.id),
      eliminatedPlayerIds: [],
      winnerId: null,
      startedAt: 0,
      endedAt: null,
    };
  }

  // State Accessor (deep clone Maps to prevent external mutation)
  getState(): Readonly<MatchState> {
    return {
      ...this.state,
      players: new Map(
        Array.from(this.state.players.entries()).map(([id, p]) => [
          id,
          { ...p },
        ]),
      ),
      survivingPlayerIds: [...this.state.survivingPlayerIds],
      eliminatedPlayerIds: [...this.state.eliminatedPlayerIds],
    };
  }

  getCurrentRound(): Readonly<RoundState> | null {
    if (!this.currentRound) return null;
    return {
      ...this.currentRound,
      question: {
        ...this.currentRound.question,
        options: [...this.currentRound.question.options],
      },
      answers: new Map(
        Array.from(this.currentRound.answers.entries()).map(
          ([playerId, answer]) => [playerId, { ...answer }],
        ),
      ),
    };
  }

  // Validate Transition (Guard)
  canTransition(to: MatchStatus): boolean {
    return VALID_TRANSITIONS[this.state.status]?.includes(to) ?? false;
  }

  // Execute Transition
  transition(to: MatchStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid transition: ${this.state.status} -> ${to}`);
    }

    this.logEvent("STATE_TRANSITION", {
      from: this.state.status,
      to,
    });

    this.state.status = to;

    // Handle specific transitions
    switch (to) {
      case MatchStatus.COUNTDOWN:
        this.state.startedAt = Date.now();
        break;
      case MatchStatus.FINISHED:
        this.state.endedAt = Date.now();
        break;
    }
  }

  // Start New Round
  startRound(
    question: {
      id: string;
      content: string;
      options: string[];
      correctAnswer: string;
      difficulty?: "EASY" | "MEDIUM" | "HARD";
    },
    roundDurationMs?: number,
  ): RoundState {
    if (this.state.status !== MatchStatus.ROUND_ACTIVE) {
      throw new Error("Cannot start round: match is not in ROUND_ACTIVE state");
    }

    this.state.currentRoundNo++;
    this.state.totalRounds = Math.max(
      this.state.totalRounds,
      this.state.currentRoundNo,
    );

    const now = Date.now();
    this.currentRound = {
      matchId: this.state.id,
      roundNo: this.state.currentRoundNo,
      question: {
        id: question.id,
        content: question.content,
        options: question.options,
        difficulty: question.difficulty ?? "MEDIUM", // Default to MEDIUM if not provided
      },
      startedAt: now,
      endsAt: now + (roundDurationMs ?? GAME_CONFIG.ROUND_DURATION_MS),
      answers: new Map(),
      status: "ACTIVE",
      correctAnswer: question.correctAnswer,
    } as RoundState & { correctAnswer: string };

    this.logEvent("ROUND_STARTED", {
      roundNo: this.state.currentRoundNo,
      questionId: question.id,
    });

    return this.currentRound;
  }

  // Submit Answer (Command Pattern)
  submitAnswer(
    playerId: string,
    answer: string,
    serverTimestamp: number,
  ): AnswerState {
    if (!this.currentRound || this.currentRound.status !== "ACTIVE") {
      throw new Error(ErrorCode.ROUND_NOT_ACTIVE);
    }

    if (this.currentRound.answers.has(playerId)) {
      throw new Error(ErrorCode.ALREADY_ANSWERED);
    }

    if (serverTimestamp > this.currentRound.endsAt) {
      throw new Error(ErrorCode.ANSWER_SUBMISSION_CLOSED);
    }

    const player = this.state.players.get(playerId);
    if (!player || player.status !== PlayerStatus.ACTIVE) {
      throw new Error(ErrorCode.PLAYER_NOT_IN_ROOM);
    }

    const roundWithAnswer = this.currentRound as RoundState & {
      correctAnswer: string;
    };
    const isCorrect = answer === roundWithAnswer.correctAnswer;
    const responseTimeMs = serverTimestamp - this.currentRound.startedAt;

    const answerState: AnswerState = {
      playerId,
      answer,
      isCorrect,
      responseTimeMs,
      submittedAt: serverTimestamp,
    };

    this.currentRound.answers.set(playerId, answerState);

    this.logEvent("ANSWER_SUBMITTED", {
      playerId,
      isCorrect,
      responseTimeMs,
    });

    return answerState;
  }

  // Evaluate Round Results
  evaluateRound(): {
    survivingIds: string[];
    eliminatedIds: string[];
    correctAnswer: string;
  } {
    if (!this.currentRound) {
      throw new Error("No active round to evaluate");
    }

    this.currentRound.status = "EVALUATING";

    const roundWithAnswer = this.currentRound as RoundState & {
      correctAnswer: string;
    };
    const correctAnswer = roundWithAnswer.correctAnswer;
    const survivingIds: string[] = [];
    const eliminatedIds: string[] = [];

    // Check each surviving player
    for (const playerId of this.state.survivingPlayerIds) {
      const answer = this.currentRound.answers.get(playerId);

      // No answer or wrong answer = eliminated
      if (!answer || !answer.isCorrect) {
        eliminatedIds.push(playerId);
        const player = this.state.players.get(playerId);
        if (player) {
          player.status = PlayerStatus.ELIMINATED;
        }
      } else {
        survivingIds.push(playerId);
        // Update player stats
        const player = this.state.players.get(playerId);
        if (player) {
          player.correctAnswers++;
          player.totalResponseTimeMs += answer.responseTimeMs;
          // B2: Accumulate score = base + speed bonus (floored to int for DB Int column)
          const roundScore = computeRoundScore(answer.responseTimeMs);
          player.score += Math.floor(roundScore.total);
        }
      }
    }

    // Update state
    this.state.survivingPlayerIds = survivingIds;
    this.state.eliminatedPlayerIds.push(...eliminatedIds);

    this.currentRound.status = "COMPLETED";

    this.logEvent("ROUND_EVALUATED", {
      roundNo: this.currentRound.roundNo,
      survivingCount: survivingIds.length,
      eliminatedCount: eliminatedIds.length,
    });

    return { survivingIds, eliminatedIds, correctAnswer };
  }

  // Check if match should end
  shouldEndMatch(): boolean {
    return this.state.survivingPlayerIds.length <= 1;
  }

  // Determine winner (includes tie-break logic)
  determineWinner(): string {
    const survivors = this.state.survivingPlayerIds;

    if (survivors.length === 1) {
      return survivors[0];
    }

    if (survivors.length === 0) {
      // Edge case: all eliminated at once
      // Winner is last player with best stats
      return this.tieBreak(this.state.eliminatedPlayerIds);
    }

    // Multiple survivors at end - apply tie-break
    return this.tieBreak(survivors);
  }

  // Tie-break Logic (Strategy Pattern)
  private tieBreak(playerIds: string[]): string {
    // Sort by total response time (ascending = faster is better)
    const sorted = [...playerIds].sort((a, b) => {
      const playerA = this.state.players.get(a)!;
      const playerB = this.state.players.get(b)!;

      // First: compare total response time
      if (playerA.totalResponseTimeMs !== playerB.totalResponseTimeMs) {
        return playerA.totalResponseTimeMs - playerB.totalResponseTimeMs;
      }

      // Second: compare correct answers count
      if (playerA.correctAnswers !== playerB.correctAnswers) {
        return playerB.correctAnswers - playerA.correctAnswers;
      }

      // Third: random (fallback)
      return Math.random() - 0.5;
    });

    const winnerId = sorted[0];

    this.logEvent("TIE_BREAK", {
      winnerId,
      tiedPlayerIds: playerIds,
    });

    return winnerId;
  }

  // Finish Match
  finishMatch(): void {
    const winnerId = this.determineWinner();

    // Set winner status
    const winner = this.state.players.get(winnerId);
    if (winner) {
      winner.status = PlayerStatus.WINNER;
    }

    this.state.winnerId = winnerId;
    this.state.endedAt = Date.now();

    this.logEvent("MATCH_FINISHED", {
      winnerId,
      totalRounds: this.state.totalRounds,
    });
  }

  // Mark player as disconnected inside the state machine
  disconnectPlayer(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (player) {
      player.isOnline = false;

      const currentStatus = player.status;
      if (
        currentStatus !== PlayerStatus.ELIMINATED &&
        currentStatus !== PlayerStatus.WINNER
      ) {
        if (currentStatus !== PlayerStatus.DISCONNECTED) {
          player.status = PlayerStatus.DISCONNECTED;
          this.logEvent("PLAYER_DISCONNECTED", { playerId });
        }
      }
    }
  }

  // Mark player as active/reconnected inside the state machine
  reconnectPlayer(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (player) {
      const priorStatus = player.status;
      const priorIsOnline = player.isOnline;

      const isOnlineToggled = !priorIsOnline;
      const statusTransitionsToActive =
        priorStatus === PlayerStatus.DISCONNECTED;

      if (statusTransitionsToActive || isOnlineToggled) {
        player.isOnline = true;
        if (statusTransitionsToActive) {
          player.status = PlayerStatus.ACTIVE;
        }
        this.logEvent("PLAYER_RECONNECTED", { playerId });
      }
    }
  }

  // Get accumulated scores for all players (B2: for DB persistence at match end)
  getPlayerScores(): Array<{ userId: string; score: number }> {
    return Array.from(this.state.players.entries()).map(([userId, p]) => ({
      userId,
      score: p.score,
    }));
  }

  // Get Match Snapshot (for reconnect)
  getSnapshot(lastEventSeqNo: number): {
    matchId: string;
    status: MatchStatus;
    currentRoundNo: number;
    players: PlayerInfo[];
    currentQuestion: { id: string; content: string; options: string[] } | null;
    roundEndTime: number | null;
    lastEventSeqNo: number;
  } {
    return {
      matchId: this.state.id,
      status: this.state.status,
      currentRoundNo: this.state.currentRoundNo,
      players: Array.from(this.state.players.values()),
      currentQuestion: this.currentRound?.question ?? null,
      roundEndTime: this.currentRound?.endsAt ?? null,
      lastEventSeqNo,
    };
  }

  // Event Logger
  private logEvent(type: string, payload: unknown): void {
    this.eventLog.push({
      type,
      payload,
      timestamp: Date.now(),
    });
  }

  getEventLog(): ReadonlyArray<{
    type: string;
    payload?: unknown;
    timestamp: number;
  }> {
    return this.eventLog.map((e) => structuredClone(e));
  }

  // Serialize state to JSON string for Redis persistence
  serialize(): string {
    const roundData = this.currentRound
      ? {
          ...this.currentRound,
          answers: Array.from(this.currentRound.answers.entries()),
          correctAnswer: (
            this.currentRound as RoundState & { correctAnswer: string }
          ).correctAnswer,
        }
      : null;

    return JSON.stringify({
      state: {
        ...this.state,
        players: Array.from(this.state.players.entries()),
      },
      currentRound: roundData,
      eventLog: this.eventLog,
    });
  }

  // Restore MatchStateMachine from serialized JSON string
  static deserialize(json: string): MatchStateMachine {
    let data: unknown;

    try {
      data = JSON.parse(json);
    } catch (error) {
      throw new Error(
        `Failed to parse MatchStateMachine JSON: ${error instanceof Error ? error.message : String(error)} (payload omitted; length=${json.length})`,
      );
    }

    const parsed = data as DeserializedMatch;
    if (
      !parsed ||
      !parsed.state ||
      !Array.isArray(parsed.state.players) ||
      !Array.isArray(parsed.eventLog)
    ) {
      throw new Error(
        `Invalid MatchStateMachine data (payload omitted; length=${json.length})`,
      );
    }
    if (parsed.currentRound) {
      const cr = parsed.currentRound;
      const isValidQuestion =
        cr.question &&
        typeof cr.question === "object" &&
        typeof cr.question.id === "string" &&
        typeof cr.question.content === "string" &&
        Array.isArray(cr.question.options);

      const isValidStatus =
        typeof cr.status === "string" &&
        ["PENDING", "ACTIVE", "EVALUATING", "COMPLETED"].includes(cr.status);

      if (
        typeof cr.correctAnswer !== "string" ||
        !Array.isArray(cr.answers) ||
        !isValidQuestion ||
        typeof cr.startedAt !== "number" ||
        typeof cr.endsAt !== "number" ||
        typeof cr.roundNo !== "number" ||
        !isValidStatus
      ) {
        throw new Error(
          `Invalid MatchStateMachine data (payload omitted; length=${json.length})`,
        );
      }
    }
    const instance = new MatchStateMachine("", "", []);

    instance.state = {
      ...parsed.state,
      players: new Map(parsed.state.players),
    } as MatchState;

    if (parsed.currentRound) {
      const { answers, ...rest } = parsed.currentRound;
      instance.currentRound = {
        ...rest,
        answers: new Map(answers),
      } as RoundState & { correctAnswer: string };
    } else {
      instance.currentRound = null;
    }

    instance.eventLog = parsed.eventLog;

    return instance;
  }
}
