# Progress: Arena of 100

## Current Status: 🏗️ Core Gameplay Working → Lobby Lifecycle / Product Flows

> Trạng thái trong file này được tổng hợp lại từ code + GitNexus (cập nhật 2026-06-06).
> Một số mục dưới đây trước đây bị đánh dấu "chưa xong" trong `progress.md` cũ, nay đã có code thật và được tick lại.
> Tài liệu `PROJECT_STATUS.md` và `activeContext.md` cũng cần đọc kèm vì có mô tả đã lỗi thời.

### ✅ Completed (Phase 0: Planning & Setup)

- [x] Requirements analysis and scope definition
- [x] Tech stack selection (NestJS + Fastify + Next.js + Zustand)
- [x] Architecture design (Modular Monolith + Event-Driven)
- [x] Monorepo structure setup (pnpm + Turborepo)
- [x] Shared types and constants package
- [x] Game-core state machine (pure domain logic)
- [x] Backend scaffold (NestJS modules: auth, room, match, health)
- [x] Frontend scaffold (Next.js + Tailwind + Zustand store)
- [x] Database schema (Prisma with PostgreSQL)
- [x] Infrastructure (Docker Compose for PostgreSQL + Redis)
- [x] Memory bank documentation
- [x] **Architecture assessment & review (2025-05-09)**
- [x] **CI/CD Pipeline with GitHub Actions & Vitest setup (2026-05-12)**
- [x] **CI E2E hardening follow-up (2026-06-06)** — bỏ cache `node_modules`, giữ pnpm store cache, thêm Prisma cache key an toàn hơn, và upload E2E reports khi fail
- [x] **CSRF Protection — double-submit cookie pattern (2026-06-03)**
- [x] **Rate Limiting — @nestjs/throttler global + admin-specific (2026-06-03)**
- [x] **Hardcoded locale redirect fix (2026-06-03)**
- [x] **Zod validation/serialization migration** (Question/Auth/Room/Match) — xem [processTechDebt.md](./processTechDebt.md)

### 🔴 Critical Fixes (Phase 0.5: Before Feature Development) — All Resolved

- [x] Add QuestionModule (service + controller + seed data)
- [x] Add MatchStateMachine.serialize()/deserialize() for Redis persistence
- [x] Refactor GameGateway from God Object → split into AuthHandler, RoomHandler, MatchHandler
- [x] ~~Fix `MatchStartedPayload` missing interface in events.ts~~ [RESOLVED - already defined]
- [x] Fix shallow copy issue in `getState()` (Map not deep cloned)
- [x] Implement type-safe error handling pattern (`RoomError` class replaces string matching)
- [x] Cập nhật validation sang Zod (gỡ `class-validator` / `class-transformer`)

### ✅ Phase 1: Core Gameplay Loop (Hoàn thành)

- [x] `GameLoopService` với countdown → round → evaluate → result → finish
- [x] Round timer 15s tự động kết thúc round (`executeRound`, `endRound`, `cancelMatchLoop`)
- [x] Match state machine persist xuống Redis qua `MatchService.persistStateMachine` / `getStateMachine` (TTL 2h)
- [x] `RoomService` + `MatchService` + `GameLoopService` đã liên kết với nhau qua socket handlers
- [x] `AuthHandler.syncReconnection` phát `SNAPSHOT` + `ROOM_JOINED` khi reconnect
- [x] End-to-end room create → join → match start → result flow đã chạy được trong code
- [x] Frontend pages đã có: `/`, `/lobby/[roomCode]`, `/game/[matchId]`, `/result/[matchId]`, `/room/create`, `/settings`
- [x] Socket-store đã có đủ handler cho `MATCH_STARTED`, `ROUND_STARTED`, `ROUND_ENDED`, `PLAYER_ELIMINATED`, `MATCH_FINISHED`, `ROOM_JOINED/LEFT`
- [x] Admin endpoints + admin UI:
  - `POST /admin/questions/sync` (rate-limited 5/min)
  - `POST /admin/system/reset` (rate-limited 2/5min)
  - `GET /health` (public), `GET /health/monitoring` (ADMIN) trả CPU/RSS/active rooms
