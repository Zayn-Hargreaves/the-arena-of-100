# Plan: Arena of 100

## Goal

Ship the MVP core loop without a broad architecture rewrite:

- finish lobby lifecycle [COMPLETED]
- add graceful exit and presence handling [COMPLETED]
- keep frontend refactors incremental [COMPLETED]
- isolate high-risk shell cleanup into its own phases [COMPLETED]

## Current State

Done and verified:

- Core match loop works with deterministic tie-breaks.
- Lobby lifecycle (`WAITING -> COUNTDOWN -> STARTING -> IN_GAME`) fully implemented.
- Heartbeat & Presence tracking (Redis-backed last-seen sweep) fully operational.
- Graceful exit, surrender path, and result page transitions implemented.
- Robust, cross-browser clipboard copy mechanism with fallback.
- Client-side Spectator View when eliminated.
- AppShellLayout/Sidebar visual cleanup, modern design guidelines compliance, and mobile UX/a11y verified.
- 100% test passing rate across packages (`@arena/game-core`, `@arena/api`, `@arena/web`, `@arena/shared`).

Main gap now:

- Refactoring and addressing remaining technical debt (asRoomType consolidation, batch player removal, deterministic tie-break sorting, and RoomCodeCard copy-to-clipboard polish).

Important risk notes from GitNexus:

- `RoomService` has MEDIUM upstream impact across room controller and auth/room/match handlers
- `AppShellLayout` has CRITICAL upstream impact across 8 pages, so shell cleanup must be isolated
- one GitNexus query reported degraded FTS search; if symbol search feels weak, run `gitnexus analyze --force` before implementation

## Rules For 200k-Token Models

- One phase = one PR = one primary problem.
- Do not mix backend lobby work with shell/layout cleanup in the same phase.
- Do not do a repo-wide Atomic Design migration.
- Only extract components on the page currently being changed.
- Hard cap per phase:
  - around 8-12 production files
  - around 3-6 test files
  - no more than 2 subsystems at once
- Prefer extending existing services/handlers over introducing a new abstraction layer unless duplication becomes clear.
- Every phase must end with verification, not just code changes.
- Do not reopen `/profile` and `/rankings` unless fixing a regression.

## Global Constraints

- Keep transport logic in handlers/controllers only.
- Keep domain logic out of frontend and gateways.
- Persist state transitions after every meaningful server-side state change.
- Never leak `correctAnswer` through snapshot or room/lobby payloads.
- Use Zod patterns already established in the repo.
- Prefer targeted component extraction over folder-taxonomy refactors.

## Critical Path

The MVP critical path is:

1. lobby lifecycle contract
2. backend lobby orchestration
3. socket/store wiring
4. lobby UI + graceful leave
5. heartbeat/presence baseline
6. shell cleanup and visual audit

## Phase 1: Lobby Lifecycle Contract

Goal:
Define the smallest shared contract for room lifecycle so backend and frontend can evolve safely.

Read set:

- `memory-bank/progress.md`
- `memory-bank/activeContext.md`
- `memory-bank/codingGuidelines.md`
- `packages/shared/src/state.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/socket.ts`
- `apps/api/prisma/schema.prisma` if room status enum is DB-backed

Target files:

- `packages/shared/src/state.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/socket.ts`
- `packages/shared/src/index.ts`
- `apps/api/prisma/schema.prisma` only if needed

Deliverables:

- formal room lifecycle states for lobby flow
- explicit event names/payloads for countdown/start/presence if missing
- clear separation between room lifecycle state and match lifecycle state

Out of scope:

- no UI changes
- no heartbeat scheduler yet
- no shell refactor

Done when:

- shared types compile
- backend and web can consume the new contract without ad-hoc local types
- no ambiguous state naming remains between room and match

Verify:

- `pnpm --filter @arena/shared build`
- `pnpm --filter @arena/api build`
- `pnpm --filter @arena/web build`

## Phase 2: Backend Lobby Orchestration Baseline

Goal:
Make rooms move through a minimal lifecycle before a match starts.

Read set:

- Phase 1 contract files
- `apps/api/src/modules/room/room.service.ts`
- `apps/api/src/gateways/handlers/room.handler.ts`
- `apps/api/src/gateways/handlers/match.handler.ts`
- `apps/api/src/modules/match/game-loop.service.ts`
- room and handler specs

