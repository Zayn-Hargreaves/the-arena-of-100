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
  RoomError,
} from "@arena/shared";
import { computeRoundScore } from "./scoring";
import { resolveTieBreak } from "./tie-break";
import { serializeMatch, deserializeMatch } from "./match-state.codec";
import {
  eliminationsForRound,
  UNAVAILABLE,
  type RoundStartingPlayers,
} from "./round-elimination";

type RoundRuntimeState = RoundState & {
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
};

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
  private currentRound: RoundRuntimeState | null = null;
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
    const round = {
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
    } as RoundRuntimeState;

    if (Array.isArray(this.currentRound.startingPlayers)) {
      round.startingPlayers = [...this.currentRound.startingPlayers];
    } else if (this.currentRound.startingPlayers === UNAVAILABLE) {
      round.startingPlayers = UNAVAILABLE;
    }

    return round;
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
      startingPlayers: [...this.state.survivingPlayerIds],
      correctAnswer: question.correctAnswer,
    } as RoundRuntimeState;

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
    submissionId?: string,
  ): AnswerState {
    if (!this.currentRound) {
      throw new RoomError(ErrorCode.ROUND_NOT_ACTIVE);
    }

    const existingAnswer = this.currentRound.answers.get(playerId);
    if (existingAnswer) {
      if (submissionId && existingAnswer.submissionId === submissionId) {
        // Return a shallow copy so the caller cannot mutate the
        // live entry inside `currentRound.answers`. This matches
        // the defensive-copy pattern used by `getCurrentRound()`.
        return { ...existingAnswer };
      }
      throw new RoomError(ErrorCode.ALREADY_ANSWERED);
    }

    if (this.currentRound.status !== "ACTIVE") {
      throw new RoomError(ErrorCode.ROUND_NOT_ACTIVE);
    }

    if (serverTimestamp > this.currentRound.endsAt) {
      throw new RoomError(ErrorCode.ANSWER_SUBMISSION_CLOSED);
    }

    const player = this.state.players.get(playerId);
    if (!player || player.status !== PlayerStatus.ACTIVE) {
      throw new RoomError(ErrorCode.PLAYER_NOT_IN_ROOM);
    }

    const roundWithAnswer = this.currentRound as RoundRuntimeState & {
      correctAnswer: string;
    };
    const isCorrect = answer === roundWithAnswer.correctAnswer;

    // M1 fix: clamp responseTimeMs to a non-negative value. A
    // negative response would come from server clock skew (NTP
    // correction during a long match: serverTimestamp briefly
    // predates round.startedAt). Previously the negative value
    // flowed into computeRoundScore, whose internal `Math.max(0,
    // responseTimeMs)` masked the bug — but the raw value was
    // still stored on the AnswerState, persisted to DB, and used
    // in totalResponseTimeMs sums. Clamp here so downstream
    // observers (DB columns, leaderboard stats, tie-break) all see
    // a sensible non-negative duration.
    const responseTimeMs = Math.max(
      0,
      serverTimestamp - this.currentRound.startedAt,
    );

    const answerState: AnswerState = {
      playerId,
      answer,
      submissionId: submissionId ?? `legacy-${playerId}-${serverTimestamp}`,
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

    const roundWithAnswer = this.currentRound as RoundRuntimeState & {
      correctAnswer: string;
    };
    const correctAnswer = roundWithAnswer.correctAnswer;
    const survivingIds: string[] = [];
    const startingPlayers = Array.isArray(roundWithAnswer.startingPlayers)
      ? roundWithAnswer.startingPlayers
      : [...this.state.survivingPlayerIds];
    const eliminatedIds = eliminationsForRound({
      ...this.currentRound,
      correctAnswer,
      startingPlayers,
    });
    const eliminatedSet = new Set(eliminatedIds);

    // Check each surviving player
    for (const playerId of startingPlayers) {
      const answer = this.currentRound.answers.get(playerId);

      // No answer or wrong answer = eliminated
      if (eliminatedSet.has(playerId)) {
        const player = this.state.players.get(playerId);
        if (player) {
          player.status = PlayerStatus.ELIMINATED;
        }
      } else {
        survivingIds.push(playerId);
        const correctAnswerState = answer!;
        // Update player stats
        const player = this.state.players.get(playerId);
        if (player) {
          player.correctAnswers++;
          player.totalResponseTimeMs += correctAnswerState.responseTimeMs;
          // B2: Accumulate score = base + speed bonus (floored to int for DB Int column)
          const roundScore = computeRoundScore(
            correctAnswerState.responseTimeMs,
          );
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
      eliminatedIds,
    });

    return { survivingIds, eliminatedIds, correctAnswer };
  }

  // Check if match should end
  //
  // H5 fix: also enforce GAME_CONFIG.MAX_ROUNDS. The previous
  // implementation only checked `survivingPlayerIds.length <= 1`,
  // so a match with slow players (or many timeouts) could run
  // indefinitely until the Redis TTL expired (H5's other half).
  // MAX_ROUNDS is a hard safety cap: once we hit it, the match
  // ends even if more than 1 player is still alive.
  shouldEndMatch(maxRounds?: number): boolean {
    if (this.state.survivingPlayerIds.length <= 1) return true;
    if (maxRounds !== undefined && this.state.currentRoundNo >= maxRounds) {
      return true;
    }
    return false;
  }

  // Determine winner (includes tie-break logic)
  //
  // B2 fix: return type widened from `string` to `string | null`. The
  // previous code returned `undefined` (typed as `string`, which TS
  // was hiding via the caller's non-null assertion) when BOTH
  // survivingPlayerIds and eliminatedPlayerIds were empty. This is a
  // reachable state during forced terminations or the corner case
  // where every player is removed before any answer. We now return
  // an explicit `null` so callers can store + emit + persist the
  // "no winner" case without lying to the type system.
  determineWinner(): string | null {
    const survivors = this.state.survivingPlayerIds;

    if (survivors.length === 1) {
      return survivors[0];
    }

    if (survivors.length === 0) {
      // Edge case: all eliminated at once
      // Winner is last player with best stats
      if (this.state.eliminatedPlayerIds.length === 0) {
        // Empty-roster path. tieBreak([]) would also return null
        // now (B2 fix) but we short-circuit here so we don't pay
        // for a sort and a seeded RNG on a list we know is empty.
        return null;
      }
      return this.tieBreak(this.state.eliminatedPlayerIds);
    }

    // Multiple survivors at end - apply tie-break
    return this.tieBreak(survivors);
  }

  // Tie-break Logic — delegates to the pure `resolveTieBreak`
  // (see ./tie-break.ts). The state machine only owns the event-log
  // side effect: the deterministic ordering + seeding lives in the
  // extracted pure function so it can be unit-tested in isolation and
  // is the low-blast-radius Strategy seam noted in the memory-bank.
  //
  // B2 fix: return type is `string | null`; the empty-roster case
  // returns `null` WITHOUT logging a TIE_BREAK event (there was no
  // tie to break), matching the original behaviour that downstream
  // code (finishMatchLoop → matchService.finishMatch → Prisma) relies
  // on to persist the explicit "no winner" signal.
  private tieBreak(playerIds: string[]): string | null {
    if (playerIds.length === 0) {
      return null;
    }

    const winnerId = resolveTieBreak(
      playerIds,
      this.state.players,
      this.state.id,
    );

    this.logEvent("TIE_BREAK", {
      winnerId,
      tiedPlayerIds: playerIds,
    });

    return winnerId;
  }

  // Finish Match
  //
  // B2 fix: `determineWinner` may now return `null` (empty-roster
  // path). The previous code unconditionally dereferenced the
  // returned id with `this.state.players.get(winnerId)` and called
  // `winner.status = PlayerStatus.WINNER` — both of which would
  // throw `TypeError: Cannot read properties of null` on the
  // empty-roster path. We now skip the WINNER promotion when no
  // winner is resolved, log an event, and store `null` in
  // `state.winnerId` so the wire payload and Prisma update both
  // carry the explicit "no winner" signal.
  finishMatch(): void {
    const winnerId = this.determineWinner();

    if (winnerId !== null) {
      // Set winner status
      const winner = this.state.players.get(winnerId);
      if (winner) {
        winner.status = PlayerStatus.WINNER;
      }
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

  // Serialize state to JSON string for Redis persistence. Delegates
  // to the pure `serializeMatch` codec (see ./match-state.codec.ts),
  // which enforces the L3 invariant that the sensitive `correctAnswer`
  // is never written to the serialized form — the recovery path
  // re-attaches it from the Question DB row via `attachCorrectAnswer`.
  serialize(): string {
    return serializeMatch(
      this.state,
      this.currentRound as (RoundState & { correctAnswer?: string }) | null,
      this.eventLog,
    );
  }

  // Attach the correct answer to the in-flight round. Called by
  // the recovery path (MatchService.getStateMachine) after
  // deserializing state from Redis, using the answer key fetched
  // from the Question DB row.
  //
  // If the in-flight round is already past ACTIVE (e.g. EVALUATING
  // / COMPLETED) we leave the correctAnswer alone — it should
  // already be set in memory by the original executeRound, and
  // attachment is for the recovery case only.
  attachCorrectAnswer(correctAnswer: string): void {
    if (!this.currentRound) return;
    if (this.currentRound.status !== "ACTIVE") return;
    (
      this.currentRound as RoundState & { correctAnswer: string }
    ).correctAnswer = correctAnswer;
  }

  // Restore MatchStateMachine from serialized JSON string. Parsing,
  // validation, and Map reconstruction live in the pure
  // `deserializeMatch` codec; here we only load the decoded data onto
  // a fresh instance.
  //
  // L3: the decoded `currentRound.correctAnswer` is undefined. The
  // recovery caller (MatchService.getStateMachine) MUST invoke
  // `attachCorrectAnswer()` before any evaluateRound() / submitAnswer()
  // that depends on it.
  static deserialize(json: string): MatchStateMachine {
    const { state, currentRound, eventLog } = deserializeMatch(json);

    const instance = new MatchStateMachine("", "", []);
    instance.state = state;
    instance.currentRound = currentRound;
    instance.eventLog = eventLog;

    return instance;
  }
}
