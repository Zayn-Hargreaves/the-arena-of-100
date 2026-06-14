# Arena of 100 - Project Status and Usecases

> Cập nhật 2026-06-14 dựa trên code + GitNexus.
> Bản 2026-06-06 từng nói "Lobby lifecycle / heartbeat / graceful exit / admin kill-switch còn thiếu"; thực tế code đã hoàn thành baseline ở PR #38 + PR #47. Bản này reclassify lại trạng thái theo code thật.

## Trạng Thái Thật Của Dự Án

- Tổng quan: monorepo pnpm + Turborepo, NestJS Fastify + Socket.io backend, Next.js 15 + React 19 + Zustand frontend, Prisma + PostgreSQL + Redis.
- Nhánh/focus gần nhất: `feat/admin-kill-switch-end-to-end` (PR #47 review follow-up đã merge).
- Trạng thái baseline đã hoàn thành: core gameplay loop, lobby state machine, heartbeat/presence sweep, graceful exit + spectator baseline (eliminated), admin kill-switch, profile/rankings real APIs.
- Gap còn thật (xem phần `Critical UX Gaps` bên dưới): drop-in spectating, in-match AFK policy, content moderation pipeline, optimistic UI rollback, k6 load test.

### ✅ Đã Có Trong Code (verified 2026-06-14)

- Monorepo, package boundaries (`shared`, `game-core`, `api`, `web`)
- Prisma schema + Docker Compose
- `MatchStateMachine` với `serialize/deserialize` + Redis persistence (TTL 2h) + deterministic tie-break
- `GameLoopService`: countdown → round → result → finish với timer 15s
- `GameLoopService.maybeStartPublicCountdown` (public auto-start) + `forceStartRoomMatch` (private host force-start) + `launchRoomMatch` orchestrator
- `GameLoopService.onModuleInit` recover lobby countdowns từ Redis (re-arm hoặc auto-launch nếu đã expire)
- `RoomService`: create/join/leave, Redis cache, atomic `playerCount` counter (INCR + Lua-decrement-clamped), presence helpers, `getActiveRooms` cho sweep
- `MatchService`: create match, get/persist state machine, save round/answer, `finishMatch(matchId, null)` cho admin termination
- `AuthHandler`: JWT auth, kick old session, `syncReconnection` (snapshot replay)
- `RoomHandler`: create/join/leave qua socket + auto-trigger `maybeStartPublicCountdown` cho public room
- `MatchHandler`: start match (host-only, private-only), submit answer, request snapshot
- `QuestionModule`: CRUD + bulk + random + stats
- `UsersModule`: `/users/me/stats`, `/users/me/history` (cursor pagination, limit 20), `PATCH /users/me/avatar`
- `RankingsModule`: `/rankings/leaderboard?period=weekly|all` (Redis cache 60s, cache-aside, `@Public()`, 30 req/min throttle)
- `AdminService`: `syncQuestions`, `resetSystem` (rate-limited), `terminateRoom` (kill-switch end-to-end)
- `HealthController`: `/health` (public), `/health/monitoring` (admin)
- `CsrfGuard` + `apiFetch()` (double-submit cookie)
- `@nestjs/throttler` global 100/min + admin 5/min + 2/5min
- Zod validation + Zod response serialization (đã bỏ `class-validator` / `class-transformer`)
- `RoomError` + `ErrorCode` cho type-safe error handling
- `PresenceService.sweep` (5s interval) — auto-disband private room nếu host stale, batch remove non-host stale, `STALE`/`HOST_STALE` reasons
- Test footprint rộng: 587/587 unit + 11/11 E2E pass. API coverage 94.98% statements
  - `packages/game-core/src/{match-state-machine,scoring}.spec.ts`
  - `apps/api/src/modules/match/{game-loop.service.spec.ts, game-loop.service.persistence.spec.ts, match.module.spec.ts, match.service.spec.ts, presence.service.spec.ts}`
  - `apps/api/src/gateways/handlers/{auth,room,match,base}.handler.spec.ts`
  - `apps/api/src/modules/{auth,room,question,admin,health,prisma,users,rankings}/**/*.spec.ts`
  - `apps/api/src/common/{pipes,interceptors}/*.spec.ts`
  - `apps/api/src/modules/admin/dto/terminate-room.dto.spec.ts`
  - `apps/api/prisma/seeds/questions-validation.test.ts`
  - `apps/api/test/modules/{users,rankings}.e2e-spec.ts`
- Frontend pages: `/`, `/room/create`, `/lobby/[roomCode]`, `/game/[matchId]`, `/result/[matchId]`, `/profile`, `/rankings`, `/settings`, `/admin`, `not-found`
- Profile page real data: `useProfileStats` + `useMatchHistory` hooks
- Rankings page real data: `useLeaderboard` hook (weekly/all-time toggle, Redis-cached)
- `socket-store` với auto-reconnect, 15+ server event handlers (ROOM*\*, MATCH*\_, ROUND\_\_, ROOM_TERMINATED), `isEliminated` state cho spectator view
- `useLobbyLifecycle` hook + extracted lobby components (`LobbyHeader`, `RoomCodeCard`, `LobbyPlayerGrid`, `LeaveRoomModal`, `LobbyCountdownOverlay`, `LobbyStartControls`)
- `GamePage` UX: nút "Rời Trận Đấu" + `LeaveMatchModal`, auto-redirect `/result` 3s, ROOM_TERMINATED toast + redirect `/` 1.5s
- `AvatarFrame` reusable cho `LobbyPlayerGrid` + `GamePage` sidebar
- Lobby i18n migration (`next-intl` namespaces `lobby.*` cho cả 5 components + hook + page)
- Candy 3D Jelly UI Phase 1-4 + Phase 5A (mobile overlay, escape/backdrop, skip-link) + Phase 5B closeout (2026-06-14)
- Sidebar + AppShell + Sidebar mobile (gradient cũ đã bỏ ở `app-shell-layout.tsx:34` + `sidebar.tsx:230`; `styles/components.css` confirmed absent)

### 🟡 Một Số Phần Còn Dở (Mock / Hardcoded)

- `GamePage` sidebar còn danh sách player mock hardcode (lines 366-443: `Zero_Cool`, `Acid_Burn`, ...). Cần wire với `match.players` từ socket-store

### 🔴 Use Case Còn Thiếu (theo brief, chưa có implementation)

1. **Drop-in Spectating** — `RoomService.joinRoom` còn reject khi `room.status !== WAITING`. Late-joiners chưa được chuyển sang `PlayerStatus.SPECTATOR`; spectator transport riêng chưa có
2. **In-match AFK policy** — sweep mới chỉ áp dụng cho lobby (`PresenceService.sweep` gọi `removePlayerBatch` + `handleRoomPlayerLeft`). Trong match, round-miss chưa có detection
3. **Mass-spectator isolation infra** — chưa có SSE channel/namespace riêng cho spectator
4. **Host kick player** — `PlayerStatus.KICKED` đã có ở shared types nhưng backend hook (`kickPlayer`) chưa wire vào room handler/admin endpoint
5. **Frictionless Onboarding + Content Moderation** — nickname qua `authenticate()` chưa qua profanity filter; chưa có device fingerprint
6. **Anonymous Identity Tracking** — `guestId` đã quyết định (Model C) nhưng chưa code enforce ở backend
7. **Optimistic UI rollback** — `GamePage` có `selectedAnswer` + `roundCompleted` lock-in nhưng chưa có idempotency key + rollback path khi server reject
8. **Admin kill-switch message sanitizer** — `TerminateRoomDto.message` hiện fail-fast reject raw message. Cần shared profanity/content-moderation pipeline (plan.md §501)
9. **Post-match rematch + share** — `/result` có UI nhưng rematch/share chưa có
10. **Asset preloading + runtime fallback** — chưa có
11. **Sudden death mode** — tie-break deterministic đã có nhưng sudden death chưa có state machine branch
12. **Accessibility audit (WCAG)** — chưa có

## Usecases — Có Thật vs Còn Thiếu

Mỗi use case dưới đây gồm trạng thái (✅ Có / 🟡 Dở / ❌ Thiếu) và file/bằng chứng nhanh.

### Core Product Usecases

#### 1. Frictionless Onboarding

- ✅ Guest nickname flow: `apps/web/src/app/[locale]/page.tsx:83`
- ✅ LocalStorage persistence: `apps/web/src/app/[locale]/page.tsx:88`
- ✅ Procedural avatar fallback: `apps/web/src/components/ui/avatar.tsx`
- ❌ Profanity filter backend: chưa có
- ❌ Shadow ban: chưa có
- ❌ Device fingerprint (Model C quyết định xong nhưng chưa enforce): xem [activeContext.md](./memory-bank/activeContext.md)

#### 2. Lobby Lifecycle Management

- ✅ Tạo/join/leave room cơ bản: `apps/api/src/modules/room/room.service.ts`
- ✅ Auto-start countdown cho public: `GameLoopService.maybeStartPublicCountdown` + `RoomHandler.handleJoinRoom` (line 148-153)
- ✅ Host force-start cho private: `GameLoopService.forceStartRoomMatch` + `MatchHandler.handleStartMatch` (host-only)
- ✅ Heartbeat/presence validation: `game.gateway.ts:157-183` + `PresenceService.sweep` (5s interval) + `game-loop.service.ts:onModuleInit` recovery
- ✅ Lobby state machine: `WAITING -> COUNTDOWN -> STARTING -> IN_GAME` (backend + store wiring done)
- 🟡 Frontend heartbeat UI indicator: presence semantics có ở backend, store có `player.isOnline`, nhưng `LobbyPlayerGrid` chưa render visual dot
- ❌ Host kick player: `PlayerStatus.KICKED` có ở shared types, chưa có handler

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
- ✅ Deterministic tie-break: `MatchStateMachine.tieBreak` (response time → correct answers → alphabetical fallback)
- ❌ Difficulty progression: chưa có logic tăng độ khó theo round
- ❌ Graceful asset fallback: chưa có (chưa có asset preloading)
- ❌ Sudden death mode: chưa có

#### 5. Drop-in Spectating

- ❌ Reject khi `room.status !== WAITING` (`room.service.ts:103-105`): chưa chuyển sang spectator
- ❌ Auto-transition sang spectator mode: chưa có
- ❌ Mass-spectator isolation infra: chưa có (chưa có SSE channel/namespace riêng)

#### 6. Spectator Mode with Micro-interactions

- 🟡 Player → SPECTATOR transition có trong state machine constants (`PlayerStatus`) + `socket-store.isEliminated` + `GamePage` render "Chế độ khán giả" UI (lines 329-338). Chỉ phủ case bị loại trong match, **chưa** phủ drop-in
- ❌ Emote/reaction broadcast: chưa có
- ❌ Personal stats cho spectator: chưa có
- ❌ Scalable spectator infra: chưa có

#### 7. AFK Sweeping

- ✅ Lobby AFK sweeping: `PresenceService.sweep` 5s interval — auto-disband private room nếu host stale, batch remove non-host stale
- ❌ In-match AFK detection (2+ round miss): chưa có
- ❌ In-match auto convert to spectator: chưa có
- ❌ In-match AFK scheduler: chưa có (sweep hiện gọi `handleRoomPlayerLeft` chỉ chạy ở lobby status)

#### 8. Graceful Exit

- ✅ Backend `RoomService.leaveRoom`: `apps/api/src/modules/room/room.service.ts:148-189` + atomic decrement
- ✅ Socket `LEAVE_ROOM`: `apps/api/src/gateways/handlers/room.handler.ts:168-196`
- ✅ Client `leaveRoom` action + `LeaveRoomModal`: `apps/web/src/components/game/leave-match-modal.tsx` + `GamePage` button (line 455-462)
- ✅ Result page auto-redirect từ `GamePage`: 3s overlay khi `match.status === FINISHED`
- ✅ Admin kill-switch (force-terminate): `AdminService.terminateRoom` + `GamePage` toast + redirect `/` 1.5s
- ❌ Surrender trong match (in-match `surrender` action): chưa có handler riêng

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

- ✅ Deterministic tie-break: `MatchStateMachine.tieBreak` (response time → correct answers → alphabetical fallback), tests ở `match-state-machine.spec.ts:796-1051`
- ❌ Sudden death mode: chưa có state machine branch
- ❌ Tie-break UI surface riêng: chỉ thấy qua `MATCH_FINISHED.winnerId` + `tiedPlayerIds` payload, chưa có UI riêng

#### 12. Post-Match Experience

- ✅ Result page UI: `apps/web/src/app/[locale]/result/[matchId]/page.tsx`
- ✅ Player ranking trong payload: `MatchResultApiResponse.players`
- ❌ Rematch capability: chưa có
- ✅ Real leaderboard data: backend (RankingsModule, Redis cache 60s) + frontend `useLeaderboard` hook. Chi tiết: `memory-bank/issue.md` Bước 4

#### 13. Reconnection Support

- ✅ AuthHandler sync snapshot: `apps/api/src/gateways/handlers/auth.handler.ts:113`
- ✅ MatchService restore từ Redis: `apps/api/src/modules/match/match.service.ts:100`
- ✅ SNAPSHOT event + `requestSnapshot` action: có
- ❌ Missed event replay (sequence number diff): cần kiểm tra trong `getSnapshot(lastSeenSeqNo)`

#### 14. Accessibility & Web Standards

- 🟡 Focus indicators + ARIA labels ở sidebar: `apps/web/src/components/ui/sidebar.tsx`
- ✅ Mobile overlay Escape + backdrop close: `app-shell-layout.tsx` (Phase 7)
- ✅ Skip-link a11y: preserved through shell cleanup
- ❌ Screen reader support cho question: chưa có ARIA riêng
- ❌ Color-blind mode: chưa có
- ❌ Full keyboard navigation: chưa có toàn diện
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
- ✅ Force-kill single room: `AdminService.terminateRoom` + `POST /admin/rooms/:roomId/terminate` (PR #47 baseline)
- ✅ Monitoring metrics: `HealthController.monitoring`
- 🟡 Global broadcast message: chưa có (chỉ có `resetSystem` thông báo qua log; chưa có WebSocket broadcast)
- ❌ Question voiding mechanism: chưa có
- ❌ Emergency shutdown: chưa có
- ❌ Custom termination message: `TerminateRoomDto.message` deferred tới khi content-moderation pipeline ready

### Technical Usecases

#### 1. Event Sourcing

- ✅ MatchStateMachine có `eventLog` (`getEventLog()`)
- ✅ Match persistence vào Prisma (`EventLog`, `Answer`, `MatchRound` models)
- 🟡 Frontend không hiển thị event log (chỉ cần thiết kế admin)

#### 2. State Management

- ✅ Server-authoritative
- ✅ Clean separation (transport/application/domain/infrastructure)
- ✅ Player role transitions có sẵn (ACTIVE → ELIMINATED → SPECTATOR)
- ✅ Lobby state machine: `WAITING → COUNTDOWN → STARTING → IN_GAME → FINISHED` với Redis persistence + recovery
- ✅ Atomic `playerCount` (INCR + Lua-decrement-clamped)

#### 3. Scalable Architecture

- ✅ Modular monolith với boundaries rõ
- 🟡 Spectator channels: chưa có tách riêng
- 🟡 Mass-spectator isolation: chưa có

#### 4. Real-time Communication

- ✅ WebSocket cho players
- ✅ Channel-based event distribution (`getRoomChannel` helper)
- ✅ Event batching cho anti-repetition, persistence
- ❌ SSE cho mass spectators: chưa có

#### 5. Resource Management

- ✅ Connection cleanup (`AuthHandler.handleDisconnect`)
- ✅ Match state cleanup (`MatchService.finishMatch` xóa Redis key)
- ✅ Lobby countdown persistence + recovery (chống kẹt COUNTDOWN sau restart)
- ❌ Asset caching layer: chưa có

#### 6. Content Moderation

- ✅ Rate limiting cho name changes (qua `@nestjs/throttler` global)
- ❌ Profanity filter: chưa có
- ❌ Shadow ban: chưa có

#### 7. Error Handling & Resilience

- ✅ `RoomError` typed errors
- ✅ Runtime question fallback (try/catch + finish match)
- ✅ Admin kill-switch partial-failure response (`{ partial, cleanupError }`)
- 🟡 Health check + circuit breaker: `HealthController` có health check nhưng chưa circuit breaker

#### 8. International Standards Compliance

- ✅ i18n: `next-intl` đã wire (lobby surfaces migrated sang `lobby.*` namespace)
- ❌ WCAG audit: chưa có
- 🟡 Keyboard navigation: một phần (sidebar, nút bấm) nhưng chưa toàn diện

## Critical UX Gaps — Mức Ưu Tiên PR

| Priority      | Gap                                  | Use Case Brief | Why Now                                                                                                                                                |
| ------------- | ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅ 2026-06-14 | Design System Phase 5B closeout      | polish         | Done: shell gradient bỏ ở `app-shell-layout.tsx:34` + `sidebar.tsx:230`; `styles/components.css` audit xác nhận 0 references; visual closeout complete |
| P1            | Drop-in spectating + transport       | #5, #6         | Next PR sau Phase 5B; cần transport riêng cho mass-spectate                                                                                            |
| P2            | In-match AFK policy                  | #7             | Cần product decision (loại vs. spectator); sweep chỉ phủ lobby                                                                                         |
| P2            | Frictionless onboarding + moderation | #1             | Privacy/legal risk nếu public; share với kill-switch sanitizer pipeline                                                                                |
| P2            | Accessibility audit                  | #14            | Compliance                                                                                                                                             |
| P2            | Optimistic UI rollback đầy đủ        | #16            | Game feel, không block ship MVP                                                                                                                        |
| P2            | Content moderation + sanitizer       | #1, #17        | Unlock custom termination message; cần shared profanity pipeline                                                                                       |
| P3            | Host kick player                     | #2             | API đã có, hook chưa wire vào room handler / admin                                                                                                     |
| P3            | Post-match rematch + share           | #12            | Retention                                                                                                                                              |
| P3            | Sudden death + tie-break UI          | #11            | Game feel giai đoạn cuối                                                                                                                               |
| P3            | Asset preloading                     | #9             | Chỉ cần khi có media assets thật                                                                                                                       |
| P3            | Surrender in-match                   | #8             | Optional; cho phép player rời khi đang IN_GAME                                                                                                         |

## Strategic Recommendations

### ✅ Done 2026-06-14: Design System Phase 5B Closeout

Phase đã đóng theo ground truth từ code. Bằng chứng:

1. **Bước 5B.1**: shell-level gradient đã bỏ ở `app-shell-layout.tsx:34` (redundant với `body` gradient ở `globals.css:22`)
2. **Bước 5B.2**: mobile overlay gradient + `backdrop-blur-md` đã bỏ ở `sidebar.tsx:230`
3. **Bước 5B.3**: audit `styles/components.css` xác nhận 0 live references (file đã absent); `bg-gradient-to-br from-pink-50 via-blue-50 to-indigo-50` không còn trong code
4. **Verify**: vitest infrastructure setup cho web package; AppShellLayout 100% test coverage (10 tests); Sidebar 99.51% (18 tests)
5. **Out of scope** (deferred sang PR riêng): home page gradient ở `[locale]/page.tsx:193` vì home không dùng AppShellLayout

### PR Kế Tiếp (P1): Drop-in Spectating + Spectator Transport Baseline

Scope đề xuất:

1. **Backend**:
   - `RoomService.joinRoom` cho phép late-joiner vào `IN_GAME`/`FINISHED` với `PlayerStatus.SPECTATOR` (thêm payload `joinedAs: "PLAYER" | "SPECTATOR"`)
   - Match snapshot endpoint riêng cho spectator (read-only, không gửi answer)
   - Socket channel/namespace riêng: `spectator:<matchId>` (hoặc `socket.io` namespace `/spectate`)
2. **Frontend**:
   - "Xem trận đấu" CTA ở `/lobby/[roomCode]` khi room IN_GAME/FINISHED
   - `SpectatorView` page (read-only `GamePage` với banner "Chế độ khán giả")
3. **Tests**:
   - `RoomService.joinRoom` 4 paths: WAITING → join as player, IN_GAME → join as spectator, FINISHED → join as spectator, full room → reject
   - Presence semantics cho spectator (không sweep)
   - Snapshot endpoint filtering (no correctAnswer leak)

### PR Sau (P2): In-match AFK Policy

Scope đề xuất (sau khi có product decision):

1. **Backend**:
   - `GameLoopService` track `lastAnsweredRound` per player trong Redis (TTL = match lifetime)
   - Sau `endRound`: detect player không trong `survivingPlayerIds` của round hiện tại lẫn round trước → auto-`ELIMINATED` (loss-of-life) hoặc auto-`SPECTATOR` (chill)
   - Emit `PLAYER_AFK_ELIMINATED` event riêng
2. **Frontend**:
   - Toast khi player khác bị loại vì AFK
3. **Tests**:
   - 1-round miss, 2-round miss, full match played → all present, mid-match disconnect → AFK

### Polish (P2-P3)

- Content moderation pipeline (profanity filter, device fingerprint) — unlock admin kill-switch custom message
- Optimistic UI rollback (idempotency key + rollback path)
- Post-match rematch + share
- Accessibility audit (WCAG)
- k6 load test 100 concurrent WS (pre-launch gate)
- Playwright browser E2E (deferred tới khi Design System ổn định)

## Senior Mindset Trade-offs (ghi nhớ khi implement)

### Emotes vs. Live Chat

- Chọn emotes: dễ implement, không cần DB, UI gọn, không cần profanity filter
- Trade-off: ít expressive hơn chat nhưng maintainable hơn nhiều

### Auto-start vs. Host-start

- Auto-start cho public room (tránh hijacking)
- Host-start cho private room (giữ authority)
- Khi nào scale: heartbeat cần Redis presence thay vì in-memory (đã có ở baseline)

### Event Batching for Performance

- Micro-interactions batch + throttle để tránh overwhelm event loop
- Group spectator interactions khi broadcast (cần spectator channel riêng)

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

Dự án đã có nền tảng kỹ thuật vững (server-authoritative, event-sourced, clean architecture), core gameplay chạy thật, lobby/heartbeat/graceful-exit/admin kill-switch baseline done. Để trở thành "product engineer portfolio piece" thật sự, cần tập trung vào:

1. ✅ Hoàn thiện lobby lifecycle + graceful exit (production-ready) — done ở PR #38
2. ✅ Real data APIs cho profile/rankings (thay mock) — done (Bước 3-5 `issue.md`)
3. ✅ Admin kill-switch end-to-end — done ở PR #47 baseline (chỉ còn deferred message-sanitizer)
4. ✅ Design System Phase 5B closeout (visual consistency) — done 2026-06-14
5. ⏳ Drop-in spectating + spectator transport — proposed next PR
6. ⏳ In-match AFK policy — proposed P2
7. ⏳ Bổ sung content moderation (profanity filter, device fingerprint) — P2
8. ⏳ Accessibility audit (WCAG) — P2

Sau khi các mục trên xong, Arena of 100 sẽ chứng minh được: complete user journey, production-grade thinking, operational excellence, international standards compliance.
