# Progress: Arena of 100

## Current Status: ✅ Lobby Lifecycle + Heartbeat + Graceful Exit + Admin Kill-Switch Baseline Done → Design System Phase 5B Done → Drop-in Spectating Next

> Cập nhật 2026-06-14 dựa trên code + GitNexus. So với bản 2026-06-06, các mốc lobby/heartbeat/graceful-exit/admin kill-switch đã hoàn thành baseline và chuyển trạng thái. Design System Phase 5B closeout cũng đã hoàn thành 2026-06-14 (ground truth từ code: `app-shell-layout.tsx:34` và `sidebar.tsx:230` không còn shell gradient; `styles/components.css` đã được xác nhận không còn reference). Vài mục trước đây đánh "chưa xong" nay đã có code thật và được tick lại.
> Các file liên quan: `PROJECT_STATUS.md` và `activeContext.md` cũng được đồng bộ trong cùng lần cập nhật này.

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
  - `POST /admin/rooms/:roomId/terminate` (rate-limited 5/min, ADMIN-only) — **NEW 2026-06-14**
  - `GET /health` (public), `GET /health/monitoring` (ADMIN) trả CPU/RSS/active rooms
- [x] CSRF: `CsrfGuard` validate `X-CSRF-Token`; `apiFetch()` tự inject
- [x] Rate Limiting: `@nestjs/throttler` global 100 req/min + admin-specific
- [x] **Test coverage footprint rộng** (Vitest, `*.spec.ts`):
  - `packages/game-core/src/{match-state-machine,scoring}.spec.ts`
  - `apps/api/src/modules/match/{game-loop.service.spec.ts, game-loop.service.persistence.spec.ts, match.module.spec.ts, match.service.spec.ts, presence.service.spec.ts}`
  - `apps/api/src/gateways/handlers/{auth,room,match,base}.handler.spec.ts`
  - `apps/api/src/modules/{auth,room,question,admin,health,prisma,users,rankings}/**/*.spec.ts`
  - `apps/api/src/common/{pipes,interceptors}/*.spec.ts`
  - `apps/api/src/modules/admin/dto/terminate-room.dto.spec.ts` — **NEW 2026-06-14**
  - `apps/api/prisma/seeds/questions-validation.test.ts`
  - `apps/api/test/modules/{users,rankings}.e2e-spec.ts` — Vitest + SWC + Fastify inject, real CSRF/JWT/Prisma/Redis

### ✅ Frontend — Design System "Candy 3D Jelly UI"

- [x] Phase 1 — Foundation (font, tokens, Tailwind, `.jelly-card`/`.jelly-btn`)
- [x] Phase 2 — Atoms (Button, GlassPanel, Badge, Input)
- [x] Phase 3 — Procedural Avatars + MelbitSprite
- [x] Phase 4 — Game Molecules (AnswerTile, Timer, PlayerGrid)
- [x] Phase 5A — Shell Cleanup (mobile overlay, escape/backdrop, skip-link) — **completed 2026-06-08**
- [x] Phase 5B — Shell visual closeout (2026-06-14)
  - [x] Bước 5B.1: Bỏ shell-level gradient ở `app-shell-layout.tsx:34` (redundant với `body` gradient ở `globals.css:22`); AppShellLayout 100% test coverage (10 tests)
  - [x] Bước 5B.2: Bỏ mobile overlay gradient + `backdrop-blur-md` ở `sidebar.tsx:230`; Sidebar 99.51% test coverage (18 tests)
  - [x] Bước 5B.3: Audit `styles/components.css` (0 live references — confirmed gone); `bg-gradient-to-br from-pink-50 via-blue-50 to-indigo-50` không còn trong code
  - [x] Web vitest infrastructure setup (vitest + RTL + jsdom + coverage-v8); coverage 99.58% trên 2 file shell
  - [x] Plan.md line numbers fixed (32→34, 211→230); home page gradient deferred sang PR riêng

### ✅ Lobby Lifecycle + Graceful Exit Baseline (PR #38, 2026-06-07/08) — Hoàn thành

#### Contract + backend baseline

