# Active Context: Arena of 100

> Cập nhật 2026-06-06 dựa trên code + GitNexus.
> Một số mục dưới đây từng đánh dấu "chưa có" nay đã có code thật và được cập nhật lại.

## Current Focus

- Nhánh hiện tại: `migrate/ui/design-system`.
- Trọng tâm review: `apps/web/src/app/[locale]/admin/page.tsx` (admin/health monitoring UI) và phần liên quan.
- Trạng thái thật của code đã vượt xa những gì các file memory-bank cũ mô tả. Mục tiêu cập nhật tài liệu lần này:
  - Khẳng định các mốc đã xong.
  - Liệt kê các gap còn lại cần làm tiếp.
  - Bám sát branch hiện tại để chốt phạm vi trước khi mở PR feature mới.

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
- **E2E in CI (2026-06-06)** — thêm job `e2e` vào `.github/workflows/ci.yml`, chạy 11 vitest E2E tests trên mỗi PR + push main, matrix Node [20, 22], dùng `services: postgres/redis` (không cần Docker-in-Docker). Step-level `DATABASE_URL` override `postgresql://arena_test:arena_test@localhost:5432/arena_test` — gọi vitest trực tiếp thay vì qua script `test:e2e` vì `cross-env` trong script sẽ ghi đè env CI. Push schema + seed:dev + seed:demo trước khi run. Estimated +60–90s/pipeline.

## Architecture Assessment Summary

### 🔴 Critical Issues — All Resolved

1. ~~GameGateway God Object~~ [RESOLVED] — Refactored thành `AuthHandler`/`RoomHandler`/`MatchHandler`.
2. ~~In-Memory State Machines~~ [RESOLVED] — `MatchService.persistStateMachine` + restore qua `getStateMachine`.
3. ~~Missing QuestionModule~~ [RESOLVED] — Full REST + admin sync + seed.

### 🟡 Significant Gaps (cập nhật 2026-06-06)

1. ~~Missing Test Coverage~~ — Bây giờ có spec cho game-core, game-loop (kể cả persistence), auth, room, question, admin, handlers, common pipes/interceptors.
2. ~~No Round Timer Management~~ [RESOLVED] — `GameLoopService` đã enforce 15s timeout.
3. **Gateway ↔ Service Coupling** — gateway vẫn gọi service trực tiếp; use-case layer chưa tách hẳn. Đã chấp nhận cho MVP.
4. ~~Frontend Only Has Landing Page~~ [RESOLVED] — Có lobby/game/result/profile/rankings/settings/admin/room-create.
5. **No Lobby Lifecycle Management** — Chưa có auto-start, host controls, heartbeat. Đây là gap lớn nhất còn lại.

### 🟢 Architecture Score (cập nhật 2026-06-06)

- Monorepo: 10/10, Package Boundaries: 9/10, Domain Logic: 9/10
- Backend: 7/10, Frontend: 7/10, Infra: 7/10, Testing: 7/10
- **Overall: ~8.0/10**

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
12. Testing: Vitest với `*.spec.ts`
13. Zod migration: `ZodValidationPipe` + `ZodSerialize`
14. Distributed session: Redis in-memory + high-perf O(1) `client.data.userId` lookups
15. Persistent guest identity: `guestId` (Model C)
16. Candy 3D Jelly UI theme (light gradient, thick ink borders, glossy reflections, jelly wobble)
17. Procedural avatar fallback + MelbitSprite
18. **Type-safe error handling** với `RoomError`
19. CSRF double-submit cookie pattern
20. Rate limiting: `@nestjs/throttler` global + admin-specific

## Pending Decisions

- [x] Gateway refactor strategy → Command Pattern via handler classes
- [x] Test framework → Vitest
- [x] Frontend routing structure → `/lobby/[code]`, `/game/[matchId]`
- [x] Guest login hijacking fix → Model C device-based `guestId`
- [ ] **Timer strategy for lobby auto-start**: `setTimeout` in-process vs. Redis-based distributed timers (chưa chốt vì chưa có nhu cầu scale)
- [ ] **Spectator transport**: WebSocket chung hay SSE riêng? (chưa có yêu cầu mass spectator)

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

### Next PR: Lobby Lifecycle + Graceful Exit Baseline

