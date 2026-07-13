# Refactor Plan — `admin.service.ts` (SRP split)

> Mục tiêu: tách god-service lớn nhất repo (`admin.service.ts` **761 dòng**) thành các ops thuần
> theo trách nhiệm, **không đổi hành vi runtime**, giữ nguyên public API + constructor để 1354 dòng
> test (`admin.service.spec.ts` 51 tests + module/controller specs) xanh **không phải sửa**.

## ✅ Trạng thái: ĐÃ XONG (2026-07-11)

| File                          | Trước | Sau    |
| ----------------------------- | ----- | ------ |
| `admin.service.ts` (facade)   | 761   | **86** |
| `ops/admin-audit.ops.ts`      | —     | 99     |
| `ops/question-sync.ops.ts`    | —     | 216    |
| `ops/system-reset.ops.ts`     | —     | 169    |
| `ops/room-termination.ops.ts` | —     | 330    |

Verify: `admin` suite **99/99** xanh, full api **912/912** xanh, `tsc --noEmit` sạch, `eslint` sạch,
`gitnexus check` **0 cycles**, `detect_changes` scope gọn trong admin (0 process ảnh hưởng).
**Spec KHÔNG sửa 1 dòng** (mục tiêu đạt): constructor + public API + logger reference giữ nguyên.
Còn lại (chưa re-index gitnexus): chạy `npx gitnexus analyze` để graph thấy các file ops/store mới.

### Bonus — `room.service.ts` (cùng đợt)

`RoomService` blast **MEDIUM** (17 upstream, 10 caller, 0 process). Khác admin, file này **cohesive** —
đa số method đúng về vòng đời room; tách CQRS query/command sẽ là over-engineer (memory cấm). Seam low-blast
duy nhất đáng tách: cụm **Redis cache snapshot + atomic player-count (2 Lua script)** — toàn private, đúng loại
concurrency-guard memory bảo cô lập sau method có tên rõ.

| File                                                  | Trước | Sau     |
| ----------------------------------------------------- | ----- | ------- |
| `room.service.ts`                                     | 641   | **537** |
| `room-cache.store.ts` (`RoomCacheStore`, plain class) | —     | 116     |

`RoomCacheStore(redis, logger)` khởi tạo như field trong constructor `RoomService` (constructor vẫn `(prisma, redis)`
để spec `new RoomService(prisma, redis)` xanh). 4 private method → `setSnapshot`/`syncPlayerCount`/`syncRoomState`/
`decrementPlayerCountClamped`. Verify: `room` suite **96/96** xanh, full api **912/912**, tsc + eslint sạch, 0 cycle.
Lua concurrency script giờ **unit-test được độc lập** (follow-up: thêm `room-cache.store.spec.ts`).

### Bonus 2 — `game/[matchId]/page.tsx` (atomic-design split, cùng đợt)

God-component **719 dòng** = ~400 logic (hooks/effects/handlers) + ~314 JSX với nhiều organism inline.
Web theo convention **feature-folder** (`components/game/*` + barrel, giống `lobby/`), KHÔNG phải atoms/molecules/organisms thuần.
File này **không có test** → tách **verbatim** (giữ nguyên className + `data-testid`), **giữ toàn bộ logic ở page** (phần rủi ro nhất, không đụng), verify bằng typecheck + build.

Tách 9 organism vào `components/game/*`, mỗi cái tự gọi `useTranslations` (đúng convention `lobby/`):
`EliminatedOverlay`, `SpectatorBanner`, `GameStateRibbon`, `QuestionCard`, `AnswerPanel`, `OpponentsSidebar`
(ôm luôn `getPlayerAvatar`), `AntiHackNote`, `LeaveMatchButton`, `MatchFinishedOverlay` + barrel `index.ts`.

| File                                            | Trước | Sau     |
| ----------------------------------------------- | ----- | ------- |
| `game/[matchId]/page.tsx` (logic + composition) | 719   | **459** |
| 9 organism + barrel trong `components/game/`    | —     | 499     |

Page giờ chỉ còn state/effects/handlers + composition. Verify: web **typecheck** sạch, **eslint** sạch,
`next build` **thành công** (route `/[locale]/game/[matchId]` compile OK).

**Đã thêm test cho organism** (lấp lỗ hổng "route không có test"): 6 spec file, **21 test**, phủ logic thật —
`OpponentsSidebar` (empty fallback, sort alive-trước-eliminated, badge, không mock-data), `AnswerPanel`
(branch spectator/eliminated vs tile tương tác, map option→A/B/C/D, onSelect, disabled), `QuestionCard`
(skeleton vs question, locked/waiting), `GameStateRibbon`, `LeaveMatchButton`, + smoke cho overlay/banner/note.
**Đã thêm render-test cho page** (`page.spec.tsx`, **11 test**): mock socket-store (`vi.hoisted` + `getState`/`setState`),
stub organism + `AppShellLayout`, fake timers + `Suspense` cho `use(params)`. Phủ: snapshot hydration (gọi 1 lần khi
match=null, không gọi khi đã có match), answer-submit gating (submit khi active; chặn khi spectator; chặn khi round=0),
eliminated overlay / spectator banner derivation, ribbon remaining/total, **finished→redirect `/result` sau 3s**,
**admin-termination→toast + redirect `/` sau 1.5s**, leave-flow confirm.

