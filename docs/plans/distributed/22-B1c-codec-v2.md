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
2. Replace the strict gate with a supported-set that **also** rejects values
   that are not numerically-integer, so a future version (3), a string version
   (`"2"`), a boolean, an object, or `null` is rejected **before** any state
   hydration runs:

   ```ts
   const SUPPORTED_STATE_VERSIONS = new Set([1, 2]);
   function hasSupportedStateVersion(parsed: unknown): boolean {
     const version = (parsed as { _stateVersion?: unknown })?._stateVersion;
     return Number.isInteger(version) && SUPPORTED_STATE_VERSIONS.has(version);
   }
   ```

   **On numerical equivalence of integer values.** `JSON.parse` and
   `Number.isInteger` cannot distinguish `2` from `2.0` (or `2.0000`, `2e0`,
   etc.) — they are the same IEEE 754 number, and the JSON spec does not
   preserve lexical form. `_stateVersion: 2.0` is therefore _accepted_ by
   `hasSupportedStateVersion` and treated identically to `_stateVersion: 2`.
   This is the intended behavior: a v2 blob is a v2 blob regardless of how
   the integer was written on the wire. If a stricter contract is later
   required (e.g. to reject hand-edited blobs that round-trip a 1.5 to 2
   through NaN), the gate would have to inspect the raw JSON representation
   _before_ parsing — for example by walking the string for the
   `"_stateVersion"` key and checking the literal token — because the
   numeric value is already lossy by the time `JSON.parse` returns. That is
   out of scope for B1c. The supported set semantics are still in force:
   `Number.isInteger(3) === true` AND `SUPPORTED_STATE_VERSIONS.has(3) === false`,
   so any integer _not_ in the supported set — including all future
   versions — is rejected on a single, well-defined error path. Values that
   `Number.isInteger` rejects (strings, booleans, objects, `null`, `NaN`,
   `Infinity`, floats) are rejected at the same gate.

   `deserializeStartingPlayers` (and anything else that branched on the strict
   check) now treats both 1 and 2 as supported, so v1 `startingPlayers` semantics
   are preserved. **Order of operations:** `hasSupportedStateVersion` is the
   first gate after JSON parse. Only after it returns `true` does the
   deserializer touch `state`, `currentRound`, or `eventLog`. Any unsupported
   version throws _before_ any field is read or copied.

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

