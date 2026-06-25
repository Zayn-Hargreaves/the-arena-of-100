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
      throw new RoomError(ErrorCode.ROUND_NOT_ACTIVE);
    }

    if (this.currentRound.answers.has(playerId)) {
      throw new RoomError(ErrorCode.ALREADY_ANSWERED);
    }

    if (serverTimestamp > this.currentRound.endsAt) {
      throw new RoomError(ErrorCode.ANSWER_SUBMISSION_CLOSED);
    }

    const player = this.state.players.get(playerId);
    if (!player || player.status !== PlayerStatus.ACTIVE) {
      throw new RoomError(ErrorCode.PLAYER_NOT_IN_ROOM);
    }

    const roundWithAnswer = this.currentRound as RoundState & {
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

  // Tie-break Logic (Strategy Pattern)
  //
  // B2 fix: return type widened to `string | null` and we early-return
  // `null` for empty input. Previously the function would have
  // returned `undefined` (the `sorted[0]` of an empty array), which
  // the type system could not catch because the old signature was
  // `string`. The non-null assertion in `finishMatchLoop` then
  // passed that `undefined` down to Prisma's `match.update` payload
  // — Prisma silently drops `undefined` fields, so the DB kept its
  // stale winnerId. Returning `null` is the explicit "no winner"
  // signal that downstream code (finishMatchLoop → matchService.finishMatch
  // → Prisma) already supports.
  private tieBreak(playerIds: string[]): string | null {
    // B2 fix: empty-roster short-circuit. Sort + seeded RNG on an
    // empty array is wasted work, and `sorted[0]` would be
    // `undefined` (the bug the non-null assertion in
    // `finishMatchLoop` was hiding).
    if (playerIds.length === 0) {
      return null;
    }

    // L5 fix: a deterministic, non-deterministic seed breaks the
    // strict weak ordering contract that Array#sort requires to
    // produce a stable, reproducible ordering. We use the match
    // id (a stable per-match value) as the seed for a deterministic
    // PRNG, then use the generated offset as a "true" tiebreaker
    // BEFORE the alphabetical ID fallback. The two properties we
    // want:
    //
    //   1. Reproducible: the same match + the same stats must
    //      produce the same winner, every time. Verified by the
    //      existing tie-break tests.
    //   2. Not "first id wins": a player with id `a_player` should
    //      not have a structural advantage over `z_player` when
    //      they are otherwise identical.
    //
    // We achieve (1) by seeding mulberry32 with a hash of the
    // match id, then generating a per-player random offset.
    // Because the seed is identical across runs, the offset is
    // identical across runs — the winner is determined by the
    // combination of stats + match id. (2) is achieved by the
    // offset being uniformly distributed, so no player has a
    // structural edge.
    const seed = this.hashStringToSeed(this.state.id);
    const offsets = new Map<string, number>();
    const rng = this.mulberry32(seed);
    for (const id of playerIds) {
      offsets.set(id, rng());
    }

    // Sort by total response time (ascending = faster is better).
    // Missing players (state corruption / desync) are always ranked last so
    // they can never win a tie-break, while still yielding a deterministic
    // ordering that satisfies the strict weak ordering contract of Array#sort.
    const sorted = [...playerIds].sort((a, b) => {
      const playerA = this.state.players.get(a);
      const playerB = this.state.players.get(b);

      // Missing players always sort last (positive number = `a` goes after `b`).
      if (!playerA && !playerB) return a < b ? -1 : a > b ? 1 : 0;
      if (!playerA) return 1;
      if (!playerB) return -1;

      // First: compare total response time
      if (playerA.totalResponseTimeMs !== playerB.totalResponseTimeMs) {
        return playerA.totalResponseTimeMs - playerB.totalResponseTimeMs;
      }

      // Second: compare correct answers count
      if (playerA.correctAnswers !== playerB.correctAnswers) {
        return playerB.correctAnswers - playerA.correctAnswers;
      }

      // Third: deterministic random offset (per-match seed). This
      // is the L5 fix: the offset breaks the "alphabetical id wins"
      // bias without sacrificing reproducibility.
      const offsetA = offsets.get(a) ?? 0;
      const offsetB = offsets.get(b) ?? 0;
      if (offsetA !== offsetB) return offsetA - offsetB;

      // Final tie-breaker: alphabetical by player ID. This
      // satisfies strict weak ordering for the rare case where
      // two players somehow get identical offsets (which would
      // require a broken PRNG).
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const winnerId = sorted[0];

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

  // Serialize state to JSON string for Redis persistence
  //
  // L3 fix: `correctAnswer` is intentionally OMITTED from the
  // serialized form. The in-flight question's correct answer is
  // sensitive — exposing it via a Redis leak or log scrape would
  // let any user who has the question id read the answer key for
  // every active match. Instead, the recovery path (see
  // MatchService.getStateMachine) re-attaches the correct answer
  // from the Question DB row by `currentRound.question.id`. The
  // Question table has stricter access controls than the Redis
  // cache and is the natural single source of truth for answer
  // keys.
  serialize(): string {
    const roundData = this.currentRound
      ? (() => {
          // L3: destructure correctAnswer out so the spread does
          // not re-include it. The remaining fields are the safe
          // round shape (question, timing, status, answers).
          // The eslint rule for unused-vars is suppressed here:
          // we deliberately destructure-out the field without
          // binding it (the leading-underscore convention marks
          // it as intentionally unused).
          const { correctAnswer: _omitCorrectAnswer, ...rest } = this
            .currentRound as RoundState & { correctAnswer: string };
          void _omitCorrectAnswer;
          return {
            ...rest,
            answers: Array.from(this.currentRound.answers.entries()),
            // L3: correctAnswer deliberately omitted. Recovery
            // re-attaches it from the DB via attachCorrectAnswer.
          };
        })()
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

      // L3 fix: `correctAnswer` is now optional in the serialized
      // form. The recovery path (MatchService.getStateMachine) is
      // responsible for re-attaching it from the Question DB row
      // before the round is evaluated. We validate that, IF
      // present, it is a string — that catches corruption while
      // allowing the new "absent" form.
      const correctAnswerOk =
        cr.correctAnswer === undefined || typeof cr.correctAnswer === "string";

      if (
        !correctAnswerOk ||
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
        // L3: correctAnswer is undefined after deserialize. The
        // recovery caller MUST invoke attachCorrectAnswer() before
        // any evaluateRound() / submitAnswer() that depends on it.
      } as RoundState & { correctAnswer: string };
    } else {
      instance.currentRound = null;
    }

    instance.eventLog = parsed.eventLog;

    return instance;
  }

  // ============================================================
  // L5 HELPERS: deterministic PRNG for fair tie-breaks
  // ============================================================

  // FNV-1a 32-bit hash. Returns an unsigned 32-bit integer
  // suitable for seeding a small PRNG. We use FNV-1a instead of
  // crypto.createHash so this is a pure function with zero
  // dependencies and the same output on every platform.
  private hashStringToSeed(s: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  // mulberry32: a tiny, fast, statistically-good 32-bit PRNG.
  // Returns a function that produces floats in [0, 1). The same
  // seed always produces the same sequence, which is what makes
  // the tie-break reproducible across process restarts.
  private mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
