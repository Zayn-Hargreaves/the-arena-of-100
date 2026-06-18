# Progress: Arena of 100

## Current Status: ✅ Lobby + Heartbeat + Graceful Exit + Admin Kill-Switch + Design System Phase 5B + Drop-in Spectating Baseline + Match Race + Frontend Correctness Hardening + Gateway/Schema Tightening Done → Admin Kill-Switch Audit Event Next

> Cập nhật 2026-06-18 dựa trên code + GitNexus + test run thực tế. So với bản 2026-06-14, các mốc lobby/heartbeat/graceful-exit/admin kill-switch đã hoàn thành baseline và chuyển trạng thái. Design System Phase 5B closeout cũng đã hoàn thành 2026-06-14 (ground truth từ code: `app-shell-layout.tsx:34` và `sidebar.tsx:230` không còn shell gradient; `styles/components.css` đã được xác nhận không còn reference). PR Drop-in Spectating Baseline (`feat/drop-in-spectating-baseline`) cũng đã hoàn thành 2026-06-14. Cùng ngày cũng close PR `fix/match-race-frontend-correctness` — 3 race bug backend (B1-B3) + 8 correctness bug frontend (F1-F8) đã sửa với 51 test mới. Sau merge, post-merge audit phát hiện thêm 7 follow-up bug (B4-B7, L1-L3); 5 trong 7 đã được land trong cùng ngày qua chuỗi commit `fix(bug): fix comment` (`87d3bb9`, `e9b9c42`, `d069a76`, `67abaa7`, `69b9ab6`, `d049035`, `126641c`); 2 còn pending lúc post-merge audit ban đầu (L2 + L3) + home gradient, nhưng đã được land trong PR 6 (`chore/gateway-schema-tightening-home-gradient`). Test count thực tế 2026-06-18: **779/779 unit api + 70/70 game-core + 31/31 web + 11/11 E2E** pass (sau PR `chore/gateway-schema-tightening-home-gradient` thêm 7 test mới — 1 cho L2 await error propagation, 6 cho L3 bound tightening). Coverage per-file ≥90% cho 2 file production sửa (`game.gateway.ts` 100%/93.1%, `schemas.ts` 100%/100%). Xem section `Phase 13` bên dưới.
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
- [x] **Phase 11 — Drop-in Spectating Baseline** (`feat/drop-in-spectating-baseline`, 2026-06-14) — cho phép late-joiner vào `IN_GAME`/`FINISHED` với `JoinMode = "SPECTATOR"` (read-only). Reuse `room:[id]` channel + `MatchStateMachine.getSnapshot` (client-safe, không leak `correctAnswer`). Server-side gate `SPECTATOR_CANNOT_ANSWER` ở `MatchHandler.handleSubmitAnswer`. Frontend: lobby banner + auto-redirect `/result/[matchId]` cho FINISHED + spectator UI trên game page. Coverage per-file ≥90% cho tất cả file sửa. Xem section chi tiết bên dưới (Phase 11).

### ✅ Phase 12 — Match Race + Frontend Correctness Hardening (`fix/match-race-frontend-correctness`, 2026-06-14) — Hoàn thành

PR gộp duy nhất đóng 3 race bug backend (B1, B2, B3) + 8 correctness bug frontend (F1-F8) trong 1 lần. Mục tiêu: chống double-write DB khi match-finish race giữa timer và admin kill-switch, đóng double-launch race khi recovery chạy đồng thời với auto-start, bỏ mock sidebar (deception thật với user), khôi phục server-authoritative guarantee bị phá bởi magic number `<= 12`, fix timer leak + race trong round-result sequence.

#### Backend (3 bug)

