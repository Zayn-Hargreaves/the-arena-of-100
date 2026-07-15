# B1a — Impact analysis GATE (no code)

**Depends on:** nothing (do any time before B1b). **Output:** a doc, no source edits.
**Commit:** `docs(distributed): B1a blast-radius snapshot for distributed refactor`.

## Why

CLAUDE.md **mandates** running `gitnexus_impact` before editing CRITICAL symbols and
**warning the user on HIGH/CRITICAL**. `MatchStateMachine` is flagged CRITICAL in
`memory-bank/progress.md`. Do this once, up front, so B1b–B5 can proceed with the blast
radius already recorded and surfaced.

## Steps

1. Run and capture verbatim output for each (`direction: "upstream"`):
   - `MatchStateMachine.transition`
   - `MatchStateMachine.startRound`
   - codec `serializeMatch` / `deserializeMatch` (the canonical serialization symbols B1c edits;
     `MatchStateMachine.serialize`/`deserialize` just delegate to these)
   - `MatchService.persistStateMachine`, `MatchService.getStateMachine`, `MatchService.finishMatch`
   - `MatchRoundRunner.startMatchLoop`, `MatchRoundRunner.checkEarlyTermination`
   - `GameLoopService.launchRoomMatch`
   - `PresenceService.sweep`
   - `MatchHandler.handleSubmitAnswer`

   Use GitNexus `gitnexus_impact` for blast radius and `gitnexus_query`/`gitnexus_context` for
   symbol + execution-flow tracing. **Do NOT treat `grep` as equivalent** — if GitNexus is
   unavailable, stop and say so, and explicitly document what cannot be traced (transitive
   callers, execution-flow/process membership, cross-module ripple) rather than presenting a
   grep of direct call sites as full coverage.

2. Write `docs/plans/distributed/impact-analysis.md`: for each symbol record
   `impactedCount / processes / modules / riskLevel` and the direct callers. Bind it to the
   current commit hash (`git rev-parse --short HEAD`).

3. **Surface to the user**: post a short summary of every HIGH/CRITICAL result and get
   acknowledgement before B1b begins editing `MatchStateMachine`. Note the memory-bank
   canonical snapshot (29 impacted / 18 processes / 3 modules) for comparison.

## Done

- `docs/plans/distributed/impact-analysis.md` exists, bound to a commit hash.
- HIGH/CRITICAL results surfaced to the user (this is the gate — do not start B1b until done).
