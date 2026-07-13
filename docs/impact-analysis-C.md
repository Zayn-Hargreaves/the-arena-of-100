# Track C — Pre-edit Impact Analysis

> Scope: `4832e72` — `feat(afk): harden AFK/elimination UX + document semantics (Track C)`
> Pre-edit baseline (HEAD~1, first parent on main): `7935cdc`
> Branch: `worktree-plan-c-afk-hardening`
> Plan ref: `Plan-C-afk-hardening.md` § Phase C1 §30-51
> GitNexus index: refreshed via `npx gitnexus analyze` at `2026-07-13T07:39:15Z`
>
> - incremental: `changed=24, added=3, deleted=0`
> - resulting graph: `5052 nodes | 11633 edges | 213 clusters | 300 flows`
>   Captured at: `2026-07-13T07:39:15Z`

## §1 Symbol-by-symbol verbatim impact output

> Each subsection below is the verbatim result of `gitnexus_impact({direction:"upstream", ...})`
> against the freshly re-analyzed index. The `Decision` line applies the rule from
> Plan-C-afk-hardening.md § C1 §34-44 (HIGH/CRITICAL + in-scope Track C edit ⇒ risk
> KNOWN/ACCEPTED/RECORDED; HIGH/CRITICAL + out-of-scope ⇒ STOP/escalate).

### 1.1 Class `MatchStateMachine` — `packages/game-core/src/match-state-machine.ts`

- Tool: `gitnexus_impact({target:"MatchStateMachine", direction:"upstream", file_path:"packages/game-core/src/match-state-machine.ts", kind:"Class"})`
- **`risk: CRITICAL`**
- `impactedCount: 29`
- Direct callers (depth 1, will-break): 3
  - `MatchService.createMatch` — `apps/api/src/modules/match/match.service.ts` — CALLS, conf 0.85
  - `MatchStateMachine.deserialize` — `packages/game-core/src/match-state-machine.ts` — CALLS, conf 0.85
  - `packages/game-core/src/index.ts` — IMPORTS, conf 1.0
- Processes affected (18):
  `endRound`, `executeRound`, `startMatchLoop`, `finishMatchLoopInner`, `checkMatchEnd`,
  `handleMatchPlayerLeft`, `timer`, `constructor` (game-loop.service.ts), `launchRoomMatch`,
  `createFromRoom`, `handleRequestSnapshot`, `handleSubmitAnswer`, `handleAuthenticate`,
  `syncReconnection`, `handleTrackedUserSwitchDisconnect`, `disconnectPromise`,
  `handleStartMatch`, `handleLeaveRoom`.
- Modules affected (3):
  - `Match` — 15 hits, direct
  - `Handlers` — 3 hits, indirect
  - `Cluster_192` — 1 hit, direct
- **Decision (Plan §C1 §34-44)**: CRITICAL + in-scope Track C edit. Diff
  (`7935cdc..4832e72`) shows **NO public method added**, **NO signature modified**, and
  Track C edits no BE source — `MatchStateMachine` is unchanged on disk. The
  CRITICAL blast radius is inherited from the BE baseline (`40f9f63 → 013b922 →
acbae97`) and was approved under those prior reviews. ⇒ **risk KNOWN, ACCEPTED,
  recorded in this artifact**. Any future Track C follow-up that mutates
  `MatchStateMachine` requires a fresh impact run and a new artifact.

### 1.2 Method `MatchStateMachine.submitAnswer` — `packages/game-core/src/match-state-machine.ts:177`

