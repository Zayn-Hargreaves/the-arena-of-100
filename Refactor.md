# Refactor Plan — `game-loop.service.ts` & `match-state-machine.ts`

> Mục tiêu: giảm 2 god-file lớn nhất dự án về kích thước dễ bảo trì **mà không đổi hành vi runtime**.
> Nguyên tắc: mỗi bước giữ nguyên public API surface → chạy test → `detect_changes` trước khi commit.

## ✅ Trạng thái: CLEAN HOÀN TOÀN (2026-07-10)

Sau bản đầu, đã làm tiếp full-clean theo yêu cầu:

- **MatchTimerRegistry**: maps → `private`, test đi qua method ngữ nghĩa (không thọc map).
- **LobbyCountdownService**: nâng thành `@Injectable` DI provider thật (logger riêng, vào `MatchModule`). Đã loại bỏ các delegator shim của LobbyCountdownService trên `GameLoopService`; các caller bên ngoài (như Room/Auth Handler) tự inject và gọi trực tiếp `LobbyCountdownService` để đảm bảo DI một chiều rõ ràng. GameLoopService vẫn duy trì một số public facade/delegator tương thích cho các tính năng khác (như delegate tới `MatchRoundRunner` và `forceStartRoomMatch`) để giữ nguyên interface tương thích.
- **MatchRoundRunner** (Phase 1D): tách vòng đời trận (countdown→round→finish + player events) ra file riêng. GameLoopService còn **394 dòng** — orchestrator: launch + admin control + facade mỏng cho socket handler.
- **Presence Sweep & Join Refactoring**: Cập nhật `PresenceService.sweep()` để phân nhánh xử lý người chơi stale dựa trên trạng thái phòng: gọi `GameLoopService.handleMatchPlayerLeft` cho các phòng `IN_GAME` hoặc `FINISHED` có trận đấu đang hoạt động, và chỉ gọi `LobbyCountdownService.handleRoomPlayerLeft` cho các phòng lobby/chờ (`WAITING`/`COUNTDOWN`/`STARTING`). Việc này thay thế hoàn toàn cơ chế join/countdown cũ luôn chạy countdown cho mọi trạng thái.

LOC cuối: `game-loop.service.ts` 1587→**394**, `match-round-runner.ts` 606, `lobby-countdown.service.ts` 550, `match-timer.registry.ts` 152, `match-state-machine.ts` 785→556.

Verify: game-core **75/75**, api **891/891** (bao gồm test mới cho presence sweep), typecheck + lint sạch, `gitnexus check` **0 cycles** (re-indexed).

---

## ✅ Trạng thái bản đầu (pragmatic)

Tất cả 6 phase đã thực thi và verify. Kết quả:

| File                     | Trước | Sau      | Tách ra                                                             |
| ------------------------ | ----- | -------- | ------------------------------------------------------------------- |
| `match-state-machine.ts` | 785   | **556**  | `prng.ts` (40), `tie-break.ts` (84), `match-state.codec.ts` (201)   |
| `game-loop.service.ts`   | 1587  | **1054** | `match-timer.registry.ts` (149), `lobby-countdown.service.ts` (551) |

Verify cuối: game-core **75/75**, api **891/891** (58 files, +registry spec), lint + typecheck sạch, `gitnexus check` **0 cycles** (re-indexed). Public API surface không đổi; không caller ngoài nào phải sửa. Log context giữ nguyên `[GameLoopService]`.

Điểm cần biết: `MatchStateMachine` vẫn ở mức CRITICAL trong impact — đó là blast radius nội tại của domain core (số caller không đổi), việc tách chỉ là helper thuần nội bộ. Không tách core transitions/round/eval (đúng chủ trương).

---

## Bối cảnh & số liệu (đo bằng GitNexus, index khớp HEAD)