1. Backend: room state machine `WAITING → COUNTDOWN → STARTING → IN_GAME`
2. Auto-start countdown cho public room; host "force start" cho private room
3. Heartbeat/presence validation + AFK sweeping scheduler
4. Frontend: countdown overlay, leave flow + confirm modal, "waiting for players" UI
5. Tests: room lifecycle, heartbeat, leave flow

### Following PR: Real Player Stats + Leaderboard

1. Backend: `GET /users/me/stats`, `GET /users/:id/history`, `GET /rankings/leaderboard`
2. Frontend: useProfileStats, useMatchHistory, useLeaderboard
3. Tests: API endpoints + page integration

### Polish (Phase 2)

1. Design System Phase 5 (shell templates, legacy CSS cleanup, visual audit)
2. Tie-break + sudden death
3. Spectator mode + drop-in spectating
4. Optimistic UI rollback
5. E2E tests với Playwright
6. Accessibility audit

## Key Files Reference (verified 2026-06-06)

```
packages/shared/src/
├── events.ts        # Event types and factory
├── state.ts         # State interfaces
├── socket.ts        # Socket protocol
├── errors.ts        # RoomError + ErrorCode
└── index.ts         # Constants and utilities

packages/game-core/src/
├── match-state-machine.ts        # Core state machine + serialize/deserialize
└── match-state-machine.spec.ts   # Vitest spec (round-trip, immutability)

apps/api/src/
├── main.ts
├── app.module.ts                 # CsrfGuard + ThrottlerGuard global
├── common/
│   ├── pipes/zod-validation.pipe.ts
│   └── interceptors/zod-serializer.interceptor.ts
├── modules/
│   ├── auth/                     # Guest login, JWT, CSRF
│   ├── room/                     # create/join/leave/list
│   ├── match/
│   │   ├── match.service.ts      # persistence, state machine wrapper
│   │   ├── game-loop.service.ts  # countdown → round → result
│   │   └── game-loop.service.{spec,persistence.spec}.ts
│   ├── question/                 # CRUD + bulk + random + stats
│   ├── admin/                    # syncQuestions + resetSystem
│   ├── health/                   # /health + /health/monitoring
│   └── prisma/                   # PrismaService
└── gateways/
    ├── game.gateway.ts
    └── handlers/{base,auth,room,match}.handler.ts

apps/web/src/
├── app/[locale]/
│   ├── page.tsx                       # Home + guest nickname/avatar
│   ├── room/create/page.tsx
│   ├── lobby/[roomCode]/page.tsx
│   ├── game/[matchId]/page.tsx
│   ├── result/[matchId]/page.tsx
│   ├── profile/page.tsx               # useProfileStats + useMatchHistory
│   ├── rankings/page.tsx              # useLeaderboard
│   ├── settings/page.tsx
│   ├── admin/page.tsx                 # monitoring + sync + reset
│   ├── layout.tsx
│   └── not-found.tsx
├── stores/socket-store.ts             # auto-reconnect, 7+ handlers
├── lib/api.ts                         # CSRF-aware apiFetch
├── components/
│   ├── ui/{button,glass-panel,avatar,...}.tsx
│   ├── ui/sidebar.tsx                 # desktop + mobile
│   └── game/{answer-tile,timer,player-grid}.tsx
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
- Micro-interactions: event batching for performance
- Graceful exit > AFK detection
- Asset preloading for fairness
- Mass-spectator isolation
- Content moderation
- Accessibility (WCAG)
- Device fingerprinting
- Optimistic UI: lock + rollback
- Admin tools: secure access

## Current Blockers (updated 2026-06-06)

Đã gỡ hết blocker kỹ thuật. Các gap product còn lại:

- Lobby lifecycle + heartbeat (gap lớn nhất)
- Design System Phase 5 cleanup
- Spectator mode + drop-in spectating
- AFK sweeping
- Graceful exit UX
- Content moderation + device fingerprint
- Optimistic UI rollback đầy đủ
- Game operations kill switch

## Testing Roadmap

**Hiện tại (đã làm 2026-06-06)**: 418 unit tests + 11 API E2E tests (users + rankings) tích hợp vào CI trên mọi PR + push main. Job `e2e` dùng real NestJS + Fastify + Prisma + Redis, real CSRF flow, real JWT auth.

**Giai đoạn 2 (sau khi lobby/UI ổn định, ~1-2 sprint)**:

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
