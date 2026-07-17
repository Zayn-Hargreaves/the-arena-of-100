# B3a — `resumeMatchLoop` (rebuild a running match)

**Depends on:** B1b/B1c (phaseEndsAt), B2c. **Blast radius:** `MatchRoundRunner` (CRITICAL — B1a).
**Commit:** `feat(distributed): B3a resume match loop from persisted state`.

## Goal

Add the pure "pick up a match mid-flight" entry point. Given a matchId a node just acquired
the lease for (boot or takeover — B3b calls this), rebuild the in-memory runtime and arm the
correct next timer from persisted state. No new Redis keys.

## New public method — `apps/api/src/modules/match/match-round-runner.ts`

```ts
async resumeMatchLoop(matchId: string, hydratedSm: MatchStateMachine, roomId: string, server: Server): Promise<void>
```

Steps:

1. **The caller (B3b) supplies the already-hydrated state machine.** B3b acquires the lease,
   hydrates from the canonical `match:state` blob via `matchService.getStateMachine`, performs
   the final revalidation, and only then calls `resumeMatchLoop` with that `hydratedSm`.
   `resumeMatchLoop` does **NOT** call `matchService.getStateMachine` itself — a second hydration
   here would reopen the TOCTOU between B3b's revalidation and the timer arm. Undefined/missing
   state and `ownership.release` handling therefore live at the **caller** (B3b), not here; this
   method may assume a valid hydrated state machine.
2. **Rebuild F2 used-questions from the event log** (the one in-memory bit not in state):
   `timers.initUsedQuestions(matchId)`; for each `ROUND_STARTED` entry in `hydratedSm.getEventLog()`,
   `timers.markQuestionUsed(matchId, entry.payload.question.questionId)`. (Confirms F2
   anti-repeat still holds after takeover — otherwise a resumed match could repeat questions.)
3. If resuming mid-`ROUND_ACTIVE`, `timers.setExpectedAnswers(matchId, state.survivingPlayerIds.length)`.
4. **Arm the timer from `state.status` + `state.phaseEndsAt`**, using
   `remaining = clamp(phaseEndsAt - Date.now(), 0, phaseMax)`:
   | status | phaseMax | action |
   |--------|----------|--------|
   | COUNTDOWN | 5000 | `setTimeout(executeRound, remaining)` |
   | ROUND_ACTIVE | 15000 | `setTimeout(endRound, remaining)` |
   | ROUND_EVALUATING | — | call `endRound` immediately (hits `handleRecoveredRoundEnd` ~445) |
   | ROUND_RESULT | 3000 | `setTimeout(checkMatchEnd, remaining)` |
   | FINISHED | — | cleanup: `timers.disposeMatch` + `ownership.release`; return |
   **Use `state.phaseEndsAt` as the single canonical deadline for every phase — including
   ROUND_ACTIVE** (B1b sets `phaseEndsAt = currentRound.endsAt` there, so they agree; relying on
   `phaseEndsAt` keeps one source of truth and stays valid even if `currentRound` is missing or the
   two ever diverge). `remaining` is always clamped to `[0, phaseMax]`.

   **Missing-deadline handling depends on whether the phase is new or resumed.** A `Date.now() +
phaseMax` fallback is only correct for **newly initialized** unarmed state (a phase that was
   never armed). A **resumed** timed phase with no `phaseEndsAt` must NOT be granted a fresh full
   `phaseMax` — that silently extends a deadline that has partly (or fully) elapsed. Since B1b sets
   `phaseEndsAt` on every transition and B1c backfills it for v1 blobs, a resumed phase should
   always have one; if it is nonetheless null/absent, **fail closed** — reconstruct the deadline
   from the persisted phase-start anchor where one exists (`ROUND_ACTIVE` → `currentRound.endsAt`;
   `COUNTDOWN` → `state.startedAt + COUNTDOWN_DURATION_MS`), and only when no anchor exists at all
   fire the phase immediately (`remaining = 0`) rather than re-granting the full window. Reserve
   `Date.now() + phaseMax` strictly for genuinely new, never-armed state.
   Register handles via `timers.ensureMatch`/`addTimer` (same M5-safe ordering as `executeCountdown`).

## Refactor to reuse

`executeCountdown` / `scheduleMatchEndCheck` hardcode their durations. Generalize them (or add
private `armPhaseTimer(matchId, fn, remaining)`) so `resumeMatchLoop` reuses the exact same
registration path — mirror `lobby-countdown.service.ts:armLobbyCountdownTimer` which already
does `setTimeout(fn, max(endsAt - now, 0))`.

## Tests — `match-round-runner.spec.ts` (+ recovery spec)

With fake timers and a state machine fixture per phase:

- COUNTDOWN with `phaseEndsAt = now+2000` → `executeRound` fires at +2000.
- ROUND_ACTIVE with **`state.phaseEndsAt` in the past** → `endRound` fires immediately. (Set the
  canonical `phaseEndsAt` deadline in the fixture — do NOT rely on an `endsAt`-only past value;
  the test must prove the resume path arms from `phaseEndsAt`, the single source of truth.)
- ROUND_RESULT → `checkMatchEnd` fires after `remaining`.
- ROUND_EVALUATING → `endRound` invoked at once (recovered path).
- FINISHED → disposes + releases, arms nothing.
- F2: event log with questions q1,q2 → after resume, `getUsedQuestions` contains q1,q2.
- Exactly-once: resume then let the round end → a single `saveRoundAndAnswers` (assert mock).

## Verify / done

- Specs green; full suite green. (Boot/orphan wiring that actually _calls_ this is B3b.)