4. **Wire schema for the timing fields.** Extend `DeserializedMatch.state` and the
   inline `DeserializedMatch` shape in `match-state.codec.ts` so the JSON wire
   format explicitly declares every timing field the deserializer will read.
   The unified rule is: **every timing field accepts `finite number` OR the
   value(s) explicitly permitted by its semantic role; only `undefined` means
   "missing" and triggers v1 backfill; any other type is rejected.** `null`
   is preserved unchanged for every field where it is semantically valid —
   it is the canonical "deadline unknown" / "no anchor yet" sentinel and is
   never thrown away by validation:
   - `state.phaseEndsAt`: `number | null | undefined`. `null` is the
     canonical "deadline unknown" value (returned by the fail-closed backfill
     and produced by the B3b owner before it materializes a fresh grace
     deadline). `undefined` is "missing on a v1 blob" and triggers the
     status-aware backfill in edit 5. A finite number passes through.
   - `state.roundResultStartedAt`: `number | null | undefined`. `null` is
     the documented default (the B1b state machine sets it to `null` in
     every non-`ROUND_RESULT` phase). `undefined` is "missing on a v1 blob"
     — there is no backfill for this field, since the result-phase anchor is
     only meaningful when `status === ROUND_RESULT`. A finite number passes
     through.
   - `state.startedAt`: `number | null | undefined`. `null` and `undefined`
     are both legal — a v2 blob whose COUNTDOWN phase has not yet been armed
     may have either, since the state machine only sets `startedAt` on the
     COUNTDOWN transition. A finite number passes through.

     **Validation during `deserializeMatch`.** All raw timing fields are
     validated **before any backfill or arithmetic runs**, in a fixed two-phase
     order so a malformed field can never feed into a `NaN` deadline that
     reaches `getRemainingMs`:

   - **Phase 1 — validate every timing field on the raw wire object.** For
     each of `state.phaseEndsAt`, `state.roundResultStartedAt`,
     `state.startedAt`, `currentRound.endsAt`, and
     `currentRound.startedAt`, the deserializer checks, in order: (1) is
     the value `undefined`? → mark the field "missing on a v1 blob"; (2) is
     the value `null`? → permitted for `state.phaseEndsAt`,
     `state.roundResultStartedAt`, and `state.startedAt` (per the per-field
     type union above), preserved unchanged; for the nested
     `currentRound.endsAt` / `currentRound.startedAt`, `null` is also
     permitted (it means "this anchor is not present", which is a legal
     v1-blob shape), preserved unchanged; (3) is the value a finite number
     (i.e. `Number.isFinite(value)`)? → permitted, preserved unchanged;
     (4) anything else (string, object, boolean, array, `NaN`,
     `Infinity`) → throw an invalid-data error **immediately**, before any
     other field is read, before any backfill, before any arithmetic. The
     error message MUST NOT echo the offending payload (payloads can leak
     question/answer content).
   - **Phase 2 — v1 backfill of `phaseEndsAt` only.** This phase runs only
     after Phase 1 has accepted every timing field on the raw object.
     Only `state.phaseEndsAt` is backfilled. `state.roundResultStartedAt`
     and `state.startedAt` are **not** backfilled — if a v1 blob omits
     them, they remain `undefined` on the returned `MatchState` (or `null`
     for `roundResultStartedAt`, which the state machine's B1b contract
     declares as the default for any non-`ROUND_RESULT` phase). The
     backfill uses the already-validated, already-known-finite
     `currentRound.endsAt` / `currentRound.startedAt` from Phase 1 — the
     backfill itself does not re-validate the nested fields; Phase 1
     guarantees they are either `undefined`, `null`, or a finite number
     by the time backfill runs.
   - **Reusing the validator.** Extract the Phase 1 check into a single
     helper that **returns the validated value** (not a type predicate —
     a `value is …` predicate returns a boolean and cannot express the
     "return the value or throw" behavior below, and `undefined` would
     fall outside the predicate type anyway):
     `validateTimingField(value: unknown, opts: { allowNull: boolean }):
number | null | undefined`. Call it from every timing-field site
     (state top-level, `currentRound` nested, and any future wire field),
     and have each call site use the **returned** value rather than the
     raw wire value. The helper's contract is the unified rule above:
     `undefined` is returned (treated as "missing"), `null` is returned
     only when `allowNull` is `true` (otherwise throw), a finite number
     is returned, anything else throws with no payload in the message.
     Every backfill and arithmetic site that reads a timing field MUST go
     through this helper. **There is no other way** a timing field reaches
     a `+` operator, a comparison, or `getRemainingMs` without being
     declared finite by the helper.

   This makes the hydration path **fail-closed** for malformed temporal
   data — `getRemainingMs` can never observe a NaN, a string, or a value
   derived from a corrupted anchor, and a payload that explicitly carries
   `null` is never upgraded to a fabricated deadline by the deserializer.

5. In `deserializeMatch`, backfill `phaseEndsAt` when absent (v1 blob). **Date.now() is
   PROHIBITED inside ordinary `deserializeMatch` hydration for every existing phase** —
   calling `Date.now()` there would let repeated `getStateMachine()` hydrations mint a new
   deadline on every read. Reconstruct deterministically where a stable persisted anchor
   exists, and otherwise leave the deadline unresolved until the B3b recovery/takeover
   owner acquires the lease and materializes the one-time grace window.
   The backfill runs **only after Phase 1 has accepted every timing field**
   (per the wire-schema rule above); in particular, the nested
   `currentRound?.endsAt` and `currentRound?.startedAt` are guaranteed
   `undefined`, `null`, or a finite number by the time backfill touches
   them. The backfill branches are:
   - `status === ROUND_ACTIVE` → use `currentRound?.endsAt` when present
     and **finite** (Phase 1 has already confirmed it is finite or `null`,
     so a non-finite value is unreachable here). When `endsAt` is missing
     (`undefined`) or `null`, anchor to
     `currentRound?.startedAt + GAME_CONFIG.ROUND_DURATION_MS` only when
     `startedAt` is present and **finite** (the same Phase 1 guarantee);
     otherwise fail closed. **Never default to `Date.now()`.**
   - `status === COUNTDOWN` → **guard on `state.startedAt`**: use the
     anchored deadline `state.startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS`
     **only when `state.startedAt` is a finite number**. (Phase 1 has
     already rejected non-finite `startedAt`, so a `NaN` cannot reach this
     arithmetic.) When `state.startedAt` is `null` or `undefined`, **fail
     closed** — this deserialize path only ever sees a resumed/legacy blob,
     never a freshly armed phase, so it must NOT be granted a fresh full
     `COUNTDOWN_DURATION_MS` window (that would let a takeover restart the
     countdown, non-authoritatively extending timing across failover).
     (Never add `COUNTDOWN_DURATION_MS` to a null/undefined `startedAt` —
     that would both yield `NaN` and re-grant a full window.) A fresh
     `Date.now() + duration` window is reserved strictly for genuinely new,
     never-armed COUNTDOWN state — which is armed by `transition`, not
     reconstructed here. **Never default to `Date.now()`.**
   - `status === ROUND_RESULT` → ordinary `deserializeMatch` MUST NOT mint
     a fresh `Date.now() + GAME_CONFIG.RESULT_DISPLAY_MS` deadline. Reuse
     only the dedicated persisted `state.roundResultStartedAt` anchor
     (validated as a finite number or `null` in Phase 1): when the
     validated anchor is a finite number, set
     `phaseEndsAt = roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS`;
     when the anchor is `null` or missing (`undefined`), leave
     `phaseEndsAt` unresolved (`null`) during normal hydration. Do **not**
     reuse `currentRound.endsAt`, which belongs to the completed gameplay
     round rather than the result-display phase. The **single server-authoritative owner that just acquired
     the lease in B3b** is the only layer allowed to materialize the fresh
     grace deadline, and it must fenced-persist that hydrated v2 blob back
     to Redis exactly once **before** `resumeMatchLoop` continues. Existing
     v2 blobs with a `phaseEndsAt` already set continue to pass through
     unchanged. **The B3b owner materialization path is the only place
     where `Date.now()` is allowed.**
   - else → `null`.
     Do this only if `parsed._stateVersion === 1 &&
parsed.state.phaseEndsAt === undefined`, so only genuine v1 blobs are
     backfilled and **v2 blobs pass through untouched — including a v2 blob
     whose `phaseEndsAt` is somehow missing** (a v2 writer always spreads
     `{...state}`, so that shape is anomalous and must not be silently
     repaired by the v1 backfill). A v1 blob that contains a malformed
     `currentRound` (e.g. `endsAt: "soon"`, `startedAt: { value: 12345 }`,
     or a non-finite number) MUST have been rejected in Phase 1 and MUST NOT
     reach this backfill path.

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