- [x] **Phase 1 contract baseline** — tách rõ room lifecycle contract khỏi match lifecycle; thêm `STARTING`, room status/presence socket events, payload room typed đầy đủ cho API/web consume (`packages/shared/src/{state,socket,events}.ts`)
- [x] **Phase 2 backend baseline** — public room auto-countdown khi đủ người, cancel countdown khi tụt dưới minimum, private room host force-start, room status chuyển `WAITING -> COUNTDOWN -> STARTING -> IN_GAME` đồng bộ với match start (`apps/api/src/modules/match/game-loop.service.ts:136-184, 274-403`)
- [x] **Phase 3 transport/store baseline** — `socket-store` consume room lifecycle events thật, lobby page đọc `room.status` / `countdownEndsAt` / `match.id` từ store, bỏ giả định manual-start-only ở client
- [x] **Phase 3 refinement (2026-06-08)** — `useLobbyLifecycle` hook (`apps/web/src/hooks/use-lobby-lifecycle.ts`) encapsulate auto-join, countdown timer, lifecycle state; xoá dev-only mock player fallback; export `Player`/`Room` types
- [x] **Host force-start private room** — `GameLoopService.forceStartRoomMatch` + `MatchHandler.handleStartMatch` (host-only) đã wire; `LobbyStartControls` consume từ store
- [x] **Heartbeat/presence validation** — client gửi heartbeat 10s (`socket-store.ts:642-657`), server `game.gateway.ts:157-183` cập nhật Redis TTL 20s, `PresenceService.sweep` 5s, auto-disband private room nếu host stale, batch remove non-host stale
- [x] **Lobby state machine** — `WAITING -> COUNTDOWN -> STARTING -> IN_GAME` (backend + store wiring done)
- [x] **Countdown recovery** — `GameLoopService.onModuleInit` đọc `room:countdowns` set, re-arm timer (hoặc auto-launch nếu đã expire) để chống kẹt COUNTDOWN sau restart
- [x] **Frontend surfaces** — countdown overlay, "leave" button + confirm modal, mobile-friendly leave flow, extracted lobby components (`LobbyHeader`, `RoomCodeCard`, `LobbyPlayerGrid`, `LeaveRoomModal`, `LobbyCountdownOverlay`) + visual stale indicator
- [x] **Lobby surface i18n** — toàn bộ 5 lobby components + `useLobbyLifecycle` hook + lobby page migrate sang `next-intl` namespaces `lobby.*`; ~50 keys mới ở `vi/en.json`
- [x] **Test footprint** — `presence.service.spec.ts` 16 tests, `game-loop.service.spec.ts` 78 tests, `room.handler.spec.ts` regression cho data-integrity guard, `room.service.spec.ts` `getActiveRooms` 2 cases, `redis.service.spec.ts` +6 passthroughs; **587/587 unit + 11/11 E2E** pass
- [x] **Coverage cleanup PR #38** — overall statements 89.53% → **94.98%**. `presence.service.ts` 18.62% → 100%, `game-loop.service.ts` 71.94% → 95.26%, `redis.service.ts` 78.75% → 97.5%, `room.service.ts` 95.97% → 100%, `room.handler.ts` 96.21% → 99.24%, `game.gateway.ts` 100%. Xem `memory-bank/coverage-cleanup.md`
- [x] **Phase 6 — Graceful Exit + Result Navigation** — auto-redirect `/result/[matchId]` 3s sau khi match finish; nút "Rời Trận Đấu" + confirm modal ở game page; xoá stale TODO trong `socket-store`
- [x] **Phase 7 — Shell Cleanup Isolation** — verify/stabilize `AppShellLayout` + `Sidebar`; thêm Escape + backdrop click-to-close cho mobile nav; preserve skip-link a11y; **không** đụng page business logic
- [x] **Phase 8 — Frontend Audit Sweep** — Home page a11y (`htmlFor`/id, tap-targets >44px), Not-Found surfaces có skip-link, tạo `AvatarFrame` reusable để dedupe avatar/sprite framing giữa `LobbyPlayerGrid` và `GamePage` sidebar
- [x] **Phase 9 — Tie-Break (baseline)** — backend `MatchStateMachine.tieBreak` đã có sort theo `totalResponseTimeMs` → `correctAnswers` → alphabetical fallback (deterministic). UI chưa expose riêng
- [x] **Phase 10 — Spectator Baseline (eliminated only)** — `socket-store` có `isEliminated`, handle `PLAYER_ELIMINATED`; `GamePage` render "Chế độ khán giả" với overlay khi `isEliminated === true`. Drop-in spectating (vào `IN_GAME`/`FINISHED`) chưa có

