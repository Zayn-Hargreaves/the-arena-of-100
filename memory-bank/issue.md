# Profile & Rankings — Brainstorm Issues

> Ngày tạo: 2026-06-06
> Scope: gỡ mock data ở `/profile` và `/rankings`, thay bằng API thật
> Trạng thái: Bước 1, 2, 3, 4, 5, 6 đã hoàn thành.

---

## 1. Tóm tắt vấn đề

Hai trang `/profile` và `/rankings` đang dùng data cứng trong file `.tsx`:

| File                                          | Dòng  | Mock                                                                                 | Cần thay bằng                                               |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `apps/web/src/app/[locale]/profile/page.tsx`  | 38-46 | `stats` (42 matches, 8 wins, 235 eliminations, 0.58s avg, 19% winrate, 82% survival) | Aggregate từ `Match` + `MatchPlayer` + `Answer`             |
| `apps/web/src/app/[locale]/profile/page.tsx`  | 48-81 | `history` (4 match giả)                                                              | Query match của user, join với `MatchPlayer` + `MatchRound` |
| `apps/web/src/app/[locale]/rankings/page.tsx` | 11-76 | `leaders` (8 player giả, kèm spritesheet)                                            | Aggregate leaderboard từ DB                                 |

UI cũng hardcode "WEEKLY SEASON" ở rankings header (line 110) và có `spritesheet` cho mỗi player mock (line 18-75) — cả hai đã được thống nhất scope dưới đây.

---

## 2. Quyết định đã thống nhất qua Brainstorm

### Q1. Backend approach cho stats/leaderboard

- **Quyết định:** Chọn **Option C (Compute + Redis Cache TTL cho Leaderboard, Real-time cho Profile)**.
- **Chi tiết:**
  - Endpoint `GET /rankings/leaderboard` sẽ tính toán từ database PostgreSQL và cache kết quả vào Redis với TTL từ 1 - 5 phút để tránh quá tải DB.
  - Endpoint `GET /users/me/stats` sẽ tính toán realtime trực tiếp từ PostgreSQL vì tần suất xem cá nhân thấp và chỉ lọc theo một `userId`.

### Q2. Metric chính cho leaderboard

- **Quyết định:** Chọn **Option B (Số trận thắng - Wins)** làm tiêu chí xếp hạng chính.
- **Chi tiết:**
  - Sắp xếp mặc định theo số trận thắng (`wonMatches`).
  - Hiển thị thêm các chỉ số phụ trên hàng của từng user (số trận đã chơi, độ chính xác - accuracy, tốc độ trung bình - avg speed) để tăng độ phong phú thông tin.

### Q3. Time window cho leaderboard

- **Quyết định:** Chọn **Option B (Weekly Rolling 7 days + All-time)**.
- **Chi tiết:**
  - Weekly leaderboard sử dụng filter thời gian động: `Match.startedAt >= NOW() - 7 days`. Cách này tránh phải chạy cronjob hay reset database định kỳ.
  - All-time leaderboard hiển thị điểm số tích lũy vĩnh viễn.
  - Giao diện có nút toggle chuyển đổi đơn giản.

### Q4. Dirty stats khi lobby lifecycle / AFK chưa có

- **Quyết định:** Chọn **Option C (Lọc Match.status = 'FINISHED')**.
- **Chi tiết:**
  - Chỉ tính stats cho các trận đấu đã kết thúc hoàn chỉnh.
  - Người chơi AFK/Disconnect sẽ bị tự động đánh dấu là `PlayerStatus.ELIMINATED` ở round tiếp theo (do timeout), và được ghi nhận là một trận thua (hợp lý theo game design).

### Q5. Avatar / spritesheet cho user

- **Quyết định:** Chọn **Option B (Thêm `avatar` seed vào User model)**.
- **Chi tiết:**
  - Thêm trường `avatar` (kiểu dữ liệu String, mặc định là `"jellyfrog"`) vào model `User` trong Prisma schema.
  - Thêm API endpoint `PATCH /users/me/avatar` để người dùng lưu cập nhật avatar lên server.
  - Trả về trường `avatar` này trong API Rankings để frontend map với spritesheet tương ứng.