- [x] **B1** — `finishMatchLoop` idempotency guard. Thêm `private finishingMatches = new Set<string>()` (mirror `endingRounds` pattern, line 38 của `game-loop.service.ts`). Guard đầu `finishMatchLoop:962` với try/finally. Expose public `GameLoopService.isMatchFinishing(matchId)`. `AdminService.terminateRoom:258-274` check guard trước khi gọi `matchService.finishMatch` — nếu đã finishing, abort toàn bộ kill-switch, trả `{ success: false, reason: "ALREADY_FINISHING" }`. Ngăn 2 đường ghi DB cùng `Match` row với `winnerId` mâu thuẫn (string vs null) + 2 broadcasts `MATCH_FINISHED` + `ROOM_TERMINATED` cùng lúc.
- [x] **B2** — `winnerId` null/undefined guard. `MatchStateMachine.tieBreak` + `determineWinner` return type widen `string` → `string | null`. Empty-roster path early-return `null` (trước: trả `undefined` qua `sorted[0]`, type system không bắt được). `finishMatch` skip `winner.status = WINNER` khi `winnerId === null` (trước: throws `TypeError: Cannot read properties of null`). `finishMatchLoop:984` đổi `state.winnerId!` → `state.winnerId ?? null` (explicit conversion). `matchService.finishMatch(matchId, null, roomId)` đã accept `string | null` từ trước. MATCH_FINISHED event phát `winnerId: null` thay vì `undefined` (Prisma sẽ silently drop field `undefined`).
- [x] **B3** — `launchRoomMatch` atomic guard. Inject `PrismaService` vào `GameLoopService` (PrismaModule là global, không cần đổi module). Wrap critical section trong `prisma.$transaction` với `tx.$queryRaw\`SELECT id, status, "currentMatchId" FROM "Room" WHERE id = ${roomId} FOR UPDATE\``. Check status in [WAITING, COUNTDOWN] + `currentMatchId IS NULL`atomic dưới row lock. Set`Room.status = STARTING`trong transaction.`createMatch`gọi ngoài transaction (đã có internal transaction cho MatchPlayer.createMany). Cleanup path: nếu`createMatch` throw sau khi transaction commit → revert room status + (TODO: delete orphan match row nếu có).

#### Frontend (8 bug)

- [x] **F1** — Sidebar real data. Bỏ 5 mock name cứng (`Zero_Cool`, `Acid_Burn`, `Lord_Nikon`, `Cereal_Killer`, `Crash_Override`) ở `game/[matchId]/page.tsx:442-472`. Render `match.players` thật, sort alive trước, badge OK/ELIMINATED từ `player.status`. `socket-store.ts:515-555` ROUND_ENDED + PLAYER_ELIMINATED handlers cross-check `eliminatedPlayerIds` và stamp `status = "ELIMINATED"`. Empty players → render "(đang chờ danh sách người chơi)" thay vì mock.
- [x] **F2** — Bỏ magic number `<= 12` redirect. Xoá `if (newCount !== null && newCount <= 12) { router.push('/result/${matchId}') }` ở `game page:153`. Match-end redirect giờ chỉ từ effect `match.status === "FINISHED"` (đã có sẵn, dùng đúng). Khôi phục server-authoritative guarantee — server `shouldEndMatch` chỉ true khi `<= 1` survivor hoặc `MAX_ROUNDS` hit.
- [x] **F3** — Tách nested setTimeout. Tách thành 2 ref `roundResultRevealRef` (1s reveal) + `roundResultContinueRef` (3s transition). `clearTimers` clear cả 2. Cleanup effect return cũng clear 2. Tránh timer leak + race khi component re-render giữa chừng.
- [x] **F4** — Dynamic maxPlayers. Import `GAME_CONFIG` từ `@arena/shared`. `maxPlayers = match.players.length > 0 ? match.players.length : GAME_CONFIG.MAX_PLAYERS`. Render `{livePlayerCount} / {maxPlayers}` thay vì `?? 100 / 100`. `room.maxPlayers` chưa có trên ROOM_JOINED payload (track PR 12 riêng).
- [x] **F5** — Loading state. Khi `!match.currentQuestion` render `<div className="animate-pulse">{t("loadingQuestion")}</div>` thay vì hardcoded monorepo package names. Thêm i18n key `Game.loadingQuestion` + `Game.opponentsEmpty` ở `messages/{en,vi}.json`.
- [x] **F6** — Bỏ `currentRoundNo || 1` dead data. `submitAnswer` chỉ emit khi `match.currentRoundNo > 0`. Server `MatchHandler.handleSubmitAnswer` đọc round từ state machine, bỏ client roundNo để tránh log noise.
- [x] **F7** — Round-end signal rõ. Effect round-completed drive từ `match.status === "ROUND_RESULT" && match.roundEndTime === null` (server-authoritative) thay vì `lastAnswerResult?.correctAnswer` (có thể rỗng/falsy khi question row missing answer key). `revealedCorrectAnswer` vẫn dùng `lastAnswerResult.correctAnswer` cho display.
- [x] **F8** — Auto-join guard. Thêm `joinInFlightRef = useRef(false)` ở `use-lobby-lifecycle.ts`. Check ở đầu effect; set true trước `await joinRoom`, false trong `finally` (kể cả cancelled). Tránh double-emit `JOIN_ROOM` khi `room` object thay đổi do presence/PLAYER_JOINED event re-trigger effect.

