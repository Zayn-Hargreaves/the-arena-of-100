# Arena of 100 - Project Status and Usecases

> Cập nhật 2026-06-06 dựa trên code + GitNexus.
> File này từng nói dự án "Base Scaffold Complete"; thực tế code đã vượt qua giai đoạn đó. Mục đích của bản cập nhật này là tách rõ:
>
> 1. Những use case đã có trong code.
> 2. Những use case thực sự còn thiếu.
> 3. Đề xuất thứ tự ưu tiên cho các PR kế tiếp.

## Trạng Thái Thật Của Dự Án

- Tổng quan: monorepo pnpm + Turborepo, NestJS Fastify + Socket.io backend, Next.js 15 + React 19 + Zustand frontend, Prisma + PostgreSQL + Redis.
- Tài liệu cũ trong `memory-bank/progress.md`, `activeContext.md` và bản gốc file này bị lệch so với code, nay đã được đồng bộ ở PR này.
- Nhánh/focus hiện tại: `migrate/ui/design-system` (admin/health monitoring UI polish).

### ✅ Đã Có Trong Code (verified 2026-06-06)

- Monorepo, package boundaries (`shared`, `game-core`, `api`, `web`)
- Prisma schema + Docker Compose
- `MatchStateMachine` với `serialize/deserialize` + Redis persistence (TTL 2h)
- `GameLoopService`: countdown → round → result → finish với timer 15s
- `RoomService`: create/join/leave, Redis cache, atomic-ish player count
- `MatchService`: create match, get/persist state machine, save round/answer
- `AuthHandler`: JWT auth, kick old session, `syncReconnection` (snapshot replay)
- `RoomHandler`: create/join/leave qua socket
- `MatchHandler`: start match, submit answer, request snapshot
- `QuestionModule`: CRUD + bulk + random + stats
- `AdminService`: `syncQuestions`, `resetSystem` (rate-limited)
- `HealthController`: `/health` (public), `/health/monitoring` (admin)
- `CsrfGuard` + `apiFetch()` (double-submit cookie)
- `@nestjs/throttler` global 100/min + admin 5/min + 2/5min
- Zod validation + Zod response serialization (đã bỏ `class-validator` / `class-transformer`)
- `RoomError` + `ErrorCode` cho type-safe error handling
- Test footprint rộng: `*.spec.ts` cho game-core, game-loop, handlers, services, common, prisma seeds
- Frontend pages: `/`, `/room/create`, `/lobby/[roomCode]`, `/game/[matchId]`, `/result/[matchId]`, `/profile`, `/rankings`, `/settings`, `/admin`
- Profile page real data: `useProfileStats` + `useMatchHistory` hooks (calls `GET /users/me/stats` + `GET /users/me/history`)
- Rankings page real data: `useLeaderboard` hook (calls `GET /rankings/leaderboard`, weekly/all-time toggle, Redis-cached)
- `socket-store` với auto-reconnect, 7+ server event handlers, leave/start/submit actions
- Candy 3D Jelly UI Phase 1-4 (foundation, atoms, avatars+sprites, game molecules)
- Sidebar + AppShell + Sidebar mobile (gradient cũ còn ở shell — xem Design System Phase 5)

### 🟡 Một Số Phần Còn Dở (Mock / Hardcoded)

- `/lobby/[roomCode]` có fallback mock players chỉ trong dev (`lobby/[roomCode]/page.tsx:91`)
- `AppShellLayout` và mobile overlay còn dùng gradient cũ — Design System Phase 5 chưa đóng

### 🔴 Use Case Còn Thiếu (theo brief, chưa có implementation)

