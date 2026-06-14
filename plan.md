# Plan: Next PR - Design System Phase 5B Closeout

> ⚠️ **[ARCHIVED 2026-06-14 — Phase 5B đã đóng theo ground truth từ code]** File này giữ lại làm execution reference lịch sử; nội dung phases bên dưới không còn là active work.
>
> Updated 2026-06-14 from `memory-bank/*.md`, `PROJECT_STATUS.md`, source review, and GitNexus.
> This file now tracks the next PR only, plus a short follow-on queue.
> It intentionally removes outdated open phases that are already done in code.

## PR Snapshot

- PR name: `Design System Phase 5B Closeout`
- Primary goal: finish shared shell visual cleanup without mixing gameplay or backend work
- Recommended branch: `feat/design-system-phase-5b-closeout`
- Recommended owner lane: frontend-only
- Recommended agent type: `frontend-specialist`
- GitNexus note: index is 1 commit behind HEAD and one search returned degraded FTS; if deeper symbol search is needed before implementation, run `npx gitnexus analyze --force`

## Tracking Board

- [ ] Phase 0 complete: baseline and scope lock
- [ ] Phase 1 complete: `AppShellLayout` cleanup
- [ ] Phase 2 complete: desktop `Sidebar` cleanup
- [ ] Phase 3 complete: mobile `Sidebar` overlay cleanup
- [ ] Phase 4 complete: residual shell artifact audit
- [ ] Phase 5 complete: verification and docs sync
- [ ] PR ready for review
- [ ] PR merged

## Reality Check

The old `plan.md` is stale. These are already done and must not be planned again as open work:

- Core gameplay loop
- Lobby lifecycle contract and backend orchestration
- Socket/store lobby wiring
- Lobby UI extraction and graceful leave
- Heartbeat/presence sweep baseline
- Graceful exit and result navigation baseline
- Admin kill-switch baseline
- Profile and rankings real APIs
- Design System Phase 1 to Phase 5A
- Eliminated-player spectator baseline

## Why This PR Next

Choose this PR next because it is the cleanest isolated polish PR left on the frontend path.

Evidence from docs and code:

- `activeContext.md` and `progress.md` both propose Design System Phase 5B as the next PR
- `apps/web/src/components/ui/app-shell-layout.tsx:34` still carries a shell-level gradient
- `apps/web/src/components/ui/sidebar.tsx:230` still carries a mobile overlay gradient
- GitNexus impact shows `AppShellLayout` has `CRITICAL` upstream impact across 8 pages, so shell work must be isolated
- Product work like drop-in spectating and in-match AFK still crosses backend, transport, and UI, so it should not be mixed into this PR

## GitNexus Context

GitNexus findings used to shape this plan:

- `AppShellLayout` upstream impact: `CRITICAL`
- Direct consumers of `AppShellLayout`: `AdminPage`, `GamePage`, `LobbyPage`, `ProfilePage`, `RankingsPage`, `ResultPage`, `CreateRoomPage`, `SettingsPage`
- `RoomService` upstream impact: `MEDIUM`
- `PresenceService` upstream impact: `LOW`
- `RoomService.joinRoom` upstream impact: `LOW`, but it is the main blocker for drop-in spectating
- `RoomService.joinRoom` currently rejects any room where `room.status !== WAITING` at `apps/api/src/modules/room/room.service.ts:103-105`
- `GamePage` has low upstream impact and still contains hardcoded opponent/sidebar data at `apps/web/src/app/[locale]/game/[matchId]/page.tsx:366-443`
- `apps/web/src/styles/components.css` does not exist anymore, so old docs that mention deleting it are stale; Phase 5B should treat that step as an audit, not a blind delete

## Locked Decisions (2026-06-14)

- Mobile overlay treatment: remove both `bg-gradient-to-br from-pink-50 via-blue-50 to-indigo-50/95` and `backdrop-blur-md` from the mobile nav overlay so the body shows through cleanly.
- Home page gradient (`apps/web/src/app/[locale]/page.tsx:193` — same Tailwind pattern) is **out of scope** for this PR and gets added to Explicit Deferrals below.
- `plan.md` line numbers in this file are kept accurate to current code (32→34, 211→230) so downstream agents do not re-discover the staleness.
- Phase 4 is strictly audit-only: any route-level visual bug that is not directly caused by Phase 1–3 is deferred to a follow-up PR.

## Hard Constraints For 256k-Token Agents