#### Verification

- [x] **712/712 → 772/772** unit tests pass (api) qua các PR fix(bug) post-merge
- [x] **Coverage per-file ≥90%** cho 4 file production sửa (cập nhật 2026-06-18 từ coverage report thực tế):
  - `game-loop.service.ts` **100%** stmts / 100% branch (was 96.25% trước fix(bug) post-merge)
  - `admin.service.ts` **100%** / 100%
  - `match.service.ts` **96.22%** / 90.76% (was 95.53%)
  - `match-state-machine.ts` **100%** / 92.12% (was 98.63% / 88.8% — coverage tăng do L1/L3 fix thêm test path)
- [x] **Server-authoritative guarantee** khôi phục: client không tự redirect kết thúc trận, chỉ tin `MATCH_FINISHED` broadcast từ server.
- [x] **Socket protocol không đổi**: không thêm event mới, không đổi payload shape, không bump version. `winnerId: string | null` đã có sẵn.
- [x] **Shared types không đổi**: `@arena/shared/src/**` nguyên vẹn (F4 dùng `GAME_CONFIG.MAX_PLAYERS` đã có).
- [x] **Prisma schema không đổi**: `Room.maxPlayers`, `Match.winnerId` đều nullable từ trước.
- [x] `pnpm --filter @arena/api {tsc --noEmit, vitest run, build}` pass.
- [x] `pnpm --filter @arena/web {tsc --noEmit, build, lint}` pass.
- [x] `pnpm --filter @arena/web test --run` pass (3 new F8 tests + 28 existing shell tests).

#### Bug deltas (GitNexus cross-check)

- Plan claim: `MatchService.finishMatch` upstream MEDIUM (4 callers) → thực tế **CRITICAL (6 callers)**
- Plan claim: `GameLoopService.launchRoomMatch` upstream MEDIUM (3 callers) → thực tế **HIGH (4 direct + 4 indirect)**
- Plan claim: `GameLoopService.finishMatchLoop` upstream LOW (2 callers) → thực tế **HIGH (2 callers + 3 processes)**
- Plan claim: B2 chỉ "DB ghi `winnerId: undefined`" → thực tế **còn crash ở `finishMatch:433` trước khi DB write xảy ra** khi `winnerId === undefined` (không chỉ là data corruption)
- B1 fix close được race thật: `AdminService.terminateRoom` + `GameLoopService.finishMatchLoop` không thể cùng ghi DB `Match` row + phát 2 broadcasts mâu thuẫn

#### Out of scope (deferred sang PR riêng)

- PR 2: Mass-Spectator Transport Scaling
- PR 3: Admin Kill-Switch Append-Only Audit Event (đang thực hiện)
- PR 4: In-Match AFK Policy (P1, product — pending decision)
- PR 5: Optimistic Answer Rollback đầy đủ (F6 chỉ bỏ dead data, chưa có idempotency key)
- PR 6: Home Page Shell Gradient Cleanup
- PR 7: Content Moderation + Message Sanitizer + Device Fingerprint
- PR 8-11: Post-match rematch, accessibility, k6 load, Playwright
- PR 12: `Room.maxPlayers` field trong `ROOM_JOINED` payload (F4 dùng fallback `GAME_CONFIG.MAX_PLAYERS`)

### ✅ Phase 13 — Gateway + Schema Tightening + Home Gradient Cleanup (`chore/gateway-schema-tightening-home-gradient`, 2026-06-18) — Hoàn thành

Housekeeping PR gộp 3 concern cleanup-style cùng blast radius thấp còn lại từ post-merge audit (L2 + L3) + tech debt cũ (PR 6 — home gradient). Tất cả đều pure tightening / defensive cleanup, không đổi behavior end-user, không đụng socket event shape hay shared types.