Target files:

- `apps/api/src/modules/room/room.service.ts`
- `apps/api/src/gateways/handlers/room.handler.ts`
- `apps/api/src/gateways/handlers/match.handler.ts`
- `apps/api/src/modules/match/game-loop.service.ts`
- related specs

Deliverables:

- public room auto-start trigger
- private room host force-start
- room status transitions like `WAITING -> COUNTDOWN -> STARTING -> IN_GAME`
- room status updates synchronized with match start
- no read-modify-write regressions worse than current baseline

Out of scope:

- frontend countdown UI
- AFK sweep
- shell/layout cleanup

Done when:

- a room can transition into a match through the backend only
- match start no longer assumes lobby is always manually started
- room and match services agree on final room status at start

Verify:

- `pnpm --filter @arena/api test`
- `pnpm --filter @arena/api build`

## Phase 3: Socket Transport And Store Wiring

Goal:
Expose the new lobby lifecycle cleanly to the client without overloading page components.

Read set:

- Phase 2 backend files
- `apps/web/src/stores/socket-store.ts`
- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`

Target files:

- `apps/web/src/stores/socket-store.ts`
- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
- shared payload files only if Phase 2 changed them

Deliverables:

- store state for lobby countdown / room phase
- socket listeners for room lifecycle events
- page reads store state instead of deriving fake lifecycle behavior
- remove stale assumptions around manual start-only behavior

Out of scope:

- big visual redesign
- shell cleanup
- global component extraction

Done when:

- lobby page can react to room lifecycle state from the store
- host/non-host UI can branch on real server state
- no local page-only lifecycle hacks remain

Verify:

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web typecheck`

## Phase 4: Lobby UI + Incremental Component Extraction

Goal:
Make the lobby usable and cleaner without a repo-wide Atomic Design pass.

Read set:

- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/game/player-grid.tsx`
- `memory-bank/frontend-enterprise-followups.md`

Target files:

- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
- new local components under `apps/web/src/components/lobby/`
- `apps/web/src/components/game/player-grid.tsx` only if reuse is obvious

Deliverables:

- countdown overlay
- waiting-for-players state
- leave-room button + confirm modal
- host start controls rendered against real lifecycle state
- extract only page-local pieces such as:
  - `LobbyHeader`
  - `RoomCodeCard`
  - `LobbyPlayerGrid`
  - `LeaveRoomModal`
  - `LobbyCountdownOverlay`

Out of scope:

- folder rename to `atoms/molecules/organisms`
- app shell redesign
- spectator mode

Done when:

- lobby page is materially smaller and easier to read
- extracted components are page-focused, not artificially generic
- dev-only mock fallback is either removed or tightly scoped and clearly intentional

Verify:

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web typecheck`

## Phase 5: Heartbeat / Presence Baseline

Goal:
Prevent ghost players from blocking flow.

Read set:

- `apps/api/src/modules/room/room.service.ts`
- `apps/api/src/gateways/handlers/auth.handler.ts`
- `apps/api/src/gateways/handlers/room.handler.ts`
- `apps/web/src/stores/socket-store.ts`
- lobby page
- room/match/auth specs

Target files:

- room/auth handlers
- `RoomService`
- `socket-store.ts`
- lobby page
- related tests

Deliverables:

- client heartbeat emission or equivalent lightweight presence signal
- Redis-backed last-seen tracking or equivalent minimal server presence state
- stale player cleanup policy for lobby
- room player list reflects live presence more reliably

Out of scope:

- full in-match AFK elimination
- spectator conversion flow
- shell cleanup

Done when:

- disconnected or stale players do not linger indefinitely in lobby
- presence updates do not require full page reload
- behavior is covered by tests

Verify:

- `pnpm --filter @arena/api test`
- `pnpm --filter @arena/web build`

## Phase 6: Graceful Exit And Result Navigation Cleanup

Goal:
Close the remaining user-flow gaps after lobby baseline.

Read set:

- `apps/web/src/stores/socket-store.ts`
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx`
- `apps/web/src/app/[locale]/result/[matchId]/page.tsx`
- `apps/api/src/gateways/handlers/room.handler.ts`
- `apps/api/src/modules/match/game-loop.service.ts`

Target files:

- `apps/web/src/stores/socket-store.ts`
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx`
- `apps/web/src/app/[locale]/result/[matchId]/page.tsx`
- backend files only if surrender/leave semantics need explicit support