### 🔍 Công thức tính điểm (Score Logic)

- **Quyết định:** Thay vì giữ `MatchPlayer.score` luôn bằng `0`, điểm số của mỗi người chơi trong mỗi trận đấu sẽ được tính và cập nhật khi kết thúc trận:
  - **Công thức tính điểm mỗi round:**
    - Trả lời đúng: +100 điểm.
    - Speed bonus (nếu trả lời đúng): `Math.max(0, 10000 - responseTimeMs) / 200` điểm. (Max bonus là 50 điểm).
  - Điểm số tích lũy này sẽ được update vào bảng `MatchPlayer` trong DB khi kết thúc trận đấu qua `MatchService.finishMatch`.

---

## 3. Các bước triển khai tách biệt (Granular Steps)

Để đảm bảo hiệu quả làm việc cho các mô hình AI có giới hạn ngữ cảnh, công việc được chia nhỏ thành 6 bước độc lập:

### Bước 1: Database Schema Migration

- **Mục tiêu:** Cập nhật Prisma Schema và chạy migration.
- **Chi tiết:**
  - Thêm `avatar String @default("jellyfrog")` vào model `User` trong `schema.prisma`.
  - Chạy `pnpm db:push` hoặc `pnpm db:migrate` để cập nhật database PostgreSQL.
  - Regenerate client bằng `pnpm db:generate`.

### Bước 2: Score Logic & Match Completion

- **Mục tiêu:** Cập nhật game loop để tính điểm và lưu điểm số thật vào Database.
- **Chi tiết:**
  - Sửa `MatchStateMachine` để tính điểm score tích lũy cho mỗi người chơi dựa trên câu trả lời đúng và tốc độ phản hồi.
  - Cập nhật `MatchService.finishMatch` để thực hiện cập nhật hàng loạt `score` của các `MatchPlayer` khi trận đấu kết thúc.
  - Viết unit tests kiểm chứng logic tính điểm và cập nhật score.

### Bước 3: Users Module & Profile Stats API ✅ HOÀN THÀNH

- **Mục tiêu:** Tạo module `users` ở backend và viết các API liên quan đến Profile.
- **Chi tiết:**
  - Tạo NestJS module `users/` mới gồm controller, service và DTOs.
  - Viết API `GET /users/me/stats` thực hiện aggregate dữ liệu (số trận thắng từ `wonMatches`, số trận chơi từ `matchPlayers`, độ chính xác và tốc độ trung bình từ `Answer`).
  - Viết API `GET /users/me/history` lấy lịch sử đấu gần nhất (giới hạn 20 trận, có phân trang).
  - Viết API `PATCH /users/me/avatar` để cập nhật avatar seed.
  - Viết Unit/Integration tests cho Users module.
- **Đã giao (2026-06-06):**
  - `packages/shared/src/avatars.ts` — `AVATAR_SEEDS` (42 seeds) + `isValidAvatarSeed()` + `AvatarSeed` type
  - `packages/shared/src/index.ts` — export `* from "./avatars"`
  - `apps/api/src/modules/users/users.module.ts` — `@Module({ controllers, providers, exports })`
  - `apps/api/src/modules/users/users.controller.ts` — 3 endpoints: `GET /users/me/stats`, `GET /users/me/history`, `PATCH /users/me/avatar`
  - `apps/api/src/modules/users/users.service.ts` — `getMyStats`, `getMyHistory`, `updateMyAvatar`. Raw SQL cho `avgResponseMs/accuracy/totalCorrect` + `survivalRate` (window function RANK), Prisma `groupBy` cho `matchesPlayed/totalScore/wins`.
  - `apps/api/src/modules/users/users.service.spec.ts` — 11 tests (NotFound, no matches, happy path aggregate, FINISHED filter, BigInt conversion, empty history, WON/ELIMINATED status, cursor pagination, cursor+skip, update avatar)
  - `apps/api/src/modules/users/users.controller.spec.ts` — 4 tests (forwarding userId, query forwarding, cursor, PATCH forwarding)
  - `apps/api/src/modules/users/users.module.spec.ts` — 1 test (module compilation)
  - `apps/api/src/modules/users/dto/{stats,history,history-query,update-avatar}.ts` — Zod schemas + Swagger API decorators
  - `apps/api/src/modules/users/dto/index.ts` — barrel export
  - `apps/api/src/app.module.ts` — import + register `UsersModule`
  - `apps/web/src/lib/avatars.ts` — refactor: dùng `AVATAR_SEEDS` từ `@arena/shared` (1 nguồn)
