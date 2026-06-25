# Progress: Arena of 100

> **Core memory-bank file 3/4**
> Timeline rút gọn + queue hiện tại. Chi tiết lịch sử sâu hơn nằm trong git history và supplementary docs.

## Current Status

Baseline hiện tại đã xong:

- lobby lifecycle
- heartbeat / presence sweep
- graceful exit
- admin kill-switch baseline
- drop-in spectating baseline
- match race + frontend correctness hardening
- gateway/schema tightening + home gradient cleanup

Admin kill-switch append-only audit event **chưa xong**.

## Latest Known Test Counts

- API unit tests: **866/866** passed.
- Game-core tests: **70/70**
- Web tests: **31/31**
- Shared tests: **3/3**
- E2E tests: **11/11**

Run the relevant package tests before using these numbers in PR text.

## Completed Milestones

### 2026-06-06

- Profile + rankings real APIs.
- CI/E2E hardening.

### 2026-06-07 / 2026-06-08

- Lobby lifecycle baseline.
- Heartbeat/presence sweep.
- Graceful exit baseline.
- `PresenceService.sweep` covers lobby stale cleanup.

### 2026-06-14

- Design System Phase 5B closeout.
- Admin kill-switch baseline.
- Drop-in spectating baseline.
- Match race + frontend correctness hardening (B1-B3, F1-F8).
- Post-merge recovery/idempotency hardening (B4-B7, L1).

### 2026-06-18

- Gateway + schema tightening + home gradient cleanup (L2, L3, PR 6).
- Validation bounds tightened for client timestamps and `lastSeenSeqNo`.
- `game.gateway.ts` import dedupe and awaited disconnect handling.

## What Is Done

- Server-authoritative match loop.
- Match state persistence / rehydrate path with Redis snapshots.
- Reconnect snapshot flow.
- Late join spectator baseline via `JoinMode = "SPECTATOR"`.
- Eliminated player spectator UI.
- Admin room termination baseline.
- Profile/rankings real APIs.
- CSRF, throttling, and Zod validation baseline.
- Socket handlers split into `AuthHandler`, `RoomHandler`, `MatchHandler`.
- Moderation MVP boundary filtering / sanitizer (NFKD Unicode normalization, diacritic stripping, and post-masking re-validation).

## What Is Not Done Yet

- Admin kill-switch append-only audit event.
- `Room.maxPlayers` realtime payload exposure.
- Full optimistic answer rollback + idempotency key.
- k6 load evidence for 100 concurrent WebSocket users.
- Spectator transport split for scale.
- Full WCAG / Playwright / rematch work.

## Priority Queue

### P0 — Docs + Memory-Bank Consolidation

- Keep only 4 default core docs for agent context.
- Keep supplementary memory-bank docs as historical references.
- Keep `systemPatterns.md` truth-based: implemented vs planned patterns must be explicit.

### P1 — Near-Term Implementation

1. **Admin Kill-Switch Audit Event**
   - Current gap: `AdminService.terminateRoom` mutates DB + Redis + timers + emits `ROOM_TERMINATED`, but does not write an append-only audit event.
   - Expected scope: schema/model support if needed, capture admin user id, append event row, query endpoint only if required by UI.
2. **`Room.maxPlayers` realtime payload**
   - Frontend currently uses fallback `GAME_CONFIG.MAX_PLAYERS` when live payload lacks max player count.
3. **Optimistic Answer Rollback**
   - Current UI has lock-in behavior, but no full idempotency/rollback contract.
4. **Moderation MVP** (Done)
   - Unicode NFKD normalization, mark stripping, and post-masking re-validation are completed and verified with tests. Deeper device fingerprinting and shadow-ban are deferred as post-MVP.

### P2 — Evidence / Scale

1. k6 load test for 100 concurrent WebSocket users.
2. Decide spectator SSE / transport split based on measured load, not speculation.

### P3 — Post-MVP / UX Closeout

- WCAG sweep.
- Playwright browser E2E.
- Post-match rematch + share.
- Bot/demo system.
- Deeper device fingerprint / shadow-ban system.

## Locked Decisions

- Wrong answer or no answer before active round deadline => eliminated in that round.
- Eliminated player remains connected as spectator/watch-only UI.
- Drop-in late joiner for `IN_GAME` / `FINISHED` joins as `SPECTATOR`.
- Monolith-first; distributed spectator infra is deferred until load evidence exists.
- Command Pattern is not needed for current socket use cases.
- Factory Pattern is currently only `createEvent()`; other factories are future seams.
- Tie-break is deterministic but not Strategy Pattern yet.

## Pattern / Architecture Notes

- `MatchStateMachine` is real and central. Broad class-level refactors are high risk because many execution flows depend on it.
- `tieBreak` may be a good future Strategy refactor because its direct blast radius is low.
- Socket event handlers are handler/dispatcher style, not Command Pattern.
- Socket.io broadcast is observer-like transport behavior, not explicit Observer Pattern.

## Supplementary / Legacy Docs

Files such as `issue.md`, `projectbrief.md`, `techContext.md`, `career-assessment.md`, `frontend-enterprise-followups.md`, `coverage-cleanup.md`, `errorHandlingPattern.md`, and `processTechDebt.md` remain available for historical context, but they are not default agent context.
