# Active Context: Arena of 100

> Cập nhật 2026-06-14 dựa trên code + GitNexus.
> Bản 2026-06-06 từng liệt kê lobby lifecycle / heartbeat / graceful exit / kill-switch là "chưa có"; thực tế code đã hoàn thành baseline ở PR #38 (lobby/heartbeat/graceful exit) và PR #47 (admin kill-switch), nay đồng bộ lại. Cùng ngày cũng đóng PR Drop-in Spectating Baseline (`feat/drop-in-spectating-baseline`): thêm `JoinMode` payload (`RoomJoinedPayload.joinedAs`) + backend join policy 4-way matrix + server-side submit gate + frontend spectator UI. Xem mục `Recent Changes` và `phase 11` dưới đây.

## Current Focus

- Nhánh hiện tại: `feat/drop-in-spectating-baseline` (PR sẵn sàng review, chờ merge). Branch kế tiếp ưu tiên: in-match AFK policy (đang chờ product decision loại vs. chuyển spectator).
- Trọng tâm review gần nhất: backend `RoomService.joinRoom` 4-way matrix (`apps/api/src/modules/room/room.service.ts:93-180`) + `RoomHandler.handleJoinRoom` spectator branch (`apps/api/src/gateways/handlers/room.handler.ts:77-189`) + `MatchHandler.handleSubmitAnswer` server gate (`apps/api/src/gateways/handlers/match.handler.ts:69-130`) + frontend `lobby/[roomCode]/page.tsx` + `game/[matchId]/page.tsx` spectator UI.
- Trạng thái thật của code: lobby/heartbeat/graceful exit/admin kill-switch/Design System Phase 5B/drop-in spectating đều baseline-done. Còn lại 4 product gap: in-match AFK, mass-spectator scaling, content moderation, optimistic rollback.
- Mục tiêu lần cập nhật này:
  - Khẳng định các mốc đã xong (lobby baseline, heartbeat, graceful exit, admin kill-switch, profile/rankings real APIs, spectator baseline khi bị loại).
  - Liệt kê các gap còn lại (Design System Phase 5B, drop-in spectating, in-match AFK, content moderation, optimistic rollback).
  - Chốt scope PR kế tiếp — đề xuất Design System Phase 5B closeout.

## Recent Changes