- **Quyết định semantics đã chốt:**
  - `eliminations` (mock) → `totalCorrectAnswers`
  - `mode` trong history → `roomCategory` (từ `Room.category`)
  - Filter: chỉ tính `Match.status = 'FINISHED'`
  - Avatar validation: `z.enum(AVATAR_SEEDS)` ở backend
- **Verification:**
  - `pnpm --filter @arena/api test` → 403/403 pass (16 mới + 387 cũ, 0 regression)
  - `pnpm --filter @arena/shared build` → tsc clean
  - `pnpm --filter @arena/api build` → nest build clean
  - `pnpm --filter @arena/web build` → next build clean
  - `pnpm --filter @arena/api lint` → eslint clean

### Bước 4: Leaderboard API với Redis Cache ✅ HOÀN THÀNH

- **Mục tiêu:** Viết API bảng xếp hạng hỗ trợ filter Weekly / All-time và cache Redis.
- **Chi tiết:**
  - Tạo service hoặc controller xử lý Leaderboard.
  - Endpoint `GET /rankings/leaderboard` nhận query parameter `period` (`weekly` hoặc `all`).
  - Implement cache logic qua Redis với TTL (ví dụ 60 giây).
  - Viết Unit/Integration tests.
- **Đã giao (2026-06-06):**
  - `apps/api/src/modules/rankings/dto/leaderboard-query.dto.ts` — Zod `period` (weekly|all) + `limit` (1-100, default 50), Swagger decorators
  - `apps/api/src/modules/rankings/dto/leaderboard.dto.ts` — Zod response: `period`, `generatedAt`, `cached`, `items[]` với 9 field (rank, userId, username, avatar, wins, matchesPlayed, accuracy, avgResponseMs, totalScore)
  - `apps/api/src/modules/rankings/dto/index.ts` — barrel export
  - `apps/api/src/modules/rankings/rankings.service.ts` — cache-aside qua `RedisService.getJSON/setJSON`, TTL=60s, 2 nhánh raw SQL (weekly với `INTERVAL '7 days'`, all không filter), ORDER BY `wins DESC, total_score DESC, avg_response_ms ASC, id ASC`, rank gán client-side. `safeGetCache`/`safeSetCache` graceful-degrade khi Redis lỗi
  - `apps/api/src/modules/rankings/rankings.controller.ts` — 1 endpoint `GET /leaderboard`, `@Public()`, `@Throttle({ limit: 30, ttl: 60000 })`, ZodValidationPipe
  - `apps/api/src/modules/rankings/rankings.module.ts` — @Module({ controllers, providers, exports })
  - `apps/api/src/modules/rankings/rankings.service.spec.ts` — 11 tests (cache hit, cache miss + setJSON TTL, weekly branch, all branch, limit encoding, rank 1-based, empty result, Redis GET failure, Redis SET failure, BigInt conversion, TTL constant)
  - `apps/api/src/modules/rankings/rankings.controller.spec.ts` — 3 tests (forward period+limit, period=all+limit=100, response passthrough kèm cached flag)
  - `apps/api/src/modules/rankings/rankings.module.spec.ts` — 1 test (module compile + resolve service+controller)
  - `apps/api/src/app.module.ts` — import + register `RankingsModule`
- **Quyết định kỹ thuật đã chốt:**
  - Endpoint `@Public()` (guest xem được, mirror `/rooms/public`)
  - Pagination: limit-only, default 50, max 100
  - Cache key: `leaderboard:{period}:limit={N}` (encode limit để khác limit → khác cache entry)
  - Cache TTL: 60 giây
  - Invalidation: TTL-only (không bust thủ công khi match finish, theo Option C spec)
  - Failure mode: Redis lỗi → log warn → compute từ DB → trả `cached: false` (không throw)
  - Throttle: 30 req/min (public endpoint cần rate-limit nhẹ)