- [x] CSRF: `CsrfGuard` validate `X-CSRF-Token`; `apiFetch()` tự inject
- [x] Rate Limiting: `@nestjs/throttler` global 100 req/min + admin-specific
- [x] **Test coverage footprint rộng** (Vitest, `*.spec.ts`):
  - `packages/game-core/src/match-state-machine.spec.ts`
  - `apps/api/src/modules/match/{game-loop.service.spec.ts, game-loop.service.persistence.spec.ts, match.module.spec.ts, match.service.spec.ts}`
  - `apps/api/src/gateways/handlers/{auth,room,match,base}.handler.spec.ts`
  - `apps/api/src/modules/{auth,room,question,admin,health,prisma}/**/*.spec.ts`
  - `apps/api/src/common/{pipes,interceptors}/*.spec.ts`
  - `apps/api/prisma/seeds/questions-validation.test.ts`

### ✅ Frontend — Design System "Candy 3D Jelly UI"

- [x] Phase 1 — Foundation (font, tokens, Tailwind, `.jelly-card`/`.jelly-btn`)
- [x] Phase 2 — Atoms (Button, GlassPanel, Badge, Input)
- [x] Phase 3 — Procedural Avatars + MelbitSprite
- [x] Phase 4 — Game Molecules (AnswerTile, Timer, PlayerGrid) — completed
- [ ] Phase 5 — Shells & Polish (xem [migrateDesignSystem.md](./migrateDesignSystem.md))
  - [ ] Step 5.1: Refactor `AppShellLayout` / `GameShell` (vẫn còn dùng gradient cũ ở `app-shell-layout.tsx:32` + mobile overlay `sidebar.tsx:211`)
  - [ ] Step 5.2: Safe-delete legacy CSS (`styles/components.css` và các class cyberpunk cũ)
  - [ ] Step 5.3: End-to-end visual audit bằng `pnpm dev` + duyệt Lobby/Match/Result/Rankings/Profile

### 🚧 In Progress / Sắp Làm

#### Lobby lifecycle + graceful exit (PR kế tiếp đề xuất)

- [x] Phase 1 contract baseline — tách rõ room lifecycle contract khỏi match lifecycle; thêm `STARTING`, room status/presence socket events, và payload room typed đầy đủ cho API/web consume
- [x] Phase 2 backend baseline — public room auto-countdown khi đủ người, cancel countdown khi tụt dưới minimum, private room host force-start, và room status chuyển `WAITING -> COUNTDOWN -> STARTING -> IN_GAME` đồng bộ với match start
- [x] Phase 3 transport/store baseline — `socket-store` consume room lifecycle events thật, lobby page đọc `room.status` / `countdownEndsAt` / `match.id` từ store, và bỏ giả định manual-start-only ở client
- [x] **Phase 3 refinement (2026-06-08):** Extracted `useLobbyLifecycle` hook (`apps/web/src/hooks/use-lobby-lifecycle.ts`) to encapsulate auto-join, countdown timer, and lifecycle state derivation. Removed dev-only mock player fallback from lobby page. Exported `Player` and `Room` types from `socket-store.ts`. Page now purely presentational.
- [ ] Auto-start countdown cho public room
- [ ] Host controls tối thiểu cho private room (force-start, kick)
- [x] Heartbeat/presence validation (chống ghost player, sweep sau N round miss) — client gửi heartbeat 10s, server Redis TTL 20s, auto-sweep 5s, auto-disband private room nếu host stale
- [x] Lobby state machine: `WAITING → COUNTDOWN → STARTING → IN_GAME` (backend + store wiring done)
- [x] Frontend: countdown overlay, "leave" button đi kèm confirm modal, mobile-friendly leave flow, extracted lobby components (`LobbyHeader`, `RoomCodeCard`, `LobbyPlayerGrid`, `LeaveRoomModal`, `LobbyCountdownOverlay`) + visual stale indicator
- [x] Test: room lifecycle + heartbeat + leave flow (582 tests passed: 55 in @arena/game-core, 527 in @arena/api, 0 in @arena/web)
- [x] **Coverage cleanup for Codecov PR #38** — added 54 new tests to address the patch coverage gap (was 55.5% / 282 missing lines). Brought all 6 flagged files to ≥95% statements: `presence.service.ts` 18.62%→100%, `game-loop.service.ts` 71.94%→95.26%, `redis.service.ts` 78.75%→97.5%, `room.service.ts` 95.97%→100%, `room.handler.ts` 96.21%→99.24%, `game.gateway.ts` stays 100%. Overall API coverage 89.53%→94.98% (587 tests, 0 failures). See `memory-bank/coverage-cleanup.md` for the full diff.
- [x] **Phase 6: Graceful Exit And Result Navigation Cleanup** — auto-redirect to `/result/[matchId]` with 3s overlay when match finishes, added "Rời Trận Đấu" button in game screen with confirmation modal, removed stale TODO in socket-store.
- [x] **Phase 7: Shell Cleanup Isolation** — verified and stabilized `AppShellLayout` and `Sidebar`. Legacy gradients still remain at `app-shell-layout.tsx:34` and `sidebar.tsx:230` and are tracked under Phase 5 Step 5.1. Enhanced mobile UX by adding Escape key listener and backdrop click-to-close for the mobile navigation overlay, preserving robust skip-link accessibility. Zero page-level business logic changes.
- [x] **Atomic Design Migration PoC** — successfully migrated `RoomCodeCard` to `components/atoms/` using GitNexus-guided impact analysis. Updated imports safely, removed legacy barrel export, and verified zero regressions. This establishes the standard workflow for future component restructuring.
- [x] **Phase 8: Frontend Audit Sweep** — verified Home page a11y (htmlFor/id already correct, tap-targets >44px). Confirmed Not-Found surfaces have proper skip-links and consistent theming. Created reusable `AvatarFrame` component to deduplicate avatar/sprite framing logic across `LobbyPlayerGrid` and `GamePage` sidebar, reducing code duplication and enforcing design system consistency.
- [x] **Phase 9 & 10: Tie-Break And Spectator Baseline** — Verified backend `MatchStateMachine` already implements robust tie-break logic (total response time → correct answers → random fallback). Confirmed `RoomService.joinRoom` already enforces "Hard Gate" for late joins (rejects `IN_GAME`/`FINISHED` rooms with `ROOM_ALREADY_STARTED`). Implemented client-side Spectator View: added `isEliminated` state to socket store, handled `PLAYER_ELIMINATED` event, and rendered a dedicated "Chế độ khán giả" UI in `GamePage` when a player is eliminated, allowing them to watch the rest of the match unfold.