- One phase at a time
- Do not read the whole repo when a phase names a bounded read set
- Hard cap per implementation phase: 1 to 3 production files
- Hard cap per verification phase: 0 to 2 docs files
- Do not touch backend files in this PR
- Do not touch `socket-store.ts` in this PR
- Do not touch `RoomService`, `PresenceService`, or `GameLoopService` in this PR
- Do not fix drop-in spectating in this PR
- Do not fix in-match AFK in this PR
- Do not fix `GamePage` hardcoded opponent data in this PR
- Do not do repo-wide component taxonomy moves
- Do not introduce new generic abstractions unless duplication is impossible to avoid
- If a phase requires page-level business-logic changes on more than 2 pages, stop and split that work into a later PR

## PR Success Criteria

- Shared shell visuals match the current Candy/Jelly direction
- Residual shell gradients are removed from shared shell surfaces
- Desktop and mobile sidebar behavior remain stable
- Skip-link behavior remains intact
- No gameplay behavior changes
- No backend behavior changes
- All pages using `AppShellLayout` still render correctly
- `pnpm --filter @arena/web build` passes
- `pnpm --filter @arena/web lint` passes
- `pnpm --filter @arena/web typecheck` passes
- Manual smoke review across all shell consumers is completed

## Out Of Scope

- Drop-in spectating
- Spectator transport isolation
- In-match AFK policy
- Optimistic answer rollback
- `GamePage` live opponents data wiring
- Home page redesign
- Not-found redesign
- Admin feature changes
- Shared backend contract changes
- Broad icon/glyph audit across the app
- Legacy design-system archaeology beyond shell artifacts directly touched here

## Phase 0: Baseline And Scope Lock

### Goal

Freeze scope before editing the high-risk shell.

### Suggested agent window

- Target context size: under 20k tokens
- Suggested agent: `explore` or `frontend-specialist`

### Read Set

- `plan.md`
- `memory-bank/progress.md`
- `memory-bank/activeContext.md`
- `memory-bank/migrateDesignSystem.md`
- `memory-bank/frontend-enterprise-followups.md`
- `PROJECT_STATUS.md`
- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/ui/sidebar.tsx`

### Required Checks

- [ ] Confirm the next PR is still shell-only
- [ ] Confirm `AppShellLayout` is still the highest-risk shared frontend symbol for this PR
- [ ] Confirm `styles/components.css` is already absent
- [ ] Confirm no backend file is needed for this PR
- [ ] Confirm `GamePage` mock sidebar remains explicitly out of scope

### Deliverables

- Short scope note in PR description draft
- Final list of files allowed for this PR
- Final list of files explicitly forbidden for this PR

### Allowed Files After Phase 0

- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/app/globals.css` only if absolutely required
- At most 2 shell-consuming page files, and only for tiny regression fixes caused by shell changes
- `memory-bank/progress.md`
- `memory-bank/activeContext.md`

### Stop Conditions

- If shell cleanup requires touching backend files
- If shell cleanup requires redesigning page-level business surfaces
- If shell cleanup requires changing more than 2 consumer pages materially

## Phase 1: `AppShellLayout` Cleanup

### Goal

Remove residual shared shell visual debt in the layout container while preserving behavior.

### Why Separate

GitNexus marks `AppShellLayout` as `CRITICAL` upstream. This must land before any sidebar or route-level polish.

### Suggested agent window

- Target context size: under 25k tokens
- Suggested agent: `frontend-specialist`

### Read Set

- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/styles/utilities.css`
- One consumer page for spot-checking structure:
- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`

### Instructions

- Remove the shell-level gradient from `AppShellLayout` if the body/background already owns that responsibility
- Preserve layout behavior: `min-h-screen`, split desktop/mobile shell, scroll containment, and main-content padding
- Preserve proactive websocket connect behavior
- Preserve skip-link semantics exactly
- Do not rename the component
- Do not move the component
- Do not change child-page layout contracts

### Target Files

- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/app/globals.css` only if needed

### Tracking

- [ ] Shell wrapper no longer owns redundant gradient styling
- [ ] Skip-link still points to `#main-content`
- [ ] Main scrolling still works on desktop and mobile
- [ ] Websocket connect-on-mount behavior unchanged
- [ ] No page-level business logic touched

### Verify

- `pnpm --filter @arena/web typecheck`

## Phase 2: Desktop `Sidebar` Cleanup

### Goal

Finish the desktop shell closeout without changing information architecture.