| File                                              | LOC hiện tại | Blast radius                                  | Ghi chú                                                                                                                                                                  |
| ------------------------------------------------- | ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/match/game-loop.service.ts` | **1587**     | —                                             | Đã tách một phần: `game-loop.helpers.ts`, `game-loop.events.ts`, `game-loop.countdown-store.ts`, `game-loop.types.ts`. Phần orchestration + lobby + recovery vẫn inline. |
| `packages/game-core/src/match-state-machine.ts`   | **785**      | **CRITICAL** — 28 upstream, 22 execution flow | Không được split core transitions. Chỉ tách phần pure, low-blast.                                                                                                        |

Blast radius các symbol ứng viên tách (đã chạy `impact upstream`):

| Symbol                      | Risk         | Upstream                                                                  | Kết luận                                                     |
| --------------------------- | ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `maybeStartPublicCountdown` | LOW          | 0                                                                         | An toàn move                                                 |
| `serialize` (state machine) | LOW          | 0                                                                         | An toàn tách                                                 |
| `tieBreak`                  | LOW          | 1 (chỉ `determineWinner`)                                                 | An toàn tách — đúng ứng viên Strategy mà memory-bank đã flag |
| `launchRoomMatch`           | **CRITICAL** | 8 (afterInit, handleStartMatch, timer, onModuleInit, forceStartRoomMatch) | **Giữ nguyên vị trí + signature**, chỉ delegate nội bộ       |

## Guardrails (áp dụng cho mọi bước)

1. **Giữ nguyên public method surface của `GameLoopService`** — gateway/handlers/admin gọi vào: `setServer`, `maybeStartPublicCountdown`, `forceStartRoomMatch`, `handleRoomPlayerLeft`, `getCountdownEnd`, `handlePlayerDisconnect`, `handleMatchPlayerLeft`, `checkEarlyTermination`, `stopRoomRuntime`, `emitRoomTerminated`, `isMatchFinishing`, `cancelMatchLoop`. Sau refactor các method này có thể chỉ còn là delegator, nhưng **chữ ký không đổi**.
2. **Giữ nguyên public API của `MatchStateMachine`** — `serialize()`/`static deserialize()`/`tieBreak` behavior không đổi; nếu tách ra module thì để lại wrapper mỏng delegate.
3. Test là safety net: `match-state-machine.spec.ts` (1500 dòng) + `game-loop.service.spec.ts` (3984 dòng) test qua public API → extraction nội bộ phải giữ chúng xanh. Cẩn thận vài spec import internals (vd `COUNTDOWN_INDEX_KEY` đã có re-export backward-compat — giữ pattern này).
4. Mỗi bước: `gitnexus_impact` trên symbol sắp sửa → sửa → `pnpm --filter <pkg> test` → `gitnexus_detect_changes` → commit nhỏ.

---

## FILE 1 — `game-loop.service.ts` (1587 → mục tiêu ~650)

Tách theo trách nhiệm. 3 cluster rõ ràng, gần như không overlap.

### Phase 1A — Tách `MatchTimerRegistry` (rủi ro THẤP, làm trước)

**File mới:** `apps/api/src/modules/match/match-timer.registry.ts` (plain class, khởi tạo như field trong service — không cần `@Injectable`).

Chuyển state in-memory + biến các `Set.has/add/delete` rải rác thành method có tên rõ nghĩa:

- Di chuyển: `activeTimers`, `usedQuestionIds`, `expectedAnswers`, `endingRounds`, `finishingMatches`.
- Di chuyển: `addTimer`, `clearTimers`.
- Đóng gói các idempotency guard (H1/B1) thành API ý nghĩa:
  - `beginEndRound(matchId): boolean` (false nếu đang ending) / `endEndRound(matchId)`
  - `beginFinish(matchId): boolean` / `endFinish(matchId)` / `isFinishing(matchId)`
  - `trackUsedQuestion(matchId, qId)` / `getUsedQuestionIds(matchId)`
  - `setExpectedAnswers` / `getExpectedAnswers`
  - `disposeMatch(matchId)` (clear timers + xoá mọi map cho match)

**Lợi ích:** phần correctness tinh vi nhất (idempotency chống double-fire) trở thành **unit test độc lập được**, và `GameLoopService` bớt ~90 dòng bookkeeping + comment.

**Verify:** `game-loop.service.spec.ts` phải xanh nguyên. Thêm `match-timer.registry.spec.ts` cho các guard.

### Phase 1B — Tách `LobbyCountdownService` (rủi ro TRUNG BÌNH)

**File mới:** `apps/api/src/modules/match/lobby-countdown.service.ts` (`@Injectable`, thêm vào `MatchModule`).

Chuyển toàn bộ vòng đời **lobby countdown trước trận + boot recovery + dead-letter**:

- `onModuleInit` (phần scan Redis recovery), `drainPendingRecovery`, `scheduleRecoveryRetry`, `sweepDeadLetterRooms`
- `maybeStartPublicCountdown`, `armLobbyCountdownTimer`, `persistLobbyCountdown`, `clearPersistedCountdown`
- `clearLobbyCountdown`, `clearLobbyCountdownBestEffort`, `getCountdownEnd`, `handleRoomPlayerLeft`
- State: `lobbyCountdowns`, `pendingRecovery`, `recoveryInFlight`, `activeRecoveryRetries`, `server` ref

**Xử lý coupling (quan trọng):** countdown hết giờ / recovery phải gọi `launchRoomMatch` (nằm ở `GameLoopService`), còn `launchRoomMatch` lại cần clear countdown → 2 chiều.

- Giải pháp thực tế (tránh circular DI): `GameLoopService` inject trực tiếp `LobbyCountdownService` theo chiều NestJS DI một chiều sạch.
- Để cho phép `LobbyCountdownService` kích hoạt trận đấu khi countdown kết thúc mà không gây circular dependency, sử dụng cơ chế callback `lobbyCountdown.setLauncher(fn)` được đăng ký trong constructor của `GameLoopService`.
  - Khi countdown hết giờ, callback launcher này sẽ gọi `this.launchRoomMatch(...)` trong `GameLoopService`.
  - `GameLoopService.launchRoomMatch` gọi `this.lobbyCountdown.clearCountdown(roomId)` ở đầu hàm.
- `GameLoopService.setServer` sẽ delegate thêm `this.lobbyCountdown.setServer(server)`.
- Các public method khác liên quan đến game-loop (như delegate tới `MatchRoundRunner`) được duy trì trên `GameLoopService` dưới dạng facade tương thích để đảm bảo gateway handler không cần thay đổi. Các caller ngoài trực tiếp tương tác với lobby countdown sẽ gọi trực tiếp `LobbyCountdownService`.

**Lợi ích:** ~550 dòng (countdown + recovery + dead-letter) ra khỏi service; `GameLoopService` chỉ còn lo vòng đời **trận đang chạy**.

**Verify:** `game-loop.countdown-store.spec.ts` + `game-loop.service.persistence.spec.ts` + `game-loop.service.spec.ts` xanh. Đây là bước chạm nhiều recovery-edge-case nhất → chạy full `apps/api` test.

### Phase 1C — `GameLoopService` còn lại (orchestrator vòng đời trận)

Sau 1A+1B, service chỉ còn phần đúng với tên nó — **the running match loop** (~600–650 dòng):

- `launchRoomMatch` (**CRITICAL, giữ nguyên vị trí + logic B3 transaction**), `forceStartRoomMatch`
- `startMatchLoop`, `executeCountdown`, `executeRound`, `endRound`, `checkMatchEnd`, `finishMatchLoop`/`finishMatchLoopInner`
- `handlePlayerDisconnect`, `handleMatchPlayerLeft`, `checkEarlyTermination`
- `cancelMatchLoop`, `stopRoomRuntime`, `emitRoomTerminated`, `isMatchFinishing` (delegate vào `MatchTimerRegistry`)

**Phase 1D (tùy chọn, hoãn):** tách tiếp round loop (`startMatchLoop → finishMatchLoopInner`) thành `MatchRoundRunner`. **Khuyến nghị KHÔNG làm ngay** — đây chính là lõi CRITICAL (22 process). Làm 1A/1B trước, đo lại LOC, chỉ tách tiếp nếu vẫn thấy cần.

---

## FILE 2 — `match-state-machine.ts` (785 → mục tiêu ~500)

⚠️ **CRITICAL (28 upstream, 22 flow).** Tuyệt đối **không** split core state/transition/round/eval. Chỉ bóc các mảnh **pure, self-contained, low-blast** ra ngoài, class giữ nguyên public API.

### Phase 2A — Tách PRNG helpers (rủi ro ~0)

**File mới:** `packages/game-core/src/prng.ts`

- Move `hashStringToSeed`, `mulberry32` thành pure exported functions.
- Blast radius: **zero** (đang là private). Chỉ `tieBreak` dùng.

### Phase 2B — Tách tie-break thành pure function (rủi ro THẤP, 1 caller)

**File mới:** `packages/game-core/src/tie-break.ts`

- Export `resolveTieBreak(playerIds: string[], players: ReadonlyMap<string, PlayerInfo>, matchId: string): string | null`.
- Chuyển nguyên logic `tieBreak` hiện tại (L5 deterministic seed + sort contract) vào đây, import PRNG từ `prng.ts`.
- Trong class: `tieBreak` thu về wrapper 1 dòng `return resolveTieBreak(ids, this.state.players, this.state.id)` — hoặc gọi trực tiếp trong `determineWinner`.
- Đây đúng là **Strategy candidate** memory-bank đã ghi. Giữ dạng **pure function trước**; chỉ nâng lên interface `TieBreakStrategy` khi có variant thứ 2 thật sự. Không over-engineer.

**Verify:** tie-break tests trong `match-state-machine.spec.ts` (reproducibility + strict-weak-ordering) phải xanh y hệt — behavior không đổi, chỉ đổi vị trí.

### Phase 2C — Tách serialize/deserialize thành codec module (rủi ro THẤP)

**File mới:** `packages/game-core/src/match-state.codec.ts`

- Move `interface DeserializedMatch` + logic thân của `serialize()` và `static deserialize()` + validation (L3 omit `correctAnswer`, legacy `submissionId` backfill).
- Export `serializeMatch(state, currentRound, eventLog): string` và `deserializeMatch(json): { state, currentRound, eventLog }` (trả về plain data, class tự dựng instance).
- Trong class **giữ lại** `serialize()` / `static deserialize()` làm wrapper mỏng delegate (guardrail #2) → `matchService.getStateMachine` và `persistStateMachine` **không phải đổi gì**.
- `attachCorrectAnswer` giữ trong class (chạm `this.currentRound`), nhưng validation shape đi kèm codec.

**Verify:** serialize/deserialize round-trip tests + `game-loop.service.persistence.spec.ts` xanh.

**Kết quả File 2:** class từ 785 → ~500 dòng; 2 concern rủi ro nhất (transitions, round/answer/eval) **không đụng tới**.

---

## Thứ tự thực thi đề xuất (từ an toàn → rủi ro)

1. **2A** PRNG (~0 risk, warm-up)
2. **2B** tie-break pure function
3. **2C** serialize/deserialize codec
4. **1A** MatchTimerRegistry
5. **1B** LobbyCountdownService (bước nặng nhất — làm khi 4 bước trên đã xanh)
6. **1C** dọn phần còn lại của GameLoopService (phần lớn tự xong sau 1A/1B)
7. (hoãn) 1D MatchRoundRunner — chỉ nếu còn thấy cần sau khi đo lại

Mỗi PR = 1 phase. Commit nhỏ, revert dễ.

## Checklist verify mỗi phase

- [ ] `gitnexus_impact` trên symbol sắp sửa → confirm risk như bảng trên
- [ ] Extraction giữ nguyên chữ ký public (guardrail #1, #2)
- [ ] `pnpm --filter @arena/game-core test` (70 tests) cho File 2
- [ ] `pnpm --filter @arena/api test` (866 tests) cho File 1
- [ ] `pnpm lint` + `pnpm typecheck`
- [ ] `gitnexus_detect_changes` → chỉ đúng scope kỳ vọng
- [ ] `gitnexus_check` (cycles) vẫn `clean` — đặc biệt sau 1B vì thêm DI edge

## Không làm trong đợt này

- Không đổi hành vi runtime, không "sửa luôn" logic khi tách.
- Không split core transition của `MatchStateMachine`.
- Không nâng tie-break/serialize lên interface/Strategy nếu chưa có variant thứ 2.
- Không tách `MatchRoundRunner` (1D) cho tới khi đo lại.
