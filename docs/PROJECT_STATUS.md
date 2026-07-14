# Arena of 100 - Project Status and Usecases

> Cập nhật 2026-07-13: dọn root docs (chuyển vào `docs/` + `docs/plans/`); Track D replay delta đã DONE trong branch `feat/replay-lastseen-delta`. L2 (gateway await handleDisconnect + dedup import) đã merge main từ trước; L3 (schema tightening) chia hai phần — `CLIENT_TIMESTAMP_MAX_OFFSET_MS = 5 * 60 * 1000` đã merge main, còn `lastSeenSeqNo.max(MAX_ROUNDS * MAX_PLAYERS * 2)` mới là branch-only (Track D).
> Cập nhật 2026-06-18 dựa trên code + GitNexus + test run thực tế.
> Bản 2026-06-14 từng nói "Lobby lifecycle / heartbeat / graceful exit / admin kill-switch còn thiếu"; thực tế code đã hoàn thành baseline ở PR #38 + PR #47. Ngày 2026-06-14 cũng đóng PR Drop-in Spectating Baseline (`feat/drop-in-spectating-baseline`): thêm `JoinMode = "PLAYER" | "SPECTATOR"` payload + `RoomJoinedPayload.joinedAs` + backend join policy 4-way matrix + server-side submit gate + frontend spectator UI. Cùng ngày cũng close PR `fix/match-race-frontend-correctness`: 3 race bug backend (B1-B3) + 8 correctness bug frontend (F1-F8) — bao gồm sửa sidebar mock (F1), bỏ magic number redirect (F2), tách timer ref (F3), dynamic maxPlayers (F4), loading state (F5), bỏ `currentRoundNo || 1` (F6), round-end signal rõ (F7), auto-join guard (F8). Sau merge, post-merge audit phát hiện thêm 7 follow-up bug (B4-B7, L1-L3); 5 trong 7 (B4-B7, L1) đã land trong cùng ngày qua chuỗi commit `fix(bug): fix comment`; 2 còn pending (L2 + L3) **tại thời điểm 2026-06-14**. Bản 2026-07-13 reclassify: L2 (gateway await) đã merge main từ sau 2026-06-14; L3 schema tightening chia hai phần (xem header trên).

## Trạng Thái Thật Của Dự Án

