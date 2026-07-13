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

Admin kill-switch append-only audit event **đã xong**.

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

### 2026-07-11

- **Track C — AFK docs + UX hardening.** Verified AFK/elimination semantics across state machine → round runner → UI; wrote `docs/afk-policy.md`.
- `MatchStateMachine` public API unchanged (CRITICAL blast radius: ~20 flows). BE elimination logic already correct — added regression tests only (AFK, disconnect, reconnect-in-round, late answer, eliminated stays eliminated).
- FE: elimination reason (`WRONG_ANSWER` / `TIMEOUT`) now shown in `eliminated-overlay`; `eliminationReason` added to socket store; reconnect snapshot hydrates `isEliminated` from roster so watch-only UI restores. New `EliminationReason` type in `@arena/shared`.
- Pre-edit impact analysis artifact (Plan §C1 §30-51): `docs/impact-analysis-C.md` — 10 symbol `gitnexus_impact` outputs verbatim, scope confirmation (no public API change, blast radius ≤ 11 file), revision binding `7935cdc..4832e72`, `§4`/`§5` left as `<fill>` pending reviewer + ISO timestamp.

## What Is Done

- Server-authoritative match loop.
- Match state persistence / rehydrate path with Redis snapshots.
- Reconnect snapshot flow.
- Late join spectator baseline via `JoinMode = "SPECTATOR"`.
- Eliminated player spectator UI.
- Admin room termination baseline.
- Admin kill-switch append-only audit event + paginated audit query.
- Profile/rankings real APIs.
- CSRF, throttling, and Zod validation baseline.
- Socket handlers split into `AuthHandler`, `RoomHandler`, `MatchHandler`.
- Moderation MVP boundary filtering / sanitizer (NFKD Unicode normalization, diacritic stripping, and post-masking re-validation).
- `Room.maxPlayers` realtime payload exposure.
- Optimistic answer rollback + server-side idempotency replay keyed by `submissionId`.

## What Is Not Done Yet

- k6 load evidence for 100 concurrent WebSocket users. Harness is now
  end-to-end Plan A compliant: `load-test/` (k6 scenarios +
  runtime-metadata + readiness barrier via `scripts/coordinator.mjs`),
  `scripts/sample-monitoring.mjs` for raw CPU/RSS + Redis JSONL with
  redacted `REDIS_URL`, and `scripts/validate-results.mjs` for the
  pass/fail report. `HealthController.monitoring` was extended with
  `rssBytes` / `totalMemBytes` and the CPU convention was switched
  to `% of 1 core` so the documented thresholds (≤ 80% peak, ≤ 70%
  p95) are observable on multi-core hosts. Baseline numbers + P2
  conclusion still pending a real run against a real Redis/Postgres
  stack (see `load-test/README.md`).
- Full reconnect/event replay contract behind `lastSeenSeqNo`.
- Spectator transport split for scale.
- Full WCAG / Playwright / rematch work.

## Priority Queue

### P0 — Docs + Memory-Bank Consolidation

- Keep only 4 default core docs for agent context.
- Keep supplementary memory-bank docs as historical references.
- Keep `systemPatterns.md` truth-based: implemented vs planned patterns must be explicit.

### P1 — Near-Term Implementation

1. **k6 Load Test**
   - Measure baseline 100 concurrent WS behavior before making spectator-transport scale decisions.
2. **AFK Docs + UX Hardening** — ✅ done (Track C, 2026-07-11)
   - Semantics verified across all 3 layers (state machine → round runner → UI); documented in `docs/afk-policy.md`.
   - No `MatchStateMachine` change (public API unchanged); FE now surfaces elimination reason (wrong / timeout) + reconnect snapshot hydrates spectator state.
3. **Admin Audit Panel UI** — ✅ done
   - Backend audit baseline exists; UI/filter/pagination closeout shipped.
   - FE consumes `GET /admin/audit-events` via `lib/api/audit.ts` +
     `hooks/use-audit-events.ts` (offset pagination, DTO-matched filters:
     eventType/roomId/adminUserId — no date filter, backend DTO has none).
   - Route `admin/audit/page.tsx` (role-guarded) with `components/admin/`
     `audit-table.tsx` + `audit-filters.tsx`; skeleton/empty/error states;
     i18n keys under `admin.audit` (en/vi); vitest specs green.
4. **Replay Contract Follow-up**
   - `submissionId` idempotency is done; `lastSeenSeqNo` delta replay remains deferred.

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