### Why Separate

`Sidebar` is shared UI but still narrower than `AppShellLayout`. Keep desktop cleanup independent from mobile overlay cleanup.

### Suggested agent window

- Target context size: under 30k tokens
- Suggested agent: `frontend-specialist`

### Read Set

- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/ui/avatar.tsx`
- `apps/web/src/components/ui/button.tsx` only if needed for style consistency
- `apps/web/src/components/ui/glass-panel.tsx` only if needed for style reference

### Instructions

- Keep the current nav structure and routes
- Keep collapse behavior and floating toggle
- Keep active-state clarity
- Keep tooltips usable when collapsed
- Keep keyboard focus styling
- Align desktop shell visuals with current Candy/Jelly primitives
- Avoid opportunistic icon refactors unless directly necessary
- Do not change translation keys

### Target Files

- `apps/web/src/components/ui/sidebar.tsx`
- At most one supporting UI primitive if absolutely required

### Tracking

- [ ] Desktop sidebar visuals match current shell direction
- [ ] Collapse toggle still works
- [ ] Active route state still reads clearly
- [ ] Collapsed tooltip still works
- [ ] Footer identity block still renders cleanly
- [ ] No route map or navigation semantics changed

### Verify

- `pnpm --filter @arena/web typecheck`

## Phase 3: Mobile `Sidebar` Overlay Cleanup

### Goal

Remove the remaining legacy-feeling overlay treatment while preserving mobile behavior.

### Why Separate

Mobile overlay behavior is easy to regress and should be checked on its own.

### Suggested agent window

- Target context size: under 25k tokens
- Suggested agent: `frontend-specialist`

### Read Set

- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/components/ui/app-shell-layout.tsx`

### Instructions

- Replace the residual overlay gradient at `sidebar.tsx:230` with the current shell treatment
- Preserve `Escape` close
- Preserve backdrop-click close
- Preserve `role="dialog"` and `aria-modal="true"`
- Keep menu button hit area comfortable on mobile
- Keep header height and sticky feel stable
- Do not introduce focus traps unless the repo already uses one
- Do not expand scope into full mobile nav redesign

### Target Files

- `apps/web/src/components/ui/sidebar.tsx`

### Tracking

- [ ] Mobile overlay no longer uses the stale gradient treatment
- [ ] Escape still closes the menu
- [ ] Backdrop click still closes the menu
- [ ] Menu button remains usable on touch devices
- [ ] Overlay remains readable on small screens
- [ ] No regressions in header layout

### Verify

- `pnpm --filter @arena/web typecheck`

## Phase 4: Residual Shell Artifact Audit

### Goal

Do a narrow cleanup pass for shell-specific leftovers and confirm stale doc assumptions.

### Why Separate

This is the safe place to catch small regressions without reopening broader product surfaces.

### Suggested agent window

- Target context size: under 35k tokens
- Suggested agent: `explore` then `frontend-specialist`

### Read Set

- `apps/web/src/components/ui/app-shell-layout.tsx`
- `apps/web/src/components/ui/sidebar.tsx`
- `apps/web/src/app/[locale]/room/create/page.tsx`
- `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx`
- `apps/web/src/app/[locale]/result/[matchId]/page.tsx`
- `apps/web/src/app/[locale]/profile/page.tsx`
- `apps/web/src/app/[locale]/rankings/page.tsx`
- `apps/web/src/app/[locale]/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`

### Instructions

- Grep for shell-specific residual gradients and dead shell references
- Treat `styles/components.css` deletion as a confirmation task, not an assumed code-change task
- Only fix route-level regressions if they are directly caused by Phase 1 to Phase 3
- Limit route-level fixes to spacing, overflow, or wrapper-class adjustments
- Do not touch gameplay logic
- Do not touch the hardcoded `GamePage` opponent list in this PR

### Tracking

- [ ] No live import/reference expects `styles/components.css`
- [ ] Shared shell gradients are removed or intentionally retained with justification
- [ ] Consumer pages still fit inside the shell without overflow regressions
- [ ] No accidental gameplay or data-flow changes introduced
- [ ] `GamePage` mock opponent block is explicitly left for later PR

### Verify

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web typecheck`

## Phase 5: Verification And Docs Sync

### Goal

Close the PR with evidence, not intuition.

### Suggested agent window

- Target context size: under 25k tokens
- Suggested agent: `test-engineer` or `frontend-specialist`

### Verification Commands

- `pnpm --filter @arena/web build`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web typecheck`
- `pnpm --filter @arena/web audit:ux`
- `pnpm --filter @arena/web audit:a11y`