- Tổng quan: monorepo pnpm + Turborepo, NestJS Fastify + Socket.io backend, Next.js 15 + React 19 + Zustand frontend, Prisma + PostgreSQL + Redis.
- Nhánh/focus gần nhất: `main` (PR `fix/match-race-frontend-correctness` đã merge 2026-06-14). Bản `feat/replay-lastseen-delta` (HEAD, 2026-07-13) mang 3 commit Track D (`1dae730` contract, `113a658` impl, `a222340` wiring). Test counts `[re-verify]` sau khi re-index gitnexus: prior anchor 2026-06-18 = 772/772 unit api + 70/70 game-core + 31/31 web + 11/11 E2E (sau rebuild `packages/shared/dist`).
- Trạng thái baseline đã hoàn thành: core gameplay loop, lobby state machine, heartbeat/presence sweep, graceful exit + spectator baseline (eliminated + drop-in), admin kill-switch, profile/rankings real APIs, Design System Phase 5B, **match race fixes (B1-B3) + frontend correctness (F1-F8)**, **post-merge idempotency/recovery hardening (B4-B7) + tie-break determinism (L1)**.
- Gap còn thật (xem phần `Critical UX Gaps` bên dưới): mass-spectator transport scaling, optimistic UI rollback, home page gradient cleanup, profanity filter (content moderation). (Track D replay delta + L3 seqNo cap đã DONE trong branch `feat/replay-lastseen-delta`; Track C in-match AFK policy đã merge main; Plan A k6 load test đã merge main qua PR #71.)

### ✅ Đã Có Trong Code (verified 2026-06-18)

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
- Test footprint rộng (anchor 2026-06-18, [re-verify] sau re-index): **772/772 unit api + 70/70 unit game-core + 31/31 unit web + 11/11 E2E pass**. Branch `feat/replay-lastseen-delta` thêm replay-delta tests (`packages/game-core/src/match-state-machine.spec.ts`, `apps/api/src/gateways/handlers/match.handler.spec.ts`, `apps/web/src/stores/socket-store.updaters.spec.ts`) — chưa cộng dồn vào anchor này. API coverage ~99% statements (`game-loop.service.ts` 100%, `admin.service.ts` 100%, `match.service.ts` 96.22%, `match-state-machine.ts` 100%)
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
- **Drop-in spectating baseline (PR `feat/drop-in-spectating-baseline`, 2026-06-14)** — `JoinMode = "PLAYER" | "SPECTATOR"` payload (`RoomJoinedPayload.joinedAs`), `RoomService.joinRoom` 4-way matrix, `MatchHandler.handleSubmitAnswer` server gate, `MatchHandler.handleRequestSnapshot` allow-list với no-correctAnswer regression test, frontend spectator UI trên lobby + game page. Reuse `room:[id]` channel. Coverage per-file ≥90% cho tất cả file sửa. 661/661 unit tests pass.
- **Match Race + Frontend Correctness Hardening (PR `fix/match-race-frontend-correctness`, 2026-06-14)** — 11 bug trong 1 PR: 3 race backend (B1-B3) + 8 frontend correctness (F1-F8). Backend: `GameLoopService.finishingMatches` Set (B1); `MatchStateMachine.tieBreak/determineWinner` return `string | null` (B2); `launchRoomMatch` dùng `prisma.$transaction` + `SELECT ... FOR UPDATE` (B3). Frontend: `game page` sidebar render `match.players` thật thay vì 5 mock cứng (F1); bỏ magic number `newCount <= 12` redirect (F2); tách 2 timer ref `roundResultRevealRef`/`roundResultContinueRef` (F3); `maxPlayers` động qua `GAME_CONFIG.MAX_PLAYERS` (F4); loading skeleton thay fallback question (F5); bỏ `currentRoundNo || 1` (F6); round-end signal dùng `match.roundEndTime === null && match.status === "ROUND_RESULT"` (F7); `use-lobby-lifecycle.ts` `joinInFlightRef` chống double-emit (F8). 712→772 unit tests (51 net mới + post-merge hardening), 70 game-core, 31 web, 11 E2E pass. Coverage per-file ≥90% (`game-loop.service.ts` 100%, `admin.service.ts` 100%, `match.service.ts` 96.22%, `match-state-machine.ts` 100%).
- **Post-merge Idempotency + Recovery Hardening (chain commit `fix(bug): fix comment` 2026-06-14)** — 5 follow-up bug từ post-merge audit: B4 (`finishMatch` `updateMany` với `status: { not: FINISHED }` cho DB-layer idempotency), B5 (`saveRoundAndAnswers` pre-check + P2002 catch), B6 (`rehydrateCorrectAnswer` try/catch graceful degradation), B7 (`buildScoreUpdateOps` warn log thay silent), L1 (tie-break dùng `mulberry32` PRNG seeded bằng `hashStringToSeed(state.id)`). All landed trong cùng ngày.

### 🟡 Một Số Phần Còn Dở (Mock / Hardcoded)

- (Đã giải quyết trong PR `fix/match-race-frontend-correctness`) ~~`GamePage` sidebar còn danh sách player mock hardcode (lines 366-443: `Zero_Cool`, `Acid_Burn`, ...). Cần wire với `match.players` từ socket-store~~ → ✅ giờ render `match.players` thật từ `socket-store.ts` (`PLAYER_ELIMINATED` + `ROUND_ENDED` handlers stamp `status = "ELIMINATED"`)
- `apps/web/src/app/[locale]/page.tsx:193` vẫn có `bg-gradient-to-br from-[#FFF0F5] via-[#E6E6FA] to-[#E0F2FE]` redundant với `body` gradient — PR 6 (home page shell gradient cleanup) defer
- ✅ (L2 done trên main, merged từ trước khi mở branch `feat/replay-lastseen-delta`) ~~`game.gateway.ts` `handleDisconnect` không `await`; import block trùng~~ → giờ `await authHandler.handleDisconnect(client)` ([game.gateway.ts:155](../apps/api/src/gateways/game.gateway.ts#L155)) + import block đã gộp thành 1 khối `from "@arena/shared"`
- 🟡 (L3 tách hai phần — `CLIENT_TIMESTAMP_MAX_OFFSET_MS = 5 * 60 * 1000` đã merge main; `lastSeenSeqNo.max(...)` chỉ branch-only) ~~`schemas.ts` `CLIENT_TIMESTAMP_MAX_OFFSET_MS` = 1 năm; `lastSeenSeqNo.max(Number.MAX_SAFE_INTEGER)`~~ → main đã có `CLIENT_TIMESTAMP_MAX_OFFSET_MS = 5 * 60 * 1000` ([schemas.ts:97](../packages/shared/src/schemas.ts#L97)); branch `feat/replay-lastseen-delta` tightening tiếp `lastSeenSeqNo.max(GAME_CONFIG.MAX_ROUNDS * GAME_CONFIG.MAX_PLAYERS * 2)` ([schemas.ts:149](../packages/shared/src/schemas.ts#L149))

### 🔴 Use Case Còn Thiếu (theo brief, chưa có implementation)

1. ~~**Drop-in Spectating**~~ ✅ Done 2026-06-14 — `RoomService.joinRoom` cho phép late-joiner vào `IN_GAME`/`FINISHED` với `JoinMode = "SPECTATOR"` (no DB write, no playerCount bump). `MatchHandler.handleSubmitAnswer` server gate. Frontend spectator UI ở lobby + game page. Mass-spectator SSE channel vẫn deferred (PR kế tiếp)
2. ✅ **In-match AFK policy** (Track C, 2026-07-13) — `evaluateRound()` chỉ quyết định _ai_ bị loại (no answer / wrong answer → `eliminatedIds`); **không** gán `EliminationReason`. Reason gán ở emit layer: `match-round-runner.endRound()` → `emitPlayerEliminated({ answeredThisRound, wasOnline })` → `reason = answeredThisRound ? "WRONG_ANSWER" : wasOnline ? "AFK" : "TIMEOUT"`. Distinction: no answer + online → **`AFK`** (player idle / didn't press); no answer + offline/disconnected → **`TIMEOUT`** (disconnect mid-round). Shared type `EliminationReason = "WRONG_ANSWER" | "TIMEOUT" | "AFK"` matches the wire (xem `packages/shared/src/events.ts` + `docs/afk-policy.md` §3). Track C: shared type + overlay + snapshot rehydrate `isEliminated`. Round-miss 2+ detection vẫn deferred (xem §7).
3. **Mass-spectator isolation infra** — drop-in baseline đã reuse `room:[id]` channel. SSE channel/namespace riêng cho spectator vẫn chưa có
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

- ✅ Reject khi `room.status !== WAITING` đã được mở rộng: IN_GAME/FINISHED cho phép join as SPECTATOR (no DB write, no playerCount bump). `RoomService.joinRoom` 4-way matrix; COUNTDOWN/STARTING vẫn reject. (`apps/api/src/modules/room/room.service.ts:93-180`)
- ✅ Auto-transition sang spectator mode: `JoinMode` payload (`joinedAs: "PLAYER" | "SPECTATOR"` trong `RoomJoinedPayload`); lobby + game page UI đã wire
- ✅ Snapshot path an toàn: `MatchHandler.handleRequestSnapshot` reuse `MatchStateMachine.getSnapshot` (đã client-safe, không leak `correctAnswer`); regression test verify
- ❌ Mass-spectator isolation infra: vẫn chưa có (SSE channel/namespace riêng) — deferred sang PR kế tiếp

#### 6. Spectator Mode with Micro-interactions

- 🟡 Player → SPECTATOR transition có trong state machine constants (`PlayerStatus`) + `socket-store.isEliminated` + `GamePage` render "Chế độ khán giả" UI (lines 329-338). Chỉ phủ case bị loại trong match, **chưa** phủ drop-in
- ❌ Emote/reaction broadcast: chưa có
- ❌ Personal stats cho spectator: chưa có
- ❌ Scalable spectator infra: chưa có

#### 7. AFK Sweeping

- ✅ Lobby AFK sweeping: `PresenceService.sweep` 5s interval — auto-disband private room nếu host stale, batch remove non-host stale
- ✅ In-match AFK detection: `MatchStateMachine.evaluateRound()` auto-eliminate ids cho 3 case (AFK thuần / disconnect mid-round / sai) — **không** gán reason. `match-round-runner.endRound()` gọi `emitPlayerEliminated` với `answeredThisRound = answers.has(playerId)` + `wasOnline = player.isOnline`; `game-loop.events.ts` map `WRONG_ANSWER` (có answer) vs **`AFK`** (không answer + còn kết nối) vs **`TIMEOUT`** (không answer + offline). Shared `EliminationReason` (`WRONG_ANSWER | TIMEOUT | AFK`) khớp đúng wire 3 trường hợp. Track C (commits `4832e72`, `eba3d73`, `ba64ef5`, `670a0a6`): shared type + FE overlay/store (xem `docs/afk-policy.md` §1-3).
- ✅ In-match auto convert to spectator: người bị loại vẫn giữ kết nối + tiếp tục xem như spectator qua `socket-store.isEliminated` + `GamePage` "Chế độ khán giả" UI. Snapshot reconnect hydrates `isEliminated` từ roster.
- ❌ In-match AFK scheduler riêng (2+ round miss pattern detector): vẫn deferred — sweep hiện gọi `handleRoomPlayerLeft` chỉ chạy ở lobby status. Detection hiện tại dựa trên "không có answer trong round đó" (mỗi round là 1 nhịp), không có nhịp "x round liên tiếp miss".

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
- ✅ Missed event replay (sequence number diff) — **Track D**, branch `feat/replay-lastseen-delta` (chưa merge main 2026-07-13):
  - State machine `getDelta(seqNo)` filtered by `seqNo > inputSeqNo`: [`packages/game-core/src/match-state-machine.ts:569`](../packages/game-core/src/match-state-machine.ts#L569)
  - Handler emit `ServerEvent.EVENT_BATCH` với delta events: [`match.handler.ts:245`](../apps/api/src/gateways/handlers/match.handler.ts#L245)
  - Schema cap `lastSeenSeqNo.max(MAX_ROUNDS * MAX_PLAYERS * 2)` (branch-only): [`schemas.ts:145-149`](../packages/shared/src/schemas.ts#L145)
  - Client EVENT_BATCH fold (validate contiguous + matchId, cập nhật cursor): [`socket-store.updaters.ts:511`](../apps/web/src/stores/socket-store.updaters.ts#L511)
  - Client EVENT_BATCH listener + `requestSnapshot(matchId, lastSeenSeqNo)`: [`socket-store.ts:312`](../apps/web/src/stores/socket-store.ts#L312), [`socket-store.ts:642-647`](../apps/web/src/stores/socket-store.ts#L642)
  - Commits: `1dae730` (contract), `113a658` (impl), `a222340` (final wiring)

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

| Priority      | Gap                                  | Use Case Brief | Why Now                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ 2026-06-14 | Design System Phase 5B closeout      | polish         | Done: shell gradient bỏ ở `app-shell-layout.tsx:34` + `sidebar.tsx:230`; `styles/components.css` audit xác nhận 0 references; visual closeout complete                                                                                                                                                                       |
| ✅ 2026-06-14 | Drop-in spectating baseline          | #5, #6         | Done: `JoinMode` payload (`RoomJoinedPayload.joinedAs`) + `RoomService.joinRoom` 4-way matrix + `MatchHandler.handleSubmitAnswer` server gate + frontend spectator UI. Reuse `room:[id]` channel. Mass-spectator SSE vẫn deferred                                                                                            |
| ✅ 2026-07-13 | In-match AFK policy (Track C)        | #7             | Done trên main (commits `4832e72`, `eba3d73`, `ba64ef5`, `670a0a6`): per-round auto-eliminate; wire reason `WRONG_ANSWER` (có answer sai) / `AFK` (không answer + còn kết nối) / `TIMEOUT` (không answer + offline); shared `EliminationReason` khớp wire; FE overlay + store rehydrate. 2-round-miss scheduler vẫn deferred |
| ✅ 2026-07-13 | k6 load test (Plan A)                | #5 (gate)      | Done qua PR #71: `load-test/` harness + `apps/api/src/modules/health/health.controller.ts:39-104` bổ sung `rssBytes` + `totalMemBytes` raw; CpuSamplerService dùng convention `100% = 1 core`. Kết quả baseline xem `load-test/README.md`                                                                                    |
| P2            | Mass-spectator SSE scaling           | #5             | Baseline xong; cần batched low-frequency updates + clear transport boundary khi scale lên                                                                                                                                                                                                                                    |
| P2            | Frictionless onboarding + moderation | #1             | Onboarding nickname + localStorage done; profanity filter backend vẫn ❌; privacy/legal risk nếu public; share với kill-switch sanitizer pipeline                                                                                                                                                                            |
| P2            | Accessibility audit                  | #14            | Compliance                                                                                                                                                                                                                                                                                                                   |
| P2            | Optimistic UI rollback đầy đủ        | #16            | Game feel, không block ship MVP                                                                                                                                                                                                                                                                                              |
| P2            | Content moderation + sanitizer       | #1, #17        | Rate limiting name changes + Unicode-bypass normalization xong (`fix/moderation-unicode-bypass`); profanity filter backend + custom termination message vẫn ❌ (cần shared pipeline)                                                                                                                                         |
| P3            | Host kick player                     | #2             | API đã có, hook chưa wire vào room handler / admin                                                                                                                                                                                                                                                                           |
| P3            | Post-match rematch + share           | #12            | Retention                                                                                                                                                                                                                                                                                                                    |
| P3            | Sudden death + tie-break UI          | #11            | Game feel giai đoạn cuối                                                                                                                                                                                                                                                                                                     |
| P3            | Asset preloading                     | #9             | Chỉ cần khi có media assets thật                                                                                                                                                                                                                                                                                             |
| P3            | Surrender in-match                   | #8             | Optional; cho phép player rời khi đang IN_GAME                                                                                                                                                                                                                                                                               |

## Strategic Recommendations

### ✅ Done 2026-06-14: Design System Phase 5B Closeout

Phase đã đóng theo ground truth từ code. Bằng chứng:

1. **Bước 5B.1**: shell-level gradient đã bỏ ở `app-shell-layout.tsx:34` (redundant với `body` gradient ở `globals.css:22`)
2. **Bước 5B.2**: mobile overlay gradient + `backdrop-blur-md` đã bỏ ở `sidebar.tsx:230`
3. **Bước 5B.3**: audit `styles/components.css` xác nhận 0 live references (file đã absent); `bg-gradient-to-br from-pink-50 via-blue-50 to-indigo-50` không còn trong code
4. **Verify**: vitest infrastructure setup cho web package; AppShellLayout 100% test coverage (10 tests); Sidebar 99.51% (18 tests)
5. **Out of scope** (deferred sang PR riêng): home page gradient ở `[locale]/page.tsx:193` vì home không dùng AppShellLayout

### ✅ Done 2026-06-14: Drop-in Spectating Baseline

PR `feat/drop-in-spectating-baseline` — cho phép late-joiner vào `IN_GAME`/`FINISHED` với tư cách `SPECTATOR` (read-only). Baseline reuse `room:[id]` channel + `MatchStateMachine.getSnapshot` (đã client-safe).

1. **Contract baseline**: thêm `JoinMode` payload (`joinedAs: "PLAYER" | "SPECTATOR"` trong `RoomJoinedPayload` + `RoomCreatedPayload`) trong `packages/shared/src/socket.ts` + `SPECTATOR_CANNOT_ANSWER` error code
2. **Backend join policy**: `RoomService.joinRoom` 4-way matrix (WAITING+new→PLAYER, WAITING+existing→PLAYER reconnect, IN_GAME/FINISHED+existing→PLAYER reconnect, IN_GAME/FINISHED+new→SPECTATOR no-DB-write, COUNTDOWN/STARTING→reject)
3. **Backend submit gate**: `MatchHandler.handleSubmitAnswer` check `stateMachine.getState().players.has(userId)` → throw `SPECTATOR_CANNOT_ANSWER` cho non-player
4. **Snapshot safety**: `MatchHandler.handleRequestSnapshot` allow-list cho spectator path + regression test verify no `correctAnswer` leak
5. **Frontend**: `socket-store.ts` thêm `joinMode: JoinMode`; `lobby/[roomCode]/page.tsx` thêm spectator banner + "Vào xem"/"Xem kết quả" CTA + auto-redirect `/result/[matchId]` cho FINISHED + suppress `LobbyStartControls`; `game/[matchId]/page.tsx` render spectator UI + `handleSelectAnswer` short-circuit
6. **i18n**: thêm `lobby.spectator.*` + `Game.dropInSpectator.*` (8 keys mới) vào `messages/{en,vi}.json`
7. **Verify**: 661/661 unit tests pass; coverage per-file ≥90% cho `room.service.ts` (98.25% stmts / 91.89% branch), `room.handler.ts` (100% / 90.47%), `match.handler.ts` (100% / 95.65%); `pnpm --filter @arena/web typecheck` + lint pass
8. **Out of scope** (deferred sang PR riêng): SSE channel riêng cho mass-spectate; `GamePage` live opponents sidebar wiring (vẫn hardcoded) — **note 2026-06-18**: SSE channel vẫn pending (PR 2); GamePage sidebar đã fix trong PR `fix/match-race-frontend-correctness` (F1), không còn hardcode nữa

### ✅ Done 2026-06-14: Match Race + Frontend Correctness Hardening

PR `fix/match-race-frontend-correctness` — gộp 11 bug trong 1 PR (3 race backend + 8 correctness frontend). Xem chi tiết tại `memory-bank/plan.md` và `memory-bank/progress.md` section "Phase 12".

1. **Backend race (B1)**: `GameLoopService.finishingMatches: Set<string>` (mirror `endingRounds`); `finishMatchLoop` try/finally guard; expose `isMatchFinishing(matchId)`; `AdminService.terminateRoom` abort với `ALREADY_FINISHING` reason
2. **Backend race (B2)**: `MatchStateMachine.tieBreak/determineWinner` return `string | null`; empty-roster early-return; `finishMatchLoop` đổi `state.winnerId!` → `state.winnerId ?? null`
3. **Backend race (B3)**: `GameLoopService.launchRoomMatch` wrap critical section trong `prisma.$transaction` với `tx.$queryRaw SELECT ... FOR UPDATE`; check `currentMatchId IS NULL` atomic
4. **Frontend correctness (F1)**: `socket-store.ts` ROUND_ENDED + PLAYER_ELIMINATED stamp `match.players[i].status`; `game page` sidebar render `match.players` thật, sort alive trước, badge OK/ELIMINATED
5. **Frontend correctness (F2)**: bỏ magic number `newCount <= 12` redirect; client chỉ redirect khi `match.status === "FINISHED"` (server-authoritative)
6. **Frontend correctness (F3)**: tách 2 timer ref `roundResultRevealRef` (1s) + `roundResultContinueRef` (3s); cleanup đầy đủ
7. **Frontend correctness (F4)**: `maxPlayers` động qua `GAME_CONFIG.MAX_PLAYERS` (fallback khi `room.maxPlayers` chưa expose)
8. **Frontend correctness (F5)**: loading skeleton `<div className="animate-pulse">{t("loadingQuestion")}</div>` thay vì hardcoded question
9. **Frontend correctness (F6)**: bỏ `currentRoundNo || 1`; `submitAnswer` chỉ emit khi `match.currentRoundNo > 0`
10. **Frontend correctness (F7)**: round-completed effect drive từ `match.status === "ROUND_RESULT" && match.roundEndTime === null` (server-authoritative)
11. **Frontend correctness (F8)**: `use-lobby-lifecycle.ts` `joinInFlightRef` chống double-emit JOIN_ROOM
12. **Verify**:
    - **Pre-Track-D baseline (anchor 2026-06-18)**: 772/772 api unit + 70/70 game-core + 31/31 web + 11/11 E2E pass; coverage per-file ≥90% (`game-loop.service.ts` 100%, `admin.service.ts` 100%, `match.service.ts` 96.22%, `match-state-machine.ts` 100%). Con số 772 KHÔNG bao gồm Track D — Track D mở rộng các spec file bên dưới.
    - **Track D replay-delta (branch `feat/replay-lastseen-delta`, head `a222340`, chưa cộng vào baseline)**: getDelta coverage ở `packages/game-core/src/match-state-machine.spec.ts` (12 test delta), EVENT_BATCH coverage ở `apps/api/src/gateways/handlers/match.handler.spec.ts` (24 test delta), lastSeenSeqNo/EVENT_BATCH folding ở `apps/web/src/stores/socket-store.updaters.spec.ts` (30 test delta). Tổng +66 test Track D net mới. **Track D full-suite verification: pending** — chạy `pnpm test` (hoặc filter `game-core` + `api` + `web`) trên head `a222340` rồi ghi tổng pass; **không** trình bày merged grand total như đã complete.

### ✅ Done 2026-06-14: Post-merge Idempotency + Recovery Hardening

Sau khi PR `fix/match-race-frontend-correctness` merge, post-merge audit phát hiện 5 follow-up bug còn lại (B4-B7, L1) — đã fix trong cùng ngày qua chuỗi commit `fix(bug): fix comment`:

1. **B4 (DB-layer idempotency)**: `MatchService.finishMatch` `updateMany` với `where: { id: matchId, status: { not: MatchStatus.FINISHED } }`; nếu `count: 0` (đã FINISHED) → log warn + return `findUnique` mà không overwrite
2. **B5 (saveRoundAndAnswers idempotency)**: pre-check `matchRound.findUnique` trong transaction + P2002 catch block → idempotent no-op
3. **B6 (rehydrateCorrectAnswer graceful degradation)**: full try/catch quanh `prisma.question.findUnique`; cả 2 nhánh (question not found, DB lookup throw) đều `logger.error` + return; match vẫn recoverable
4. **B7 (buildScoreUpdateOps operator warning)**: `logger.warn` (không silent) khi state machine đã mất
5. **L1 (tie-break determinism)**: `match-state-machine.ts:384-411` dùng `mulberry32` PRNG seeded bằng `hashStringToSeed(state.id)`; reproducible theo (response time → correctAnswers → deterministic offset → alphabetical)

### ✅ ĐÃ XONG: PR 2B — Schema cap `lastSeenSeqNo` (branch-only; L2 + L3 timestamp đã có trên main)

> Branch `feat/replay-lastseen-delta` **không** ship lại toàn bộ L2/L3. L2 (gateway await + dedup import) và phần L3 timestamp (`CLIENT_TIMESTAMP_MAX_OFFSET_MS`) đã có trên main từ trước; branch chỉ bổ sung `lastSeenSeqNo.max(...)`. Chi tiết giữ nguyên:
>
> 1. **L2 (gateway) — already on main** — `game.gateway.ts:155` giờ `await this.authHandler.handleDisconnect(client)` (handler có try/catch nội bộ quanh room/match lookup nên rejection chỉ đến từ programming bug và được để surface). Import block đã gộp thành 1 khối `from "@arena/shared"`.
> 2. **L3 (schema validation)** — **already on main:** `schemas.ts:97` `CLIENT_TIMESTAMP_MAX_OFFSET_MS = 5 * 60 * 1000` (5 phút, dùng `.refine()` với `Date.now()` runtime). **Branch-only:** `schemas.ts:149` `lastSeenSeqNo.max(GAME_CONFIG.MAX_ROUNDS * GAME_CONFIG.MAX_PLAYERS * 2)`.

### ✅ ĐÃ XONG: Track C — In-match AFK Policy (2026-07-13)

Track C đã land trên main qua các commit `4832e72`, `eba3d73`, `ba64ef5`, `670a0a6`. Scope đã ship:

1. **Shared type** `EliminationReason = "WRONG_ANSWER" | "TIMEOUT" | "AFK"` (`packages/shared/src/events.ts`) — khớp wire 3 trường hợp (có answer sai / không answer + còn kết nối / không answer + offline).
2. **BE (verify only, không thêm code)**: `evaluateRound()` auto-eliminate ids cho 3 case (AFK thuần / disconnect / sai) — **không** gán reason. Reason gán tại `emitPlayerEliminated`: `answeredThisRound ? "WRONG_ANSWER" : wasOnline ? "AFK" : "TIMEOUT"` (xem `docs/afk-policy.md` §3). Track C chỉ regression tests + FE, không đổi state machine (CRITICAL blast radius: 19 execution flows, xem `docs/plans/Plan-C-afk-hardening.md` Phase C1).
3. **FE**: `eliminationReason` trong `socket-store` + `EliminatedOverlay` hỗ trợ cả 3 reason với copy tương ứng; runtime nhận `AFK` (unanswered + online) hoặc `TIMEOUT` (unanswered + offline) tuỳ `wasOnline` ở emit layer. Snapshot reconnect hydrates `isEliminated` từ roster.
4. **i18n**: `Game.eliminatedOverlay.reasonWrong` / `reasonTimeout` / `reasonAfk` trong en.json + vi.json.
5. **Verify**: game-core 80/80, round-runner 44/44, web stores+game 49/49, web typecheck, web+shared lint. `gitnexus detect_changes` confirm scope FE store/overlay/page + shared events only.

**Out of scope (deferred sang PR riêng)**:

- In-match AFK scheduler riêng (2-round-miss pattern detector): vẫn ❌.

### PR Kế Tiếp (P2): Mass-spectator Transport Scaling

Sau khi drop-in spectating baseline xong, cần tách transport riêng cho scale:

1. SSE channel `spectator:<matchId>` hoặc Socket.io namespace `/spectate`
2. Batched low-frequency updates (1s/lần) thay vì per-event broadcast
3. Clear player vs spectator transport boundary ở `game.gateway.ts` + `match.handler.ts`

### Polish (P2-P3)

- Content moderation pipeline (profanity filter, device fingerprint) — unlock admin kill-switch custom message
- Optimistic UI rollback (idempotency key + rollback path)
- Post-match rematch + share
- Accessibility audit (WCAG)
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

Dự án đã có nền tảng kỹ thuật vững (server-authoritative, event-sourced, clean architecture), core gameplay chạy thật, lobby/heartbeat/graceful-exit/admin kill-switch/drop-in spectating baseline done. Để trở thành "product engineer portfolio piece" thật sự, cần tập trung vào:

1. ✅ Hoàn thiện lobby lifecycle + graceful exit (production-ready) — done ở PR #38
2. ✅ Real data APIs cho profile/rankings (thay mock) — done (Bước 3-5 `issue.md`)
3. ✅ Admin kill-switch end-to-end — done ở PR #47 baseline (chỉ còn deferred message-sanitizer)
4. ✅ Design System Phase 5B closeout (visual consistency) — done 2026-06-14
5. ✅ Drop-in spectating baseline — done 2026-06-14
6. ✅ In-match AFK policy (Track C) — done 2026-07-13 (xem §"ĐÃ XONG: Track C" bên dưới); 2-round-miss scheduler riêng vẫn deferred
7. ✅ k6 load test (Plan A) — done 2026-07-13 qua PR #71; gate evidence ở `load-test/README.md`
8. ⏳ Mass-spectator transport scaling — proposed P2
9. ⏳ Bổ sung content moderation (profanity filter, device fingerprint) — P2
10. ⏳ Accessibility audit (WCAG) — P2

Sau khi các mục trên xong, Arena of 100 sẽ chứng minh được: complete user journey, production-grade thinking, operational excellence, international standards compliance.
