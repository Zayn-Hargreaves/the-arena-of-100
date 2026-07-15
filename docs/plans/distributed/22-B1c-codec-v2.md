# B1c — Codec v2 + back-compat

**Depends on:** B1b. **Blast radius:** `serializeMatch`/`deserializeMatch` (CRITICAL — B1a).
**Commit:** `feat(distributed): B1c codec v2 with v1 back-compat`.

## Why

B1b added `phaseEndsAt`. Bump the serialized format version so readers know it may be
present — **without breaking in-flight v1 blobs**. The trap: `deserializeStartingPlayers`
keys off `hasSupportedStateVersion` which uses **strict `=== SERIALIZED_STATE_VERSION`**;
a naive bump flips every live v1 match's `startingPlayers` to `UNAVAILABLE`.

## Edits — `packages/game-core/src/match-state.codec.ts`

1. Bump `SERIALIZED_STATE_VERSION` `1 → 2`.
2. Replace the strict gate with a supported-set:

   ```ts
   const SUPPORTED_STATE_VERSIONS = new Set([1, 2]);
   function hasSupportedStateVersion(parsed): boolean {
     return SUPPORTED_STATE_VERSIONS.has(parsed?._stateVersion);
   }
   ```

   Ensure `deserializeStartingPlayers` (and anything else that branched on the strict check)
   now treats both 1 and 2 as supported, so v1 `startingPlayers` semantics are preserved.

3. The dedicated persisted `ROUND_RESULT` anchor is
   `state.roundResultStartedAt: number | null` (epoch milliseconds) — **a nullable field on the
   shared `MatchState` contract in `packages/shared/src/state.ts` (added in B1b, default `null`),
   not a codec-only field. That contract change must exist before this phase's codec logic lands.**
   The state machine (B1b) sets it to the server-authoritative moment the result-display
   phase begins when entering `ROUND_RESULT` and resets it to `null` in every other phase;
   the codec here only serializes/validates it. Backward-compatible v1 blobs may
   be missing this field, in which case the result phase has no stable anchor and
   `deserializeMatch` leaves `phaseEndsAt` as `null`. If a v1/v2 blob does contain
   `roundResultStartedAt`, `deserializeMatch` validates that it is a finite number and
   reuses it as the sole result-display anchor by computing
   `roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS`. Do not infer this anchor
   from `currentRound.endsAt`, and do not synthesize it from `Date.now()` in ordinary
   game-core hydration; `@arena/game-core` stays deterministic and pure.