6. `serializeMatch` already spreads `{...state}`, so `phaseEndsAt` and
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
- **Non-integer-typed `_stateVersion` rejected:** hand-craft a v1-shaped blob with
  `_stateVersion: "2"` (string), `_stateVersion: true` (boolean),
  `_stateVersion: null`, or `_stateVersion: { value: 1 }` (object). Each MUST
  throw on `deserializeMatch` and MUST NOT silently coerce. This proves the
  `Number.isInteger` guard from edit 2 rejects every non-numeric shape.
- **Future version rejected:** hand-craft a v1-shaped blob with `_stateVersion: 3`. MUST
  throw. Confirms the supported-set semantics from edit 2 still hold.
- **Invalid `phaseEndsAt` types rejected (JSON-representable bad values):** for
  each of the following, hand-craft a v2 blob in `ROUND_ACTIVE` by
  `JSON.stringify` of an object, then feed the resulting JSON string to
  `deserializeMatch` and assert it throws — without leaking the payload
  into the error message:
  - `state.phaseEndsAt: "soon"` (string)
  - `state.phaseEndsAt: { value: 12345 }` (object)
  - `state.phaseEndsAt: true` (boolean)
  - `state.phaseEndsAt: ["a", "b"]` (array)
    Each rejection MUST occur before any backfill or `currentRound` read, so
    `getRemainingMs` can never observe a corrupted deadline. `null` is **not**
    in this matrix — it is the canonical "deadline unknown" value and must
    be preserved unchanged. `undefined` is **not** in this matrix either —
    it is treated as "missing on a v1 blob" and triggers the status-aware
    backfill in edit 5.
- **Non-finite `phaseEndsAt` values rejected (parsed-object / direct-validation
  path):** `JSON.stringify(NaN)` returns `"null"` and `JSON.stringify(Infinity)`
  returns `"null"`, so a JSON-roundtrip fixture cannot actually carry a
  non-finite number. The non-finite rejection is covered by **two parallel
  paths**, each independent of the JSON wire format:
  1. **Parsed-object fixture:** build the parsed object literally in
     JavaScript (e.g. `const parsed = JSON.parse('{"_stateVersion": 2, ...}')`
     for the surrounding shape, then mutate
     `parsed.state.phaseEndsAt = NaN` and call the deserializer's internal
     validation function directly — bypassing `JSON.stringify`, which
     would otherwise collapse `NaN` to `null`). Assert the validation
     function throws.
  2. **Direct validation helper call:** call
     `validateTimingField(NaN, { allowNull: true })` and
     `validateTimingField(Infinity, { allowNull: true })` directly.
     Assert each throws. This proves the helper is the single source of
     truth and is not coupled to the JSON wire at all.
     Both paths are required; together they prove the validation logic
     rejects `NaN` and `Infinity` without conflating the check with the
     valid `null` sentinel.