#### L2 — `GameGateway` defensive consistency (apps/api/src/gateways/game.gateway.ts)

- [x] **Import dedupe**: gộp 2 block `import { ... } from "@arena/shared"` (lines 13-23 types + lines 30-39 schemas cũ) thành 1 block duy nhất, types trước (alphabetical + `type` prefix), schemas sau (alphabetical). TypeScript cho phép mix value + type-only imports trong 1 statement.
- [x] **`await handleDisconnect`**: `handleDisconnect` ở `auth.handler.ts:137` là `async` (queries active rooms, notifies match), nhưng `game.gateway.ts:148-150` gọi fire-and-forget. Nếu handler reject, error bị swallow thành unhandled rejection. Thêm `await` + comment ngắn giải thích invariant.
- [x] Test mới (`game.gateway.spec.ts:226-235`): "propagates errors from authHandler.handleDisconnect instead of swallowing them" — mock `authHandler.handleDisconnect` reject, verify `gateway.handleDisconnect` reject. Catches regression nếu ai đó bỏ `await` lần sau.

#### L3 — Tighten validation bounds (packages/shared/src/schemas.ts)

- [x] **`CLIENT_TIMESTAMP_MAX_OFFSET_MS`**: `365 * 24 * 60 * 60 * 1000` (1 năm) → `5 * 60 * 1000` (5 phút). Rationale: `ROUND_DURATION_MS = 15_000`, 5 phút = 20x round duration = đủ headroom cho NTP drift + mobile sleep recovery + network buffering. Comment giải thích invariant + headroom.
- [x] **`lastSeenSeqNo`**: `Number.MAX_SAFE_INTEGER` → `GAME_CONFIG.MAX_ROUNDS * 2` (= 100). Rationale: giá trị hiện tại là pass-through echo (`MatchStateMachine.getSnapshot` chỉ trả về verbatim trong snapshot payload, không filter event). Cả 2 call site đều hardcode `0`. Cap 100 là sanity bound chống hostile fuzz input (sentinels, bit-flips, junk) — KHÔNG phải tight upper bound trên event log size. Một match 100 player có thể sinh hàng nghìn event (xem `match-state-machine.ts`: `ANSWER_SUBMITTED` × players × rounds + `STATE_TRANSITION` / `ROUND_EVALUATED` / `TIE_BREAK` / `MATCH_FINISHED` / `PLAYER_DISCONNECTED` / `PLAYER_RECONNECTED`). Comment giải thích invariant + cảnh báo nếu sau này implement real delta filtering thì phải re-derive cap.
- [x] **Không đổi** `roundNo` bound (line 106 đã cap ở `MAX_ROUNDS`), `token` (line 32, MAX 4096), `maxPlayers` (line 44, MAX_PLAYERS_MAX) — tất cả đã đúng.
- [x] **Regression tests mới** (`game.gateway.spec.ts:373-419`):
  - `SUBMIT_ANSWER rejects clientTimestamp 1 year in the past` (verify old bound không còn accepted)
  - `SUBMIT_ANSWER rejects clientTimestamp 6 minutes in the past` (boundary edge)
  - `SUBMIT_ANSWER rejects clientTimestamp 6 minutes in the future` (boundary edge)
  - `SUBMIT_ANSWER accepts clientTimestamp 4 minutes in the past` (within headroom)
  - `REQUEST_SNAPSHOT rejects lastSeenSeqNo above MAX_ROUNDS * 2` (new max=100)
  - `REQUEST_SNAPSHOT accepts lastSeenSeqNo at MAX_ROUNDS * 2` (boundary positive)

#### PR 6 — Drop redundant home gradient (apps/web/src/app/[locale]/page.tsx)

- [x] Drop `bg-gradient-to-br from-[#FFF0F5] via-[#E6E6FA] to-[#E0F2FE]` khỏi `<main>` className (line 193 cũ). `body` ở `globals.css:22` đã có cùng `linear-gradient(135deg, #fff0f5 0%, #e6e6fa 50%, #e0f2fe 100%)` (góc 135deg ≡ `to-br`), nên redundant.
- [x] Giữ `relative` (vẫn cần cho absolute positioning của floating emoji layer ở line 208).
- [x] **Không thay đổi** `globals.css:22` (gradient ở body vẫn giữ nguyên).
- [x] **Không thêm test** (visual change; manual smoke).