1. **Lobby Lifecycle Management**: auto-start, host controls, heartbeat (chưa có scheduler/state machine cho room).
2. **Spectator Mode + Micro-interactions**: chưa có socket channel riêng, chưa có emote events.
3. **Drop-in Spectating**: late joiners vào phòng đang `IN_GAME` đang bị reject.
4. **AFK Sweeping**: chưa có detection logic.
5. **Frictionless Onboarding + Content Moderation**: nickname qua `authenticate()` chưa qua profanity filter; chưa có device fingerprint.
6. **Anonymous Identity Tracking**: `guestId` đã quyết định (Model C) nhưng chưa code enforce.
7. **Optimistic UI**: lock-in có, rollback flow chưa đầy đủ ở `game/[matchId]/page.tsx`.
8. **Game Operations / Kill Switch**: `system/reset` đã có nhưng chưa có `force-kill room`, `void question`, `global broadcast`.
9. **Post-match rematch + stats**: `/result` có UI nhưng rematch/share chưa có.
10. **Asset preloading + runtime fallback**: chưa có.
11. **Tie-break / Sudden Death**: chưa có.
12. **Accessibility audit**: chưa có.
13. **Mass-spectator isolation infra**: chưa có SSE channel riêng.

## Usecases — Có Thật vs Còn Thiếu

Mỗi use case dưới đây gồm trạng thái (✅ Có / 🟡 Dở / ❌ Thiếu) và file/bằng chứng nhanh.

### Core Product Usecases

#### 1. Frictionless Onboarding

- ✅ Guest nickname flow: `apps/web/src/app/[locale]/page.tsx:83`
- ✅ LocalStorage persistence: `apps/web/src/app/[locale]/page.tsx:88`
- ✅ Procedural avatar fallback: `apps/web/src/components/ui/avatar.tsx`
- ❌ Profanity filter backend: chưa có
- ❌ Shadow ban: chưa có
- ❌ Device fingerprint (Model C quyết định xong nhưng chưa enforce): xem `memory-bank/activeContext.md:71`

#### 2. Lobby Lifecycle Management

- ✅ Tạo/join/leaveroom cơ bản: `apps/api/src/modules/room/room.service.ts`
- ❌ Auto-start countdown: chưa có
- ❌ Host controls (force-start, kick): chưa có
- ❌ Heartbeat/ready check: chưa có
- ❌ Lobby state machine: chưa có

#### 3. Room Management & Social Discovery

- ✅ Create/join by code: `apps/api/src/modules/room/room.controller.ts`
- ✅ List public rooms: `RoomService.listPublicRooms`
- 🟡 UI tạo phòng cơ bản: `/room/create/page.tsx`; còn thiếu "Quick Match" UI tận dụng list

#### 4. Battle Royale Quiz Gameplay

- ✅ 100 players compete: `GAME_CONFIG.MAX_PLAYERS`
- ✅ 15s rounds: `GAME_CONFIG.ROUND_DURATION_MS`
- ✅ Server-authoritative timing: `apps/api/src/modules/match/game-loop.service.ts:32`
- ✅ Anti-repetition question: `usedQuestionIds` Map
- ✅ Runtime question fallback: `GameLoopService.executeRound` đã có try/catch + `finishMatchLoop`
- ❌ Difficulty progression: chưa có logic tăng độ khó theo round
- ❌ Graceful asset fallback: chưa có (chưa có asset preloading)

#### 5. Drop-in Spectating

- ❌ Reject khi `room.status !== WAITING` (`room.service.ts:87`)
- ❌ Auto-transition sang spectator mode: chưa có
- ❌ Mass-spectator isolation infra: chưa có

#### 6. Spectator Mode with Micro-interactions

- 🟡 Player → SPECTATOR transition có trong state machine constants (`PlayerStatus`) nhưng chưa có event emit/logic
- ❌ Emote/reaction broadcast: chưa có
- ❌ Personal stats cho spectator: chưa có
- ❌ Scalable spectator infra: chưa có

#### 7. AFK Sweeping

- ❌ Detection (2+ round miss): chưa có
- ❌ Auto convert to spectator: chưa có
- ❌ Scheduler: chưa có

#### 8. Graceful Exit

- ✅ Backend `RoomService.leaveRoom`: `apps/api/src/modules/room/room.service.ts:122`
- ✅ Socket `LEAVE_ROOM`: `apps/api/src/gateways/handlers/room.handler.ts:84`
- 🟡 Client `leaveRoom` action: có nhưng chưa có UI confirm modal + redirect flow
- ❌ Surrender trong match (khi đã `IN_GAME`): chưa có