#### Phase 4 refinement (2026-06-08)

- [x] **LobbyStartControls extracted** — host start button block (16 lines, 4 room-status states) moved from `app/[locale]/lobby/[roomCode]/page.tsx` into a new page-local component `apps/web/src/components/lobby/lobby-start-controls.tsx`. Page size 169 → 161 lines. `RoomCodeCard` stays in `components/atoms/` (atomic migration is gradual, per user direction). Cleaned up now-unused imports (`Gamepad`, `RoomStatus`) from lobby page.
- [x] **Lobby surface i18n migration (Option C)** — fully migrated all 5 lobby components (`LobbyHeader` was already done, `LobbyCountdownOverlay`, `LeaveRoomModal`, `LobbyPlayerGrid`, `LobbyStartControls`) + the `useLobbyLifecycle` hook + the lobby page itself to `next-intl` namespaces under `lobby.*`. Added ~50 new translation keys to `apps/web/messages/{vi,en}.json` with full Vietnamese + English coverage. Hook stays a pure domain adapter (no `useTranslations`); it surfaces either a real `Error.message` or a sentinel `"lobby.unknownError"` string that the page resolves through `t("joinFailedFallback")` to keep the i18n concern at the component layer. `pnpm --filter @arena/web {build,lint,typecheck}` all green. Lobby route size: 7.61 kB → 7.01 kB (i18n keys more compact than inline Vietnamese strings).

#### Product features phụ thuộc lobby hoàn thiện