#### Verification (verify 2026-06-18)

- [x] `pnpm --filter @arena/api {typecheck,lint,test}` pass. **779/779** unit tests (was 772, +7 net: 1 cho L2 await error propagation + 6 cho L3 bound tightening).
- [x] `pnpm --filter @arena/web {tsc,build,lint,test}` pass. **31/31** web tests (không break).
- [x] `pnpm --filter @arena/game-core {typecheck,test}` pass. **70/70** game-core.
- [x] `pnpm --filter @arena/shared {typecheck,test}` pass. **3/3** shared.
- [x] **Coverage per-file ≥90%** cho 2 file production sửa (verify bằng `vitest --coverage`):
  - `game.gateway.ts` **100%** stmts / 93.1% branch / 100% funcs / 100% lines
  - `schemas.ts` **100%** stmts / 100% branch / 100% funcs / 100% lines
- [x] **Socket protocol không đổi**: không thêm event mới, không đổi payload shape, không bump version. Tighten validation chỉ là narrowing rejection (không additive).
- [x] **Shared types không đổi**: `packages/shared/src/types.ts` nguyên vẹn (chỉ chạm `schemas.ts` runtime validation).
- [x] **Prisma schema không đổi**.
- [x] Không thêm dependency mới.

#### GitNexus delta

- Plan claim: blast radius LOW cho cả 3 concern (verified qua `gitnexus_impact` upstream LOW, `gitnexus_detect_changes` 4 files changed + 8 symbols touched, scope confined đúng).
- Risk flag "critical" trong detect_changes là do `handleDisconnect` + `handleAuthenticate` xuất hiện trong nhiều execution flow (cross_community); không phải thực sự critical — chỉ là false positive vì minor refactor đụng hot path.

#### Out of scope (deferred sang PR riêng)

- **PR 3 (Admin Kill-Switch Append-Only Audit Event)** — promote lên P1 next. `AdminService.terminateRoom` (apps/api/src/modules/admin/admin.service.ts:250-410) vẫn mutate DB + Redis + timers + emit `ROOM_TERMINATED` nhưng KHÔNG ghi `EventLog` row. EventLog model tồn tại (`schema.prisma:194-207`) nhưng codebase **không bao giờ create** (chỉ `prisma.eventLog.deleteMany` trong `resetSystem:191`). Vi phạm `.github/instructions/review.instructions.md:36`. Scope: schema migration (thêm `roomId`, `adminUserId`, `reason` columns) + capture userId từ controller + append EventLog row. P1 next.
- **PR 4 (In-Match AFK Policy)** — chờ product decision (auto-`ELIMINATED` vs auto-`SPECTATOR`).
- **PR 5 (Optimistic UI Rollback đầy đủ)** — game feel, không block MVP.
- **PR 7 (Content Moderation + Message Sanitizer + Device Fingerprint)** — chờ shared profanity pipeline.
- **PR 8-12** (rematch, accessibility, k6 load, Playwright, `Room.maxPlayers` payload).

### ✅ Phase 14 — Admin Kill-Switch Append-Only Audit Event (`feat/admin-audit-event-log`, 2026-06-18) — In Progress

`AdminService` giờ ghi audit rows cho terminate/reset/sync, `AdminController` truyền `req.user.userId`, và `GET /admin/audit-events` đã có query DTO + pagination/filter. EventLog được mở rộng để lưu room/admin scope, audit rows được giữ lại qua reset.

#### Schema + service

- [x] `apps/api/prisma/schema.prisma` — `EventLog` thêm `roomId`, `adminUserId`; `matchId` nullable; `onDelete: SetNull`; indexes mới cho `roomId/adminUserId/eventType + createdAt`
- [x] `apps/api/prisma/migrations/20260618120000_admin_audit_event/migration.sql` — migration áp dụng thành công trên dev DB
- [x] `apps/api/src/modules/admin/admin.service.ts` — `appendAudit` best-effort helper + audit calls cho `terminateRoom`, `resetSystem`, `syncQuestions` + `getAuditEvents`
- [x] `apps/api/src/modules/admin/admin.controller.ts` — capture `req.user.userId` + `GET /admin/audit-events`

#### Tests + verification