### Manual Smoke Matrix

- [ ] `/room/create` desktop
- [ ] `/room/create` mobile
- [ ] `/lobby/[roomCode]` desktop
- [ ] `/lobby/[roomCode]` mobile
- [ ] `/game/[matchId]` desktop
- [ ] `/game/[matchId]` mobile
- [ ] `/result/[matchId]` desktop
- [ ] `/result/[matchId]` mobile
- [ ] `/rankings` desktop
- [ ] `/rankings` mobile
- [ ] `/profile` desktop
- [ ] `/profile` mobile
- [ ] `/settings` desktop
- [ ] `/settings` mobile
- [ ] `/admin` desktop
- [ ] `/admin` mobile
- [ ] not-found surface desktop
- [ ] not-found surface mobile
- [ ] skip-link works on at least one shell route
- [ ] mobile menu open/close checked on at least 3 shell routes

### Docs Sync

- [ ] Update `memory-bank/progress.md` with a short Phase 5B completion note
- [ ] Update `memory-bank/activeContext.md` to move Design System Phase 5B from proposed to done
- [ ] Update this file’s tracking boxes
- [ ] Add PR note listing any intentionally deferred issues found during shell audit

## Definition Of Done

- Shared shell cleanup is complete
- GitNexus high-risk shell symbol was changed in isolation
- No backend or transport files changed
- No product-scope expansion happened
- Web build, lint, and typecheck all pass
- Audit scripts were reviewed manually
- Manual smoke matrix is checked off
- Progress docs are updated

## Explicit Deferrals After This PR

Do not pull these into the current PR. They are real gaps, but they deserve their own PRs.

### PR 2: `GamePage` Live Opponents Panel

Reason:

- `apps/web/src/app/[locale]/game/[matchId]/page.tsx:366-443` still uses hardcoded sidebar data
- GitNexus shows `GamePage` has low upstream risk, so this is a good isolated frontend follow-up PR

Success target:

- Replace mock opponent list with real store-backed match/player data
- Keep shell untouched

### PR 3: Drop-In Spectating Backend Entry

Reason:

- `RoomService.joinRoom` still rejects non-`WAITING` rooms at `room.service.ts:103-105`
- GitNexus shows `joinRoom` touches `RoomHandler`, `RoomController`, and gateway join flows

Success target:

- Allow late join to ongoing or finished room as spectator
- Keep this PR backend-contract-first

### PR 4: Spectator Transport And UI

Reason:

- Late join and spectator transport should not be bundled with join policy
- This likely touches shared events, socket store, and game/result UI

Success target:

- Dedicated spectator transport path
- Clear player vs spectator responsibilities

### PR 5: In-Match AFK Policy

Reason:

- `PresenceService.sweep` currently handles lobby stale users, not in-match round-miss policy
- This crosses domain rules, backend orchestration, and product semantics

Pending decision:

- auto-`ELIMINATED` or auto-`SPECTATOR` after missed rounds

### PR 6: Optimistic Answer Rollback

Reason:

- Current answer lock-in exists, but idempotency and rejection rollback are still incomplete

Success target:

- idempotency key
- rollback UX
- retry strategy

### PR 7: Home Page Shell Gradient Cleanup

Reason:

- `apps/web/src/app/[locale]/page.tsx:193` paints the same redundant `bg-gradient-to-br from-[#FFF0F5] via-[#E6E6FA] to-[#E0F2FE]` shell background as the body already owns.
- Home page does **not** use `AppShellLayout`, so it sits outside the shell cleanup scope of this PR.
- Leaving it untouched keeps this PR strictly within the shared shell layer; the home page visual closeout becomes its own follow-up.

Success target:

- Drop the redundant gradient class from the home `<main>` and let `body` own the background.
- Keep the floating candy/donut/emoji decorative layer intact.
- Stay a one-file change unless the audit surfaces a real reason to widen.

## Notes For Whoever Executes This Plan

- The biggest trap is scope creep from shared shell files into unrelated route cleanup
- The second biggest trap is treating stale docs as truth; `styles/components.css` is already gone
- The third biggest trap is accidentally fixing `GamePage` mock data while inside the shell PR
- If Phase 4 finds a real route-level visual bug that is not caused by shell cleanup, document it and defer it
