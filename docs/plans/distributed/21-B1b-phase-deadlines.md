# B1b — `phaseEndsAt` on MatchState

**Depends on:** B1a (impact surfaced). **Blast radius:** touches `MatchStateMachine.transition`

- `startRound` (CRITICAL — B1a covers it). **Commit:** `feat(distributed): B1b persist phase deadlines`.

## Why

Failover (B3) rebuilds a match's next timer from persisted state. Today **only
`round.endsAt` (ROUND_ACTIVE) is persisted** — COUNTDOWN and ROUND_RESULT have no stored
deadline, so a takeover node can't know how much of those phases remains. Add one explicit
wall-clock deadline field that every transition sets.

## Edits

1. **`packages/shared/src/state.ts`** — add to `MatchState` (~73-85):

   ```ts
   phaseEndsAt: number | null; // epoch ms; deadline of the current phase (COUNTDOWN/ROUND_ACTIVE/ROUND_RESULT), null otherwise
   roundResultStartedAt: number | null; // epoch ms; server-authoritative moment ROUND_RESULT began, null in every other phase (B1c's result-display anchor)
   ```

   Update any `MatchState` factory/initializer to default both `null`. If a Zod schema mirrors
   `MatchState`, add `phaseEndsAt: z.number().nullable()` and
   `roundResultStartedAt: z.number().nullable()` (optional-safe).

2. **`packages/game-core/src/match-state-machine.ts`**:
   - In `transition(newStatus)` (~132), set alongside the existing `startedAt`/`endedAt` writes:
     - `COUNTDOWN` → `this.state.phaseEndsAt = Date.now() + GAME_CONFIG.COUNTDOWN_DURATION_MS`
     - `ROUND_RESULT` → read the clock **once** and derive both anchors from that single value:
       ```ts
       const now = Date.now();
       this.state.roundResultStartedAt = now; // server-authoritative result-phase anchor (B1c)
       this.state.phaseEndsAt = now + GAME_CONFIG.RESULT_DISPLAY_MS;
       ```
       Two separate `Date.now()` calls could differ by a tick, breaking B1c's codec invariant
       that `phaseEndsAt === roundResultStartedAt + RESULT_DISPLAY_MS` for v2 blobs.
     - `FINISHED` and `ROUND_EVALUATING` → `this.state.phaseEndsAt = null`
     - **Every status other than `ROUND_RESULT` → `this.state.roundResultStartedAt = null`**
       (clear it on every non-result transition so no stale anchor survives the phase).
   - In `startRound()` (~156-177, ROUND_ACTIVE) → `this.state.phaseEndsAt = this.state.currentRound.endsAt`
     (same value as `endsAt`; keep them consistent) **and `this.state.roundResultStartedAt = null`**
     (a new round must not retain the previous round's result timestamp).
     `GAME_CONFIG` is already imported.

   > The codec auto-serializes new `MatchState` fields via `{...state}` (B1c handles the
   > version bump + v1 backfill). No codec change needed in THIS phase, but B1c must land
   > before multi-node runs read old blobs.

   > **Timer arming from `phaseEndsAt` (done in B3a).** So the persisted deadline, the emits,
   > and the failover takeover all share ONE phase boundary, `executeCountdown`, `executeRound`,
   > and `scheduleMatchEndCheck` should arm their timers from `state.phaseEndsAt`
   > (`delay = max(phaseEndsAt - Date.now(), 0)`) via the shared `armPhaseTimer` flow rather than
   > the fixed `COUNTDOWN_DURATION_MS` / `ROUND_DURATION_MS` / `RESULT_DISPLAY_MS`. For
   > `ROUND_ACTIVE`, `startRound()` sets `currentRound.endsAt` and B1b mirrors it into
   > `phaseEndsAt`, so arm the ROUND_ACTIVE timer from `state.phaseEndsAt` (which equals
   > `currentRound.endsAt` — the preserved phase-end source) instead of `ROUND_DURATION_MS`, so
   > the normal and takeover paths share the same deadline. That refactor lands in B3a
   > (`armPhaseTimer`) and is reused by `resumeMatchLoop`; behavior in the normal flow is
   > unchanged (the delay ≈ the fixed duration because the deadline was set a moment earlier).

## Tests — `match-state-machine.spec.ts`

- After `transition(COUNTDOWN)`, `getState().phaseEndsAt ≈ now + 5000` (± tolerance).
- After `startRound()`, `phaseEndsAt === currentRound.endsAt` and `roundResultStartedAt === null`
  (no stale anchor from a previous ROUND_RESULT).
- After `transition(ROUND_RESULT)`, `phaseEndsAt ≈ now + 3000` and `roundResultStartedAt ≈ now`.
- After `transition(FINISHED)`, `phaseEndsAt === null` and `roundResultStartedAt === null`.
- Use fake timers or a mocked `Date.now` for determinism (match existing spec style).

## Verify / done

- `pnpm --filter @arena/game-core exec vitest run src/match-state-machine.spec.ts` green.
- game-core build clean; downstream api build clean (rebuild `packages/*/dist` if the repo
  consumes built output — `pnpm --filter @arena/shared build && pnpm --filter @arena/game-core build`).
- Full game-core + api suites green.