- [x] `apps/api/src/modules/admin/admin.service.spec.ts` — 43 tests (thêm audit append/query coverage)
- [x] `apps/api/src/modules/admin/admin.controller.spec.ts` — 11 tests
- [x] `apps/api/src/modules/admin/dto/get-audit-events.dto.spec.ts` — 4 tests
- [x] `pnpm --filter @arena/api test` pass: **792/792** unit tests
- [x] `pnpm --filter @arena/api test:coverage` pass: `admin.controller.ts` **100%** stmts / **100%** branch / **100%** funcs / **100%** lines; `admin.service.ts` **100%** stmts / **96.43%** branch / **100%** funcs / **100%** lines

#### Notes

- Audit append is best-effort and never blocks admin actions
- Reset keeps audit rows queryable; it no longer purges `event_logs`
- `GET /admin/audit-events` is backend-only for now; no frontend panel in this PR

### ✅ Phase 11 — Drop-in Spectating Baseline (`feat/drop-in-spectating-baseline`, 2026-06-14) — Hoàn thành

Drop-in spectating cho phép late-joiner vào phòng `IN_GAME` hoặc `FINISHED` với tư cách `SPECTATOR` (read-only), tách biệt khỏi flow player và eliminated-spectator. Baseline reuse `room:[id]` channel + `MatchStateMachine.getSnapshot` (đã client-safe, không leak `correctAnswer`).

#### Contract baseline (Phase 1)

- [x] `packages/shared/src/socket.ts` — thêm `type JoinMode = "PLAYER" | "SPECTATOR"` + `joinedAs: JoinMode` trong `RoomJoinedPayload` + `RoomCreatedPayload` (spectator role ở transport layer, không phải `PlayerStatus` enum)
- [x] `packages/shared/src/socket.ts` — thêm `type JoinMode = "PLAYER" | "SPECTATOR"` + `joinedAs: JoinMode` vào `RoomJoinedPayload` + `RoomCreatedPayload`
- [x] `packages/shared/src/error-codes.ts` — thêm `SPECTATOR_CANNOT_ANSWER`; `index.ts` — thêm message VN
- [x] `pnpm --filter @arena/shared typecheck` pass

#### Backend join policy (Phase 2)

- [x] `apps/api/src/modules/room/room.service.ts:joinRoom` — 4-way matrix:
  - WAITING + new user → join as PLAYER (giữ flow cũ)
  - WAITING + existing user → no-op rejoin as PLAYER
  - IN_GAME/FINISHED + existing user (reconnect) → rejoin as PLAYER
  - IN_GAME/FINISHED + new user → join as SPECTATOR (no DB write, no playerCount bump)
  - COUNTDOWN/STARTING → reject `ROOM_ALREADY_STARTED`
- [x] `apps/api/src/gateways/handlers/room.handler.ts:handleJoinRoom` — spectator branch:
  - KHÔNG emit `PLAYER_JOINED` (tránh confuse player khác)
  - KHÔNG gọi `maybeStartPublicCountdown`
  - VẪN `client.join(\`room:${id}\`)` để nhận ROUND\_\* broadcasts
  - `ROOM_JOINED` payload include `joinedAs`
- [x] `room.service.spec.ts` — 29 tests (was 24, +5 new) — **98.25% stmts / 91.89% branch**
- [x] `room.handler.spec.ts` — 17 tests (was 15, +2 new: spectator branch + non-Error rejection) — **100% stmts / 90.47% branch**

#### Snapshot safety + submit gate (Phase 3)

- [x] `match.handler.ts:handleSubmitAnswer` — server-side gate: `stateMachine.getState().players.has(userId)` check, throw `SPECTATOR_CANNOT_ANSWER` nếu không phải player
- [x] `match.handler.ts:handleRequestSnapshot` — comment rõ allow-list cho spectator path; thêm regression test verify no `correctAnswer` leak
- [x] `match.handler.spec.ts` — 17 tests (was 15, +2 new: spectator reject + snapshot safety) — **100% stmts / 95.65% branch**

#### Frontend (Phase 4)