Deliverables:

- remove stale TODO around match-finished navigation
- explicit result-page transition strategy
- coherent leave behavior from lobby and in-game surfaces
- optional minimal surrender path if product decision is ready

Out of scope:

- spectator mode
- shell cleanup
- tie-break redesign

Done when:

- match finish flow is explicit and testable
- player can leave without getting stuck in a dead-end client state

Verify:

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/api test` if backend behavior changed

## Phase 7: Shell Cleanup Isolation

Goal:
Complete Design System Phase 5A without mixing it into gameplay work.

Reason to isolate:
`AppShellLayout` has CRITICAL upstream impact across most pages.

Read set:

- `memory-bank/migrateDesignSystem.md`
- `memory-bank/frontend-enterprise-followups.md`
- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/ui/sidebar.tsx`

Target files:

- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- small supporting UI primitives only if strictly necessary

Deliverables:

- remove remaining legacy gradient/shell inconsistencies
- align desktop/mobile shell behavior
- preserve skip-link behavior
- no page-level business logic changes

Out of scope:

- lobby logic
- game logic
- room lifecycle
- broad page rewrites

Done when:

- shell styles are stable across all pages using `AppShellLayout`
- mobile overlay behavior matches the design system direction
- no unrelated page logic changed in the same PR

Verify:

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web typecheck`
- manual smoke check on lobby, game, result, profile, rankings, settings, admin

## Phase 8: Frontend Audit Sweep

Goal:
Do the small-but-real cleanup that remains after core flow is stable.

Read set:

- `memory-bank/frontend-enterprise-followups.md`
- home page
- not-found pages
- `player-grid.tsx`
- lobby/game shared avatar and glyph usages

Target files:

- `apps/web/src/app/[locale]/page.tsx`
- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/components/game/player-grid.tsx`
- a few shared primitives if repetition is obvious

Deliverables:

- home-page a11y fixes
- not-found consistency
- duplicate avatar/sprite framing cleanup where it clearly helps
- audit tooling refinements if false positives remain costly

Out of scope:

- shell redesign
- backend features
- spectator transport

Done when:

- the touched pages are cleaner and more consistent
- audit scripts are more actionable, less noisy
- no gratuitous component taxonomy refactor was introduced

Verify:

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web typecheck`
- `pnpm --filter @arena/web audit:ux`
- `pnpm --filter @arena/web audit:a11y`

## Phase 9: Tie-Break And Post-Match Polish

Goal:
Improve endgame quality only after the lobby flow is stable.

Target areas:

- `packages/game-core`
- match service / game loop
- result page

Deliverables:

- formal tie-break behavior
- sudden-death decision if still desired
- result page polish for winner/loser clarity
- rematch decision point captured, even if full rematch is deferred

Done when:

- endgame rules are explicit
- result UI reflects real outcome logic cleanly

Verify:

- game-core tests
- API tests if persistence changes
- web build

## Phase 10: Spectator And Late-Join Baseline

Goal:
Unlock drop-in spectating after the core player flow is trustworthy.

Target areas:

- shared event contracts
- room/match handlers
- game/result/lobby pages
- optional separate spectator channel design

Deliverables:

- late join policy
- spectator entry path
- eliminated-player spectator transition baseline
- minimal spectator UI, not full micro-interaction polish yet

Done when:

- ongoing matches can be observed without breaking player flow
- player and spectator responsibilities are distinct

Verify:

- API/socket tests
- web build
- manual multiplayer smoke test

## Deferred Until After Core MVP Loop

Keep these out of the critical path unless a blocking requirement appears:

- device fingerprint enforcement
- profanity moderation pipeline
- admin kill switch expansion
- mass-spectator SSE isolation
- deep optimistic UI retry/idempotency
- full accessibility audit pass
- asset preloading system
- bot/demo system

## Phase Acceptance Checklist

Every phase must finish with:

- code changes limited to that phase’s concern
- updated tests for touched behavior
- build passes for touched packages
- no cross-cutting cleanup justified only by taste
- brief note in `memory-bank/progress.md` after implementation

## Recommended PR Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10
