// ============================================================
// Match State Machine - Game Đấu Trường 100
// State Pattern: Encapsulates match state transitions
// ============================================================

import {
  MatchStatus,
  PlayerStatus,
  type CardId,
  type CardEffect,
  type ClassId,
  type MatchState,
  type PlayerInfo,
  type RoundState,
  type AnswerState,
  type ActiveEffectSnapshot,
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
import { assignClasses } from "./class-engine";
import { sampleOffer } from "./card-engine";
import {
  selectCandidateTopics,
  resolveBannedTopics,
  tallyTopicVotes,
  type TopicVotingResult,
} from "./topic-voting";

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
  [MatchStatus.CREATED]: [MatchStatus.COUNTDOWN, MatchStatus.TOPIC_VOTING],
  [MatchStatus.TOPIC_VOTING]: [MatchStatus.COUNTDOWN, MatchStatus.FINISHED],
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
    seqNo: number;
  }> = [];
  // Monotonic sequence assigned to each logged event. Starts at 0 so the
  // first event gets seqNo 1; 0 is reserved for the client "have not seen
  // anything yet" cursor. Restored from the max persisted seqNo in
  // `deserialize` so seqNo keeps increasing across Redis rehydrate.
  private eventSeqCounter = 0;
  // Phase 2 — Class + Card Hybrid state. Stored privately so
  // (a) the existing public API stays unchanged, and (b) the
  // codec retains the only `serializeMatch` / `deserializeMatch`
  // boundary. Survives across `serialize`/`deserialize` via
  // the state machine's restore path (added below).
  private readonly playerClasses: Map<string, ClassId> = new Map();
  private readonly playerHands: Map<string, CardId[]> = new Map();
  // Per-player active card effects. Each entry tracks the
  // (serverNow, expiresAtServer) pair so reconnect/rehydrate
  // can compute `remainingMs = max(0, expiresAtServer - serverNow)`
  // from the AUTHORITATIVE `expiresAtServer` (spec §4.4).
  private readonly activeEffects: Map<
    string,
    Array<{
      sourceSeqNo: number;
      effect: CardEffect;
      expiresAtServer: number;
      persistedDurationMs: number;
    }>
  > = new Map();
  // Per-player played cards — used by the API boundary's
  // single-use-per-match validator (spec §3.1 invariant). Maintained
  // incrementally on `playCard` / `rehydrateCardStateFromEventLog`.
  // O(1) reads instead of a per-call O(N) scan of the event log.
  private readonly playerPlayedCards: Map<string, Set<CardId>> = new Map();
  // Per-player picked-but-not-yet-played cards. Distinct from
  // `playerPlayedCards`: a card only counts as "played" after
  // the resolved CARD_RESOLVED event lands. A pick that never
  // resolves (e.g. validator rejects, client disconnects) is
  // cleared by the next offer — see `pickOffer`.
  private readonly playerPickedCards: Map<string, Set<CardId>> = new Map();
  // Per-round AOE counter — used by the API boundary's
  // AOE-cap validator (spec §3.3 "AOE cap = 2 per round").
  // Incremental on `playCard` / `onEndRound`; rebuilt on
  // `rehydrateCardStateFromEventLog`. O(1) reads.
  private readonly aoeCountByRound: Map<number, number> = new Map();

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
      phaseEndsAt: null,
      roundResultStartedAt: null,
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
      candidateTopics: this.state.candidateTopics
        ? [...this.state.candidateTopics]
        : undefined,
      topicVotes: this.state.topicVotes
        ? { ...this.state.topicVotes }
        : undefined,
      bannedTopics: this.state.bannedTopics
        ? [...this.state.bannedTopics]
        : undefined,
      activeTopics: this.state.activeTopics
        ? [...this.state.activeTopics]
        : undefined,
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

  // Server-only accessor for the current round's correct answer.
  // The client-safe public `RoundState` (snapshot/replay) omits
  // it by design — only the server-side resolver needs the
  // value, and it MUST go through this accessor so a future
  // rename of the internal field surfaces at the call site.
  getCorrectAnswer(): string | undefined {
    return this.currentRound?.correctAnswer;
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

    // Handle specific transitions.
    // B1b: every transition also maintains phaseEndsAt (the wall-clock deadline
    // failover rebuilds the next timer from) and roundResultStartedAt (the
    // result-phase anchor), so no stale value survives a phase change.
    switch (to) {
      case MatchStatus.TOPIC_VOTING:
        this.state.startedAt = Date.now();
        this.state.phaseEndsAt =
          Date.now() + GAME_CONFIG.TOPIC_VOTING_DURATION_MS;
        this.state.roundResultStartedAt = null;
        break;
      case MatchStatus.COUNTDOWN:
        this.state.startedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + GAME_CONFIG.COUNTDOWN_DURATION_MS;
        this.state.roundResultStartedAt = null;
        break;
      case MatchStatus.ROUND_RESULT: {
        // Read the clock ONCE so the codec invariant
        // phaseEndsAt === roundResultStartedAt + RESULT_DISPLAY_MS holds
        // exactly for v2 blobs (two Date.now() calls could differ by a tick).
        const now = Date.now();
        this.state.roundResultStartedAt = now;
        this.state.phaseEndsAt = now + GAME_CONFIG.RESULT_DISPLAY_MS;
        break;
      }
      case MatchStatus.FINISHED:
        this.state.endedAt = Date.now();
        this.state.phaseEndsAt = null;
        this.state.roundResultStartedAt = null;
        break;
      case MatchStatus.ROUND_EVALUATING:
        this.state.phaseEndsAt = null;
        this.state.roundResultStartedAt = null;
        break;
      case MatchStatus.ROUND_ACTIVE:
        // startRound() assigns the active-round deadline (mirrors
        // currentRound.endsAt) and installs the new round. Clear phaseEndsAt
        // AND the previous (completed) currentRound here so a snapshot taken —
        // or a failover occurring — between this transition and startRound()
        // cannot retain the prior phase's deadline OR the prior round. Only
        // startRound() initializes the new active round.
        this.state.phaseEndsAt = null;
        this.state.roundResultStartedAt = null;
        this.currentRound = null;
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
    const endsAt = now + (roundDurationMs ?? GAME_CONFIG.ROUND_DURATION_MS);
    const clientQuestion = {
      id: question.id,
      content: question.content,
      options: question.options,
      difficulty: question.difficulty ?? "MEDIUM", // Default to MEDIUM if not provided
    };
    this.currentRound = {
      matchId: this.state.id,
      roundNo: this.state.currentRoundNo,
      question: clientQuestion,
      startedAt: now,
      endsAt,
      answers: new Map(),
      status: "ACTIVE",
      startingPlayers: [...this.state.survivingPlayerIds],
      correctAnswer: question.correctAnswer,
    } as RoundRuntimeState;

    // B1b: mirror the round deadline into phaseEndsAt so failover arms the
    // ROUND_ACTIVE timer from one phase-end source, and drop any stale result
    // anchor a previous ROUND_RESULT left behind.
    this.state.phaseEndsAt = endsAt;
    this.state.roundResultStartedAt = null;

    // Plan D delta replay: carry the full client-safe question + timer
    // so a reconnecting client can rebuild the in-flight round from the
    // delta alone (a full SNAPSHOT is otherwise the only source for the
    // question content/options). `correctAnswer` is deliberately NOT
    // logged — same L3 guarantee as the wire ROUND_STARTED payload and
    // the serialized snapshot.
    this.logEvent("ROUND_STARTED", {
      roundNo: this.state.currentRoundNo,
      questionId: question.id,
      question: clientQuestion,
      endsAt,
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
    if (player?.status !== PlayerStatus.ACTIVE) {
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
      correctAnswer,
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
    candidateTopics?: string[];
    voteCounts?: Record<string, number>;
    phaseEndsAt?: number | null;
    bannedTopics?: string[];
    activeTopics?: string[];
  } {
    const candidateTopics = this.state.candidateTopics;
    const voteCounts =
      candidateTopics && candidateTopics.length > 0
        ? tallyTopicVotes(this.state.topicVotes ?? {}, candidateTopics)
        : undefined;

    return {
      matchId: this.state.id,
      status: this.state.status,
      currentRoundNo: this.state.currentRoundNo,
      players: Array.from(this.state.players.values()),
      currentQuestion: this.currentRound?.question ?? null,
      roundEndTime: this.currentRound?.endsAt ?? null,
      lastEventSeqNo,
      candidateTopics: candidateTopics ? [...candidateTopics] : undefined,
      voteCounts,
      phaseEndsAt: this.state.phaseEndsAt,
      bannedTopics: this.state.bannedTopics
        ? [...this.state.bannedTopics]
        : undefined,
      activeTopics: this.state.activeTopics
        ? [...this.state.activeTopics]
        : undefined,
    };
  }

  // Event Logger. Returns the allocated seqNo so callers (e.g.
  // `playCard`) can reference it without having to manually
  // increment the counter and risk drift between the assigned
  // value and the value stored on the entry. The pushed entry
  // is deeply frozen so a callback that accidentally mutates the
  // payload (e.g. `payload.seqNo = ...`) cannot poison later
  // reads.
  private logEvent(type: string, payload: unknown): number {
    const seqNo = ++this.eventSeqCounter;
    const entry = deepFreezeEventEntry({
      type,
      payload,
      timestamp: Date.now(),
      seqNo,
    });
    this.eventLog.push(entry);
    return seqNo;
  }

  // seqNo of the most recent logged event, or 0 when the log is empty.
  // Used by the reconnect handler as the full-snapshot cursor and to
  // bound the delta window.
  getHeadSeqNo(): number {
    const last = this.eventLog.at(-1);
    return last ? last.seqNo : 0;
  }

  // seqNo of the oldest event still retained in the log, or 0 when
  // empty. A client cursor older than this cannot be served as a delta
  // (the events it missed are gone) and must fall back to a full
  // snapshot. The log is currently never truncated, so this is the
  // first event's seqNo; it becomes meaningful once/if trimming lands.
  getFloorSeqNo(): number {
    const first = this.eventLog[0];
    return first ? first.seqNo : 0;
  }

  // Delta replay: the events a client with cursor `lastSeenSeqNo` has
  // not seen yet (seqNo strictly greater), in ascending seqNo order.
  // Returns the client-safe wire shape (EventBatchPayload["events"]).
  // Callers decide delta-vs-full via getFloorSeqNo/getHeadSeqNo; this
  // method only slices — an out-of-range cursor simply yields [] here.
  getDelta(lastSeenSeqNo: number): Array<{
    id: string;
    type: string;
    timestamp: number;
    payload: unknown;
    seqNo: number;
  }> {
    return this.eventLog
      .filter((e) => e.seqNo > lastSeenSeqNo)
      .map((e) => ({
        id: `${this.state.id}:${e.seqNo}`,
        type: e.type,
        timestamp: e.timestamp,
        payload: e.payload ?? null,
        seqNo: e.seqNo,
      }));
  }

  getEventLog(): ReadonlyArray<{
    type: string;
    payload?: unknown;
    timestamp: number;
    seqNo: number;
  }> {
    return this.eventLog.map((e) => structuredClone(e));
  }

  // `forEachEvent` — non-cloning iterator over the event log.
  // Callers MUST NOT mutate the supplied entry (callbacks receive
  // live internal event records, which are deep-frozen by logEvent).
  forEachEvent(
    callback: (entry: {
      readonly type: string;
      readonly payload?: unknown;
      readonly timestamp: number;
      readonly seqNo: number;
    }) => void | boolean,
    direction: "forward" | "reverse" = "forward",
  ): void {
    if (direction === "reverse") {
      for (let index = this.eventLog.length - 1; index >= 0; index--) {
        if (callback(this.eventLog[index]!) === false) break;
      }
      return;
    }
    for (const entry of this.eventLog) {
      if (callback(entry) === false) break;
    }
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

  // -------------------------------------------------------------------------
  // Topic Ban Voting (Pre-match Crowd Draft)
  // -------------------------------------------------------------------------

  initTopicVoting(candidateTopics?: string[], durationMs?: number): string[] {
    const candidates =
      candidateTopics && candidateTopics.length > 0
        ? candidateTopics
        : selectCandidateTopics(this.state.id);

    this.state.candidateTopics = [...candidates];
    this.state.topicVotes = {};
    this.state.bannedTopics = [];
    this.state.activeTopics = [];

    const duration = durationMs ?? GAME_CONFIG.TOPIC_VOTING_DURATION_MS;
    this.transition(MatchStatus.TOPIC_VOTING);
    this.state.phaseEndsAt = (this.state.startedAt ?? Date.now()) + duration;

    this.logEvent("TOPIC_VOTING_STARTED", {
      matchId: this.state.id,
      candidateTopics: this.state.candidateTopics,
      durationMs: duration,
      endsAt: this.state.phaseEndsAt,
    });

    return this.state.candidateTopics;
  }

  voteBanTopic(
    playerId: string,
    topic: string,
    metadata?: { eventId?: string },
  ): boolean {
    if (
      this.state.status !== MatchStatus.TOPIC_VOTING ||
      (this.state.phaseEndsAt !== undefined &&
        this.state.phaseEndsAt !== null &&
        Date.now() >= this.state.phaseEndsAt)
    ) {
      throw new RoomError(ErrorCode.TOPIC_VOTING_CLOSED);
    }

    const player = this.state.players.get(playerId);
    if (!player || player.status !== PlayerStatus.ACTIVE) {
      throw new RoomError(ErrorCode.PLAYER_NOT_IN_ROOM);
    }

    if (!this.state.candidateTopics?.includes(topic)) {
      throw new RoomError(ErrorCode.INVALID_TOPIC);
    }

    if (!this.state.topicVotes) {
      this.state.topicVotes = {};
    }

    const previousVote = this.state.topicVotes[playerId];
    if (previousVote === topic) {
      return true;
    }

    this.state.topicVotes[playerId] = topic;

    const payload: Record<string, unknown> = {
      matchId: this.state.id,
      playerId,
      topic,
    };
    if (metadata?.eventId) {
      payload.eventId = metadata.eventId;
    }

    this.logEvent("TOPIC_VOTE_SUBMITTED", payload);

    return true;
  }

  resolveTopicVoting(
    bannedCount: number = GAME_CONFIG.TOPIC_VOTING_BANNED_COUNT,
  ): TopicVotingResult {
    const candidates = this.state.candidateTopics ?? [];
    const votes = this.state.topicVotes ?? {};

    const result = resolveBannedTopics(
      candidates,
      votes,
      this.state.id,
      bannedCount,
    );

    this.state.bannedTopics = [...result.bannedTopics];
    this.state.activeTopics = [...result.activeTopics];

    this.logEvent("TOPIC_VOTING_FINISHED", {
      matchId: this.state.id,
      bannedTopics: this.state.bannedTopics,
      activeTopics: this.state.activeTopics,
      voteCounts: result.voteCounts,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Phase 2 — Class + Card Hybrid methods
  // Source of truth: memory-bank/spec/class-cards-phase.md §5.2 sub-task C.
  //
  // All four methods are ADDITIVE — they do not touch the existing
  // public API (`submitAnswer`, `evaluateRound`, `finishMatch`,
  // `getSnapshot`, etc.). The CRITICAL blast radius on MatchStateMachine
  // is preserved by leaving every existing method signature and
  // behavior unchanged.
  // -------------------------------------------------------------------------

  // `classAssignment` — server-side random per-match class
  // assignment. The full map is persisted as ONE `CLASS_ASSIGNED`
  // event so a diff or replay detects class changes by comparing
  // the maps. The seed that produced the assignment is also
  // persisted so a replay can reproduce.
  //
  // Acceptance contract (spec §5.2 Architectural commitments):
  //   - The immutable CLASS_ASSIGNED event is the authoritative
  //     source for that player's class — NOT in-memory state.
  //   - Replay/rehydrate restores the same class for each player
  //     from the event log, preserving idempotency.
  //   - A second call with the same `seedUsed` produces the
  //     same assignment (deterministic).
  classAssignment(
    playerIds: readonly string[],
    seedUsed: string,
  ): Array<{ playerId: string; classId: ClassId }> {
    const assignments = assignClasses(playerIds, seedUsed);
    this.logEvent("CLASS_ASSIGNED", {
      matchId: this.state.id,
      assignments,
      seedUsed,
    });
    // In-memory mirror — the LOG is the source of truth, this
    // exists only for fast lookup. A rehydrate from event log
    // will overwrite this map.
    for (const a of assignments) {
      this.playerClasses.set(a.playerId, a.classId);
    }
    return assignments;
  }

  // `pickOffer` — milestone card offer (Q5/12/20). Runs the
  // canonical sampling (spec §3.3) + emits a `CARD_OFFER` event
  // + populates the player's hand. The 3-tuple size is
  // type-pinned — see the invariant note in
  // `CardOfferEvent.offeredCardIds`.
  pickOffer(
    playerId: string,
    roundNo: number,
    seedUsed: string,
  ): [CardId, CardId, CardId] {
    const classId = this.playerClasses.get(playerId);
    if (!classId) {
      throw new RoomError(ErrorCode.PLAYER_NOT_IN_ROOM);
    }
    const { cards } = sampleOffer(classId, seedUsed);
    if (cards.length !== 3) {
      throw new Error(
        `card-engine invariant: expected 3 cards, got ${cards.length}`,
      );
    }
    const [a, b, c] = cards as [CardId, CardId, CardId];
    this.logEvent("CARD_OFFER", {
      roundNo,
      playerId,
      offeredCardIds: [a, b, c],
      seedUsed,
    });
    this.playerHands.set(playerId, [a, b, c]);
    // Reset the picked-cards cache: a fresh offer supersedes
    // any prior pick that did not resolve. Played cards stay
    // (they survive across offers — single-use per match).
    this.playerPickedCards.delete(playerId);
    return [a, b, c];
  }

  // `pickCard` — the player picked one of the offered cards.
  // The `offerSeqNo` correlation back-points to the
  // `CARD_OFFER.seqNo` so the API boundary can verify the picked
  // card was actually offered and not a replayed/foreign card id.
  //
  // Optional `eventId` + `commandId` stamp the persisted event with the
  // transport-level command identity so `recoverDuplicatePickEvent`
  // can verify a redelivered command matches the originally-committed
  // one before re-broadcasting. They are intentionally optional so the
  // core state machine stays free of any transport concerns; callers
  // that route through the API boundary always supply them.
  pickCard(
    pickedByPlayerId: string,
    cardId: CardId,
    offerSeqNo: number,
    metadata?: { eventId?: string; commandId?: string },
  ): void {
    const hand = this.playerHands.get(pickedByPlayerId);
    if (!hand?.includes(cardId)) {
      throw new RoomError(ErrorCode.CARD_NOT_IN_HAND);
    }
    const payload: Record<string, unknown> = {
      roundNo: this.currentRound?.roundNo ?? 0,
      playerId: pickedByPlayerId,
      selectedCardId: cardId,
      offerSeqNo,
    };
    if (metadata?.eventId) payload.eventId = metadata.eventId;
    if (metadata?.commandId) payload.commandId = metadata.commandId;
    this.logEvent("CARD_PICKED", payload);
    // Spending the card: remove from hand. The card is
    // single-use per match (v1 invariant — spec §3.1).
    this.playerHands.set(
      pickedByPlayerId,
      hand.filter((c) => c !== cardId),
    );
    // Maintain the per-player picked-cards cache (O(1) lookup).
    // The card only joins `playerPlayedCards` once the matching
    // CARD_RESOLVED event is appended in `playCard`.
    let set = this.playerPickedCards.get(pickedByPlayerId);
    if (!set) {
      set = new Set();
      this.playerPickedCards.set(pickedByPlayerId, set);
    }
    set.add(cardId);
  }

  // `playCard` — apply a resolved card effect. The resolver
  // runs server-side in the API boundary (sub-task D) before
  // calling this method; this method only applies the persisted
  // outcome and appends the `CARD_RESOLVED` event.
  //
  // Effect split (spec §4.2):
  //   - `MUTATION` — no countdown, applies once.
  //   - `TEMPORARY` — carries `expiresAtServer`; the rehydrate
  //     reducer restores only while `expiresAtServer > replayServerNow`.
  //
  // `serverNow` is the TRUSTED current server time captured at
  // the call site (one capture per request). It is used
  // UNCONDITIONALLY for both `remainingMs` (transport metadata
  // — never trusted by the client for countdown) and for
  // TEMPORARY `expiresAtServer` derivation.
  playCard(
    playedByPlayerId: string,
    cardId: CardId,
    offerSeqNo: number,
    resolvedEffect: CardEffect,
    targetPlayerIds: readonly string[],
    serverNow: number,
    metadata?: { eventId?: string; commandId?: string },
  ): {
    seqNo: number;
    expiresAtServer: number | null;
    remainingMs: number | null;
  } {
    const isTemporary = isTemporaryEffectKind(resolvedEffect.kind);
    const expiresAtServer = isTemporary
      ? serverNow + getDurationMs(resolvedEffect)
      : 0;
    const remainingMs = isTemporary ? expiresAtServer - serverNow : 0;

    // `logEvent` returns the allocated seqNo — we mirror it into
    // the payload here (the only call site that exposes seqNo on
    // the payload itself; rehydrate reducers / replay log readers
    // can reach the envelope via entry.seqNo) BEFORE the push so
    // the stored entry is never mutated post-append.
    const seqNo = this.eventSeqCounter + 1;
    const payload: Record<string, unknown> = {
      seqNo,
      matchId: this.state.id,
      roundNo: this.currentRound?.roundNo ?? 0,
      cardId,
      offerSeqNo,
      playedByPlayerId,
      targetPlayerIds: [...targetPlayerIds],
      effect: resolvedEffect,
      resolution: isTemporary ? "TEMPORARY" : "MUTATION",
      serverTimestamp: serverNow,
      expiresAtServer: isTemporary ? expiresAtServer : null,
      remainingMs: isTemporary ? remainingMs : null,
    };
    if (metadata?.eventId) payload.eventId = metadata.eventId;
    if (metadata?.commandId) payload.commandId = metadata.commandId;
    const allocatedSeqNo = this.logEvent("CARD_RESOLVED", payload);
    if (allocatedSeqNo !== seqNo) {
      // Defensive: logEvent and the local seqNo MUST agree. If
      // they ever drift, the entry's payload.seqNo would lie
      // about its own envelope seqNo.
      throw new Error(
        `match-state-machine: seqNo drift in playCard (local=${seqNo}, logEvent=${allocatedSeqNo})`,
      );
    }

    if (isTemporary) {
      const list = this.activeEffects.get(playedByPlayerId) ?? [];
      list.push({
        sourceSeqNo: seqNo,
        effect: resolvedEffect,
        // `isTemporary` above already gated on `isTemporaryEffectKind`,
        // so `expiresAtServer` is the (serverNow + durationMs) sum —
        // never the `0` fallback used for MUTATION effects.
        expiresAtServer,
        persistedDurationMs: getDurationMs(resolvedEffect),
      });
      this.activeEffects.set(playedByPlayerId, list);
    }

    // Maintain the per-round AOE counter (incremental, O(1)).
    // Single-target resolutions don't count toward the AOE cap;
    // only resolutions with `targetPlayerIds.length > 1` do,
    // matching the spec's `AOE_CAP_PER_ROUND` rule (spec §3.3).
    if (targetPlayerIds.length > 1) {
      const roundNo = this.currentRound?.roundNo ?? 0;
      const current = this.aoeCountByRound.get(roundNo) ?? 0;
      this.aoeCountByRound.set(roundNo, current + 1);
    }

    // Promote the picked card to "played" only after the
    // resolved event has been appended. A pick that the
    // validator rejects (or that the client never plays) stays
    // in `playerPickedCards` until the next `pickOffer` clears
    // it — which is fine, because the API boundary uses
    // `playerPlayedCards` (not `playerPickedCards`) for the
    // single-use-per-match invariant.
    let played = this.playerPlayedCards.get(playedByPlayerId);
    if (!played) {
      played = new Set();
      this.playerPlayedCards.set(playedByPlayerId, played);
    }
    played.add(cardId);
    this.playerPickedCards.get(playedByPlayerId)?.delete(cardId);

    return {
      seqNo,
      expiresAtServer: isTemporary ? expiresAtServer : null,
      remainingMs: isTemporary ? remainingMs : null,
    };
  }

  // Get a player's current hand (off the in-memory mirror —
  // the EVENT LOG is the source of truth).
  getHand(playerId: string): readonly CardId[] {
    return this.playerHands.get(playerId) ?? [];
  }

  // Resolve the `CARD_OFFER` envelope that produced the picked
  // card. The API boundary calls this with `offerSeqNo` from the
  // client to validate the play against the offer that actually
  // targeted this player — NOT against the current hand (which
  // `pickCard` has already mutated by removing the picked card).
  // Returns `null` if no matching `CARD_OFFER` for this player
  // exists, so the API boundary can reject a foreign
  // `offerSeqNo` with `CARD_NOT_IN_HAND`.
  getCardOfferForPlayer(
    playerId: string,
    offerSeqNo: number,
  ): readonly CardId[] | null {
    for (const e of this.eventLog) {
      if (e.type !== "CARD_OFFER") continue;
      if (e.seqNo !== offerSeqNo) continue;
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      if (payload.playerId !== playerId) continue;
      const ids = (payload.offeredCardIds ?? []) as CardId[];
      if (ids.length !== 3) return null;
      return ids;
    }
    return null;
  }

  // Get the set of cardIds the player has picked but not yet
  // resolved (incremental, O(1)). Distinct from `getPlayedCards`:
  // picked cards include any card the player selected via
  // `pickCard` even if `playCard` was never reached (validator
  // rejection, client disconnect, ...). The next `pickOffer`
  // replaces this set wholesale.
  getPickedCards(playerId: string): ReadonlySet<CardId> {
    return this.playerPickedCards.get(playerId) ?? EMPTY_CARD_SET;
  }

  // Get the set of cardIds the player has already played this
  // match (single-use invariant, spec §3.1). Backs the API
  // boundary's `validateCardCommand` playedCardIds argument.
  // O(1) read — incrementally maintained by `playCard`.
  getPlayedCards(playerId: string): ReadonlySet<CardId> {
    return this.playerPlayedCards.get(playerId) ?? EMPTY_CARD_SET;
  }

  // Get the AOE-resolution count for the current round.
  // O(1) read — incrementally maintained by `playCard`.
  // The callback path uses this directly to enforce the
  // `AOE_CAP_PER_ROUND` cap without re-scanning the event log.
  getAoeCountForRound(roundNo: number): number {
    return this.aoeCountByRound.get(roundNo) ?? 0;
  }

  // Get a player's active card effects as a snapshot
  // (clock-drift safe rehydrate, spec §4.4):
  //   `remainingMs = max(0, expiresAtServer - serverNow)`
  // materialised at the supplied `serverNow`. If
  // `expiresAtServer <= serverNow` the effect has expired and is
  // NOT included in the snapshot.
  getActiveEffects(
    playerId: string,
    serverNow: number,
  ): readonly ActiveEffectSnapshot[] {
    const list = this.activeEffects.get(playerId) ?? [];
    return list
      .map((e) => {
        const remainingMs = Math.max(0, e.expiresAtServer - serverNow);
        return {
          sourceSeqNo: e.sourceSeqNo,
          effect: extractTemporaryEffect(e.effect),
          remainingMs,
          persistedDurationMs: e.persistedDurationMs,
          expiresAtServer: e.expiresAtServer,
        };
      })
      .filter((e) => e.remainingMs > 0);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  // Restore `playerClasses` / `playerHands` / `activeEffects` from
  // the event log. Called by the rehydrate path in `deserialize`
  // after the codec has loaded the canonical event log. The log
  // is the only authoritative source — drift is impossible
  // because the in-memory state is rebuilt verbatim from the
  // log on every recovery.
  private rehydrateCardStateFromEventLog(): void {
    this.playerClasses.clear();
    this.playerHands.clear();
    this.activeEffects.clear();
    this.playerPlayedCards.clear();
    this.playerPickedCards.clear();
    this.aoeCountByRound.clear();
    for (const e of this.eventLog) {
      this.rehydrateEvent(e);
    }
  }

  private rehydrateEvent(e: {
    type: string;
    payload?: unknown;
    seqNo: number;
  }): void {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "CLASS_ASSIGNED":
        this.rehydrateClassAssigned(payload);
        break;
      case "CARD_OFFER":
        this.rehydrateCardOffer(payload);
        break;
      case "CARD_PICKED":
        this.rehydrateCardPicked(payload);
        break;
      case "CARD_RESOLVED":
        this.rehydrateCardResolved(e.seqNo, payload);
        break;
    }
  }

  private rehydrateClassAssigned(payload: Record<string, unknown>): void {
    const assignments = (payload.assignments ?? []) as Array<{
      playerId: string;
      classId: ClassId;
    }>;
    for (const a of assignments) {
      this.playerClasses.set(a.playerId, a.classId);
    }
  }

  private rehydrateCardOffer(payload: Record<string, unknown>): void {
    const playerId = payload.playerId as string;
    const ids = (payload.offeredCardIds ?? []) as CardId[];
    if (ids.length === 3) {
      this.playerHands.set(playerId, ids);
      this.playerPickedCards.delete(playerId);
    }
  }

  private rehydrateCardPicked(payload: Record<string, unknown>): void {
    const playerId = payload.playerId as string;
    const cardId = payload.selectedCardId as CardId;
    const hand = this.playerHands.get(playerId) ?? [];
    this.playerHands.set(
      playerId,
      hand.filter((c) => c !== cardId),
    );
    let set = this.playerPickedCards.get(playerId);
    if (!set) {
      set = new Set();
      this.playerPickedCards.set(playerId, set);
    }
    set.add(cardId);
  }

  private rehydrateCardResolved(
    seqNo: number,
    payload: Record<string, unknown>,
  ): void {
    const playedBy = payload.playedByPlayerId as string;
    const cardId = payload.cardId as CardId;
    let played = this.playerPlayedCards.get(playedBy);
    if (!played) {
      played = new Set();
      this.playerPlayedCards.set(playedBy, played);
    }
    played.add(cardId);
    this.playerPickedCards.get(playedBy)?.delete(cardId);
    if (payload.resolution === "TEMPORARY") {
      const list = this.activeEffects.get(playedBy) ?? [];
      list.push({
        sourceSeqNo: seqNo,
        effect: payload.effect as CardEffect,
        expiresAtServer: payload.expiresAtServer as number,
        persistedDurationMs: getDurationMs(payload.effect as CardEffect),
      });
      this.activeEffects.set(playedBy, list);
    }
    const targets = (payload.targetPlayerIds ?? []) as string[];
    if (targets.length > 1) {
      const roundNo = payload.roundNo as number;
      const current = this.aoeCountByRound.get(roundNo) ?? 0;
      this.aoeCountByRound.set(roundNo, current + 1);
    }
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
    // Resume the sequence from the highest persisted seqNo so events
    // logged after rehydrate keep increasing and never collide with an
    // already-emitted seqNo (which would corrupt a client's delta cursor).
    instance.eventSeqCounter = eventLog.reduce(
      (max, e) => Math.max(e.seqNo, max),
      0,
    );
    // Phase 2 — rebuild class/card state from the event log.
    // The log is the source of truth; this just mirrors the
    // latest persisted state for fast lookup.
    instance.rehydrateCardStateFromEventLog();

    return instance;
  }
}

// ---------------------------------------------------------------------------
// Helpers (file-scoped, no MatchStateMachine state)
// ---------------------------------------------------------------------------

// Frozen empty set returned by `getPlayedCards` for players
// with no plays yet. Sharing one reference avoids the per-call
// allocation that a fresh `new Set()` would incur.
const EMPTY_CARD_SET: ReadonlySet<CardId> = new Set<CardId>();

// CardEffect kinds that carry a temporary visual countdown
// (spec §4.2 "TemporaryEffect" branch). Single authoritative
// source for both `isTemporaryEffectKind` and `getDurationMs` —
// every kind listed here MUST return its `durationMs` from
// `getDurationMs`, and any kind not listed returns `0`.
const TEMPORARY_KINDS = [
  "OPTION_DISABLE",
  "OPTION_FAKE",
  "OPTION_LOCK",
  "VISUAL_OVERLAY",
  "SEMANTIC_FLIP",
] as const;
const TEMPORARY_KINDS_SET: ReadonlySet<string> = new Set(TEMPORARY_KINDS);

function isTemporaryEffectKind(kind: CardEffect["kind"]): boolean {
  return TEMPORARY_KINDS_SET.has(kind);
}

function getDurationMs(effect: CardEffect): number {
  if (!isTemporaryEffectKind(effect.kind)) return 0;
  // Safe because `isTemporaryEffectKind` only returns true for
  // kinds whose CardEffect shape carries `durationMs`.
  return (effect as { durationMs: number }).durationMs;
}

function extractTemporaryEffect(
  effect: CardEffect,
): ActiveEffectSnapshot["effect"] {
  // The snapshot only carries TEMPORARY effects (the only kind
  // we add to `activeEffects`). The cast is safe because
  // `isTemporaryEffectKind` gates the insertion above.
  return effect as ActiveEffectSnapshot["effect"];
}

// Deep-freeze an event-log entry. We recurse into the payload
// (which is the only mutable field on a frozen entry) so a
// callback that accidentally writes `entry.payload.x = ...`
// also throws. `undefined` payloads are preserved.
function deepFreezeEventEntry<
  E extends {
    type: string;
    payload?: unknown;
    timestamp: number;
    seqNo: number;
  },
>(entry: E): Readonly<E> {
  const frozenPayload =
    entry.payload === undefined
      ? undefined
      : deepFreezeValue(entry.payload, new WeakSet());
  return Object.freeze({
    ...entry,
    payload: frozenPayload,
  }) as Readonly<E>;
}

// `deepFreezeValue` walks `value` and freezes every reachable
// object/array recursively. Two corrections vs the previous
// short-circuit on `Object.isFrozen`:
//
// 1. `playCard` pre-freezes the outer payload before pushing it
//    through `logEvent`; the previous short-circuit meant nested
//    `targetPlayerIds`, `effect`, and effect-internal arrays stayed
//    mutable. We now check the visitor `seen` WeakSet instead, so
//    already-frozen objects are still traversed on first visit and
//    their nested children get frozen exactly once.
//
// 2. The `seen` set prevents infinite recursion on cyclic payloads
//    (a future payload shape could include a self-reference).
function deepFreezeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  // `seen` is a per-call cache so an object that legitimately
  // appears at multiple NON-cyclic points still gets walked
  // recursively — but a cycle folds back to the already-visited
  // object and stops.
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  if (!Object.isFrozen(value)) Object.freeze(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (Object.hasOwn(value, i)) {
        deepFreezeValue(value[i], seen);
      }
    }
    return value;
  }
  for (const k of Object.keys(value as Record<string, unknown>)) {
    deepFreezeValue((value as Record<string, unknown>)[k], seen);
  }
  return value;
}