Web test tổng: **50 → 82** xanh (21 organism + 11 page). typecheck + build sạch.

## Bối cảnh (đo bằng GitNexus, index khớp HEAD)

- Vòng trước đã dọn sạch server match-loop: `game-loop.service.ts` 1587→394, tách `match-round-runner.ts`,
  `lobby-countdown.service.ts`, `match-timer.registry.ts`; `match-state-machine.ts` 785→556.
- `socket-store` (client) **đã** refactor xong: `updaters`/`types`/`helpers` tách file + có test.
- God-file lớn nhất còn lại: **`admin.service.ts` 761** — blast **LOW** (`impact AdminService upstream` = 4 upstream, 0 process).
  Chứa **4 concern rời nhau** (vi phạm SRP rõ, đúng "rule of three" trong memory-bank), lại có **lưới test dày** → ứng viên an toàn & giá trị nhất.
- Không chọn `game/[matchId]/page.tsx` (719): **không có test** → refactor behavior-preserving không verify được. Để sau, phải viết test trước.

## 4 concern trong `admin.service.ts`

| Concern                        | Symbol                                                                       | ~LOC | Deps thực dùng                                                                |
| ------------------------------ | ---------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| Question sync                  | `syncQuestions`                                                              | 192  | `prisma`, `logger`, `appendAudit`                                             |
| System reset                   | `resetSystem`                                                                | 147  | `prisma`, `redis`, `logger`, `appendAudit`                                    |
| Room termination (kill-switch) | `terminateRoom` + `recordPartialTerminationFailure` + `cleanupRoomRedisKeys` | 250  | `roomService`, `matchService`, `gameLoopService`, `redis`, `prisma`, `logger` |
| Audit (cross-cutting)          | `appendAudit`, `getAuditEvents`                                              | 65   | `prisma`, `logger`                                                            |

## Ràng buộc từ test (BẮT BUỘC giữ, nếu không spec vỡ)

1. Spec dựng `new AdminService(prisma, redis, roomService, matchService, gameLoopService)` **trực tiếp** →
   **constructor phải giữ đúng 5 tham số này**, không thêm bớt.
2. Spec swap `(service as any).logger = new Logger(...)` **sau** khi construct, rồi `vi.spyOn(service.logger, "error")`
   ở ~8 chỗ → **mọi log phải đi qua đúng reference `this.logger` tại thời điểm gọi**, không được cache logger cũ.
3. Public method surface controller gọi: `syncQuestions`, `resetSystem`, `terminateRoom`, `getAuditEvents` — chữ ký không đổi.
4. `export interface TerminateRoomResult` đang xuất từ `admin.service.ts` → giữ re-export để không vỡ import ngoài.

## Thiết kế: ops là HÀM THUẦN nhận "deps bag"

Mỗi concern → 1 file export function nhận `deps` bag (chứa `this.prisma`/`this.logger`/... truyền sống mỗi lần gọi).
`AdminService` giữ nguyên constructor + fields, mỗi public method thành **delegator 1 dòng** truyền `this.logger` sống vào
→ thỏa ràng buộc #2 (logger đúng reference, spy thấy), và mỗi ops **unit-test được độc lập** (gọi với mock deps bag).

File mới trong `apps/api/src/modules/admin/ops/`:

- `admin-audit.ops.ts` — `appendAudit(deps, params)`, `getAuditEvents(deps, params)`; deps `{ prisma, logger }`.
- `question-sync.ops.ts` — `syncQuestions(deps, clearExisting, adminUserId)`; deps `{ prisma, logger }`.
- `system-reset.ops.ts` — `resetSystem(deps, adminUserId)`; deps `{ prisma, redis, logger }`.
- `room-termination.ops.ts` — `terminateRoom(deps, roomId, adminUserId, message?)` + `TerminateRoomResult` type + helper private module-scope; deps `{ prisma, redis, roomService, matchService, gameLoopService, logger }`.

`AdminService` sau cùng (~120 dòng): giữ interface tương thích, constructor 5 deps, 5 method delegate.

## Thứ tự thực thi (an toàn → phụ thuộc)

1. **A — audit** (0-blast, cả 3 concern kia dùng chung → tách trước).
2. **B — question-sync** (chỉ prisma).
3. **C — system-reset** (prisma + redis).
4. **D — room-termination** (nặng nhất, nhiều collaborator; helper + type đi kèm).
5. **E — dọn AdminService** thành facade mỏng.

Sau MỖI phase: `pnpm --filter @arena/api test -- admin` phải xanh (99 tests).

## Verify cuối

- [ ] `pnpm --filter @arena/api test` (toàn bộ ~897) xanh
- [ ] `pnpm --filter @arena/api typecheck` + `pnpm --filter @arena/api lint` sạch
- [ ] `gitnexus_detect_changes` → chỉ đúng scope admin
- [ ] `gitnexus_check` (cycles) vẫn `clean`

## Không làm trong đợt này

- Không đổi hành vi runtime, không "sửa luôn" logic khi tách.
- Không đổi constructor/public API của `AdminService`, không sửa spec (mục tiêu: 0 dòng spec thay đổi).
- Không đổi `admin.module.ts` / controller (DI graph giữ nguyên — ops là hàm thuần, không phải provider).
