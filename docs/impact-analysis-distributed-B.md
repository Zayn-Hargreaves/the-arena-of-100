# B1a — Distributed Refactor Blast-Radius Snapshot

> **Phase:** B1a (impact-analysis GATE, no source code).
> **Mandate:** `CLAUDE.md` requires `gitnexus_impact` before editing **any**
> symbol, and **warning the user on HIGH/CRITICAL**. This doc records the blast
> radius once, up front, so B1b–B5 proceed with it already surfaced.
> **Revision binding:** `HEAD = 15d68de` (main, post Stage-A merge PR #75/#76).
> **Captured:** `2026-07-17T18:23:05Z`. Re-run any symbol below if a later phase
> touches one not covered here, or if the index drifts from this revision.
> **Tool:** `gitnexus_impact({direction: "upstream", mode: "callgraph"})`,
> `summaryOnly` for hub symbols. Repo `the-arena-of-100`.

## Verbatim results (upstream blast radius)

| Symbol                                   | File                                               | Risk           | Impacted | Direct | Processes | Modules             | Edited by                          |
| ---------------------------------------- | -------------------------------------------------- | -------------- | -------- | ------ | --------- | ------------------- | ---------------------------------- |
| `MatchStateMachine.transition`           | `packages/game-core/src/match-state-machine.ts`    | **CRITICAL**   | 17       | 6      | 11        | 1 (Match)           | B1b                                |
| `MatchStateMachine.startRound`           | `packages/game-core/src/match-state-machine.ts`    | **HIGH**       | 3        | 1      | 3         | 1 (Match)           | B1b                                |
| `serializeMatch`                         | `packages/game-core/src/match-state.codec.ts`      | LOW            | 0        | 0      | 0         | 0                   | B1c                                |
| `deserializeMatch`                       | `packages/game-core/src/match-state.codec.ts`      | LOW            | 0        | 0      | 0         | 0                   | B1c                                |
| `MatchService.persistStateMachine`       | `apps/api/src/modules/match/match.service.ts`      | **MEDIUM**     | 31       | 11     | —         | 1                   | B4 (persist path)                  |
| `MatchService.getStateMachine`           | `apps/api/src/modules/match/match.service.ts`      | **CRITICAL**   | 30       | 13     | 18        | 2 (Match, Handlers) | B3b/B4 (read path)                 |
| `MatchService.finishMatch`               | `apps/api/src/modules/match/match.service.ts`      | **CRITICAL**   | 6        | 2      | 5         | 1 (Match)           | B3b (finalize)                     |
| `MatchRoundRunner.startMatchLoop`        | `apps/api/src/modules/match/match-round-runner.ts` | **HIGH**       | 4        | 1      | 3         | 2                   | B2b/B3a                            |
| `MatchRoundRunner.checkEarlyTermination` | `apps/api/src/modules/match/match-round-runner.ts` | LOW            | 0        | 0      | 0         | 0                   | (B2c fences its callee boundaries) |
| `GameLoopService.launchRoomMatch`        | `apps/api/src/modules/match/game-loop.service.ts`  | LOW            | 3        | 2      | 2         | 2                   | B2b                                |
| `PresenceService.sweep`                  | `apps/api/src/modules/match/presence.service.ts`   | LOW (upstream) | 1        | 1      | 0         | 1                   | B5                                 |
| `MatchHandler.handleSubmitAnswer`        | `apps/api/src/gateways/handlers/match.handler.ts`  | LOW            | 0        | 0      | 0         | 0                   | B4b                                |

Ambiguity notes (resolved by candidate UID):

- `persistStateMachine` — two matches; authoritative is
  `Method:...match.service.ts:MatchService.persistStateMachine#1` (31 impacted,
  MEDIUM). The other is a spec-local const (0).
- `checkEarlyTermination` — the `MatchRoundRunner` method (0 upstream) vs the
  `GameLoopService` facade (1). B2c fences the _callees_ it reaches (`endRound`,
  `checkMatchEnd`, `finishMatchLoopInner`), not this entry itself.
- `handleSubmitAnswer` — `MatchHandler` method (0) is the B4b target; the
  `GameGateway` delegate (0) just forwards.

## HIGH / CRITICAL surfaced to user (CLAUDE.md mandate)

⚠️ **Five symbols are HIGH/CRITICAL. Phases touching them proceed with the
following understood:**

1. **`MatchStateMachine.transition` — CRITICAL (17 impacted, 11 processes).**
   The hub of the game loop. **B1b edits it** to set `phaseEndsAt` on every
   transition. Mitigation: additive only — a new field write inside the existing
   switch, **no signature change, no control-flow change**. Every one of the 11
   processes calls `transition` the same way after B1b. Full API suite must stay
   green (984/984) to prove no behavioral drift.

2. **`MatchService.getStateMachine` — CRITICAL (30 impacted, 18 processes, 2
   modules).** The universal read/hydrate path. **B3b/B4 read through it** but do
   **not** change its signature — B3a takes an already-hydrated SM from the
   caller (B3b) precisely to avoid a second hydration / TOCTOU. No edit to this
   symbol's contract is planned; it is listed because recovery/answer phases
   depend on its current behavior.

3. **`MatchService.finishMatch` — CRITICAL (6 impacted, 5 processes).** B3b's
   finalize path must remain the single terminal writer. B3b adds a fenced
   tombstone in the _same_ atomic finalize primitive rather than a parallel
   store, so `finishMatch`'s existing DB-uniqueness guard
   (`updateMany status != FINISHED`) stays the correctness backstop.

4. **`MatchStateMachine.startRound` — HIGH (3), `MatchRoundRunner.startMatchLoop`
   — HIGH (4).** B1b/B2b/B3a touch these. Additive: `phaseEndsAt` on
   `startRound`; ownership acquire wrapped _around_ `startMatchLoop`, not inside
   its core.

## Scope confirmation

- **No public API / signature changes** are planned for any CRITICAL symbol. All
  edits are additive (new field writes, new wrapping call sites, new methods).
- The three **mutating boundaries B2c fences** are `endRound` (~275),
  `checkMatchEnd` (~651), `finishMatchLoopInner` (~706) in
  `match-round-runner.ts` — fencing is a guard _prepended_, not a rewrite.
- `PresenceService.sweep` shows LOW _upstream_ (1 caller — its own interval), but
  its **downstream** mutation surface is large (disband, remove players,
  `handlePlayerDisconnect`). B5's risk is therefore in what it _drives_, not who
  calls it; B5 makes it leader-only so only one node drives that surface.

## Policy exception (no independent reviewer)

Mirroring `docs/impact-analysis-C.md §4`: this snapshot is **author
self-attested**, not independently reviewed. Recorded at
`2026-07-17T18:23:05Z` against `HEAD = 15d68de`. This is a record of due
diligence, **not an approval**. Any phase that ends up touching a CRITICAL
symbol's _signature_ (not planned) must re-surface to the user before merge.