4. In `deserializeMatch`, backfill `phaseEndsAt` when absent (v1 blob). **Date.now() is
   PROHIBITED inside ordinary `deserializeMatch` hydration for every existing phase** —
   calling `Date.now()` there would let repeated `getStateMachine()` hydrations mint a new
   deadline on every read. Reconstruct deterministically where a stable persisted anchor
   exists, and otherwise leave the deadline unresolved until the B3b recovery/takeover
   owner acquires the lease and materializes the one-time grace window:
   - `status === ROUND_ACTIVE` → use `state.currentRound?.endsAt` when present; else
     anchor to `state.currentRound?.startedAt + GAME_CONFIG.ROUND_DURATION_MS` only when
     both `endsAt` is missing and `startedAt` is present (a deterministic
     reconstruction from the round's own clock). **Never default to `Date.now()`.**
   - `status === COUNTDOWN` → **guard on `state.startedAt`**: use the anchored deadline
     `state.startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS` **only when `state.startedAt != null`**
     (deterministic: `startedAt` is set at the COUNTDOWN transition). When `startedAt` is `null`
     or `undefined`, **fail closed** — this deserialize path only ever sees a resumed/legacy blob,
     never a freshly armed phase, so it must NOT be granted a fresh full `COUNTDOWN_DURATION_MS`
     window (that would let a takeover restart the countdown, non-authoritatively extending timing
     across failover). (Never add `COUNTDOWN_DURATION_MS` to a null/undefined `startedAt` — that
     both yields `NaN` and re-grants a full window.) A fresh `Date.now() + duration` window is
     reserved strictly for genuinely new, never-armed COUNTDOWN state — which is armed by
     `transition`, not reconstructed here. **Never default to `Date.now()`.**
   - `status === ROUND_RESULT` → ordinary `deserializeMatch` MUST NOT mint a fresh
     `Date.now() + GAME_CONFIG.RESULT_DISPLAY_MS` deadline. Reuse only the dedicated
     persisted `state.roundResultStartedAt` anchor described above; do **not** reuse
     `currentRound.endsAt`, which belongs to the completed gameplay round rather than
     the result-display phase. When no dedicated result-phase anchor exists, leave
     `phaseEndsAt` unresolved (`null`) during normal hydration. The **single server-authoritative
     owner that just acquired the lease in B3b** is the only layer allowed to materialize
     the fresh grace deadline, and it must fenced-persist that hydrated v2 blob back to
     Redis exactly once **before** `resumeMatchLoop` continues. Existing v2 blobs with a
     `phaseEndsAt` already set continue to pass through unchanged.
     **The B3b owner materialization path is the only place where `Date.now()` is allowed.**
   - else → `null`.
     Do this only if `parsed.state.phaseEndsAt === undefined`, so **v2 blobs pass through untouched**.

   **Fail-closed contract for `ROUND_ACTIVE` and `COUNTDOWN`.** When the deadline
   cannot be reconstructed (e.g. `currentRound` is null, or both anchors are missing,
   or `startedAt` is null), the backfill returns `phaseEndsAt = null`. The
   server-authoritative semantics around that null are fixed and tested:
   - `getRemainingMs()` MUST return `null` (NOT 0 and NOT a negative number). The
     caller distinguishes "deadline unknown" from "deadline passed" by checking
     `null` vs a non-null value.
   - The match round/resume machinery MUST treat `null` as "no automatic timeout";
     the round advances only via an explicit `endRound` call (driven by the owner
     under the H1/B1 in-memory guards + B2c fenced CAS), NOT by a
     `Date.now() - phaseEndsAt > 0` comparison.
   - **Finite recovery path:** distinguish a persistent **missing legacy anchor** from a
     transient hydrate/reconcile failure. `phaseEndsAt === null` by itself is not a retry /
     dead-letter condition for `ROUND_ACTIVE` or `COUNTDOWN`; the owner retains an
     authoritative repair/control path and may resolve the phase via the canonical
     `endRound` flow. Only genuinely recoverable failures in hydration, lease/fence
     validation, fenced persistence, or reconciliation go through B3b's bounded retry /
     dead-letter wrapper. A match is not retried or dead-lettered solely because the
     codec backfill returned `null`.
   - `endRound` MUST NOT use `phaseEndsAt === null` as a signal to eliminate players
     immediately. The fail-closed path defers the elimination to the owner's
     authoritative `endRound`, which (a) re-validates the lease/fence, (b) reads
     canonical state, and (c) emits the result event after the fenced persist —
     never on the basis of a missing deadline. This is the single consistent
     semantics: **`null` phaseEndsAt means "no auto-timeout"; player elimination
     is owned by `endRound`, not by a backfill-driven timeout.**

   > **Mixed-version window is short-lived.** `match:state` blobs have a 24h TTL and matches last
   > minutes, so v1 blobs drain quickly after B1c ships. If even a bounded grace is unacceptable,
   > the stricter option is to **gate B3 failover-takeover rollout** until no v1 blobs remain
   > (e.g. after a full TTL cycle) — call this out in the B3b rollout notes.

5. `serializeMatch` already spreads `{...state}`, so `phaseEndsAt` and
   `roundResultStartedAt` are written automatically at v2.

## Tests — `match-state.codec.spec.ts`

- **v2 round-trip**: serialize a state with `phaseEndsAt` set → deserialize → field preserved.
- **v1 → v2 back-compat**: hand-craft a `_stateVersion: 1` blob (no `phaseEndsAt`) with
  populated `startingPlayers`; deserialize → `startingPlayers` intact (NOT UNAVAILABLE),
  `phaseEndsAt` backfilled per the rules above (ROUND_ACTIVE→endsAt; COUNTDOWN→startedAt + COUNTDOWN_DURATION_MS when startedAt exists, or null when missing; RESULT→stable anchor when present, or null when absent; else null).
- **v1 ROUND_RESULT with stable anchor**: hand-craft a `_stateVersion: 1` blob in
  `ROUND_RESULT` with no `phaseEndsAt`, with `state.roundResultStartedAt = 12345`, and with
  `currentRound.endsAt` set to a different value. Deserialize → `phaseEndsAt === 12345 +
GAME_CONFIG.RESULT_DISPLAY_MS`, proving the stable-anchor path is independently testable and
  does not fall back to `currentRound.endsAt` or `Date.now()`.
- **v1 ROUND_RESULT with no stable anchor**: hand-craft a v1 blob in `ROUND_RESULT` with no reconstructable persisted anchor. `deserializeMatch` returns `phaseEndsAt === null` and does **not** derive a grace deadline from `Date.now()` during ordinary hydration.
- **v1 ROUND_ACTIVE with missing `endsAt` — anchor case:** hand-craft a v1 blob in
  `ROUND_ACTIVE` whose `currentRound` has `startedAt` set but no `endsAt` and no
  `phaseEndsAt`. Deserialize → `phaseEndsAt === startedAt + ROUND_DURATION_MS` (not
  `Date.now()`, not `null`). The codec does NOT call `Date.now()` during backfill for
  ROUND_ACTIVE; assert the value is deterministic relative to the input.
- **v1 ROUND_ACTIVE with no reconstructable deadline — fail-closed case:** v1 blob in
  `ROUND_ACTIVE` with `currentRound` either null or with both `startedAt` and `endsAt`
  missing. Deserialize → `phaseEndsAt === null` (NOT `Date.now()`, NOT
  `startedAt + ROUND_DURATION_MS` with `NaN`). The codec spec stops there: it only
  asserts the deterministic reconstructed value (or `null`) returned by `deserializeMatch`.
- **Unsupported version** (e.g. 3) still rejected as before.

Distributed lifecycle coverage belongs in the owner/recovery specs, not in
`match-state.codec.spec.ts`:

- **Fail-closed runtime semantics:** cover `getRemainingMs() === null`, the owner-only
  lease/fence validation path, and `endRound` behavior in `match-round-runner.spec.ts`
  / `match-round-runner.recovery.spec.ts`, proving that a null `phaseEndsAt` does not
  auto-timeout and does not bypass the canonical owner-controlled transition.
- **Elimination broadcasts:** verify in `match-round-runner.spec.ts` that
  `PLAYER_ELIMINATED` emissions still come only from the authoritative `endRound`
  flow, never directly from codec backfill.
- **Boot/retry hydrate integration path:** drive the B3b boot/takeover flow in
  `match-ownership.service.spec.ts` plus the relevant `GameLoopService` /
  `MatchRoundRunner` recovery specs. Force at least one retry/re-hydration before
  `resumeMatchLoop` succeeds, assert that the owner materializes the grace deadline
  only after lease acquisition and successful fenced persistence, and assert that
  every later retry reuses the persisted v2 blob / anchor rather than extending the
  deadline.

## Verify / done

- `pnpm --filter @arena/game-core exec vitest run src/match-state.codec.spec.ts` green.
- Full game-core + api suites green; rebuild `packages/game-core/dist` if consumed as built output.
- Manual sanity: an existing `match:state:*` blob written pre-B1c still deserializes with
  correct `startingPlayers`.