#### 9. Rich Asset Preloading

- ❌ Background asset fetching: chưa có
- ❌ Media caching: chưa có
- ❌ Mobile-optimized loading: chưa có

#### 10. Content Management & Delivery

- ✅ Curated question pool + seed: `apps/api/prisma/seeds/`
- ✅ Difficulty categorization: `Question.difficulty` enum
- ✅ Anti-repetition: `usedQuestionIds` trong `GameLoopService`
- ✅ Admin sync: `AdminService.syncQuestions`
- ❌ Shuffle mechanism UI: chưa có
- ❌ Difficulty progression: chưa có

#### 11. Tie-break & Sudden Death

- 🟡 Tie-break trong `MatchStateMachine.sorted` (response-time) đã có nhưng chưa expose
- ❌ Sudden death mode: chưa có
- ❌ UI cho tie-break: chưa có

#### 12. Post-Match Experience

- ✅ Result page UI: `apps/web/src/app/[locale]/result/[matchId]/page.tsx`
- ✅ Player ranking trong payload: `MatchResultApiResponse.players`
- ❌ Rematch capability: chưa có
- ✅ Real leaderboard data: có — backend (RankingsModule, RankingsService, RankingsController/DTOs, Redis cache 60s, 418/418 tests) + frontend `useLeaderboard` hook. Chi tiết: `memory-bank/issue.md` Bước 4.

#### 13. Reconnection Support

- ✅ AuthHandler sync snapshot: `apps/api/src/gateways/handlers/auth.handler.ts:113`
- ✅ MatchService restore từ Redis: `apps/api/src/modules/match/match.service.ts:100`
- ✅ SNAPSHOT event + `requestSnapshot` action: có
- ❌ Missed event replay (sequence number diff): cần kiểm tra trong `getSnapshot(lastSeenSeqNo)`

#### 14. Accessibility & Web Standards

- 🟡 Focus indicators + ARIA labels ở sidebar: `apps/web/src/components/ui/sidebar.tsx`
- ❌ Screen reader support cho question: chưa có ARIA
- ❌ Color-blind mode: chưa có
- ❌ Full keyboard navigation: chưa có
- ❌ WCAG audit: chưa có

#### 15. Anonymous Identity Tracking

- 🟡 Model C (`guestId` trong localStorage) đã quyết định nhưng chưa enforce ở `auth.service.ts`
- ❌ Device fingerprint (Canvas/WebGL/UA): chưa có
- ❌ IP correlation: chưa có
- ❌ Backend device-level ban: chưa có

#### 16. Optimistic UI & Answer Lock-in

- 🟡 UI lock-in có ở `game/[matchId]/page.tsx` (set `selectedAnswer`, `roundCompleted`)
- ❌ Smart recovery (idempotency key, exponential backoff): chưa có
- ❌ Rollback flow rõ ràng khi server reject: chưa có

#### 17. Game Operations & Kill Switch

- ✅ Admin dashboard: `apps/web/src/app/[locale]/admin/page.tsx`
- ✅ Reset system: `AdminService.resetSystem`
- ✅ Monitoring metrics: `HealthController.monitoring`
- ❌ Force-kill single room: chưa có
- ❌ Global broadcast message: chưa có
- ❌ Question voiding mechanism: chưa có
- ❌ Emergency shutdown: chưa có

### Technical Usecases

#### 1. Event Sourcing

- ✅ MatchStateMachine có `eventLog` (`getEventLog()`)
- ✅ Match persistence vào Prisma (`EventLog`, `Answer`, `MatchRound` models)
- 🟡 Frontend không hiển thị event log (chỉ cần thiết kế admin)

#### 2. State Management

- ✅ Server-authoritative
- ✅ Clean separation (transport/application/domain/infrastructure)
- ✅ Player role transitions có sẵn (ACTIVE → ELIMINATED → SPECTATOR)

#### 3. Scalable Architecture