- **Verification:**
  - `pnpm --filter @arena/api test` → 418/418 pass (15 mới + 403 cũ, 0 regression)
  - `pnpm --filter @arena/api build` → nest build clean
  - `pnpm --filter @arena/api lint` → eslint clean
  - `pnpm --filter @arena/shared build` → tsc clean
  - `pnpm --filter @arena/web build` → next build clean
- **URL thật (khi dev server chạy):** `GET /api/v1/rankings/leaderboard?period=weekly&limit=50`

### Bước 5: Frontend Hooks & API Rewire ✅ HOÀN THÀNH

- **Mục tiêu:** Gỡ bỏ mock data ở Frontend và tích hợp các endpoint thật.
- **Chi tiết:**
  - Viết các hooks: `useProfileStats`, `useMatchHistory`, `useLeaderboard` gọi API thật qua `apiFetch`.
  - Cập nhật trang `/profile` để hiển thị stats thậy và lịch sử đấu thật.
  - Cập nhật trang `/rankings` để hiển thị leaderboard thật với toggle Weekly / All-time.
  - Cập nhật trang `/settings` hoặc khu vực login để cập nhật avatar seed lên server qua API.

### Bước 6: Seed Script & E2E Test Infrastructure ✅ HOÀN THÀNH

- **Mục tiêu:** Seed dữ liệu giả cho UI + E2E test, hoàn thiện E2E infrastructure.
- **Chi tiết:**
  - Tạo seed riêng `seed-demo.ts` (idempotent, 30 user + 8 match FINISHED, span 14 ngày, mulberry32 PRNG seed 20260606)
  - Setup Docker test PostgreSQL riêng (port 5434) để không đụng dev DB
  - Viết 11 E2E tests (Vitest + SWC + Fastify inject) cho `/users/me/*` và `/rankings/leaderboard`
  - Test app factory: override `CsrfGuard`/`ThrottlerGuard`/`RolesGuard` (giữ `JwtAuthGuard` thật), real CSRF flow cho mutating requests
- **Đã giao (2026-06-06):**
  - `apps/api/prisma/seed-demo.ts` — 30 user upsert theo `username`, 8 match FINISHED với mulberry32 PRNG (seed 20260606), `computeScore` theo công thức Bước 2 (`100 + max(0, (10000 - responseTimeMs) / 200)`), idempotent qua `deleteMany` match theo `roomId` của `DEMO_ARENA`, env guards (refuse prod + non-test DB trừ khi `DEMO_ALLOW_DEV_DB=true`)
  - `infrastructure/docker-compose.test.yml` — postgres:16-alpine riêng port 5434 (5433 đã bị dev postgres chiếm), gắn `postgres-init-test.sh`
  - `infrastructure/scripts/postgres-init-test.sh` — `ALTER USER arena_test CREATEDB`
  - `infrastructure/scripts/test-db-up.sh` — docker up + healthcheck + `prisma db push` + seed questions + seed demo
  - `infrastructure/scripts/test-db-down.sh` — `docker compose down -v`
  - `apps/api/test/vitest-e2e.config.ts` — vitest config với `unplugin-swc` (emit `design:paramtypes` cho NestJS DI), singleFork pool, 60s timeout
  - `apps/api/test/setup-e2e.ts` — env guards: refuse prod + non-test DB
  - `apps/api/test/helpers/test-app.factory.ts` — `Test.createTestingModule({imports: [AppModule]})` + FastifyAdapter + prefix `api` + version `1`, `overrideGuard(CsrfGuard|ThrottlerGuard|RolesGuard).useValue(alwaysPass)`, helpers `authedHeaders()` (ký JWT) + `mutatingHeaders()` (lấy CSRF token + cookie thật từ `/auth/csrf-token`)
  - `apps/api/test/helpers/db-helpers.ts` — lazy PrismaClient init, `findDemoUser`/`requireDemoUser`
  - `apps/api/test/helpers/redis-helpers.ts` — lazy ioredis client, `flushTestRedis`
  - `apps/api/test/modules/users.e2e-spec.ts` — 7 cases: 401 (no auth), 401 (malformed), 200 aggregate stats, 200 history pagination, 400 invalid limit, 200 PATCH avatar, 400 unknown seed
  - `apps/api/test/modules/rankings.e2e-spec.ts` — 4 cases: 200 all-time, cache hit/miss với same period+limit, 200 weekly filter, 400 invalid period
  - `apps/api/tsconfig.spec.json` — thêm `test/**`, exclude `test/e2e/**`
  - `apps/api/tsconfig.e2e.json` — riêng cho E2E
  - `apps/api/tsconfig.json` — references cả 3 tsconfig
  - `apps/api/eslint.config.mjs` — parser project thêm `tsconfig.e2e.json`
  - `apps/api/src/modules/users/users.service.ts` — fix `toSafeNumber()` để xử lý Prisma `Decimal` objects (do `numeric(10, 2)` cast trong raw SQL)
  - `apps/api/package.json` — scripts: `prisma:seed:demo`, `prisma:seed:demo:reset`, `test:e2e`, `test:e2e:watch`
  - `package.json` (root) — scripts: `test:db:up`, `test:db:down`, `test:db:reset`, `test:e2e`
  - Deps: `unplugin-swc`, `@swc/core` (cho `design:paramtypes` metadata)