### ✅ Admin Kill-Switch (PR #47, 2026-06-14) — Baseline Hoàn thành

- [x] **Phase 1 (contract)** — typed `ServerEvent.ROOM_TERMINATED` + `RoomTerminatedPayload` + `RoomTerminationReason="ADMIN_TERMINATED"`
- [x] **Phase 2 (backend action)** — `POST /admin/rooms/:roomId/terminate` (ADMIN-only, 5/min throttle) → `AdminService.terminateRoom` orchestrator; `MatchService.finishMatch(matchId, null)`; `GameLoopService.stopRoomRuntime` cancel lobby countdown + match timers; `emitRoomTerminated` encapsulate socket emit; Redis cleanup (room keys + SCAN'd presence keys + match state + lobby countdowns index)
- [x] **Phase 3 (defensive orchestrator)** — `cleanupRoomRedisKeys` error + `disbandRoom` error đều surface `{ partial: true, cleanupError }` với first-error-wins semantics. `admin.service.ts` 100% stmts/100% branch, `match.service.ts` 100%/100%, `game-loop.service.ts` 100% stmts / 98.57% branch
- [x] **Phase 4 (game page ROOM_TERMINATED UX)** — `GamePage` toast qua `useToast`, `clearTimers` qua `clearTimers` callback, `useRef` guard cho strict-mode double-invoke, redirect `/` sau 1.5s; `Game.termination.{toastTitle,toastDefault}` i18n keys ở `vi/en.json`. Inline `TODO(game-page-termination)` đã xoá
- [x] **DTO metadata truth-in-advertising** — `TerminateRoomDto.message` description sửa để khớp hành vi fail-fast của `superRefine`, mark `deprecated: true`. `terminate-room.dto.spec.ts` 8 tests
- [x] **Coverage PR #47** — `game-loop.service.ts` patch 6.89% → 100% stmts / 98.57% branch, `admin.service.ts` 88.09% → 100%/100%, `terminate-room.dto.ts` 66.66% → 100%/100%. **+47 net tests** (8 DTO + 17 game-loop + 22 admin), **119/119 spec trong 3 file pass**
- [ ] Admin kill-switch message sanitizer — **deferred** tới khi shared profanity/content-moderation pipeline (plan.md §501) lands. `TerminateRoomDto.message` hiện fail-fast reject raw message — `AdminService.terminateRoom` cố ý không truyền `message` từ UI cho tới khi pipeline ready

### ✅ Profile + Rankings Real APIs (PR #38 follow-up, 2026-06-06) — Hoàn thành

- [x] Backend `UsersModule` (`/users/me/stats`, `/users/me/history` cursor-paginated, `PATCH /users/me/avatar`)
- [x] Backend `RankingsModule` (`GET /rankings/leaderboard?period=weekly|all` + `limit=1..100`, Redis cache 60s, cache-aside, 30 req/min throttle, `@Public()`)
- [x] Frontend `useProfileStats` + `useMatchHistory` + `useLeaderboard` hooks
- [x] `PATCH /users/me/avatar` flow + `apps/web/src/lib/avatars.ts` dùng 1 nguồn `AVATAR_SEEDS` từ `@arena/shared`
- [x] `seed-demo.ts` (idempotent) + Vitest SWC E2E infrastructure (`test:db:up`/`test:e2e`)
- [x] Tests: 418/418 unit + 11/11 E2E pass. Xem `memory-bank/issue.md` Step 3-6

### 🟡 Tie-Break & Sudden Death

- [x] Deterministic tie-break backend (`MatchStateMachine.tieBreak`) — sort by `totalResponseTimeMs` (lower is better), `correctAnswers` (higher is better), alphabetical playerId fallback
- [ ] Sudden death mode (chưa có state machine branch)
- [ ] Tie-break UI surface (chưa expose riêng; chỉ thấy qua `MATCH_FINISHED.winnerId` + `tiedPlayerIds` payload)

### 📋 Upcoming — PR Kế Tiếp (đề xuất)

1. **Drop-in spectating + spectator transport baseline** (P1, product) — promoted lên P1 sau khi Phase 5B done
   - Re-evaluate `RoomService.joinRoom` để cho phép late-joiners vào `IN_GAME`/`FINISHED` với `PlayerStatus.SPECTATOR`
   - Thêm socket channel `spectator:<matchId>` (hoặc namespace riêng) để mass-spectate không pollute player channel
   - Tests: `RoomService.joinRoom` reject vs. allow-by-status, presence semantics cho spectator
2. **In-match AFK policy** (P2, product)
   - Backend: round-miss detection tận dụng `Answer` table (current/previous round)
   - Quyết định: 2+ round miss → auto-`ELIMINATED` (loss-of-life) hoặc `SPECTATOR` (chill) — pending product decision
3. **Content moderation + message sanitizer + device fingerprint** (P2, compliance)
   - Shared profanity/content-moderation pipeline (plan.md §501)
   - `TerminateRoomDto.message` cho phép custom message
   - Backend enforce `guestId` Model C + IP/UA fingerprint
4. **Optimistic UI rollback** (P2, game feel) — hiện `game/[matchId]/page.tsx` đã có `selectedAnswer` + `roundCompleted` lock-in; thiếu idempotency key + rollback path khi server reject
5. **Post-match rematch + share** (P3, retention)
6. **Accessibility audit (WCAG)** (P2, compliance)
7. **k6 load test 100 concurrent WS** (P2, pre-launch gate) — xem Testing Roadmap bên dưới
8. **Playwright browser E2E (3-5 cases)** (P3) — deferred sau khi Design System ổn định

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

- [ ] Lobby lifecycle state machine còn nằm trong `GameLoopService` thay vì tách thành `RoomLifecycleService` riêng (low priority — current design works)
- [ ] In-match AFK policy chưa quyết (loại vs. chuyển spectator)
- [ ] `RoomService.getActiveRooms` dùng Prisma `findMany` (OK cho 1 instance, cần cache hoặc stream nếu scale)
- [ ] `correctAnswer` có thể leak qua `stateMachine.startRound` (đã strip ở broadcast nhưng cần audit thêm)
- [ ] `SocketNamespace` chưa có SPECTATOR entry riêng (drop-in spectating sẽ cần)
- [ ] `packages/config` directory trống
- [x] **Design system Phase 5B đã đóng (2026-06-14)** — shell gradient đã bỏ ở `app-shell-layout.tsx:34` + mobile overlay ở `sidebar.tsx:230`; `styles/components.css` audit xác nhận 0 live references; visual closeout done
- [ ] **Admin kill-switch message sanitizer** — deferred tới khi profanity/content-moderation pipeline lands
- [ ] **Admin kill-switch append-only audit event** — `AdminService.terminateRoom` (`apps/api/src/modules/admin/admin.service.ts:250-362`) mutate DB (finishMatch + disbandRoom) + Redis + timers + emit `ROOM_TERMINATED` nhưng KHÔNG ghi `EventLog` row. Vi phạm `.github/instructions/review.instructions.md:36` + `memory-bank/codingGuidelines.md:247`. Cần: append immutable audit event (roomId, matchId, adminUserId, reason, timestamp) trước/song song với `disbandRoom`. Owner: TBD, ticket: TBD
- [ ] **Host kick player** — backend hook (`PlayerStatus.KICKED` đã có ở shared types) chưa wire vào room handler / admin endpoint
- [ ] **Drop-in spectating** — `RoomService.joinRoom` còn reject khi `room.status !== WAITING`

### 🟢 Nice-to-Have

- [ ] Frictionless onboarding với content moderation + device fingerprint
- [ ] Lobby heartbeat UI indicator (đã có presence semantics backend; thiếu UI dot)
- [ ] Mass-spectator isolation infra (SSE channel riêng)
- [ ] Spectator emotes (micro-interactions)
- [ ] Asset preloading + fallback
- [ ] Post-match rematch UI
- [ ] Accessibility audit
- [ ] Bot/demo system
- [ ] Optimistic UI rollback flow
- [ ] k6 load test pre-launch
- [ ] Playwright browser E2E
- [x] Game operations kill switch (admin force-kill room) — Phases 1-4 done; chỉ còn deferred message-sanitizer
- [x] Profile + Rankings real APIs — done
- [x] Lobby mock players fallback — removed
- [x] Lobby state machine backend + store wiring — done
- [x] Heartbeat/presence scheduler — done (`PresenceService.sweep` 5s)

## Architecture Assessment Scores (cập nhật 2026-06-14)

| Dimension                | Score      | Notes                                                                                                 |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------- |
| Monorepo Structure       | 10/10      | Turborepo + Remote Caching                                                                            |
| Package Boundaries       | 9/10       | Clean separation, đúng dependency flow                                                                |
| Domain Logic (game-core) | 9/10       | Có serialize/deserialize, immutability, persistence, deterministic tie-break                          |
| Backend Architecture     | 8/10       | Handlers rõ ràng; lobby/heartbeat baseline done; admin kill-switch baseline done                      |
| Frontend Architecture    | 8/10       | Lobby/Game/Result done; spectator baseline (eliminated) done; Profile/Rankings real                   |
| Infrastructure           | 8/10       | Docker + Redis + Throttler + CI/E2E; chưa có multi-instance adapter                                   |
| DevOps/CI-CD             | 10/10      | GitHub Actions pipeline configured; E2E job có cache strategy gọn + fail artifacts                    |
| Testing                  | 9/10       | 587 unit + 11 E2E; coverage 94.98% stmts; PR #38 + PR #47 cleanup; admin 100%/100%                    |
| **Overall**              | **8.4/10** | Lobby/heartbeat/graceful-exit/admin kill-switch baseline done; Design System Phase 5B done 2026-06-14 |

## Milestones

| Milestone                       | Target   | Status                               |
| ------------------------------- | -------- | ------------------------------------ |
| Base Scaffold                   | Week 1   | ✅ Complete                          |
| Architecture Review             | Week 1   | ✅ Complete                          |
| Critical Fixes (Phase 0.5)      | Week 2   | ✅ Complete                          |
| Core Gameplay Loop              | Week 2   | ✅ Complete                          |
| Frontend Pages + Design System  | Week 2-3 | ✅ Phase 5A + 5B done (2026-06-14)   |
| Lobby Lifecycle + Graceful Exit | Week 3   | ✅ Complete (PR #38)                 |
| Admin Kill-Switch End-to-End    | Week 3-4 | ✅ Baseline (PR #47)                 |
| Profile/Rankings real APIs      | Week 4   | ✅ Complete                          |
| E2E + Accessibility audit       | Week 4   | 🟡 API E2E done; Playwright deferred |
| MVP Launch                      | Week 5   | 🔮 Future                            |

## What Works Now (verified 2026-06-14)

- Project structure, CI/CD, Vitest, Turborepo remote cache
- Shared types (`events.ts`, `state.ts`, `socket.ts`, `errors.ts`)
- Match state machine (pure logic, Redis persistence, immutability, deterministic tie-break)
- `GameLoopService` chạy countdown → round → result → finish với persistence + lobby state machine
- `GameLoopService.maybeStartPublicCountdown` auto-start cho public, `forceStartRoomMatch` cho private host
- `GameLoopService.onModuleInit` recover lobby countdowns từ Redis sau restart
- `PresenceService.sweep` (5s interval) auto-disband private room nếu host stale, batch remove non-host stale
- `AuthHandler` reconnect sync, `RoomHandler` create/join/leave, `MatchHandler` start/answer/snapshot
- `AdminService` sync questions, reset system, `terminateRoom` kill-switch; `HealthController` monitoring
- CSRF + rate limiting + Zod validation đã wire xuyên suốt
- Frontend pages: home (`/`), `/room/create`, `/lobby/[roomCode]`, `/game/[matchId]`, `/result/[matchId]`, `/profile`, `/rankings`, `/settings`, `/admin`
- Socket-store với auto-reconnect logic, room lifecycle events, ROOM_TERMINATED handling, eliminated spectator state
- 587/587 unit tests + 11/11 E2E tests pass; API coverage 94.98% statements

## What's Next (Priority Order)

1. **PR tiếp theo — Drop-in spectating + spectator transport baseline (đề xuất)**
   - `RoomService.joinRoom` cho phép late-joiner vào `IN_GAME`/`FINISHED` với `PlayerStatus.SPECTATOR`
   - Socket channel/namespace riêng cho spectator
2. **PR sau — In-match AFK policy** (sau khi có product decision: loại vs. spectator)
3. **PR sau — Content moderation + message sanitizer + device fingerprint**
4. **Optimistic UI rollback** (game feel, không block ship MVP)
5. **Post-match rematch + share** (retention)
6. **k6 load test 100 concurrent WS** (pre-launch gate)
7. **Playwright browser E2E** (deferred tới khi UI ổn định)
8. Cập nhật `PROJECT_STATUS.md` và `activeContext.md` cho khớp hiện trạng ✅ done trong lần này