- [ ] Frictionless onboarding system với content moderation (chưa có profanity filter, device fingerprint)
- [ ] Spectator mode + micro-interactions (chưa có socket channel riêng cho spectator)
- [ ] Drop-in spectating cho late joiners
- [ ] AFK sweeping
- [ ] Asset preloading system with fallback
- [ ] Mass-spectator isolation (SSE channel riêng)
- [ ] Anonymous identity tracking (device fingerprint)
- [ ] Optimistic UI implementation với smart recovery (đã có một phần ở `game/[matchId]/page.tsx` nhưng chưa đầy đủ rollback)
- [ ] Game operations tools (admin force-kill chưa có, hiện chỉ có `system/reset` thô)
  - [x] **Phase 1 (contract) done** (2026-06-07): typed `ServerEvent.ROOM_TERMINATED` + `RoomTerminatedPayload` + `RoomTerminationReason="ADMIN_TERMINATED"`; mirrored `RoomEventType.ROOM_TERMINATED` + `RoomTerminatedEventPayload` for event-sourcing. `@arena/shared` build green. Phases 2–5 pending.
  - [x] **Phase 2 (backend admin action) done** (2026-06-07): `POST /admin/rooms/:roomId/terminate` (ADMIN-only, 5/min throttle) wired through `AdminService.terminateRoom` orchestrator. Extends `MatchService.finishMatch` to accept `null` winner (admin termination skips score persistence). New `GameLoopService.stopRoomRuntime` cancels lobby countdown + match timers; `emitRoomTerminated` encapsulates the socket.io emit. Explicit Redis cleanup (room keys + SCAN'd presence keys + match state + lobby countdowns index). 607 tests pass, `@arena/api` build green. Phases 3–5 pending.

### 🔴 Trang UI dùng mock data — cần thay bằng API thật

- [x] `/profile` — stats/match history — ✅ Done (issue.md Step 3+5: `useProfileStats` + `useMatchHistory` hooks call `GET /users/me/stats` + `/users/me/history`)
- [x] `/rankings` — leaderboard — ✅ Done (issue.md Step 4+5: `useLeaderboard` hook calls `GET /rankings/leaderboard`)
- [x] `/lobby/[roomCode]` — mock players fallback removed (Phase 3 refinement 2026-06-08); page now reads strictly from server-authoritative player list via `useLobbyLifecycle` hook
- [x] Backend endpoints — ✅ Done (issue.md Steps 3+4: `GET /users/me/stats`, `GET /users/me/history`, `PATCH /users/me/avatar`, `GET /rankings/leaderboard` implemented and tested)

### 📋 Upcoming (Phase 2: Polish & Testing)

- [ ] Tie-break và sudden death
- [ ] Post-match flow polish (rematch, share, screenshot)
- [ ] Content delivery: runtime fallback, anti-repetition UI
- [ ] Accessibility audit (ARIA, keyboard nav, color-blind mode)
- [ ] Comprehensive testing (E2E với Playwright)
- [ ] Lighthouse + bundle size review

### 🔮 Future (Phase 3: Production Ready)

- [ ] Sound effects, music
- [ ] Tournament mode, social features
- [ ] Mobile responsive improvements
- [ ] Bot/demo system for solo testing
- [ ] Multi-instance scaling (Redis adapter cho Socket.io, sticky sessions)

## Known Issues / Technical Debt

### 🔴 Critical (Blocks MVP Ship)

- Không còn blocker kỹ thuật lớn; các blocker trước (gateway god object, in-memory state, missing QuestionModule, validator risk) đã giải quyết.

### 🟡 Significant

- [ ] Lobby lifecycle chưa có state machine riêng; chỉ mới chuyển trạng thái thông qua match loop
- [ ] Heartbeat/AFK sweeping chưa có scheduler
- [ ] `RoomService` dùng read-modify-write trên `playerCount` (race condition nhỏ, cần `INCR`/`DECR` nếu scale)
- [ ] `correctAnswer` có thể leak qua `stateMachine.startRound` (đã strip ở broadcast nhưng cần audit thêm)
- [ ] `SocketNamespace` chưa có SPECTATOR entry
- [ ] `packages/config` directory trống
- [x] **Profile + Rankings mock data** — cần backend endpoints trước khi gắn UI thật ✅ Done (issue.md Step 3+4+5: backend + hooks + UI live)
- [ ] **Design system Phase 5 chưa đóng** (shell templates, legacy CSS, visual audit) — **Follow-up**: Design system Phase 5 (shell templates/legacy CSS/visual audit) — owner: TBD, ticket: TBD
- [ ] **Lobby mock players fallback** — cần real player events khi prod (debug only hiện tại)

### 🟢 Nice-to-Have

- [ ] Frictionless onboarding với content moderation + device fingerprint
- [ ] Lobby heartbeat UI
- [ ] Drop-in spectating (SSE channel riêng)
- [ ] AFK sweeping UI
- [ ] Graceful exit confirmation modal
- [ ] Spectator emotes (micro-interactions)
- [ ] Asset preloading + fallback
- [ ] Mass-spectator isolation infra
- [ ] Post-match rematch UI
- [ ] Accessibility audit
- [ ] Bot/demo system
- [ ] Optimistic UI rollback flow
- [ ] Game operations kill switch (admin force-kill room)

## Architecture Assessment Scores (cập nhật 2026-06-06)

| Dimension                | Score      | Notes                                                                                  |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| Monorepo Structure       | 10/10      | Turborepo + Remote Caching                                                             |
| Package Boundaries       | 9/10       | Clean separation, đúng dependency flow                                                 |
| Domain Logic (game-core) | 9/10       | Có serialize/deserialize, immutability, persistence                                    |
| Backend Architecture     | 7/10       | Handlers rõ ràng; còn thiếu lobby lifecycle, use-case layer, kick-switch               |
| Frontend Architecture    | 7/10       | Lobby/Game/Result xong, sidebar/app-shell đã có; Phase 5 + Profile/Rankings còn dở     |
| Infrastructure           | 7/10       | Docker + Redis + Throttler; chưa có multi-instance adapter                             |
| DevOps/CI-CD             | 10/10      | GitHub Actions pipeline configured; E2E job có cache strategy gọn hơn + fail artifacts |
| Testing                  | 7/10       | Có nhiều spec cho game-core, game-loop, handlers, admin, question                      |
| **Overall**              | **8.0/10** | Foundation + core gameplay xong; cần lobby lifecycle + real data APIs                  |

## Milestones

| Milestone                       | Target   | Status            |
| ------------------------------- | -------- | ----------------- |
| Base Scaffold                   | Week 1   | ✅ Complete       |
| Architecture Review             | Week 1   | ✅ Complete       |
| Critical Fixes (Phase 0.5)      | Week 2   | ✅ Complete       |
| Core Gameplay Loop              | Week 2   | ✅ Complete       |
| Frontend Pages + Design System  | Week 2-3 | 🚧 Phase 5 còn dở |
| Lobby Lifecycle + Graceful Exit | Week 3   | 📋 Next           |
| Reconnect polish + Tie-break    | Week 3-4 | 📋 Pending        |
| Profile/Rankings real APIs      | Week 4   | 📋 Pending        |
| E2E + Accessibility audit       | Week 4   | 📋 Pending        |
| MVP Launch                      | Week 5   | 🔮 Future         |

## What Works Now (verified 2026-06-06)

- Project structure, CI/CD, Vitest, Turborepo remote cache
- Shared types (`events.ts`, `state.ts`, `socket.ts`)
- Match state machine (pure logic, Redis persistence, immutability)
- `GameLoopService` chạy countdown → round → result → finish với persistence
- `AuthHandler` reconnect sync, `RoomHandler` create/join/leave, `MatchHandler` start/answer/snapshot
- `AdminService` sync questions, reset system; `HealthController` monitoring
- CSRF + rate limiting + Zod validation đã wire xuyên suốt
- Frontend pages: home (`/`), `/room/create`, `/lobby/[roomCode]`, `/game/[matchId]`, `/result/[matchId]`, `/profile`, `/rankings`, `/settings`, `/admin`
- Socket-store với auto-reconnect logic + state machine handlers

## What's Next (Priority Order)

1. **PR tiếp theo — Lobby lifecycle + graceful exit baseline**
   - Backend: room state machine (`WAITING → COUNTDOWN → STARTING → IN_GAME`), auto-start cho public, host controls cho private
   - Heartbeat validation + AFK sweeping
   - Frontend: countdown overlay, leave flow, "waiting for players" UI
   - Tests: room lifecycle, heartbeat, leave flow
2. **PR sau — Real player stats + leaderboard**
   - Backend: `GET /users/me/stats`, `GET /users/:id/history`, `GET /rankings/leaderboard`
   - Frontend: thay mock data ở `/profile`, `/rankings`
3. **Dọn dẹp Design System Phase 5**: shell cleanup, legacy CSS, visual audit
4. Cập nhật `PROJECT_STATUS.md` và `activeContext.md` cho khớp hiện trạng (xem notes trong PR này)