- ✅ Modular monolith với boundaries rõ
- 🟡 Spectator channels: chưa có tách riêng
- 🟡 Mass-spectator isolation: chưa có

#### 4. Real-time Communication

- ✅ WebSocket cho players
- ✅ Channel-based event distribution
- ✅ Event batching cho anti-repetition, persistence
- ❌ SSE cho mass spectators: chưa có

#### 5. Resource Management

- ✅ Connection cleanup (`AuthHandler.handleDisconnect`)
- ✅ Match state cleanup (`MatchService.finishMatch` xóa Redis key)
- ❌ Asset caching layer: chưa có

#### 6. Content Moderation

- ✅ Rate limiting cho name changes (qua `@nestjs/throttler` global)
- ❌ Profanity filter: chưa có
- ❌ Shadow ban: chưa có

#### 7. Error Handling & Resilience

- ✅ `RoomError` typed errors
- ✅ Runtime question fallback (try/catch + finish match)
- 🟡 Health check + circuit breaker: `HealthController` có health check nhưng chưa circuit breaker

#### 8. International Standards Compliance

- ✅ i18n: `next-intl` đã wire
- ❌ WCAG audit: chưa có
- 🟡 Keyboard navigation: một phần (sidebar, nút bấm) nhưng chưa toàn diện

## Critical UX Gaps — Mức Ưu Tiên PR

Mình đánh lại ưu tiên dựa trên mức impact và rủi ro:

| Priority | Gap                                  | Use Case Brief | Why Now                                                                        |
| -------- | ------------------------------------ | -------------- | ------------------------------------------------------------------------------ |
| P0       | Lobby lifecycle + heartbeat          | #2             | Core loop xong nhưng chưa có cách quản lý "ready" → "start"                    |
| P0       | Graceful exit UX                     | #8             | Backend sẵn sàng, chỉ thiếu UI + surrender in-match                            |
| P1       | Real player stats + leaderboard      | #12            | Đã xong backend + frontend (Bước 3-5 issue.md); cần seed data để test hiển thị |
| P1       | Design System Phase 5                | polish         | Branch hiện tại đang mở; đóng để chốt theme                                    |
| P1       | Tie-break / Sudden death             | #11            | Game feel quan trọng cho giai đoạn cuối                                        |
| P2       | Spectator mode + drop-in             | #5, #6         | Sau khi core flow productized                                                  |
| P2       | AFK sweeping                         | #7             | Sau khi có heartbeat                                                           |
| P2       | Optimistic UI rollback đầy đủ        | #16            | Game feel, không block ship MVP                                                |
| P2       | Frictionless onboarding + moderation | #1             | Privacy/legal risk nếu public                                                  |
| P2       | Accessibility audit                  | #14            | Compliance                                                                     |
| P3       | Game operations kill switch          | #17            | Operational excellence                                                         |
| P3       | Post-match rematch + share           | #12            | Retention                                                                      |
| P3       | Asset preloading                     | #9             | Chỉ cần khi có media assets thật                                               |

## Strategic Recommendations

### PR Kế Tiếp (P0): Lobby Lifecycle + Graceful Exit Baseline

Scope đề xuất:

1. **Backend**:
   - `RoomLifecycleService` với state machine `WAITING → COUNTDOWN → STARTING → IN_GAME`
   - Auto-start cho public room khi đủ `minPlayers` (ví dụ 2 cho MVP, 100 cho prod)
   - Host controls cho private room: `forceStart`, `kickPlayer`
   - Heartbeat/presence scheduler (chạy mỗi 5s, sweep sau 2 round miss)
   - Socket events mới: `LOBBY_COUNTDOWN_START`, `LOBBY_COUNTDOWN_TICK`, `HEARTBEAT_PING/PONG`, `PLAYER_KICKED`
2. **Frontend**:
   - Lobby UI: countdown overlay, "waiting for X more players", "host can force start"
   - Leave flow: confirm modal + redirect về `/`
   - Heartbeat client: gửi `PING` mỗi N giây
