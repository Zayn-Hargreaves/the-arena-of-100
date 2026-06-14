# Plan: Next PR — Match Race + Frontend Correctness Hardening — ✅ MERGED 2026-06-14

> **Trạng thái (2026-06-14)**: PR `fix/match-race-frontend-correctness` đã merge.
> 3 bug backend (B1, B2, B3) + 8 bug frontend (F1-F8) đã sửa với 51 test mới (tổng 712 backend + 68 game-core + 31 web + 11 E2E), coverage per-file ≥90% cho 4 file production sửa. Xem `memory-bank/progress.md` section "Phase 12 — Match Race + Frontend Correctness Hardening" để có evidence đầy đủ.
> 3 bug backend (B1, B2, B3) + 8 bug frontend (F1-F8) đã xác nhận bằng đọc code + GitNexus impact.
>
> **Backend**:
>
> - **B1** (🔴) `finishMatchLoop` không có idempotency guard → admin terminate đua với timer `checkMatchEnd` có thể ghi 2 lần DB, phát 2 sự kiện kết thúc mâu thuẫn, winnerId non-deterministic.
> - **B2** (🔴) `finishMatchLoop:984` `state.winnerId!` — nếu cả `survivingPlayerIds` lẫn `eliminatedPlayerIds` đều rỗng, `tieBreak` trả `undefined` rồi DB ghi `winnerId: undefined`.
> - **B3** (🟡) `launchRoomMatch` re-fetch + `updateRoomStatus(STARTING)` **không có row lock** (khác với `joinRoom` đã dùng `SELECT ... FOR UPDATE`). Có thể tạo 2 match cho cùng 1 room khi auto-start + recovery chạy đồng thời.
>
> **Frontend**:
>
> - **F1** (🔴) `game/[matchId]/page.tsx:442-472` sidebar "opponents" hiển thị 5 mock cứng (Zero_Cool, Acid_Burn, Lord_Nikon…) suốt trận, không đọc `match.players` thật.
> - **F2** (🔴) `game/[matchId]/page.tsx:153` magic number `newCount <= 12` redirect sang `/result` — client tự kết thúc trận, **phá vỡ server-authoritative** (server end khi `survivingPlayerIds <= 1` hoặc chạm `MAX_ROUNDS`).
> - **F3** (🔴) `game/[matchId]/page.tsx:146-164` nested `setTimeout` cùng ghi `timerRef.current` → 2 timer ghi đè lẫn nhau, `clearTimers` chỉ giữ 1 ref, race + leak khi component re-render giữa chừng.
> - **F4** (🟡) `game/[matchId]/page.tsx:369` mẫu số `/ 100` hardcode, tử số fallback `?? 100` → hiển thị "100 / 100" lúc chưa có data, không phản ánh `maxPlayers` thật.
> - **F5** (🟡) `game/[matchId]/page.tsx:282-288` fallback question/options hardcoded (`apps/api (NestJS)…`) hiện trong UI thật khi hydrate trễ.
> - **F6** (🟡) `game/[matchId]/page.tsx:247` `currentRoundNo || 1` gửi giá trị có thể sai (server đã chống, nhưng dead data trên wire).
> - **F7** (🟡) Round-end suy từ `lastAnswerResult?.correctAnswer` ở cả store (`socket-store.ts:515-544`) và page (`game page:140`) — nếu `correctAnswer` rỗng/falsy, client **kẹt trạng thái** không bao giờ vào `roundCompleted`.
> - **F8** (🟡) `use-lobby-lifecycle.ts:26-57` auto-join effect phụ thuộc `room` (object thay đổi mỗi `PLAYER_JOINED`/presence) → re-run liên tục, `cancelled` chỉ chặn setState, **không chặn emit `JOIN_ROOM` thứ 2**.
>
> Updated 2026-06-14 from source review of:
>
> - Backend: `apps/api/src/modules/match/{match,game-loop,presence}.service.ts`, `apps/api/src/modules/room/room.service.ts`, `apps/api/src/modules/admin/admin.service.ts`, `apps/api/src/gateways/handlers/{match,room,auth}.handler.ts`, `apps/api/src/gateways/game.gateway.ts`, `packages/game-core/src/match-state-machine.ts`
> - Frontend: `apps/web/src/stores/socket-store.ts`, `apps/web/src/app/[locale]/game/[matchId]/page.tsx`, `apps/web/src/hooks/use-lobby-lifecycle.ts`, `apps/web/src/app/[locale]/lobby/[roomCode]/page.tsx`
> - Docs: `memory-bank/progress.md`, `memory-bank/activeContext.md`
>
> Plan này là **plan gộp duy nhất** — backend B1-B3 + frontend F1-F8 trong 1 PR, vì user xác nhận muốn sửa 1 thể. Bám theo format plan cũ (PR Snapshot, Tracking Board, Reality Check, GitNexus Context, Hard Constraints, Success Criteria, Out Of Scope, phases, Definition Of Done, Explicit Deferrals). Phases được group theo concern: backend xong trước, frontend 🔴 tiếp, frontend 🟡 cuối.

## PR Snapshot

- PR name: `Match Race + Frontend Correctness Hardening` — **READY TO EXECUTE**
- Primary goal: chống 3 race backend (B1, B2, B3) + sửa 8 bug frontend (F1-F8) trong cùng 1 PR, giữ server-authoritative guarantee + phá bỏ mock data + fix timer/race trên UI
- Branch: `fix/match-race-frontend-correctness` (đề xuất)
- Execution: 7 phases sequential (3 backend, 1 frontend 🔴, 1 frontend 🟡, 1 test sweep, 1 docs)
- Coverage gate: backend per-file ≥90% ; frontend build/lint/typecheck pass + vitest (nếu có)
- GitNexus: blast radius đã đánh giá cho cả backend (3 file production) và frontend (3-4 file production)
- Ảnh hưởng: 7 production files sửa (3 backend + 4 frontend), 4 test files, 3 docs files. **Không đụng shared types, không đụng socket event shape, không đụng Prisma schema.**

## Tracking Board

- [x] Phase 0 complete: truth sync and scope lock
- [x] Phase 1 complete: B1 — `finishMatchLoop` idempotency guard
- [x] Phase 2 complete: B2 — `winnerId` null guard
- [x] Phase 3 complete: B3 — `launchRoomMatch` atomic guard
- [x] Phase 4 complete: Frontend 🔴 — F1 (sidebar real data) + F2 (bỏ magic number) + F3 (timer leak fix)
- [x] Phase 5 complete: Frontend 🟡 — F4 (dynamic maxPlayers) + F5 (loading state) + F6 (bỏ currentRoundNo || 1) + F7 (round-end signal rõ) + F8 (auto-join guard)
- [x] Phase 6 complete: regression test sweep + coverage gate
- [x] Phase 7 complete: docs sync + PR description
- [x] PR ready for review
- [x] PR merged

## Reality Check

Code đã verified, bug đã reproduce bằng reasoning. PR này **không** đụng vào những thứ đã xong:

- Core gameplay loop (`startMatchLoop` → `executeCountdown` → `executeRound` → `endRound` → `checkMatchEnd`)
- `endRound` idempotency (`endingRounds` Set) — pattern sẽ được reuse cho B1
- Lobby lifecycle contract + backend orchestration
- Heartbeat/presence sweep baseline
- Drop-in spectating baseline (`joinRoom` 4-way matrix, `handleSubmitAnswer` server gate)
- Admin kill-switch baseline (`terminateRoom` defensive orchestrator)
- `MatchService.finishMatch` transaction (đã atomic ở M4/H2)
- `MatchStateMachine.serialize/deserialize` + L3 correctAnswer re-attach
- `RoomService.joinRoom` `SELECT ... FOR UPDATE` pattern (B3 sẽ reuse cùng pattern)
- `useTranslations` setup trên lobby/game page
- Heartbeat cleanup pattern ở `socket-store.ts:236-244`
- `terminationNotifiedRef` / `snapshotHydratedRef` / `finishedRedirectedRef` strict-mode guards

## Why This PR Next

Chọn PR gộp vì:

- 3 bug backend 🔴 + 3 bug frontend 🔴 có blast radius thẳng vào kết quả game và UI correctness — pre-launch blocker nếu trigger
- F2 (magic number) **phá vỡ server-authoritative guarantee** mà backend vừa bảo vệ bằng B1/B2 — land cùng nhau cho nhất quán
- F1 (mock sidebar) là deception thật đối với user, không phải polish
- F3 (timer leak) chỉ xảy ra ở edge case strict-mode/reconnect, đáng fix cùng
- 8 bug frontend 🟡 đã chờ lâu (memory-bank đã list), gộp tránh nợ kỹ thuật kéo dài
- Scope dù lớn nhưng khu trú (7 production files), pattern đã có sẵn, dễ review theo phase

Bằng chứng từ docs + code:

- `memory-bank/progress.md` liệt kê "Admin kill-switch append-only audit event" + "in-match AFK policy" + "k6 load test 100 concurrent WS" là các gap lớn — bug fix này nên done trước khi load test
- `apps/api/src/modules/match/game-loop.service.ts:962` `finishMatchLoop` không có guard giống `endingRounds:38,788,1158` — inconsistency nội tại
- `apps/api/src/modules/match/game-loop.service.ts:984` `state.winnerId!` — non-null assertion che null path
- `apps/api/src/modules/match/game-loop.service.ts:466-475` `launchRoomMatch` không có `tx.$queryRaw FOR UPDATE` như `room.service.ts:175-182`
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx:153` `newCount <= 12` không khớp `match.state-machine.ts:323 shouldEndMatch` (server dùng `<= 1` + `MAX_ROUNDS`)
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx:442-472` hardcoded 5 mock name — Memory-bank PR 2 đã chốt deferred, nhưng bây giờ quyết định fix
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx:146-164` nested `setTimeout` ghi đè cùng `timerRef.current`

## GitNexus Context

GitNexus findings đã dùng để shape plan này:

**Backend:**

- `MatchService.finishMatch` upstream impact: **MEDIUM** (4 direct callers: `GameLoopService.finishMatchLoop`, `AdminService.terminateRoom`, `match.service.spec.ts`, E2E setup)
- `GameLoopService.launchRoomMatch` upstream impact: **MEDIUM** (3 direct callers: `maybeStartPublicCountdown` timer, `forceStartRoomMatch` host, `onModuleInit` recovery)
- `GameLoopService.finishMatchLoop` upstream impact: **LOW** (2 callers: `checkMatchEnd` self-call, `executeRound` error path)
- `MatchStateMachine.determineWinner` → `tieBreak` upstream impact: **LOW**

**Frontend:**

- `socket-store.ts` upstream impact: **CRITICAL** (consumed by 8 pages, 4 hooks) → mọi sửa phải giữ shape cũ
- `game/[matchId]/page.tsx` upstream impact: **LOW** (route-level)
- `use-lobby-lifecycle.ts` upstream impact: **LOW** (chỉ `lobby/[roomCode]/page.tsx`)

Blast radius:

- B1: thêm `finishingMatches: Set<string>` + 1 public method → chỉ `finishMatchLoop` + `terminateRoom` đọc
- B2: null guard trong `determineWinner` + assertion rõ trong `finishMatchLoop` → pure logic
- B3: thêm `SELECT ... FOR UPDATE` ở `launchRoomMatch` → atomic guard
- F1: consume `match.players` thật + cập nhật `player.status` qua `PLAYER_ELIMINATED` → tăng nhẹ store payload
- F2: bỏ `<= 12` branch, tin `MATCH_FINISHED` → không đổi state, chỉ xoá code
- F3: tách 2 timer ref → không đổi behavior cuối, chỉ chống leak
- F4: render `maxPlayers` từ `room.maxPlayers ?? match.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS` → pure UI
- F5: loading skeleton khi `!currentQuestion` → không đổi logic
- F6: bỏ `currentRoundNo || 1`, gửi `currentRoundNo` thật → không đổi wire (server đã chống)
- F7: dùng `data.matchId + data.roundNo` từ `ROUND_ENDED` (state machine đã có), không phụ thuộc `correctAnswer`
- F8: ref `joinInFlight` chống double-emit → chỉ thêm guard, không đổi happy path

## Locked Decisions (2026-06-14)

**Backend:**

- **B1 pattern**: thêm `private finishingMatches = new Set<string>()` ở `GameLoopService`, mirror `endingRounds` pattern. Guard đầu `finishMatchLoop:962` với try/finally. Expose public `isMatchFinishing(matchId)`. `AdminService.terminateRoom:258-274` check guard trước khi gọi `matchService.finishMatch` — nếu đã finishing, **abort toàn bộ kill-switch** (tránh partial state), trả `{ success: false, reason: "ALREADY_FINISHING" }`.
- **B2 pattern**: `tieBreak([])` early return `null`. `determineWinner` xử lý empty-roster → `null`. `finishMatch` skip set `winner.status = WINNER` khi null. `finishMatchLoop:984` đổi `state.winnerId!` → `state.winnerId ?? null` (explicit conversion), `winnerId` local var type `string | null`. Khi null: log warn với matchId + roomId, gọi `matchService.finishMatch(matchId, null, roomId)`, emit `MATCH_FINISHED.winnerId: null` (frontend đã xử lý nullable từ trước).
- **B3 pattern**: `launchRoomMatch` mở `prisma.$transaction` với `SELECT ... FOR UPDATE` (cùng pattern `joinRoom:175-182`), trong transaction check `status IN (WAITING, COUNTDOWN)` + `currentMatchId IS NULL`. Nếu pass → `createMatch` (giữ ngoài transaction để tránh nested) → update `Room.currentMatchId` trong transaction. Nếu fail trước khi createMatch → throw `ROOM_ALREADY_STARTED`, rollback. Cleanup: nếu `createMatch` throw sau khi transaction commit, try/catch delete Match row.

**Frontend:**

- **F1 pattern**: chọn option (b) — thêm tracking alive/eliminated per round. Store consume `PLAYER_ELIMINATED` payload (`{matchId, roundNo, playerId, playerName, reason}`) để set `player.status = "ELIMINATED"` trong `match.players` map. Đồng thời từ `ROUND_ENDED.eliminatedPlayerIds` cross-check. `GamePage` render `match.players` thật, sort alive trước, hiển thị badge OK/ELIMINATED. Bỏ hoàn toàn 5 mock name.
- **F2 pattern**: bỏ hẳn logic `newCount <= 12` redirect. Client chỉ redirect khi `match.status === "FINISHED"` (effect ở dòng 218-226 đã có sẵn, đúng). Effect ở dòng 138-173 chỉ xử lý local UI (clearTimers + reset local state), **không** push router. Comment rõ "server-authoritative match end".
- **F3 pattern**: tách 2 timer ref (`roundResultRevealRef` cho 1s reveal, `roundResultContinueRef` cho 3s transition), hoặc gom thành 1 helper `runRoundResultSequence` cleanup sạch. Chọn tách 2 ref vì đã có pattern `timerRef`/`intervalRef` ở component. Thêm cleanup đầy đủ trong cả 2 effect.
- **F4 pattern**: `const maxPlayers = room?.maxPlayers ?? match?.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS;` (cần import `GAME_CONFIG`). Hiển thị `remainingCount ?? match?.players?.length ?? 0` thay vì `?? 100`. Tránh con số giả.
- **F5 pattern**: khi `!match?.currentQuestion` → render `<div className="animate-pulse">{t("loadingQuestion")}</div>` thay vì fallback question hardcoded. Thêm i18n key `Game.loadingQuestion`.
- **F6 pattern**: bỏ `currentRoundNo || 1`, gửi `match.currentRoundNo` thật (kể cả khi 0/undefined thì gửi null/undefined để backend reject rõ ràng hơn là silent coerce). Hoặc đơn giản hơn: chỉ emit nếu `match.currentRoundNo > 0`.
- **F7 pattern**: thêm derived state rõ ràng trong store — `match.roundEndTime` đã được set null khi nhận `ROUND_ENDED`. Dùng `match.roundEndTime === null && match.currentQuestion === null` làm tín hiệu "round ended" ở page. Bỏ phụ thuộc `lastAnswerResult?.correctAnswer`. Effect ở dòng 138 dùng tín hiệu mới.
- **F8 pattern**: thêm `const joinInFlightRef = useRef(false)` ở `use-lobby-lifecycle`. Set true trước `await joinRoom`, false trong finally. Effect early-return nếu `joinInFlightRef.current === true` (dù `room.code !== roomCode`). Tránh double-emit khi re-run do presence/player_joined event.

**Cross-cutting:**

- Không thay đổi socket event shape, không thêm event mới, không bump version protocol
- Không thay đổi shared types (`packages/shared/src/**`)
- Không đụng Prisma schema
- Coverage gate per-file ≥90% cho backend; frontend build/lint/typecheck pass + (nếu có vitest cho web) pass
- `apps/web` đã có vitest infrastructure (memory-bank mention 28 tests ở shell) — chạy `pnpm --filter @arena/web test` nếu có

## Hard Constraints For 256k-Token Agents

- One phase at a time
- Do not read the whole repo when a phase names a bounded read set
- Hard cap per implementation phase: 1 to 3 production files
- Hard cap per verification phase: 0 to 2 docs files
- Do not touch `packages/shared/**`
- Do not change socket event names/payload shape
- Do not change Zod schemas
- Do not introduce new dependencies
- Do not refactor unrelated code
- Backend phases: chỉ chạm `apps/api/src/modules/match/**`, `apps/api/src/modules/admin/admin.service.ts`, `packages/game-core/src/match-state-machine.ts`
- Frontend phases: chỉ chạm `apps/web/src/**`
- Không đụng `apps/api/src/gateways/**` (handlers + gateway) trong phase nào
- Không đụng `apps/api/src/modules/room/room.service.ts` (đã chốt, không liên quan)
- Không đụng `apps/api/src/modules/question/**`, `apps/api/src/modules/users/**`, `apps/api/src/modules/rankings/**`
- Không đụng `apps/web/src/app/[locale]/lobby/**` (ngoại trừ `use-lobby-lifecycle.ts` cho F8)
- Không đụng `apps/web/src/app/[locale]/result/**`, `apps/web/src/app/[locale]/profile/**`, `apps/web/src/app/[locale]/rankings/**`, `apps/web/src/app/[locale]/admin/**`, `apps/web/src/app/[locale]/room/create/**`, `apps/web/src/app/[locale]/settings/**`, `apps/web/src/app/[locale]/page.tsx`
- Không đụng `apps/web/src/components/**` (chỉ fix bug trong page + store + hook)
- Nếu phase cần đụng file ngoài allow-list, stop và split thành PR phụ
- If a phase requires touching frontend, stop and split into a later PR (cho backend phases)
- If a phase requires touching backend, stop and split into a later PR (cho frontend phases)

## PR Success Criteria

**Backend:**

- B1: hai đường finish (timer + admin) không thể ghi DB cùng matchId hai lần
- B1: hai đường finish không thể phát `MATCH_FINISHED` + `ROOM_TERMINATED` cùng lúc với cùng payload mâu thuẫn
- B2: nếu match kết thúc không resolve được winner, DB `winnerId = null` thay vì `undefined`, log warn có matchId + roomId
- B3: hai đường launch (timer + recovery) không thể tạo 2 match cho cùng room
- B3: nếu launch race thất bại, lỗi trả về qua error path đã có (`ROOM_ALREADY_STARTED`), không để lại orphan match

**Frontend:**

- F1: sidebar "opponents" render `match.players` thật, sort alive trước, badge OK/ELIMINATED từ store
- F1: page không còn 5 mock name cứng
- F2: client không tự redirect sang `/result` khi `remainingCount === 12`
- F2: client chỉ redirect khi server phát `MATCH_FINISHED` (đã có effect, dùng đúng)
- F3: timer `roundResultRevealRef` và `roundResultContinueRef` tách biệt, cleanup đầy đủ
- F3: không còn nested `setTimeout` ghi đè cùng ref
- F4: mẫu số hiển thị `maxPlayers` thật từ `room.maxPlayers` (fallback `GAME_CONFIG.MAX_PLAYERS`)
- F4: tử số không fallback về `100` cứng
- F5: khi `!currentQuestion` hiện loading state, không hiện fallback question lập trình
- F6: không còn `currentRoundNo || 1`, gửi giá trị thật (hoặc skip emit nếu invalid)
- F7: round-end signal dùng `match.roundEndTime === null && match.currentQuestion === null`, không phụ thuộc `correctAnswer`
- F8: auto-join lobby chống double-emit qua `joinInFlightRef`

**Cross-cutting:**

- Server-authoritative guarantee giữ nguyên
- Socket protocol không thay đổi (event names, payload shape)
- 661+ unit tests hiện tại vẫn pass
- Coverage per-file ≥90% cho mỗi file backend sửa
- `pnpm --filter @arena/api {typecheck,lint,test}` pass
- `pnpm --filter @arena/web {build,lint,typecheck,test}` pass
- Regression test mới cho B1, B2, B3; F1 (sidebar real data), F2 (bỏ redirect magic number), F3 (timer leak), F8 (double-emit guard)

## Out Of Scope

- In-match AFK policy
- Mass-spectator transport scaling
- Content moderation + admin kill-switch message sanitizer
- Optimistic answer rollback (chỉ F6 đơn giản, không phải rollback đầy đủ)
- Home page shell gradient cleanup
- `GamePage` UI tổng thể redesign (chỉ fix sidebar + timer + redirect + loading)
- `apps/web/src/components/**` refactor
- `apps/web/src/app/[locale]/lobby/**` ngoài `use-lobby-lifecycle.ts` (F8 chỉ chạm hook)
- `apps/web/src/app/[locale]/result/**` page
- Post-match rematch + share
- Accessibility audit (WCAG)
- k6 load test 100 concurrent WS
- Playwright browser E2E
- Multi-instance Socket.io adapter
- Auto-spectate khi in-match AFK (chờ product decision)
- Audit event log append-only cho `terminateRoom`
- i18n key mới ngoài `Game.loadingQuestion` (F5)
- Tăng scope race fix vào các method khác (`endRound`, `checkEarlyTermination` — đã có `endingRounds` guard rồi)

## Phase 0: Baseline And Scope Lock

### Goal

Freeze scope trước khi đụng vào orchestration path + UI critical page.

### Suggested agent window

- Target context size: under 20k tokens
- Suggested agent: `explore` hoặc `backend-specialist` (cho backend) + `frontend-specialist` (cho frontend)

### Read Set

- `plan.md` (file này)
- `memory-bank/progress.md`
- `memory-bank/activeContext.md`

**Backend subset:**

- `apps/api/src/modules/match/game-loop.service.ts` (line 38, 780-930, 962-1014)
- `apps/api/src/modules/match/match.service.ts` (line 238-297)
- `apps/api/src/modules/admin/admin.service.ts` (line 250-377)
- `apps/api/src/modules/room/room.service.ts` (line 169-260 — `joinRoom` `FOR UPDATE` pattern)

**Frontend subset:**

- `apps/web/src/stores/socket-store.ts` (line 232-260 disconnect/reconnect, 453-490 match lifecycle, 515-555 round-end)
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (line 56-77 timer refs, 138-173 round-completed effect, 235-249 selectAnswer, 262-288 fallback question, 369 maxPlayers, 442-472 hardcoded sidebar)
- `apps/web/src/hooks/use-lobby-lifecycle.ts` (line 26-57 auto-join)

### Required Checks

- [ ] Xác nhận B1, B2, B3 vẫn reproducible theo reasoning
- [ ] Xác nhận F1, F2, F3, F4, F5, F6, F7, F8 vẫn reproducible
- [ ] Xác nhận `endRound` không bị ảnh hưởng bởi phase này (giữ nguyên `endingRounds` pattern)
- [ ] Xác nhận không cần đụng `packages/shared`
- [ ] Xác nhận không cần thay đổi socket protocol
- [ ] Xác nhận không cần thay đổi Prisma schema
- [ ] Xác nhận `GAME_CONFIG.MAX_PLAYERS` đã export từ `@arena/shared` (cho F4)
- [ ] Xác nhận `apps/web` có vitest setup (cho F3, F8 nếu thêm test)

### Deliverables

- Scope note ngắn trong PR description draft
- Final list of files allowed for this PR
- Final list of files explicitly forbidden for this PR

### Allowed Files After Phase 0

**Backend production:**

- `apps/api/src/modules/match/game-loop.service.ts` (B1, B2, B3)
- `apps/api/src/modules/match/match.service.ts` (B1, B3)
- `apps/api/src/modules/admin/admin.service.ts` (B1)
- `packages/game-core/src/match-state-machine.ts` (B2)

**Backend tests:**

- `apps/api/src/modules/match/game-loop.service.spec.ts` (extend)
- `apps/api/src/modules/admin/admin.service.spec.ts` (extend)
- `packages/game-core/src/match-state-machine.spec.ts` (extend)

**Frontend production:**

- `apps/web/src/stores/socket-store.ts` (F1, F7)
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (F1, F2, F3, F4, F5, F6, F7)
- `apps/web/src/hooks/use-lobby-lifecycle.ts` (F8)

**Frontend tests (nếu vitest cho web có sẵn):**

- `apps/web/src/app/[locale]/game/[matchId]/page.spec.tsx` (extend hoặc tạo mới — F1, F2, F3, F7)
- `apps/web/src/hooks/use-lobby-lifecycle.spec.ts` (extend hoặc tạo mới — F8)

**Docs:**

- `memory-bank/progress.md`
- `memory-bank/activeContext.md`

### Stop Conditions

- Nếu B1 cần đụng `MatchService.finishMatch` API surface (parameter mới) → split thành PR phụ
- Nếu B3 cần thay đổi Prisma schema → split thành PR phụ
- Nếu B2 cần thay đổi wire shape của `MATCH_FINISHED` → split thành PR phụ (kỳ vọng không cần vì `winnerId: string | null` đã có)
- Nếu F1 cần thêm field mới vào `Player` interface shared → split thành PR phụ
- Nếu F4 cần thêm `maxPlayers` field vào `Match` payload → split thành PR phụ (dùng `room.maxPlayers` thay thế)

## Phase 1: B1 — `finishMatchLoop` Idempotency Guard

### Goal

Ngăn 2 đường (`checkMatchEnd` timer + `AdminService.terminateRoom`) cùng ghi DB / cùng emit event cho cùng matchId.

### Why Separate

Race có blast radius lớn nhất, pattern đã có sẵn (`endingRounds`), land trước để có confidence cho B2, B3.

### Suggested agent window

- Target context size: under 25k tokens
- Suggested agent: `backend-specialist`

### Read Set

- `apps/api/src/modules/match/game-loop.service.ts` (line 38, 780-930, 962-1014)
- `apps/api/src/modules/match/match.service.ts` (line 238-297)
- `apps/api/src/modules/admin/admin.service.ts` (line 250-377)
- `apps/api/src/modules/match/game-loop.service.spec.ts` (line 1-200)

### Instructions

- Thêm `private finishingMatches = new Set<string>() = new Set()` ở `GameLoopService` ngay sau `endingRounds` (line 38).
- Sửa `finishMatchLoop:962`: guard đầu hàm `if (this.finishingMatches.has(matchId)) { this.logger.warn(...); return; }` rồi `try { this.finishingMatches.add(matchId); ... } finally { this.finishingMatches.delete(matchId); }`.
- Expose public method `GameLoopService.isMatchFinishing(matchId: string): boolean`.
- Sửa `AdminService.terminateRoom:258-274`: trước khi gọi `matchService.finishMatch`, check `if (this.gameLoopService.isMatchFinishing(matchId))` → log info, **abort toàn bộ kill-switch** (return sớm), trả `{ success: false, partial: false, reason: "ALREADY_FINISHING", roomId, matchId }`.
- Thêm test `game-loop.service.spec.ts`: "finishMatchLoop called twice for same matchId — second call is a no-op" (mock `matchService.finishMatch` đếm số lần gọi).
- Thêm test `admin.service.spec.ts`: "terminateRoom called while match is finishing — early abort" (mock `gameLoopService.isMatchFinishing` return true).

### Target Files

- `apps/api/src/modules/match/game-loop.service.ts` (production)
- `apps/api/src/modules/admin/admin.service.ts` (production)
- `apps/api/src/modules/match/game-loop.service.spec.ts` (test)
- `apps/api/src/modules/admin/admin.service.spec.ts` (test)

### Tracking

- [ ] `finishingMatches` Set thêm vào `GameLoopService` ngay sau `endingRounds`
- [ ] `finishMatchLoop` guard bằng Set với try/finally
- [ ] `GameLoopService.isMatchFinishing` public method
- [ ] `AdminService.terminateRoom` check guard, abort toàn bộ kill-switch
- [ ] Test double-finish race: pass
- [ ] Test admin × finishing overlap: pass
- [ ] Không thay đổi socket event
- [ ] Không thay đổi `matchService.finishMatch` signature

### Verify

- `pnpm --filter @arena/api typecheck`
- `pnpm --filter @arena/game-core test --run`
- `pnpm --filter @arena/api test --run game-loop.service.spec.ts admin.service.spec.ts`
- Coverage per-file ≥90% cho 2 file production sửa

## Phase 2: B2 — `winnerId` Null Guard ở State Machine

### Goal

Đảm bảo nếu `determineWinner` không resolve được winner (cả 2 mảng rỗng), `state.winnerId` set `null` thay vì `undefined`, và `finishMatchLoop` xử lý path này rõ ràng.

### Why Separate

B2 thuộc pure logic (`@arena/game-core`), không phụ thuộc B1 hay B3.

### Suggested agent window

- Target context size: under 20k tokens
- Suggested agent: `backend-specialist`

### Read Set

- `packages/game-core/src/match-state-machine.ts` (line 322-346, 427-443, 486-491)
- `packages/game-core/src/match-state-machine.spec.ts` (line 1-200)
- `apps/api/src/modules/match/game-loop.service.ts` (line 962-1014, focus 984)

### Instructions

- Sửa `MatchStateMachine.tieBreak:349`: thêm early return `if (playerIds.length === 0) return null;` ngay đầu hàm.
- Sửa `MatchStateMachine.determineWinner:331`: nếu `survivors.length === 0` và `eliminatedPlayerIds.length === 0` → trả `null`. Giữ nguyên còn lại.
- Sửa `MatchStateMachine.finishMatch:427`: nếu `winnerId === null` → skip `winner.status = WINNER`, log warn, set `state.winnerId = null`.
- Sửa `apps/api/src/modules/match/game-loop.service.ts:984`: thay `state.winnerId!` bằng `state.winnerId ?? null`. Sửa `winnerId` local type thành `string | null`. Nếu null → log warn, vẫn gọi `matchService.finishMatch(matchId, null, roomId)`. `MATCH_FINISHED` event phát `winnerId: null` (frontend đã handle).
- Thêm test `match-state-machine.spec.ts`: "tieBreak with empty playerIds returns null", "determineWinner with both arrays empty returns null", "finishMatch with no winner sets state.winnerId to null and skips winner.status = WINNER".
- Thêm test `game-loop.service.spec.ts`: "finishMatchLoop handles null winnerId (emits MATCH_FINISHED with winnerId: null)".

### Target Files

- `packages/game-core/src/match-state-machine.ts` (production)
- `apps/api/src/modules/match/game-loop.service.ts` (production, line 984)
- `packages/game-core/src/match-state-machine.spec.ts` (test)
- `apps/api/src/modules/match/game-loop.service.spec.ts` (test)

### Tracking

- [ ] `tieBreak([])` trả `null`
- [ ] `determineWinner` xử lý empty-roster → `null`
- [ ] `finishMatch` không crash khi `winnerId === null`
- [ ] `finishMatchLoop` emit `MATCH_FINISHED.winnerId: null` thay vì undefined
- [ ] Test empty-roster path: pass
- [ ] Không thay đổi `MATCH_FINISHED` event shape
- [ ] Không thay đổi shared types

### Verify

- `pnpm --filter @arena/api typecheck`
- `pnpm --filter @arena/game-core test --run`
- `pnpm --filter @arena/api test --run game-loop.service.spec.ts`
- Coverage `match-state-machine.ts` ≥90%

## Phase 3: B3 — `launchRoomMatch` Atomic Guard

### Goal

Đóng race window giữa `getRoom` (line 467) và `updateRoomStatus` (line 475) bằng `SELECT ... FOR UPDATE` trong transaction (cùng pattern `joinRoom:175-182`), thêm check `currentMatchId IS NULL` atomic.

### Why Separate

B3 là cross-method refactor (launchRoomMatch + createMatch) khác với B1/B2, cần impact analysis kỹ nhất. Land cuối backend vì tốn context nhất.

### Suggested agent window

- Target context size: under 30k tokens
- Suggested agent: `backend-specialist`

### Read Set

- `apps/api/src/modules/match/game-loop.service.ts` (line 416-505, 1130-1190)
- `apps/api/src/modules/match/match.service.ts` (line 29-100 — `createMatch`)
- `apps/api/src/modules/room/room.service.ts` (line 169-260 — `joinRoom` `FOR UPDATE` reference)
- `apps/api/src/modules/match/game-loop.service.spec.ts` (line 200-end)

### Instructions

- Trong `launchRoomMatch:421`, **trước** re-fetch lần 2 (line 467), mở `prisma.$transaction` với `tx.$queryRaw\`SELECT id, status, "currentMatchId" FROM "Room" WHERE id = ${roomId} FOR UPDATE\``.
- Nếu `status` không phải `WAITING`/`COUNTDOWN` hoặc `currentMatchId IS NOT NULL` → throw `RoomError(ROOM_ALREADY_STARTED)`, rollback tự động.
- Gọi `matchService.createMatch(roomId)` (giữ ngoài transaction, vì `createMatch` đã có internal transaction cho MatchPlayer.createMany).
- Trong transaction: update `Room.currentMatchId = match.id` + `Room.status = STARTING`.
- Cleanup: nếu `createMatch` throw sau khi transaction commit → try/catch `prisma.match.delete` + revert room status → WAITING.
- Nếu `createMatch` throw **trước** khi commit (race fail sớm) → throw, transaction rollback tự động.
- Thêm test: "launchRoomMatch with already-set currentMatchId throws ROOM_ALREADY_STARTED" (mock 2 concurrent launchRoomMatch).

### Target Files

- `apps/api/src/modules/match/game-loop.service.ts` (production, line 416-505)
- `apps/api/src/modules/match/game-loop.service.spec.ts` (test)

### Tracking

- [ ] `launchRoomMatch` dùng `tx.$queryRaw FOR UPDATE` ngay trước khi gọi `createMatch`
- [ ] Check `currentMatchId IS NULL` atomic trong transaction
- [ ] Nếu race thất bại, throw `RoomError(ROOM_ALREADY_STARTED)` (không tạo orphan Match)
- [ ] Cleanup path: nếu `createMatch` throw sau commit, try/catch delete Match row
- [ ] Test double-launch race: pass
- [ ] Không thay đổi `MATCH_STARTING` event shape
- [ ] Không thay đổi `MatchService.createMatch` signature

### Verify

- `pnpm --filter @arena/api typecheck`
- `pnpm --filter @arena/api test --run game-loop.service.spec.ts`
- Coverage `game-loop.service.ts` vẫn ≥90% (sau 3 phases chồng)

## Phase 4: Frontend 🔴 — F1 + F2 + F3

### Goal

Sửa 3 bug frontend nghiêm trọng nhất:

- **F1**: sidebar "opponents" hiển thị dữ liệu thật thay vì mock
- **F2**: bỏ magic number `newCount <= 12` redirect, chỉ tin `MATCH_FINISHED`
- **F3**: tách nested `setTimeout` để fix leak/race

### Why Separate

Cả 3 đều 🔴, đều ở `game/[matchId]/page.tsx` (F1 cần thêm chỉnh store). Gộp để 1 PR 1 concern về page này.

### Suggested agent window

- Target context size: under 35k tokens
- Suggested agent: `frontend-specialist`

### Read Set

- `apps/web/src/stores/socket-store.ts` (line 453-490 match lifecycle, 515-555 round-end, 546-555 PLAYER_ELIMINATED)
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (full file 573 lines)
- `packages/shared/src/state.ts` (line PlayerInfo, PlayerStatus enum)

### Instructions

**F1 — Sidebar real data:**

- Sửa `socket-store.ts:546-555` PLAYER_ELIMINATED handler: ngoài set `isEliminated` cho current user, cập nhật `state.match.players` map → set `player.status = "ELIMINATED"` cho playerId tương ứng. Dùng `set((state) => ({...}))` immutable update.
- Sửa `socket-store.ts:515-544` ROUND_ENDED handler: cross-check `data.eliminatedPlayerIds` và set `status = "ELIMINATED"` cho từng player trong `match.players`.
- Sửa `apps/web/src/app/[locale]/game/[matchId]/page.tsx:442-518`: thay 5 mock name bằng `match?.players?.map(...)`. Sort: alive trước, eliminated sau. Render badge OK/ELIMINATED từ `player.status`. Bỏ `getPlayerAvatar` dùng name giả, thay bằng dùng `player.id` (giữ logic avatar nhưng lookup theo id).
- Hiển thị "(đang chờ danh sách người chơi)" nếu `match?.players` rỗng.
- Sửa `socket-store.ts:469-490` MATCH_STARTED: đảm bảo `match.players` được khởi tạo từ `room.players` (đã có, verify). Có thể cần thêm `status: "ACTIVE"` cho từng player.
- Thêm test (nếu vitest): "sidebar renders match.players with correct alive/eliminated badges".

**F2 — Bỏ magic number redirect:**

- Sửa `apps/web/src/app/[locale]/game/[matchId]/page.tsx:146-164`: xoá `if (newCount !== null && newCount <= 12) { router.push(...); return; }`. Effect chỉ làm UI local (clearTimers + reset state), comment rõ "server-authoritative match end; client không tự redirect".
- Match-end redirect đã có ở effect dòng 218-226 (`match.status === "FINISHED"` → push `/result`).
- Không thêm test mới (logic đơn giản, lint/typecheck đủ).

**F3 — Tách nested setTimeout:**

- Sửa `apps/web/src/app/[locale]/game/[matchId]/page.tsx:64-77`: thêm 2 ref mới `roundResultRevealRef` và `roundResultContinueRef` cạnh `timerRef`/`intervalRef` cũ.
- Sửa effect dòng 138-173: timer ngoài 1s ghi `roundResultRevealRef`, timer trong 3s ghi `roundResultContinueRef`. Cleanup đầy đủ cả 2.
- Sửa `clearTimers` (dòng 68-77): thêm `clearTimeout(roundResultRevealRef.current)` + `clearTimeout(roundResultContinueRef.current)`.
- Thêm test (nếu vitest): "clearTimers cleans all 4 timer refs without leak".

### Target Files

- `apps/web/src/stores/socket-store.ts` (F1)
- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (F1, F2, F3)
- `apps/web/src/app/[locale]/game/[matchId]/page.spec.tsx` (test, tạo mới nếu chưa có)

### Tracking

- [ ] `socket-store.ts` PLAYER_ELIMINATED handler update `match.players[i].status`
- [ ] `socket-store.ts` ROUND_ENDED cross-check `eliminatedPlayerIds`
- [ ] `game page` sidebar render `match?.players` thật, sort alive trước
- [ ] `game page` sidebar bỏ 5 mock name hoàn toàn
- [ ] `game page` effect dòng 146 bỏ `<= 12` redirect
- [ ] `game page` clearTimers xử lý 4 ref
- [ ] `game page` round-completed effect dùng 2 ref riêng (không nested)
- [ ] Test sidebar real data: pass (nếu có vitest)
- [ ] Test timer cleanup: pass (nếu có vitest)

### Verify

- `pnpm --filter @arena/web typecheck`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web test --run` (nếu vitest có)
- Manual smoke: `/game/[matchId]` desktop + mobile, kiểm tra sidebar render player thật

## Phase 5: Frontend 🟡 — F4 + F5 + F6 + F7 + F8

### Goal

Polish 5 bug frontend còn lại: dynamic maxPlayers, loading state, bỏ `currentRoundNo || 1`, round-end signal rõ ràng, auto-join guard.

### Why Separate

Cùng nhóm "polish correctness" nhưng nhỏ hơn 🔴. Land sau Phase 4 để sidebar mới (F1) đã ổn định trước khi thêm polish khác.

### Suggested agent window

- Target context size: under 35k tokens
- Suggested agent: `frontend-specialist`

### Read Set

- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (focus 56-77 timer refs, 138-173 round-completed effect, 235-249 selectAnswer, 262-288 fallback, 369 maxPlayers, 442-518 sidebar)
- `apps/web/src/stores/socket-store.ts` (line 469-490 MATCH_STARTED, 515-544 ROUND_ENDED, 603-606 ANSWER_RESULT)
- `apps/web/src/hooks/use-lobby-lifecycle.ts` (line 26-57 auto-join, 61-74 countdown interval)
- `apps/web/src/messages/{en,vi}.json` (để thêm `Game.loadingQuestion` i18n key)

### Instructions

**F4 — Dynamic maxPlayers:**

- Sửa `game page:369`: `const maxPlayers = room?.maxPlayers ?? match?.maxPlayers ?? GAME_CONFIG.MAX_PLAYERS;` — cần thêm `room.maxPlayers` vào store (xem B1) hoặc dùng fallback từ `GAME_CONFIG`.
- Render: `{remainingCount ?? match?.players?.length ?? 0} / {maxPlayers}` thay vì `/ 100`.
- Cần import `GAME_CONFIG` từ `@arena/shared`.
- Note: `Room.maxPlayers` chưa có trong payload `ROOM_JOINED` hiện tại. Cần check `packages/shared/src/socket.ts` có export `room.maxPlayers` không. Nếu chưa → dùng `GAME_CONFIG.MAX_PLAYERS` làm fallback (đủ tốt cho phase này, fix payload là PR khác).

**F5 — Loading state thay fallback question:**

- Sửa `game page:282-288`: nếu `!match?.currentQuestion` → render `<div className="animate-pulse text-center text-candy-ink/50 py-12">{t("loadingQuestion")}</div>` thay vì fallback question.
- Thêm i18n key `Game.loadingQuestion` vào `apps/web/src/messages/{en,vi}.json` (~2 dòng mỗi file).

**F6 — Bỏ `currentRoundNo || 1`:**

- Sửa `game page:247`: thay `match.currentRoundNo || 1` bằng `match.currentRoundNo` (giá trị thật). Hoặc thêm guard: nếu `match.currentRoundNo <= 0` thì skip emit (return sớm trong `handleSelectAnswer`).
- Comment rõ "server đọc round từ state machine, bỏ client roundNo để tránh dead data".

**F7 — Round-end signal rõ ràng:**

- Sửa `game page:140`: thay `lastAnswerResult?.correctAnswer` bằng derived state từ match: `const roundEnded = match?.roundEndTime === null && match?.currentQuestion === null && match?.status === "ROUND_RESULT"`. Effect ở dòng 138 chỉ fire khi `roundEnded && !roundCompleted`.
- Lưu ý: ROUND_ENDED handler ở store (`socket-store.ts:515-544`) set `match.roundEndTime = null` (dòng 528). Đó là tín hiệu server gửi. Kết hợp với `status === "ROUND_RESULT"` (cũng set ở dòng 527).
- Có thể bỏ `revealedCorrectAnswer` local state, dùng trực tiếp `lastAnswerResult?.correctAnswer` (chỉ để hiển thị, không phải trigger).

**F8 — Auto-join guard:**

- Sửa `use-lobby-lifecycle.ts:18-124`: thêm `const joinInFlightRef = useRef(false)` ở đầu hook.
- Sửa effect dòng 26-57: đầu effect `if (joinInFlightRef.current) return;`. Trong `autoJoin`: set `joinInFlightRef.current = true` trước `await joinRoom`, finally set false. Cleanup cũng set false (cancelled case).
- Comment rõ "tránh double-emit JOIN_ROOM khi room object thay đổi do presence/PLAYER_JOINED event re-trigger effect".
- Thêm test (nếu vitest): "useLobbyLifecycle: rapid room updates while joining do not emit JOIN_ROOM twice".

### Target Files

- `apps/web/src/app/[locale]/game/[matchId]/page.tsx` (F4, F5, F6, F7)
- `apps/web/src/hooks/use-lobby-lifecycle.ts` (F8)
- `apps/web/src/messages/{en,vi}.json` (F5 i18n key)
- `apps/web/src/hooks/use-lobby-lifecycle.spec.ts` (F8 test, tạo mới nếu chưa có)

### Tracking

- [ ] `game page` render `maxPlayers` động, fallback `GAME_CONFIG.MAX_PLAYERS`
- [ ] `game page` tử số không fallback `?? 100`
- [ ] `game page` loading state khi `!currentQuestion` (không còn fallback question)
- [ ] `messages/{en,vi}.json` có `Game.loadingQuestion`
- [ ] `game page` bỏ `currentRoundNo || 1`, gửi giá trị thật
- [ ] `game page` round-end signal dùng `match.roundEndTime === null && match.status === "ROUND_RESULT"`
- [ ] `use-lobby-lifecycle.ts` có `joinInFlightRef` guard
- [ ] Test auto-join guard: pass (nếu có vitest)

### Verify

- `pnpm --filter @arena/web typecheck`
- `pnpm --filter @arena/web lint`
- `pnpm --filter @arena/web test --run` (nếu vitest có)
- Manual smoke: lobby auto-join không bị double-emit, game page sidebar vẫn render, loading state hiện khi chưa có câu hỏi

## Phase 6: Regression Test Sweep + Coverage Gate

### Goal

Đảm bảo 661+ tests hiện tại vẫn pass, tests mới cho 11 bug pass, coverage per-file ≥90% cho file backend sửa, frontend build/lint/typecheck/test pass.

### Why Separate

Sau 5 phases implementation, cần một pass chạy full suite để chốt coverage gate. Fail một test hiện có → block PR, không phải quay lại phase trước.

### Suggested agent window

- Target context size: under 25k tokens
- Suggested agent: `test-engineer`

### Read Set

- `apps/api/src/modules/match/game-loop.service.spec.ts` (full)
- `apps/api/src/modules/admin/admin.service.spec.ts` (full)
- `apps/api/src/modules/match/match.service.spec.ts` (full)
- `packages/game-core/src/match-state-machine.spec.ts` (full)
- `apps/web/src/app/[locale]/game/[matchId]/page.spec.tsx` (full nếu có)
- `apps/web/src/hooks/use-lobby-lifecycle.spec.ts` (full nếu có)
- `.github/workflows/ci.yml` (xác nhận CI command)

### Instructions

- Chạy backend full unit test: `pnpm --filter @arena/api test --run`
- Chạy game-core: `pnpm --filter @arena/game-core test --run`
- Chạy E2E (nếu Docker infra available): `pnpm --filter @arena/api test:e2e`
- Chạy frontend build/lint/typecheck: `pnpm --filter @arena/web {build,lint,typecheck,test}`
- Nếu test hiện có fail do behavior change, update test thay vì rollback code
- Coverage report backend: `pnpm --filter @arena/api test:coverage --run`
- Verify per-file ≥90% cho 4 file backend production sửa: `game-loop.service.ts`, `match.service.ts`, `admin.service.ts`, `match-state-machine.ts`
- Nếu coverage dưới 90%, thêm test cụ thể cho branch chưa cover
- Nếu frontend vitest chưa có, skip frontend test và note trong PR description

### Target Files

- Spec files chỉ thêm/sửa, không xóa test hiện có trừ khi conflict với behavior mới

### Tracking

- [ ] `pnpm --filter @arena/api test --run` pass (target 670+ tests, từ 661)
- [ ] `pnpm --filter @arena/game-core test --run` pass
- [ ] Coverage `game-loop.service.ts` ≥90%
- [ ] Coverage `admin.service.ts` ≥90%
- [ ] Coverage `match.service.ts` ≥90%
- [ ] Coverage `match-state-machine.ts` ≥90%
- [ ] `pnpm --filter @arena/api lint` pass
- [ ] `pnpm --filter @arena/api typecheck` pass
- [ ] `pnpm --filter @arena/web build` pass
- [ ] `pnpm --filter @arena/web lint` pass
- [ ] `pnpm --filter @arena/web typecheck` pass
- [ ] `pnpm --filter @arena/web test --run` pass (nếu vitest có)

### Verify

- Tất cả command ở Tracking

## Phase 7: Docs Sync + Pre-Merge Checklist

### Goal

Đóng PR với evidence, không phải intuition. Cập nhật memory-bank, tracking boxes, viết PR description rõ ràng.

### Why Separate

Docs + checklist là phần "kitchen sink" cuối cùng. Tách riêng để người review thấy implementation phases đã clean, không lẫn vào docs.

### Suggested agent window

- Target context size: under 20k tokens
- Suggested agent: `general` hoặc tự viết

### Read Set

- `memory-bank/progress.md` (để update Phase 12)
- `memory-bank/activeContext.md` (để update Recent Changes + Current Focus)
- `plan.md` (file này, để tick tracking)

### Instructions

- Cập nhật `memory-bank/progress.md`:
  - Thêm `### ✅ Phase 12 — Match Race + Frontend Correctness Hardening (2026-06-14)` section
  - Liệt kê 3 bug backend (B1, B2, B3) + 8 bug frontend (F1-F8) với file:line reference
  - Số test thêm vào (target 670+ backend, frontend nếu có)
  - Coverage per-file sau fix
  - Tick checkbox tương ứng trong "Up Next"
- Cập nhật `memory-bank/activeContext.md`:
  - Update "Current Focus" từ `feat/drop-in-spectating-baseline` → `fix/match-race-frontend-correctness` (hoặc merged)
  - Update "Recent Changes" với 11 fix
  - Update "Architecture Assessment Summary" — backend score có thể tăng (8 → 9/10), frontend score có thể giữ (8/10) vì đây là correctness, không phải polish
- Cập nhật `plan.md` (file này):
  - Tick tất cả `[ ]` thành `[x]`
  - Thêm "PR merged" tick nếu đã merge
- Viết PR description (copy format PR #38 / #47):
  - TL;DR 11 bug (3 backend + 8 frontend)
  - Evidence (file:line + reasoning cho mỗi bug)
  - Test matrix (race scenarios + edge cases + manual smoke)
  - Coverage delta
  - Out-of-scope (giữ nguyên deferral list)

### Target Files

- `memory-bank/progress.md` (≤ 80 dòng thêm)
- `memory-bank/activeContext.md` (≤ 40 dòng thêm)
- `plan.md` (chỉ tick boxes)

### Tracking

- [ ] `progress.md` có Phase 12 section
- [ ] `activeContext.md` "Current Focus" updated
- [ ] `plan.md` tất cả tracking boxes ticked
- [ ] PR description có TL;DR + evidence + test matrix

### Verify

- `pnpm --filter @arena/api test --run` (cuối cùng, sanity check)
- `pnpm --filter @arena/web build` (cuối cùng, sanity check)

## Definition Of Done

**Backend:**

- 3 race bug (B1, B2, B3) đã fix với regression test
- 661+ unit tests hiện tại vẫn pass
- Tests mới pass, tổng 670+
- Coverage per-file ≥90% cho 4 file production sửa

**Frontend:**

- 8 correctness bug (F1-F8) đã fix
- Mock sidebar data bỏ hoàn toàn
- Server-authoritative guarantee giữ (client không tự redirect kết thúc trận)
- Timer/race leak fix
- Auto-join chống double-emit
- Loading state thay vì fallback question hardcoded
- Dynamic maxPlayers hiển thị đúng

**Cross-cutting:**

- `pnpm --filter @arena/api {typecheck,lint,test}` pass
- `pnpm --filter @arena/web {build,lint,typecheck,test}` pass
- Memory bank đã sync
- PR description có đầy đủ evidence + test matrix
- Không shared types thay đổi
- Không socket protocol thay đổi
- Không Prisma schema thay đổi
- Tất cả 7 phase tracking boxes ticked

## Explicit Deferrals After This PR

Không pull vào PR này. Đây là gap thật, nhưng cần PR riêng.

### PR 2: Mass-Spectator Transport Scaling

Reason:

- Drop-in spectating baseline đã reuse `room:[id]` channel + `getSnapshot` cho late-joiner (đã xong trong Phase 11)
- Baseline đủ unblock sản phẩm; SSE/namespace riêng chỉ cần khi scale lên hàng nghìn spectator / room

Success target:

- Dedicated spectator transport path (SSE hoặc Socket.io namespace)
- Batched low-frequency spectator updates
- Clear player vs spectator transport boundaries ở `game.gateway.ts` + `match.handler.ts`

### PR 3: Admin Kill-Switch Audit Event

Reason:

- `AdminService.terminateRoom` mutate DB + Redis + timers + emit `ROOM_TERMINATED` nhưng KHÔNG ghi `EventLog` row
- Vi phạm review instructions + coding guidelines

Success target:

- Append immutable audit event (roomId, matchId, adminUserId, reason, timestamp)
- Không block ship MVP nếu chưa có content moderation pipeline

### PR 4: In-Match AFK Policy

Reason:

- `PresenceService.sweep` chỉ handle lobby stale, không có in-match round-miss policy
- Crosses domain rules, backend orchestration, product semantics

Pending decision:

- auto-`ELIMINATED` hay auto-`SPECTATOR` sau missed rounds (chờ product)

Success target:

- Round-miss detection tận dụng `Answer` table
- 2+ miss → tự động transition status
- UI feedback cho người chơi còn lại

### PR 5: Optimistic Answer Rollback

Reason:

- F6 trong PR này chỉ bỏ `currentRoundNo || 1` dead data, chưa phải rollback đầy đủ
- Vẫn cần idempotency key + retry strategy + rollback UX

Success target:

- Idempotency key
- Rollback UX khi server reject
- Retry strategy

### PR 6: Home Page Shell Gradient Cleanup

Reason:

- `apps/web/src/app/[locale]/page.tsx:193` paints redundant `bg-gradient-to-br` shell background
- Home page không dùng `AppShellLayout`, nằm ngoài scope

Success target:

- Drop redundant gradient class, để `body` own background
- Giữ floating candy/donut/emoji decorative layer intact

### PR 7: Content Moderation + Message Sanitizer

Reason:

- Shared profanity/content-moderation pipeline chưa có
- `TerminateRoomDto.message` đang fail-fast reject raw message
- Device fingerprint Model C chưa enforce

Success target:

- Profanity filter pipeline
- `TerminateRoomDto.message` cho phép custom message sau pipeline ready
- Backend enforce guestId + IP/UA fingerprint

### PR 8: Post-Match Rematch + Share

Reason:

- Retention feature, low priority so với correctness

### PR 9: Accessibility Audit (WCAG)

Reason:

- Pre-launch compliance gate

### PR 10: k6 Load Test 100 Concurrent WS

Reason:

- Pre-launch perf gate
- Sẽ tốt hơn sau khi PR này (race hiếm chỉ trigger dưới concurrent load)

### PR 11: Playwright Browser E2E

Reason:

- Deferred tới khi UI ổn định

### PR 12: `Room.maxPlayers` trong `ROOM_JOINED` payload

Reason:

- F4 trong PR này dùng `GAME_CONFIG.MAX_PLAYERS` fallback vì `room.maxPlayers` chưa có trong socket payload
- Cần thêm field vào `RoomJoinedPayload` + backend `joinRoom` response

Success target:

- `RoomJoinedPayload.maxPlayers: number` exposed
- Frontend dùng `room.maxPlayers` thay vì fallback

## Notes For Whoever Executes This Plan

**Backend:**

- B1 là race có blast radius lớn nhất → land trước để có confidence
- B2 thuộc pure logic (`@arena/game-core`) → dễ test, độc lập với B1/B3
- B3 là cross-method refactor (launchRoomMatch + createMatch) → cần impact analysis kỹ nhất; nếu `createMatch` signature phải đổi thì split thành PR phụ
- Nếu test hiện có fail do behavior thay đổi (đặc biệt B2 — `winnerId` từ undefined sang null), update test thay vì rollback code; null là hành vi đúng cho "không có winner"
- Nếu Phase 4 (test sweep) phát hiện test E2E cần Docker infra unavailable, mark là "deferred to CI" và continue

**Frontend:**

- F1 là bug "deception thật" → land sớm trong Phase 4 🔴
- F2 phá vỡ server-authoritative → land cùng F1 (cùng effect liên quan)
- F3 chỉ là cleanup ref nhưng quan trọng vì timer leak có thể gây redirect duplicate
- F4-F7 là polish, có thể gộp Phase 5 một lần
- F8 độc lập với F1-F7, có thể land cuối cùng Phase 5
- Nếu frontend vitest chưa setup, skip frontend test ở Phase 6 và note trong PR
- Nếu `room.maxPlayers` chưa có trong payload, F4 dùng `GAME_CONFIG.MAX_PLAYERS` fallback (PR 12 sẽ thêm field)

**Cross-cutting:**

- Đừng fix B5 (createMatch players leave race) trong PR này — đã degrade an toàn, là UX glitch không phải data corruption
- Sau khi PR này merge, in-match AFK policy (PR 4) + content moderation (PR 7) vẫn là gap lớn nhất trong pre-launch checklist
- Plan này gộp 11 bug trong 1 PR — lớn hơn bình thường, nhưng đã chốt với user. Nếu review quá tải, có thể tách thành 2 PR (backend + frontend) sau khi review đầu tiên