- **Invalid `roundResultStartedAt` types rejected (JSON-representable bad
  values):** same matrix as `phaseEndsAt` (string, object, boolean, array).
  `null` is **not** in this matrix — it is the documented default value and
  must be preserved unchanged. `undefined` is **not** in this matrix
  either — it is "missing on a v1 blob" and is left as `undefined` on
  `DeserializedMatch.state` (no backfill for this field; the result-phase
  anchor is only meaningful when `status === ROUND_RESULT`). Each invalid
  type MUST throw.
- **Non-finite `roundResultStartedAt` values rejected (parsed-object /
  direct-validation path):** same two-path coverage as
  `phaseEndsAt` — parsed-object fixture (`parsed.state.roundResultStartedAt = NaN`)
  and direct `validateTimingField(NaN, …)` / `validateTimingField(Infinity, …)`
  calls. Each MUST throw.
- **`phaseEndsAt: null` and `roundResultStartedAt: null` are preserved:**
  hand-craft a v2 blob with `state.phaseEndsAt: null` and a v2 blob with
  `state.roundResultStartedAt: null`. Both MUST round-trip with `null`
  preserved on the returned `state`. This is the explicit guard against
  the "reject null" mistake and is what `getRemainingMs` relies on to
  distinguish "deadline unknown" from "deadline passed".
- **Invalid `state.startedAt` types rejected (JSON-representable bad
  values):** hand-craft a v2 blob in `COUNTDOWN` with `state.startedAt`
  set to a string, an object, a boolean, or an array. Each MUST throw.
  `state.startedAt: null` and `state.startedAt: undefined` MUST both
  pass through (null is the COUNTDOWN-before-armed default).
- **Non-finite `state.startedAt` values rejected (parsed-object / direct-
  validation path):** same two-path coverage — parsed-object fixture
  (`parsed.state.startedAt = NaN`) and direct `validateTimingField(NaN, …)` /
  `validateTimingField(Infinity, …)`. Each MUST throw.
- **Invalid `currentRound.endsAt` and `currentRound.startedAt` rejected**
  (the nested-anchor validation in Phase 1 of edit 4). Two paths:
  1. **JSON-representable bad values:** for each of
     `currentRound.endsAt: "soon"`, `currentRound.endsAt: { value: 1 }`,
     `currentRound.endsAt: true`, `currentRound.startedAt: "later"`,
     `currentRound.startedAt: [1]`, hand-craft a v1 blob in `ROUND_ACTIVE`
     (no `state.phaseEndsAt`) by `JSON.stringify` and call
     `deserializeMatch`. Each MUST throw before the backfill arithmetic
     runs — i.e. `phaseEndsAt` MUST NOT be set to `NaN`, `"soon" + duration`,
     or any other derived value. The error MUST NOT echo the payload.
     Additionally, cover at least one non-`ROUND_ACTIVE` status so the
     nested-anchor validation cannot be implemented inside the
     `ROUND_ACTIVE` backfill branch by accident: a v1 blob in `COUNTDOWN`
     with `currentRound.endsAt: "soon"` and a v1 blob in `ROUND_RESULT`
     with `currentRound.startedAt: { value: 12345 }` MUST each throw
     before any derived timing value is produced. Phase 1 validates all
     nested anchors **before** any status-specific handling, regardless
     of `status`.
  2. **Non-finite values:** same JSON roundtrip limitation applies.
     `currentRound.endsAt: NaN`, `currentRound.endsAt: Infinity`,
     `currentRound.startedAt: NaN`, and `currentRound.startedAt: Infinity`
     are covered by parsed-object fixtures (`parsed.currentRound.endsAt = NaN`
     / `parsed.currentRound.startedAt = NaN` after `JSON.parse` of the
     surrounding shape) fed to the same status-independent nested-anchor
     validation path exercised in path 1 (the deserializer's internal
     validation, not the helper in isolation), and by direct
     `validateTimingField(NaN, …)` / `validateTimingField(Infinity, …)`
     calls. Each MUST throw before any derived timing value is produced.
     These tests are the regression guard for Finding 1: a v1 blob whose
     nested round clock is corrupted MUST fail closed, not silently produce
     a `NaN` deadline.
- **Valid temporal fields still work:** round-trip a v2 blob with finite numbers in
  every timing field; assert all values preserved. Round-trip a v2 blob with
  `phaseEndsAt: null`; assert preserved. Round-trip a v2 blob with `startedAt: null`;
  assert preserved. These three cases guard against the validation logic accidentally
  rejecting legal payloads.

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