- Tạo full monorepo pnpm + Turborepo
- Shared types, MatchStateMachine, NestJS scaffold (auth/room/match/health), Next.js scaffold
- Prisma schema + Docker Compose
- Memory bank docs
- **Architecture assessment (2026-05-09)**
- **CI/CD + Vitest (2026-05-12)**
- **Type-safe error handling** — `RoomError` + `ErrorCode` (xem [errorHandlingPattern.md](./errorHandlingPattern.md))
- **Gateway refactor** — `AuthHandler`, `RoomHandler`, `MatchHandler`
- **State machine persistence** — `MatchStateMachine.serialize/deserialize` + Redis (TTL 2h)
- **Question module** — full CRUD + bulk import + admin sync + seed data
- **`getState()` deep-clone fix** — players Map không còn leak
- **Zod migration** — bỏ `class-validator` / `class-transformer` (xem [processTechDebt.md](./processTechDebt.md))
- **CSRF (2026-06-03)** — `CsrfGuard` + double-submit cookie, `apiFetch` inject `X-CSRF-Token`
- **Rate Limiting (2026-06-03)** — `@nestjs/throttler` global 100/min; admin 5/min sync, 2/5min reset
- **Hardcoded locale redirect fix (2026-06-03)** — `routing.defaultLocale` thay vì `/vi`
- **Admin UI (2026-06-03)** — toast cho migration check; `typecheck` script cho web
- **E2E in CI (2026-06-06)** — job `e2e` ở `.github/workflows/ci.yml`, 11 vitest E2E tests trên mỗi PR + push main, matrix Node [20, 22], `services: postgres/redis`. Step-level `DATABASE_URL` override. Follow-up hardening: bỏ cache `**/node_modules`, Prisma cache key `node-version + pnpm-lock.yaml`, junit + json reports upload khi fail
- **CI/E2E scaling note (2026-06-06)** — suite ở serial (`singleFork`, `fileParallelism: false`) cho ổn định. Hướng scale: per-worker DB + global setup, transaction rollback per test, hoặc testcontainers per worker
- **Profile + Rankings real APIs (2026-06-06)** — `UsersModule` + `RankingsModule` (Redis cache 60s); `useProfileStats` + `useMatchHistory` + `useLeaderboard` hooks; `seed-demo.ts` idempotent + Vitest SWC E2E infrastructure. 418/418 unit + 11/11 E2E
- **Lobby lifecycle + heartbeat + graceful exit baseline (PR #38, 2026-06-07/08)**
  - `GameLoopService.maybeStartPublicCountdown` + `forceStartRoomMatch` + `launchRoomMatch` orchestrator
  - `GameLoopService.onModuleInit` recover lobby countdowns từ Redis (re-arm hoặc auto-launch nếu expire)
  - `PresenceService.sweep` (5s interval) — auto-disband private room nếu host stale, batch remove non-host stale
  - `useLobbyLifecycle` hook, extracted lobby components (`LobbyHeader`, `RoomCodeCard`, `LobbyPlayerGrid`, `LeaveRoomModal`, `LobbyCountdownOverlay`, `LobbyStartControls`)
  - Lobby i18n migration (~50 keys ở `vi/en.json`)
  - Coverage: 89.53% → 94.98% statements; 533 → 587 tests
- **Phase 6 Graceful Exit** — `GamePage` auto-redirect `/result/[matchId]` 3s sau khi match finish; nút "Rời Trận Đấu" + `LeaveMatchModal`; xoá stale TODO
- **Phase 7 Shell Cleanup Isolation** — verify `AppShellLayout` + `Sidebar`; Escape + backdrop click-to-close cho mobile nav; preserve skip-link a11y
- **Phase 8 Frontend Audit Sweep** — `AvatarFrame` reusable; Home page a11y
- **Phase 9 Tie-Break baseline** — `MatchStateMachine.tieBreak` deterministic (response time → correct answers → alphabetical fallback). UI surface chưa expose riêng
- **Phase 10 Spectator Baseline (eliminated only)** — `socket-store.isEliminated`; `GamePage` render "Chế độ khán giả" overlay khi bị loại. Drop-in spectating (vào `IN_GAME`/`FINISHED` cho non-existing player) được bổ sung ở Phase 11 dưới đây.
- **Atomic Design Migration PoC** — `RoomCodeCard` chuyển sang `components/atoms/` qua GitNexus impact analysis
- **Admin Kill-Switch (PR #47, 2026-06-14)**
  - `POST /admin/rooms/:roomId/terminate` (ADMIN-only, 5/min throttle)
  - `AdminService.terminateRoom` defensive orchestrator: stop timers → emit `ROOM_TERMINATED` → Redis cleanup → DB disband; surface `{ partial: true, cleanupError }` first-error-wins
  - `GameLoopService.stopRoomRuntime` + `emitRoomTerminated` encapsulate runtime teardown + socket emit
  - `GamePage` UX: toast qua `useToast`, `clearTimers` callback, `useRef` guard cho strict-mode double-invoke, redirect `/` sau 1.5s; `Game.termination.{toastTitle,toastDefault}` i18n keys
  - `TerminateRoomDto.message` description sửa để khớp fail-fast behavior; mark `deprecated: true`
  - `terminate-room.dto.spec.ts` 8 tests; `admin.service.spec.ts` 33 tests; `game-loop.service.spec.ts` 78 tests. `admin.service.ts` 100% stmts/100% branch, `match.service.ts` 100%/100%, `game-loop.service.ts` 100% stmts / 98.57% branch
- **Drop-in Spectating Baseline (PR `feat/drop-in-spectating-baseline`, 2026-06-14)**
  - `packages/shared/src/socket.ts` — thêm `type JoinMode = "PLAYER" | "SPECTATOR"` + `joinedAs: JoinMode` trong `RoomJoinedPayload` + `RoomCreatedPayload` (spectator role carried ở transport layer, không phải `PlayerStatus`)
  - `packages/shared/src/error-codes.ts` — thêm `SPECTATOR_CANNOT_ANSWER` (server gate)
  - `RoomService.joinRoom` 4-way matrix: WAITING+new→PLAYER, WAITING+existing→PLAYER reconnect, IN_GAME/FINISHED+existing→PLAYER reconnect, IN_GAME/FINISHED+new→SPECTATOR (no DB write), COUNTDOWN/STARTING→reject
  - `RoomHandler.handleJoinRoom` — spectator branch: KHÔNG emit `PLAYER_JOINED`, KHÔNG gọi `maybeStartPublicCountdown`, VẪN `client.join(\`room:${id}\`)`để nhận ROUND_* broadcasts; ROOM_JOINED payload include`joinedAs`
  - `MatchHandler.handleSubmitAnswer` — server-side gate `stateMachine.getState().players.has(userId)` → throw `SPECTATOR_CANNOT_ANSWER` nếu không phải player
  - `MatchHandler.handleRequestSnapshot` — comment rõ allow-list cho spectator path; regression test verify no `correctAnswer` leak
  - `socket-store.ts` — thêm `joinMode: JoinMode` vào `Room` interface; set từ `ROOM_JOINED.joinedAs`
  - `lobby/[roomCode]/page.tsx` — spectator banner + "Vào xem" (IN_GAME) / "Xem kết quả" (FINISHED) CTA + auto-redirect `/result/[matchId]` cho FINISHED + suppress `LobbyStartControls` + replace "Quick Tips" panel
  - `game/[matchId]/page.tsx` — `handleSelectAnswer` short-circuit khi `isSpectator`; render spectator banner + reuse Swords/Spectator block với i18n mới (`dropInSpectator.*` namespace)
  - `messages/{en,vi}.json` — thêm `lobby.spectator.*` + `Game.dropInSpectator.*` (8 keys mới)
  - 661/661 unit tests pass; coverage per-file ≥90% cho tất cả file sửa: `room.service.ts` 98.25%/91.89%, `room.handler.ts` 100%/90.47%, `match.handler.ts` 100%/95.65%

## Architecture Assessment Summary

### 🔴 Critical Issues — All Resolved

1. ~~GameGateway God Object~~ [RESOLVED] — Refactored thành `AuthHandler`/`RoomHandler`/`MatchHandler`.
2. ~~In-Memory State Machines~~ [RESOLVED] — `MatchService.persistStateMachine` + restore qua `getStateMachine`.
3. ~~Missing QuestionModule~~ [RESOLVED] — Full REST + admin sync + seed.

### 🟡 Significant Gaps (cập nhật 2026-06-14)

1. ~~Missing Test Coverage~~ — Bây giờ có spec cho game-core, game-loop (kể cả persistence + admin helpers), auth, room, question, admin, handlers, common pipes/interceptors, presence, users, rankings, terminate-room DTO. 587/587 pass.
2. ~~No Round Timer Management~~ [RESOLVED] — `GameLoopService` đã enforce 15s timeout.
3. **Gateway ↔ Service Coupling** — gateway vẫn gọi service trực tiếp; use-case layer chưa tách hẳn. Đã chấp nhận cho MVP.
4. ~~Frontend Only Has Landing Page~~ [RESOLVED] — Có lobby/game/result/profile/rankings/settings/admin/room-create/not-found.
5. ~~No Lobby Lifecycle Management~~ [RESOLVED] — backend baseline + store wiring + frontend surfaces đều done. `WAITING -> COUNTDOWN -> STARTING -> IN_GAME` đầy đủ. Auto-start public, force-start private, heartbeat/presence sweep, countdown recovery.
6. ~~Missing Admin Kill-Switch~~ [RESOLVED baseline] — `POST /admin/rooms/:roomId/terminate` end-to-end. Message sanitizer deferred tới khi shared profanity/content-moderation pipeline lands.
7. ~~Drop-in spectating~~ [RESOLVED baseline 2026-06-14] — `JoinMode` payload (`RoomJoinedPayload.joinedAs`) added; `RoomService.joinRoom` 4-way matrix; `MatchHandler.handleSubmitAnswer` server gate; frontend spectator UI trên lobby + game page. Reuse `room:[id]` channel. Mass-spectator SSE vẫn deferred (PR 3).
8. **Design System Phase 5B closeout** — **done 2026-06-14**. Shell gradient đã bỏ ở `app-shell-layout.tsx:34` + mobile overlay `sidebar.tsx:230`; legacy `styles/components.css` audit xác nhận không còn reference; vitest infrastructure cho web package setup với 99.58% coverage trên 2 file shell (28 tests pass). Home page gradient ở `[locale]/page.tsx:193` deferred sang PR riêng vì home không dùng AppShellLayout.

### 🟢 Architecture Score (cập nhật 2026-06-14)

- Monorepo: 10/10, Package Boundaries: 9/10, Domain Logic: 9/10
- Backend: 8/10, Frontend: 8/10, Infra: 8/10, Testing: 9/10
- **Overall: ~8.4/10**

## Active Decisions (selected highlights)

1. NestJS + Fastify + Socket.io + Zustand
2. Server-authoritative, event-sourced, modular monolith
3. Frictionless onboarding với content moderation
4. Lobby auto-start (public) + host controls (private) + heartbeat
5. Micro-interactions (emotes) thay cho chat
6. Performance: event batching, throttling, separate channels cho spectator
7. Resilience: graceful degradation, content fallback
8. Security: content moderation, rate limiting, device fingerprint
9. Anonymous identity tracking (Model C — `guestId` trong localStorage)
10. Optimistic UI với smart recovery
11. Game operations: admin tools cho emergency interventions
12. Testing: Vitest với `*.spec.ts`; E2E: Vitest + SWC + Fastify inject (real CSRF/JWT/Prisma/Redis)
13. Zod migration: `ZodValidationPipe` + `ZodSerialize`
14. Distributed session: Redis in-memory + high-perf O(1) `client.data.userId` lookups
15. Persistent guest identity: `guestId` (Model C)
16. Candy 3D Jelly UI theme (light gradient, thick ink borders, glossy reflections, jelly wobble)
17. Procedural avatar fallback + MelbitSprite
18. **Type-safe error handling** với `RoomError`
19. CSRF double-submit cookie pattern
20. Rate limiting: `@nestjs/throttler` global + admin-specific
21. Atomic counter cho `playerCount` (`INCR` + Lua-decrement-clamped) — chống race join/leave/remove
22. Lobby countdown persisted in Redis (`room:countdown:<roomId>` + `room:countdowns` set) + recovery in `GameLoopService.onModuleInit`
23. Admin kill-switch với partial-failure response contract (`{ partial, cleanupError }`)

## Pending Decisions

- [x] Gateway refactor strategy → Command Pattern via handler classes
- [x] Test framework → Vitest; E2E framework → Vitest + SWC + Fastify inject
- [x] Frontend routing structure → `/lobby/[code]`, `/game/[matchId]`
- [x] Guest login hijacking fix → Model C device-based `guestId`
- [x] Lobby countdown strategy → in-process `setTimeout` + Redis persistence + recovery (đủ cho 1 instance)
- [ ] **In-match AFK policy** — 2+ round miss → auto-`ELIMINATED` (loss-of-life) hay chuyển `SPECTATOR`? Cần product decision
- [ ] **Mass-spectator transport scaling** — baseline đã reuse `room:[id]` channel + `getSnapshot` cho late-joiner. SSE channel riêng + batched low-frequency updates vẫn là next step khi cần scale.
- [ ] **Admin kill-switch custom message** — cho phép `TerminateRoomDto.message` sau khi shared profanity/content-moderation pipeline (plan.md §501) lands

## Next Steps (Immediate — Priority Order)

### Prerequisite

1. Start Docker containers
2. `pnpm install` + `pnpm db:push`

### Critical Fixes — All Done

1. ~~QuestionModule~~ ✅
2. ~~State persistence + Redis~~ ✅
3. ~~Gateway refactor~~ ✅
4. ~~Zod migration~~ ✅

### Core Game Loop — Done

1. ~~GameLoopService (countdown → round → evaluate → repeat)~~ ✅
2. ~~Round timer (auto-end round)~~ ✅
3. ~~Unit tests cho game-core state machine~~ ✅

### Lobby Lifecycle + Graceful Exit + Admin Kill-Switch Baseline — Done (PR #38 + PR #47)

1. ~~Backend: room state machine `WAITING -> COUNTDOWN -> STARTING -> IN_GAME`~~ ✅
2. ~~Auto-start countdown cho public room; host "force start" cho private room~~ ✅
3. ~~Heartbeat/presence validation + AFK sweeping scheduler~~ ✅ (sweep 5s, TTL 20s)
4. ~~Frontend: countdown overlay, leave flow + confirm modal, "waiting for players" UI~~ ✅
5. ~~Tests: room lifecycle, heartbeat, leave flow~~ ✅ (presence 16 + game-loop 78 + room.handler 1 + room.service 2 + redis 6 = +103)
6. ~~Profile + Rankings real APIs~~ ✅ (Step 3-5 `issue.md`)
7. ~~Admin kill-switch end-to-end~~ ✅ (PR #47 baseline)

### Next PR (đề xuất): Design System Phase 5B Closeout — DONE 2026-06-14

1. ✅ Bước 5B.1: bỏ shell gradient ở `app-shell-layout.tsx:34` (redundant với body gradient)
2. ✅ Bước 5B.2: audit `styles/components.css` (0 live references) + bỏ mobile overlay gradient ở `sidebar.tsx:230`
3. ✅ Bước 5B.3: setup vitest infrastructure (vitest + RTL + jsdom + coverage-v8); 28 tests / 99.58% coverage trên 2 file shell
4. ✅ Verify: `pnpm --filter @arena/web {build,lint,typecheck}` all pass
5. ✅ Plan.md updated (line numbers fixed, home page gradient added to deferrals)

### Following PRs (Priority Order)

1. ✅ Drop-in spectating baseline — **done 2026-06-14** (`feat/drop-in-spectating-baseline`)
2. In-match AFK policy (P1, product — pending decision) — promoted lên P1 sau khi drop-in spectating baseline done
3. Mass-spectator transport scaling (P2, infra) — SSE channel riêng + batched low-frequency updates
4. Content moderation pipeline + admin kill-switch message sanitizer (P2, compliance)
5. Optimistic UI rollback đầy đủ (P2, game feel)
6. Post-match rematch + share (P3, retention)
7. Accessibility audit (WCAG) (P2, compliance)
8. k6 load test 100 concurrent WS (P2, pre-launch gate)
9. Playwright browser E2E (P3, deferred)

## Key Files Reference (verified 2026-06-14)

```
packages/shared/src/
├── events.ts        # Event types and factory (ROOM_TERMINATED, ROOM_COUNTDOWN_*, MATCH_STARTING, ...)
├── state.ts         # State interfaces (RoomStatus.WAITING/COUNTDOWN/STARTING/IN_GAME/FINISHED, PlayerStatus.ACTIVE/ELIMINATED/DISCONNECTED/WINNER/SPECTATOR — SPECTATOR added in PR drop-in-spectating-baseline 2026-06-14)
├── socket.ts        # Socket protocol + getRoomChannel
├── errors.ts        # RoomError + ErrorCode
├── avatars.ts       # AVATAR_SEEDS + isValidAvatarSeed
└── index.ts         # Constants (GAME_CONFIG.COUNTDOWN_DURATION_MS, ...)

packages/game-core/src/
├── match-state-machine.ts        # Core state machine + serialize/deserialize + tieBreak
├── match-state-machine.spec.ts
├── scoring.ts                    # computeRoundScore (100 + max(0,(10000-rt)/200))
└── scoring.spec.ts

apps/api/src/
├── main.ts
├── app.module.ts                 # CsrfGuard + ThrottlerGuard global; UsersModule + RankingsModule
├── common/
│   ├── pipes/zod-validation.pipe.ts
│   └── interceptors/zod-serializer.interceptor.ts
├── modules/
│   ├── auth/                     # Guest login, JWT, CSRF
│   ├── room/                     # create/join/leave/list, atomic playerCount, presence, getActiveRooms
│   │   └── room.service.{ts,spec.ts}
│   ├── match/
│   │   ├── match.service.ts      # persistence, state machine wrapper
│   │   ├── game-loop.service.ts  # lobby state machine, maybeStartPublicCountdown, forceStartRoomMatch, launchRoomMatch, stopRoomRuntime, emitRoomTerminated
│   │   ├── game-loop.service.{spec,persistence.spec}.ts
│   │   ├── presence.service.ts   # 5s sweep, heartbeat, auto-disband
│   │   └── presence.service.spec.ts
│   ├── question/                 # CRUD + bulk + random + stats
│   ├── users/                    # /users/me/stats + /users/me/history + PATCH /users/me/avatar
│   ├── rankings/                 # /rankings/leaderboard?period=weekly|all, Redis cache 60s
│   ├── admin/                    # syncQuestions + resetSystem + terminateRoom
│   │   ├── admin.service.{ts,spec.ts}
│   │   └── dto/terminate-room.dto.{ts,spec.ts}
│   ├── health/                   # /health + /health/monitoring
│   └── prisma/                   # PrismaService
├── gateways/
│   ├── game.gateway.ts           # heartbeat -> presenceService.updatePresence
│   └── handlers/{base,auth,room,match}.handler.ts
└── test/                         # Vitest E2E infrastructure
    ├── vitest-e2e.config.ts
    ├── setup-e2e.ts
    ├── helpers/{test-app.factory,db-helpers,redis-helpers}.ts
    └── modules/{users,rankings}.e2e-spec.ts

apps/web/src/
├── app/[locale]/
│   ├── page.tsx                       # Home + guest nickname/avatar
│   ├── room/create/page.tsx
│   ├── lobby/[roomCode]/page.tsx      # useLobbyLifecycle hook; LobbyStartControls
│   ├── game/[matchId]/page.tsx        # ROOM_TERMINATED UX, LeaveMatchModal, spectator UI
│   ├── result/[matchId]/page.tsx
│   ├── profile/page.tsx               # useProfileStats + useMatchHistory
│   ├── rankings/page.tsx              # useLeaderboard
│   ├── settings/page.tsx
│   ├── admin/page.tsx                 # monitoring + sync + reset + terminate
│   ├── layout.tsx
│   └── not-found.tsx
├── components/
│   ├── ui/{button,glass-panel,avatar,avatar-frame,animated-sprite,app-shell-layout,sidebar}.tsx
│   ├── game/{answer-tile,timer,player-grid,leave-match-modal}.tsx
│   └── lobby/{lobby-header,room-code-card,lobby-player-grid,leave-room-modal,lobby-countdown-overlay,lobby-start-controls}.tsx
├── hooks/{use-lobby-lifecycle,use-toast}.ts
├── stores/socket-store.ts             # auto-reconnect, 15+ server event handlers, ROOM_TERMINATED, isEliminated
├── lib/api.ts                         # CSRF-aware apiFetch
└── styles/tokens/{colors,animations,...}.ts
```

## Important Patterns to Remember

- Server-authoritative timestamps (anti-cheat)
- Client sends intent, server validates and executes
- State transitions guarded
- Events immutable (append-only)
- Redis for fast state, PostgreSQL for persistence
- **State machines MUST be persisted to Redis after each transition**
- **Never expose correctAnswer to client via snapshot/events**
- Lobby lifecycle: public auto-start, private host control
- Atomic playerCount counter (`INCR` + Lua-decrement-clamped)
- Lobby countdown persistence + recovery (`onModuleInit` reads `room:countdowns` set)
- Micro-interactions: event batching for performance
- Graceful exit > AFK detection
- Asset preloading for fairness
- Mass-spectator isolation
- Content moderation
- Accessibility (WCAG)
- Device fingerprinting
- Optimistic UI: lock + rollback
- Admin tools: secure access + partial-failure response contract

## Current Blockers (updated 2026-06-14)

Đã gỡ hết blocker kỹ thuật. Các gap product/UX còn lại (theo thứ tự ưu tiên):

- Design System Phase 5B closeout (shell gradient legacy + safe-delete CSS + visual audit)
- In-match AFK policy (sau khi có product decision: loại vs. chuyển spectator)
- Content moderation + admin kill-switch message sanitizer (deferred tới khi shared profanity/content-moderation pipeline lands; `TerminateRoomDto.message` hiện fail-fast)
- Device fingerprint (Model C đã chốt nhưng backend chưa enforce)
- Optimistic UI rollback đầy đủ (lock-in có ở `GamePage`, thiếu idempotency key + rollback khi server reject)
- Post-match rematch + share
- Accessibility audit (WCAG)
- k6 load test 100 concurrent WS
- Playwright browser E2E

## Testing Roadmap

**Hiện tại (đã làm 2026-06-14)**: 587 unit tests + 11 API E2E tests (users + rankings) tích hợp vào CI trên mọi PR + push main. Job `e2e` dùng real NestJS + Fastify + Prisma + Redis, real CSRF flow, real JWT auth. API coverage 94.98% statements (89.53% pre-PR #38, +5.45% delta).

**Giai đoạn 2 (sau khi Design System Phase 5B ổn định, ~1-2 sprint)**:

- **Playwright smoke test** 3-5 cases: guest login → lobby → create room → join → see other player → start match flow.
- Job riêng (`e2e:browser`), trigger: chỉ push main + nightly scheduled, không chạy matrix Node version (chỉ Node 22) vì browser E2E chậm.
- Reference setup: `@playwright/test`, browser install qua `npx playwright install --with-deps chromium`, web app chạy qua `pnpm --filter @arena/web start` với API URL trỏ vào localhost:3001 (API test instance).

**Giai đoạn 3 (pre-launch)**:

- **k6 load test** cho 100 concurrent WebSocket connections/room — quan trọng cho game real-time.
- Test scenario: 100 users join cùng room, simulate answer flow, đo p95/p99 latency, packet loss tolerance, reconnect storms.
- Script chạy scheduled (nightly) + pre-release gate.

**Lý do không làm Playwright ngay**:

1. Core value của game = state machine + WebSocket real-time, đã cover qua API E2E (real CSRF + Prisma + Redis).
2. WebSocket timing rất khó test ổn định qua browser (race conditions, flakey).
3. Frontend hiện chưa có logic phức tạp đủ để cần UI E2E.
4. Để CV đẹp (FAANG-style): "API E2E (Vitest + Fastify inject + real CSRF/Prisma/Redis)" thể hiện hiểu testing pyramid tốt hơn 5 Playwright smoke tests.