- Tool: `gitnexus_impact({target:"submitAnswer", direction:"upstream", file_path:"packages/game-core/src/match-state-machine.ts", kind:"Method"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0 (call site uses dynamic dispatch on the state-machine
  instance; obvious runtime caller is `MatchHandler.handleSubmitAnswer` in
  `apps/api/src/gateways/handlers/match.handler.ts`).
- Processes affected: 0. Modules affected: 0.
- **Decision**: LOW. No approval gate. Track C does not edit this method.

### 1.3 Method `MatchRoundRunner.endRound` — `apps/api/src/modules/match/match-round-runner.ts`

- Tool: `gitnexus_impact({target:"endRound", direction:"upstream", file_path:"apps/api/src/modules/match/match-round-runner.ts", kind:"Method"})`
- **`risk: LOW`**
- `impactedCount: 2`
- Direct callers (depth 1): 2
  - `MatchRoundRunner.checkEarlyTermination` — `apps/api/src/modules/match/match-round-runner.ts` — CALLS, conf 0.85
  - `MatchRoundRunner.timer` — `apps/api/src/modules/match/match-round-runner.ts` — CALLS, conf 0.85
- Processes affected: 1 (`timer`, 9 hits, earliest broken step 1)
- Modules affected: 1 (`Match`, 2 hits, direct)
- **Decision**: LOW. No approval gate. Track C does not edit this method.

### 1.4 Function `applySnapshotState` — `apps/web/src/stores/socket-store.updaters.ts:447`

- Tool: `gitnexus_impact({target:"applySnapshotState", direction:"upstream", file_path:"apps/web/src/stores/socket-store.updaters.ts", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0 (runtime caller: `connect` in `apps/web/src/stores/socket-store.ts` via internal dispatch).
- **Decision**: LOW. Track C edits this function — adds `isEliminated` derivation
  from the snapshot roster (`selfEliminated = state.userId ? players.find(...)?.status === ELIMINATED : false`).
  Change is **additive** (new property in the returned partial state). No signature
  change. LOW risk confirmed.

### 1.5 Function `applyRoundEndedState` — `apps/web/src/stores/socket-store.updaters.ts:322`

- Tool: `gitnexus_impact({target:"applyRoundEndedState", direction:"upstream", file_path:"apps/web/src/stores/socket-store.updaters.ts", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0 (runtime caller: `connect`).
- **Decision**: LOW. Track C does not edit this function in `7935cdc..4832e72`.
  Track C also adds `eliminationReason: null` to `applyRoomCreatedState`,
  `applyRoomJoinedState`, `applyMatchStartedState`, `applyRoomTerminatedState`,
  `applyUnauthorizedErrorState` — those reducers are listed by Plan §C1 §30-31 only
  for completeness; they were not enumerated in the §C1 §30 10-symbol list and are
  additive property resets, not signature changes.

### 1.6 Function `applyPlayerEliminatedState` — `apps/web/src/stores/socket-store.updaters.ts:384`

- Tool: `gitnexus_impact({target:"applyPlayerEliminatedState", direction:"upstream", file_path:"apps/web/src/stores/socket-store.updaters.ts", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 1`
- Direct callers (depth 1): 1
  - `connect` — `apps/web/src/stores/socket-store.ts` — CALLS, conf 0.85
- Processes affected: 1 (`connect`, 1 hit, earliest broken step 1)
- Modules affected: 1 (`Stores`, 1 hit, direct)
- **Decision**: LOW. Track C edits the **consumer** of this function (`socket-store.ts`
  handler for `PLAYER_ELIMINATED` event), not this reducer itself. The consumer
  change is additive — `set({ isEliminated: true, eliminationReason: data.reason })`
  vs the previous `set({ isEliminated: true })`. Signature unchanged.

### 1.7 Function `AnswerPanel` — `apps/web/src/components/game/answer-panel.tsx:28`

- Tool: `gitnexus_impact({target:"AnswerPanel", direction:"upstream", file_path:"apps/web/src/components/game/answer-panel.tsx", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0
- **Decision**: LOW. Track C does not edit this component. Pre-existing
  `if (isEliminated || isSpectator)` lock at line 44 preserved.

### 1.8 Function `EliminatedOverlay` — `apps/web/src/components/game/eliminated-overlay.tsx:10`

- Tool: `gitnexus_impact({target:"EliminatedOverlay", direction:"upstream", file_path:"apps/web/src/components/game/eliminated-overlay.tsx", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0
- **Decision**: LOW. Track C edits this component — adds additive
  `reason?: EliminationReason | null` prop with default `null`. Consumer
  (`apps/web/src/app/[locale]/game/[matchId]/page.tsx`) forwards
  `eliminationReason` from the socket store. No breaking change to existing
  callers (`<EliminatedOverlay />` with no args still works because of the
  default).

### 1.9 Function `PlayerGrid` — `apps/web/src/components/game/player-grid.tsx:20`

- Tool: `gitnexus_impact({target:"PlayerGrid", direction:"upstream", file_path:"apps/web/src/components/game/player-grid.tsx", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0
- **Decision**: LOW. Track C does not edit this component. Pre-existing ELIMINATED
  render logic at lines 54-67 (`grayscale opacity-50`, `Avatar status="eliminated"`)
  preserved. **Note (not a Plan §C1 finding, recorded for next agent)**:
  `PlayerGrid` is not consumed by `apps/web/src/app/[locale]/game/[matchId]/page.tsx`
  in this branch — only `OpponentsSidebar` is (line 479). Plan §C3 §129 listed this
  file alongside `opponents-sidebar.tsx`, but the runtime sink for realtime
  elimination sync is `OpponentsSidebar`. `PlayerGrid` is still on the public API
  surface; removal is out of scope for Track C.

### 1.10 Function `OpponentsSidebar` — `apps/web/src/components/game/opponents-sidebar.tsx:28`

- Tool: `gitnexus_impact({target:"OpponentsSidebar", direction:"upstream", file_path:"apps/web/src/components/game/opponents-sidebar.tsx", kind:"Function"})`
- **`risk: LOW`**
- `impactedCount: 0`
- Direct callers (in-code): 0
- **Decision**: LOW. Track C does not edit this component. Pre-existing ELIMINATED
  badge logic at lines 88-97 preserved. This is the actual runtime sink for
  realtime elimination sync (consumed by `game/[matchId]/page.tsx:479` with
  `players={match?.players ?? []}`); the store-side `match.players[].status = ELIMINATED`
  stamp added by `socket-store.ts:281` flows through here.

## §2 Confirmed scope

Diff `7935cdc..4832e72 --stat` (verbatim, 14 files, +374/-13):

```text
apps/web/messages/en.json                                              |   4 +-
apps/web/messages/vi.json                                              |   4 +-
apps/web/src/app/[locale]/game/[matchId]/page.spec.tsx                 |   1 +
apps/web/src/app/[locale]/game/[matchId]/page.tsx                      |   3 +-
apps/web/src/components/game/eliminated-overlay.tsx                    | 30 +++++-
apps/web/src/components/game/overlays.spec.tsx                         | 26 +++++
apps/web/src/stores/socket-store.ts                                    |   6 +-
apps/web/src/stores/socket-store.types.ts                              |   5 +
apps/web/src/stores/socket-store.updaters.spec.ts                      | 73 +++++++++++++
apps/web/src/stores/socket-store.updaters.ts                           | 28 ++++-
docs/afk-policy.md                                                     | 71 +++++++++++++
memory-bank/progress.md                                                | 13 ++-
packages/game-core/src/match-state-machine.spec.ts                     | 116 +++++++++++++++++++++
packages/shared/src/events.ts                                          |   7 +-
```

### Scope confirmation checklist

- [x] **No public method added to `MatchStateMachine`.** Verified via
      `git diff 7935cdc..4832e72 -- packages/game-core/src/match-state-machine.ts`
      (returns empty — the only game-core file touched is the spec).
- [x] **No public method signature modified on the explicitly checked
      shared BE files.** Verified via
      `git diff 7935cdc..4832e72 -- packages/game-core/src/match-state-machine.ts apps/api/src/modules/match/match-round-runner.ts packages/game-core/src/match-state.codec.ts packages/game-core/src/round-elimination.ts apps/api/src/modules/match/game-loop.events.ts`
      (returns empty for all five files).
- [x] **No BE state-machine or round-runner code change.** Same diff
      above is empty for `apps/api/src/modules/match/match-round-runner.ts`
      and `packages/game-core/src/match-state-machine.ts`.

> Scope honesty note: this checklist narrows the claim to **the five
> explicitly checked shared BE files**. The §1.1 `gitnexus_impact` result
> enumerates **18 processes** that depend on `MatchStateMachine`, but the
> per-process file paths were not individually re-diffed here. Any
> follow-up that touches a shared BE file **not in the five above** must
> re-validate by adding that file to the diff command and re-running
> `git diff` before merging.

- [x] **All Track C edits are behavior-additive (no wire-format change).** Verified per file:
  - `socket-store.ts` (line 281) — additive `set({ isEliminated: true, eliminationReason: data.reason })`.
  - `socket-store.types.ts` — additive `eliminationReason: EliminationReason | null` field.
  - `socket-store.updaters.ts` — additive `eliminationReason: null` resets in 5 reducers +
    additive `isEliminated: selfEliminated` derivation in `applySnapshotState`.
  - `eliminated-overlay.tsx` — additive `reason?: EliminationReason | null` prop.
  - `game/[matchId]/page.tsx` — destructure `eliminationReason` from store, forward as prop.
  - `messages/{en,vi}.json` — additive i18n keys.
  - `shared/events.ts` — **source-declaration refactor (only non-additive change in Track C)**: replace inline `reason: "WRONG_ANSWER" | "TIMEOUT"` union with `reason: EliminationReason` reference and add named `export type EliminationReason = ...` declaration. Wire format / JSON shape unchanged.
  - `match-state-machine.spec.ts` — 5 new tests in a new `describe` block.
  - `overlays.spec.tsx` — 4 new tests in the existing `EliminatedOverlay` block.
  - `socket-store.updaters.spec.ts` — 3 new tests in a new `describe` block.
  - `docs/afk-policy.md` — new file (71 lines, semantics doc).
  - `memory-bank/progress.md` — entry for 2026-07-11 added.
- [x] **Blast radius of Track C** ≤ 11 distinct files outside test/docs
      (`messages/{en,vi}.json`, `page.tsx`, `page.spec.tsx`, `eliminated-overlay.tsx`,
      `overlays.spec.tsx`, `socket-store.ts`, `socket-store.types.ts`,
      `socket-store.updaters.ts`, `socket-store.updaters.spec.ts`,
      `match-state-machine.spec.ts`, `events.ts`).
- [x] **Phase C2 BE (helper, sentinel, codec, runner, tests)** was shipped by
      Track K6 (`40f9f63 → 013b922 → acbae97`), not Track C. Track C inherits but
      does not extend that work. The `MatchStateMachine` CRITICAL blast radius is
      covered by the Track K6 reviews (see §3 baselines).

## §3 Revision binding

| Item                                                         | Value                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------- | ------------ | ---------- |
| HEAD (this commit)                                           | `4832e72e8083e46a921696653a70cec3ed654019`                                         |
| Pre-edit baseline (HEAD~1, first parent on main)             | `7935cdcddba64bcb27b7c58fd91a186dc64ed2a6`                                         |
| Original branch tip pre-merge (`7935cdc^2`, i.e. `1f472e4^`) | `1f472e41d30b8dea08dcb70e32a41ed0600152be`                                         |
| Branch name                                                  | `worktree-plan-c-afk-hardening`                                                    |
| Track K6 baseline (Phase C2 BE origin, ordered)              | `40f9f63 → 013b922 → acbae97`                                                      |
| Track K6 Phase C2 BE commit tip                              | `acbae97`                                                                          |
| GitNexus index version                                       | re-analyzed `2026-07-13T07:39:15Z` (incremental: `changed=24, added=3, deleted=0`) |
| GitNexus graph post-analyze                                  | `5052 nodes                                                                        | 11633 edges | 213 clusters | 300 flows` |

`git diff 7935cdc..4832e72 --stat` reproduces the 14-file Track C delta verbatim
(see §2 for the diffstat block).

## §4 Reviewer

> **No independent reviewer available — POLICY EXCEPTION recorded.**

- Reviewer status: **none (author-only review)**.
- Rationale: at the time of artifact generation (2026-07-13T07:55:28Z),
  the only contributor on `worktree-plan-c-afk-hardening` is the diff
  author (`Zayn-Hargreaves`). The repository's git history shows a
  single author across the commits being checked — `git log --format="%an" 7935cdc..4832e72`
  returns `Zayn-Hargreaves`. No second human was available to perform
  4-eyes review.
- Conflict-of-interest disclosure: the listed "reviewer" handle in
  prior drafts (`Zayn-Hargreaves`) was the same individual as the sole
  diff author. Self-approval is **NOT** treated as independent review
  under this artifact and is explicitly **disallowed for audit
  purposes**.
- Required action before this artifact may be cited as compliance
  evidence: a second reviewer (any individual with `code review` write
  on the repo) must sign off on the SHAs in §3 and re-run the
  `gitnexus_impact` batch in §1 against the PR tip. The captured-at
  timestamp below records artifact generation only; it is **not** an
  approval timestamp under §4.

## §5 Confirmation timestamp

- Author-self-attestation timestamp (artifact generation only,
  **not** an approval under §4): `2026-07-13T07:55:28Z`
- Indexed-data captured at: `2026-07-13T07:39:15Z`
- No independent approval timestamp — see §4 policy exception.

## §6 Cross-references

- Plan: `Plan-C-afk-hardening.md` § Phase C1 §30-51 (decision rule for HIGH/CRITICAL)
- Track C commit: `4832e72`
- Track K6 Phase C2 BE commits (ordered): `40f9f63`, `013b922`, `acbae97`
- Consumer doc (semantics): `docs/afk-policy.md`
- Memory-bank entry: `memory-bank/progress.md` § "Run Numbers & Test Notes" — 2026-07-11
- GitNexus index resource: `gitnexus://repo/the-arena-of-100/context`

## §7 Notes for the next agent

1. **§4 records a POLICY EXCEPTION (no independent reviewer).** §5 timestamp
   is author-self-attestation, not an external approval. If team policy
   requires 4-eyes review, do **NOT** cite this artifact as compliance
   evidence until a second reviewer signs off on §3 SHAs and re-runs
   §1 against the PR tip. Once a second reviewer is added, update §4 with
   their handle (and replace the §5 attestation timestamp with the
   approval timestamp).
2. **Re-validate against the actual PR commit SHA** before merging Track C. If the
   SHA changes (force-push, rebase, etc.), regenerate §1 from a fresh
   `gitnexus_impact` batch — and re-run `npx gitnexus analyze` first if more than
   5 commits have landed since `2026-07-13T07:39:15Z`.
3. **Plan §C1 §34-44 decision rule was applied** to §1.1 (`MatchStateMachine`
   class): CRITICAL + in-scope Track C edit + blast radius ≤ 11 file + no public
   API change ⇒ **risk KNOWN, ACCEPTED, recorded in this artifact**. Any future
   Track C follow-up that mutates `MatchStateMachine` requires a fresh impact run
   and a new artifact — do not reuse this one.
4. **Phase C2 BE work is not in scope** for this artifact; it was approved under
   Track K6. The MatchStateMachine CRITICAL blast radius is inherited, not new.
5. **`PlayerGrid` (file `apps/web/src/components/game/player-grid.tsx`)** is not
   consumed by the game runtime page in this branch. Plan §C3 §129 grouped it
   with `OpponentsSidebar`, but the actual sink is `OpponentsSidebar`. If a
   future cleanup removes `PlayerGrid`, no game-runtime breakage is expected —
   but verify with `grep -rn "components/game/player-grid" apps/` first.
