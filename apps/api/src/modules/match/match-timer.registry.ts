// ============================================================
// MatchTimerRegistry — in-memory bookkeeping for the game loop
//
// Extracted from GameLoopService. Owns the per-match runtime state
// that never touches the DB or Redis:
//   - active setTimeout handles (round/countdown/result timers)
//   - used question ids (F2 anti-repeat)
//   - expected answer counts (early-termination tracking)
//   - the H1 round-end and B1 match-finish idempotency guards
//
// The idempotency guards are the subtle correctness surface: they
// serialise concurrent callers so a round is not ended twice and a
// match is not finished twice. Exposing them as intention-revealing
// methods (beginEndRound/beginFinish) makes that contract explicit and
// unit-testable in isolation.
//
// State is fully encapsulated: callers (and tests) go through the
// intention-revealing methods below, never the raw Maps/Sets.
// ============================================================

export class MatchTimerRegistry {
  /** matchId -> set of live setTimeout handles for that match. */
  private readonly activeTimers = new Map<string, Set<NodeJS.Timeout>>();
  /** matchId -> set of question ids already served (F2 anti-repeat). */
  private readonly usedQuestionIds = new Map<string, Set<string>>();
  /** matchId -> surviving player count expected to answer this round. */
  private readonly expectedAnswers = new Map<string, number>();
  /** H1: matchIds whose endRound is currently in flight. */
  private readonly endingRounds = new Set<string>();
  /** B1: matchIds whose finishMatchLoop is currently in flight. */
  private readonly finishingMatches = new Set<string>();
  /**
   * B1.1: matchId -> in-flight finishMatchLoop promise. Lets concurrent
   * callers (e.g. `forceFinishMatchForDisband`) await the natural finish
   * instead of returning early and racing the in-flight persist.
   */
  private readonly finishingPromises = new Map<string, Promise<void>>();

  // ---- Timers -------------------------------------------------

  /**
   * Ensure a timer set exists for the match and return it. Used by
   * `executeCountdown` to register the set BEFORE `setTimeout` returns
   * (M5 fix), closing the window where `clear` could run before the
   * timer handle was tracked.
   */
  ensureMatch(matchId: string): Set<NodeJS.Timeout> {
    let set = this.activeTimers.get(matchId);
    if (!set) {
      set = new Set();
      this.activeTimers.set(matchId, set);
    }
    return set;
  }

  addTimer(matchId: string, timer: NodeJS.Timeout): void {
    this.ensureMatch(matchId).add(timer);
  }

  clearTimers(matchId: string): void {
    const timers = this.activeTimers.get(matchId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.activeTimers.delete(matchId);
    }
  }

  hasTimers(matchId: string): boolean {
    return this.activeTimers.has(matchId);
  }

  // ---- Used questions (F2) ------------------------------------

  initUsedQuestions(matchId: string): void {
    this.usedQuestionIds.set(matchId, new Set());
  }

  markQuestionUsed(matchId: string, questionId: string): void {
    this.ensureUsedQuestions(matchId).add(questionId);
  }

  getUsedQuestions(matchId: string): Set<string> | undefined {
    return this.usedQuestionIds.get(matchId);
  }

  hasUsedQuestions(matchId: string): boolean {
    return this.usedQuestionIds.has(matchId);
  }

  private ensureUsedQuestions(matchId: string): Set<string> {
    let set = this.usedQuestionIds.get(matchId);
    if (!set) {
      set = new Set();
      this.usedQuestionIds.set(matchId, set);
    }
    return set;
  }

  // ---- Expected answers (early termination) -------------------

  setExpectedAnswers(matchId: string, count: number): void {
    this.expectedAnswers.set(matchId, count);
  }

  getExpectedAnswers(matchId: string): number {
    return this.expectedAnswers.get(matchId) ?? 0;
  }

  // ---- H1 round-end idempotency -------------------------------

  /** Acquire the round-end guard. Returns false if already in flight. */
  beginEndRound(matchId: string): boolean {
    if (this.endingRounds.has(matchId)) return false;
    this.endingRounds.add(matchId);
    return true;
  }

  endEndRound(matchId: string): void {
    this.endingRounds.delete(matchId);
  }

  isEndingRound(matchId: string): boolean {
    return this.endingRounds.has(matchId);
  }

  // ---- B1 match-finish idempotency ----------------------------

  /** Acquire the match-finish guard. Returns false if already in flight. */
  beginFinish(matchId: string): boolean {
    if (this.finishingMatches.has(matchId)) return false;
    this.finishingMatches.add(matchId);
    return true;
  }

  endFinish(matchId: string): void {
    this.finishingMatches.delete(matchId);
    this.finishingPromises.delete(matchId);
  }

  isFinishing(matchId: string): boolean {
    return this.finishingMatches.has(matchId);
  }

  /**
   * Store the in-flight `finishMatchLoop` promise so concurrent callers
   * can `awaitFinish(matchId)` instead of returning early and racing the
   * persist. Must be called AFTER `beginFinish` succeeds.
   */
  registerFinishPromise(matchId: string, promise: Promise<void>): void {
    this.finishingPromises.set(matchId, promise);
  }

  /**
   * Resolve when the in-flight `finishMatchLoop` for `matchId` settles.
   * Returns `Promise.resolve()` when no finish is in flight — caller-
   * friendly: never throws, never hangs. Awaits the same promise that
   * the runner created, so rejections propagate to the awaiter.
   */
  awaitFinish(matchId: string): Promise<void> {
    return this.finishingPromises.get(matchId) ?? Promise.resolve();
  }

  // ---- Lifecycle ----------------------------------------------

  /**
   * Clear all timers and drop the per-match tracking maps. Mirrors the
   * cleanup done by `cancelMatchLoop` and the end of `finishMatchLoop`.
   * Does NOT touch the idempotency guards — those are released by their
   * own try/finally so a thrown error still frees the match.
   */
  disposeMatch(matchId: string): void {
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.expectedAnswers.delete(matchId);
    // NOTE: finishingPromises is intentionally NOT deleted here.
    // endFinish() is the sole method responsible for removing that entry so
    // that concurrent callers (e.g. forceFinishMatchForDisband) can still
    // awaitFinish() after disposeMatch is called during teardown.
  }
}