- **Quyết định kỹ thuật đã chốt:**
  - **Vitest + SWC (không esbuild)**: esbuild không emit `decoratorMetadata: true` → NestJS DI `configService = undefined`. SWC plugin giải quyết.
  - **Test DB Docker riêng port 5434**: tránh xung đột dev postgres (đang chiếm 5433).
  - **Idempotent seed**: `upsert` User theo `username`, `deleteMany` Match theo `roomId` của `DEMO_ARENA`.
  - **Deterministic PRNG (mulberry32 seed 20260606)**: reproducible E2E + screenshot.
  - **Refuse non-test DB**: `seed-demo.ts` throw nếu `DATABASE_URL` không chứa `:5433/`, `:5434/`, hoặc `/arena_test`, trừ khi `DEMO_ALLOW_DEV_DB=true`.
  - **Score formula match Bước 2**: `isCorrect ? 100 + Math.max(0, (10000 - responseTimeMs) / 200) : 0`.
  - **Match span 14 ngày**: 1 match mỗi 0.5–13.5 ngày trước.
  - **Override CSRF/Throttler/Roles, giữ JwtAuthGuard thật**: test business logic + auth 401 path real.
  - **Real CSRF flow cho mutating requests**: `overrideGuard` không hoạt động với `APP_GUARD: useClass` provider; helper `mutatingHeaders()` lấy token thật từ `/auth/csrf-token` để CsrfGuard pass.
  - **Timeout rate 15%**: đảm bảo mỗi `matchPlayer` có answer rows (rotates fairly qua các round) để `avgResponseMs` không bị 0 do thiếu data.
  - **Response wrapping**: `TransformInterceptor` wrap thành `{ success, message, data }`. Tests access `body.data.X`.
  - **Prisma Decimal handling**: `numeric(...)` cast trong raw SQL trả về `Decimal` object (type `object`), không phải `string`/`number`. Phải check `toNumber()`/`valueOf()` trong `toSafeNumber()` helper.
- **Verification:**
  - `pnpm --filter @arena/api test` → 418/418 pass
  - `pnpm --filter @arena/api test:e2e` → 11/11 pass (7 users + 4 rankings)
  - `pnpm --filter @arena/api lint` → eslint clean
  - `pnpm lint` (root) → all clean
  - `pnpm --filter @arena/api build` → tsc clean
  - `pnpm --filter @arena/shared build` → tsc clean
  - `pnpm --filter @arena/web build` → next build clean
  - `pnpm test:db:up` → test DB healthy + schema + questions + demo seeded