3. **Tests**:
   - Unit: `RoomLifecycleService` (state transitions, auto-start, host force, sweep)
   - Integration: socket events emit đúng, REST `/rooms/:id` mới
   - Spec cho heartbeat sweeper

### PR Sau (P1): Real Player Stats + Leaderboard ~~(ĐÃ HOÀN THÀNH)~~

Scope đề xuất ~~đã thực hiện~~ (xem `memory-bank/issue.md` Bước 3-5):

1. **Backend**:
   - ~~`GET /users/me/stats`~~ ✅ `apps/api/src/modules/users/` — 16 tests
   - ~~`GET /users/:id/history`~~ ✅ cursor pagination, limit 20
   - ~~`GET /rankings/leaderboard?period=weekly|alltime`~~ ✅ `apps/api/src/modules/rankings/` — Redis cache 60s, 15 tests
   - ~~`UserStatsService`~~ ✅ `UsersService` + `RankingsService` aggregate từ `Match`, `MatchPlayer`, `Answer`
2. **Frontend**:
   - ~~Thay mock ở `/profile/page.tsx`~~ ✅ `useProfileStats` + `useMatchHistory` hooks
   - ~~Thay mock ở `/rankings/page.tsx`~~ ✅ `useLeaderboard` hook
3. ~~Tests~~ ✅ 418/418 pass

### PR Polish (P1): Design System Phase 5

Scope đề xuất:

1. `AppShellLayout` + `GameShell`: bỏ gradient cũ, dùng `.jelly-card`
2. Safe-delete `styles/components.css` nếu còn class cyberpunk
3. Visual audit toàn flow: `pnpm dev` + duyệt `/`, `/room/create`, `/lobby`, `/game`, `/result`, `/rankings`, `/profile`, `/admin`, `/not-found`
4. Screenshot diff để bảo đảm consistency

### Secondary (P2+)

- Spectator mode + drop-in
- AFK sweeping (tận dụng heartbeat vừa có)
- Optimistic UI rollback
- Frictionless onboarding + content moderation
- Accessibility audit
- Game operations kill switch

## Senior Mindset Trade-offs (ghi nhớ khi implement)

### Emotes vs. Live Chat

- Chọn emotes: dễ implement, không cần DB, UI gọn, không cần profanity filter
- Trade-off: ít expressive hơn chat nhưng maintainable hơn nhiều

### Auto-start vs. Host-start

- Auto-start cho public room (tránh hijacking)
- Host-start cho private room (giữ authority)
- Khi nào scale: heartbeat cần Redis presence thay vì in-memory

### Event Batching for Performance

- Micro-interactions batch + throttle để tránh overwhelm event loop
- Group spectator interactions khi broadcast

### Frictionless Onboarding vs. Moderation

- Guest nickname + content moderation backend
- Shadow ban cho repeat offenders
- Rate limit name changes
- Device fingerprint (Model C) để chống ban evasion

### Player vs. Spectator Communication Infra

- WebSocket cho player (bidirectional, low-latency)
- SSE hoặc WebSocket riêng cho spectator (scale)
- Batch 1s/lần cho spectator

### Optimistic UI Trade-offs

- Lock UI ngay khi user action
- Idempotency key cho retry
- Rollback gracefully khi server reject

## Portfolio Value Enhancement

Dự án đã có nền tảng kỹ thuật vững (server-authoritative, event-sourcing, clean architecture) và core gameplay chạy thật. Để trở thành "product engineer portfolio piece" thật sự, cần tập trung vào:

1. Hoàn thiện lobby lifecycle + graceful exit (production-ready)
2. ~~Real data APIs cho profile/rankings (thay mock)~~ ✅ Đã xong (Bước 3-5 issue.md)
3. Đóng Design System Phase 5 (visual consistency)
4. Bổ sung operational tooling (admin kill-switch, monitoring alerts)
5. Bổ sung content moderation (profanity filter, device fingerprint)
6. Accessibility audit (WCAG)

Sau khi các mục trên xong, Arena of 100 sẽ chứng minh được: complete user journey, production-grade thinking, operational excellence, international standards compliance.