- [x] `socket-store.ts` — thêm `joinMode: JoinMode` vào `Room` interface; set từ `ROOM_JOINED.joinedAs` (default `PLAYER` cho backwards-compat)
- [x] `lobby/[roomCode]/page.tsx` — spectator banner + "Vào xem" (IN_GAME) / "Xem kết quả" (FINISHED) CTA + auto-redirect `/result/[matchId]` cho FINISHED + suppress `LobbyStartControls` + replace "Quick Tips" panel
- [x] `game/[matchId]/page.tsx` — `handleSelectAnswer` short-circuit khi `isSpectator`; render spectator banner + reuse Swords/Spectator block với i18n mới (`dropInSpectator.*` namespace)
- [x] `messages/{en,vi}.json` — thêm `lobby.spectator.*` + `Game.dropInSpectator.*` (8 keys mới)
- [x] `pnpm --filter @arena/web typecheck` + `pnpm --filter @arena/web lint` pass

#### Verification

- [x] 661/661 unit tests pass (full api suite)
- [x] Coverage per-file ≥90% gate đạt cho mọi file sửa:
  - `room.service.ts` 98.25% stmts / 91.89% branch
  - `room.handler.ts` 100% / 90.47%
  - `match.handler.ts` 100% / 95.65%
- [x] Server-authoritative gate verified: spectator client bypass attempt bị server reject
- [x] Snapshot safety regression: snapshot payload assert `.not.toHaveProperty("correctAnswer")`

#### Out of scope (deferred sang PR riêng)

- SSE channel riêng cho mass-spectator (PR 3 theo plan)
- In-match AFK policy (PR 2 theo plan) — vẫn pending product decision
- `GamePage` live opponents sidebar wiring (PR 4 theo plan) — hardcoded data vẫn còn
- `ResultPage` REST auth cho guest spectator (skip per user decision Phase 0)

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

1. **Admin Kill-Switch Audit Event** (P1, compliance) — promote lên top next. `AdminService.terminateRoom` mutate DB + Redis + timers + emit `ROOM_TERMINATED` nhưng KHÔNG ghi `EventLog` row. Vi phạm `review.instructions.md:36`. Cần schema migration (thêm `roomId`, `adminUserId`, `reason` columns) + capture userId từ controller (xem pattern `room.controller.ts:35`)
2. **In-match AFK policy** (P1, product) — pending product decision
   - Backend: round-miss detection tận dụng `Answer` table (current/previous round)
   - Quyết định: 2+ round miss → auto-`ELIMINATED` (loss-of-life) hoặc `SPECTATOR` (chill)
3. **Mass-spectator transport scaling** (P2, infra) — SSE channel riêng cho spectator
   - Baseline đã reuse `room:[id]` channel + `getSnapshot` cho late-joiner
   - Cần batched low-frequency updates + clear player vs spectator transport boundary
4. **Content moderation + message sanitizer + device fingerprint** (P2, compliance)
   - Shared profanity/content-moderation pipeline (plan.md §501)
   - `TerminateRoomDto.message` cho phép custom message
   - Backend enforce `guestId` Model C + IP/UA fingerprint
5. **Optimistic UI rollback** (P2, game feel) — hiện `game/[matchId]/page.tsx` đã có `selectedAnswer` + `roundCompleted` lock-in; thiếu idempotency key + rollback path khi server reject
6. **Post-match rematch + share** (P3, retention)
7. **Accessibility audit (WCAG)** (P2, compliance)
8. **k6 load test 100 concurrent WS** (P2, pre-launch gate) — xem Testing Roadmap bên dưới
9. **Playwright browser E2E (3-5 cases)** (P3) — deferred sau khi Design System ổn định

> **Drop-in spectating baseline done** (Phase 11, 2026-06-14). Xem section `Phase 11` ở trên để biết chi tiết.

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
- [ ] `SocketNamespace` chưa có SPECTATOR entry riêng (mass-spectator scaling, PR 3 ở `plan.md`)
- [ ] `packages/config` directory trống
- [x] **Design system Phase 5B đã đóng (2026-06-14)** — shell gradient đã bỏ ở `app-shell-layout.tsx:34` + mobile overlay ở `sidebar.tsx:230`; `styles/components.css` audit xác nhận 0 live references; visual closeout done
- [ ] **Admin kill-switch message sanitizer** — deferred tới khi profanity/content-moderation pipeline lands
- [ ] **Admin kill-switch append-only audit event** — `AdminService.terminateRoom` (`apps/api/src/modules/admin/admin.service.ts:250-362`) mutate DB (finishMatch + disbandRoom) + Redis + timers + emit `ROOM_TERMINATED` nhưng KHÔNG ghi `EventLog` row. Vi phạm `.github/instructions/review.instructions.md:36` + `memory-bank/codingGuidelines.md:247`. Cần: append immutable audit event (roomId, matchId, adminUserId, reason, timestamp) trước/song song với `disbandRoom`. Owner: TBD, ticket: TBD. **Promote lên P1 next PR sau Phase 13.**
- [ ] **Host kick player** — backend hook (`PlayerStatus.KICKED` đã có ở shared types) chưa wire vào room handler / admin endpoint
- [x] **Drop-in spectating** — ✅ Done 2026-06-14 trong PR `feat/drop-in-spectating-baseline`. Xem `Phase 11` section. Còn lại: mass-spectator transport scaling (PR kế tiếp)

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

## Architecture Assessment Scores (cập nhật 2026-06-18)

| Dimension                | Score      | Notes                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo Structure       | 10/10      | Turborepo + Remote Caching                                                                                                                                                                                                                                                                                                          |
| Package Boundaries       | 9/10       | Clean separation, đúng dependency flow                                                                                                                                                                                                                                                                                              |
| Domain Logic (game-core) | 9/10       | Có serialize/deserialize, immutability, persistence, deterministic tie-break                                                                                                                                                                                                                                                        |
| Backend Architecture     | 9/10       | Handlers rõ ràng; lobby/heartbeat baseline done; admin kill-switch baseline done; **race fixes (B1, B2, B3) landed 2026-06-14**                                                                                                                                                                                                     |
| Frontend Architecture    | 8.5/10     | Lobby/Game/Result done; spectator baseline (eliminated + drop-in) done; **F1-F8 correctness fixes landed 2026-06-14**; Profile/Rankings real                                                                                                                                                                                        |
| Infrastructure           | 8/10       | Docker + Redis + Throttler + CI/E2E; chưa có multi-instance adapter                                                                                                                                                                                                                                                                 |
| DevOps/CI-CD             | 10/10      | GitHub Actions pipeline configured; E2E job có cache strategy gọn + fail artifacts                                                                                                                                                                                                                                                  |
| Testing                  | 9.5/10     | 779 unit api + 70 game-core + 31 web + 11 E2E; coverage 100% stmts `game-loop.service.ts` / 100% `admin.service.ts` / 96.22% `match.service.ts` / 100% `match-state-machine.ts` / 100% `game.gateway.ts` / 100% `schemas.ts`; **+51 net tests for B1-B3 + 3 for F8 + post-merge B4-B7/L1 (~+8 test path) + 7 for L2/L3 (Phase 13)** |
| **Overall**              | **8.8/10** | Lobby/heartbeat/graceful-exit/admin kill-switch baseline + race fixes + frontend correctness + gateway/schema tightening all done                                                                                                                                                                                                   |

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

## What Works Now (verified 2026-06-18)

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
- 779/779 unit tests (api) + 70/70 unit tests (game-core) + 31/31 unit tests (web) + 3/3 unit tests (shared) + 11/11 E2E tests pass; API coverage 99.05% statements (verify 2026-06-18 sau PR `chore/gateway-schema-tightening-home-gradient` — game.gateway.ts 100%/93.1%, schemas.ts 100%/100% — sau khi rebuild `packages/shared/dist` cho `GAME_CONFIG.SCORE_*` constants)

## What's Next (Priority Order)

1. **PR tiếp theo — Admin Kill-Switch Audit Event** (P1, compliance — `AdminService.terminateRoom` chưa ghi `EventLog` row, vi phạm `review.instructions.md:36`)
2. **PR sau — In-match AFK policy** (P1, product — chờ product decision loại vs. chuyển spectator)
3. **PR sau — Mass-spectator transport scaling** (SSE channel riêng + batched updates) — xem `plan.md` PR 2
4. **PR sau — Content moderation + message sanitizer + device fingerprint**
5. **Optimistic UI rollback** (game feel, không block ship MVP)
6. **Post-match rematch + share** (retention)
7. **Playwright browser E2E** (deferred tới khi UI ổn định)
8. Cập nhật `PROJECT_STATUS.md` và `activeContext.md` cho khớp hiện trạng ✅ done trong lần này
