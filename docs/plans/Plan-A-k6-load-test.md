# Plan A — k6 Load Test (100 concurrent WebSocket users)

> Track độc lập tuyệt đối. Chạy song song với B/C/D. Xem tổng quan: [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#1 & P2 (đây là **gate** cho quyết định spectator transport split).

## Mục tiêu

Đo baseline hành vi của game loop server-authoritative dưới **100 người dùng WebSocket đồng thời** để có số liệu thực (latency, drop, CPU/mem, Redis) trước khi quyết định có tách spectator transport hay không.

## Vì sao độc lập

Chỉ thêm thư mục `load-test/` + script CI. **Ngoại lệ duy nhất đã land** (xem "Điểm tích hợp cần đọc"):
một field tối thiểu trên `apps/api/src/modules/health/health.controller.ts` —

- Bổ sung `rssBytes: number` + `totalMemBytes: number` trên response của `GET /health/monitoring`
  (xem `health.controller.ts:39-48`, `:103-108`) để sampler ghi raw `*.cpu.jsonl` không mất precision
  khi round-trip qua MB rounding. Không đổi behavior runtime; chỉ expose thêm field đã có sẵn
  (`process.memoryUsage().rss`, `os.totalmem()`).
- Blast của exception: chỉ 1 file controller + thêm field response (legacy `memoryUsageMb` /
  `totalMemoryMb` vẫn giữ). Không đụng enum, không đổi status code, không đổi auth.
- Phần còn lại (harness/sampler/validator/CI): trong `load-test/` + `.github/workflows/`.
  → Blast radius = 1 file controller + thư mục mới; không xung đột với B/C/D.

## Phase

### Phase A1 — Hạ tầng & smoke (1 phòng, 2 người)

- [ ] Thêm thư mục `load-test/` với k6 (`xk6-websockets` hoặc `k6/experimental/websockets`).
- [ ] Script kịch bản cơ bản: connect → authenticate (handshake token) → join room → nhận `MATCH_STARTING`/`ROUND_STARTED` → submit answer → nhận `ROUND_ENDED`.
- [ ] Config môi trường test (URL, token generator) tách khỏi prod; seed sẵn phòng/câu hỏi qua `prisma/seed-demo.ts`.
- [ ] Smoke: 2 client hoàn tất 1 match end-to-end không lỗi.

### Phase A2 — Kịch bản tải thật (100 WS)

- [ ] Ramp: 0 → 100 VU qua 30s, giữ tải suốt 1 match đầy đủ (nhiều round).
- [ ] Trộn hồ sơ người dùng: player (join + answer) và spectator (drop-in `SPECTATOR`, chỉ nhận).
- [ ] Thu thập: p50/p95/p99 latency (answer→result echo), tỉ lệ disconnect, số message/giây, error rate.
- [ ] Đo phía server song song: CPU/mem của `apps/api`, số key Redis `match:state:*`, thời gian round tick.

### Phase A3 — Báo cáo & ngưỡng

- [ ] Ghi kết quả vào `load-test/README.md` + cập nhật `memory-bank/progress.md` (thay dòng "k6 load evidence" ở "What Is Not Done Yet").
- [ ] Kết luận rõ: **có/không** cần spectator transport split (P2). Đây là output feed cho quyết định P2.
- [ ] (Optional) Thêm job CI thủ công (`workflow_dispatch`) ở `.github/workflows/load-test.yml` để chạy lại tải.

## File dự kiến thêm (không sửa file cũ)

Cây thư mục tham chiếu. Trạng thái thực tế trong repo (cập nhật lần cuối:
xem thẻ `Last verified` ở cuối file). Mục này là đích đến mong muốn của plan;
một số mục đã có thật, một số mục còn là backlog (sampler/validator) và
được đánh dấu `[planned]`.

```text
load-test/
  config.js
  scenarios/smoke.js
  scenarios/full-match.js
  scenarios/spectator-flood.js
  lib/auth.js          # sinh handshake token qua POST /api/v1/auth/guest
  lib/protocol.js      # event names, mirror từ packages/shared/src/socket.ts
  lib/socketio.js      # minimal EIO=4 / socket.io v4 client cho k6
  lib/flows.js         # player / host / spectator flows
  lib/scenario-common.js  # shared setup + exec functions cho multi-VU
  lib/metrics.js       # custom k6 metrics
  lib/runtime-metadata.js       # resolve REDIS_URL/REDIS_KEY_PREFIX
  lib/readiness.js             # AUTHENTICATED set coordinator client
  lib/reporting.js     [planned]      # ghi anchor timestamps, summary
  scripts/sample-monitoring.mjs       # CPU/RSS + Redis JSONL sampler
  scripts/validate-results.mjs        # steady-state/cleanup validator
  scripts/coordinator.mjs             # readiness sidecar (idempotent SADD)
  README.md            # cách chạy + kết quả baseline
.github/workflows/load-test.yml  # workflow CI manual
```

## Điểm tích hợp cần đọc (chỉ đọc, không sửa runtime)

- Handshake auth: `apps/api/src/modules/auth/auth.service.ts` (verifyToken),
  `apps/api/src/modules/auth/auth.controller.ts` (POST `/api/v1/auth/guest`).
- Event names/payload: `packages/shared/src/socket.ts` (ClientEvent / ServerEvent,
  `Namespace = "/game"`). `packages/shared/src/schemas.ts` chỉ định nghĩa
  payload schema; harness chỉ cần event-name strings + frame format từ
  `socket.ts`.
- Question seed: `pnpm --filter @arena/api prisma:seed:dev`
  (`apps/api/prisma/seed.ts`) — bắt buộc vì match loop cần question rows.
  `seed-demo.ts` chỉ liên quan tới Profile/Rankings demo, không phải
  dependency của load test.

## Acceptance

- [ ] 100 VU chạy hết 1 match không crash server, đáp ứng các tiêu chí pass/fail định lượng sau (thay cho đề xuất):
  - error rate < 1%
  - p95 latency < 1000ms
  - p99 latency < 2500ms
  - Tỉ lệ disconnect đột ngột < 1%
  - CPU/Memory server ổn định, không leak bộ nhớ (xem định nghĩa đo lường bên dưới)
  - Bộ nhớ/key Redis ổn định, dọn dẹp sạch sau trận đấu (xem định nghĩa đo lường bên dưới)
- [ ] Báo cáo trong `load-test/README.md` phải ghi rõ metadata bắt buộc gồm: phiên bản build (commit hash), cấu hình môi trường, số VU, thời lượng, dữ liệu/match, lệnh chạy, **resolved Redis target** (xem dưới) để kết quả spectator split có thể tái lập.
- [ ] **Raw artifacts bắt buộc lưu cùng báo cáo** (để bất kỳ tiêu chí nào ở trên đều có thể recalculate/audit lại):
  - Raw k6 summary: `--summary-export=load-test/results/<scenario>-<commit>-<timestamp>.json` (giữ raw JSON, không chỉ giữ cell trong bảng Markdown).
  - Raw CPU/RSS samples: `load-test/results/<scenario>-<commit>-<timestamp>.cpu.jsonl` — mỗi dòng có dạng:
    ```text
    { ts: ISO-8601, cpu: number|null, rssBytes: number|null, totalMemBytes: number|null, roomCount: number|null, error?: string }
    ```
    Lưu ý đơn vị: `rssBytes` và `totalMemBytes` là **bytes** (số nguyên, KHÔNG làm tròn sang MB). Cả giá trị `null` và `error` PHẢI được lưu để có thể verify "không âm thầm bỏ qua". Producer (sampling script) và consumer (validator) PHẢI dùng cùng tên field, không được tự ý đổi sang `rss` / `totalMem` / `memoryUsageMb`.
  - Raw Redis samples: `load-test/results/<scenario>-<commit>-<timestamp>.redis.jsonl` — mỗi dòng có dạng:
    ```text
    { ts: ISO-8601, usedMemoryBytes: number|null, connectedClients: number|null, keyCount: number|null, pattern: string, db: number, redisUrl: string }
    ```
    Lưu ý đơn vị: `usedMemoryBytes` là **bytes** (số nguyên). `redisUrl` PHẢI là **URL đã redacted** (xem mục "Resolved Redis target" bên dưới). KHÔNG lưu userinfo, password, token, hoặc bất kỳ secret nào trong raw artifact.
  - **Tool versions** ghi trong cùng file README: `k6 --version`, `redis-cli --version`, container image (nếu sample chạy trong container), hash commit API, hash commit web.
  - **Sample counts** ghi rõ: số mẫu CPU thu được, số mẫu `null`, số mẫu lỗi, số mẫu Redis, số mẫu trong steady-state vs cleanup. Mỗi p95/peak/delta báo cáo PHẢI đi kèm `n=` để có thể audit.
  - **Resolved Redis target (REDACTED)** ghi rõ trong README (xem phần "Nguồn dữ liệu & tần suất lấy mẫu" bên dưới): chỉ scheme, host, port, DB, `REDIS_KEY_PREFIX` (nếu có) và scan pattern. **KHÔNG BAO GIỜ** ghi `REDIS_URL` nguyên bản, userinfo, password, hoặc token vào README hoặc raw artifact.
  - Mọi giá trị p95/peak/delta công bố trong bảng "Baseline results" PHẢI truy ngược được về raw artifact (đường dẫn trong README + số dòng / timestamp).
  - Mọi tiêu chí "Đạt/Không đạt" ở dưới phải truy ngược được về raw artifact tương ứng.
- [ ] Kết luận benchmark (cập nhật quy tắc "Đạt/Không đạt" để tham chiếu các định nghĩa dưới đây):
  - **Đạt**: khi TẤT CẢ tiêu chí ở trên (error rate, latency, disconnect, CPU/Memory, Redis) đều thoả mãn định nghĩa khách quan bên dưới ⇒ ghi nhận kết quả, feed vào quyết định P2 (spectator transport split).
  - **Không đạt**: khi BẤT KỲ tiêu chí nào vi phạm định nghĩa bên dưới ⇒ ghi nhận "benchmark không đạt", nêu rõ tiêu chí thất bại (kèm số liệu, kèm link raw artifact), và:
    - Mở follow-up điều tra/khắc phục nguyên nhân (lưu vào `memory-bank/progress.md`).
    - HOẶC đánh giá lại khả năng cần spectator transport split sớm hơn (P2 chuyển từ "gate" sang "phụ thuộc bắt buộc") dựa trên tiêu chí thất bại cụ thể.
  - Không để trạng thái "không có quyết định".

### Định nghĩa đo lường (objective, reproducible)

Áp dụng cho **CPU/Memory** và **Redis** — các tiêu chí phải được đo bằng nguồn dữ liệu cụ thể, trong cửa sổ quan sát xác định, với ngưỡng số liệu rõ ràng để so sánh pass/fail. Mọi giá trị dùng để kết luận PHẢI từ raw artifact đã lưu ở checklist trên.

**Nguồn dữ liệu & tần suất lấy mẫu**:

- CPU% và RSS (memory): endpoint `GET /health/monitoring` (xem
  `apps/api/src/modules/health/health.controller.ts:81-98`,
  `apps/api/src/modules/health/services/cpu-sampler.service.ts`). Lấy mẫu mỗi
  **1 giây**. **CPU% đo cho process API** (không phải cả container); mỗi
  container nên sample riêng nếu API chạy trong container. **Quy ước CPU%
  của plan này: `100% = 1 core`** (chứ không phải 100% = toàn bộ host).
  Do đó công thức CPU% lấy theo `CpuSamplerService` PHẢI được điều chỉnh
  để khớp quy ước này:
  - `deltaCpuMicros = (cpu.user + cpu.system) - (prev.user + prev.system)`
  - `elapsedMs = now - prevTime`
  - `cpu% = min(100 * numCpus, deltaCpuMicros / 1000 / elapsedMs * 100)`
  - Trong đó `numCpus = os.cpus().length`.
  - Việc **nhân kết quả hiện tại của `CpuSamplerService` với `numCpus`**
    là cách đơn giản nhất để chuyển từ "100% = tổng cores" sang
    "100% = 1 core" mà không phải đổi logic core. KHÔNG dùng cách "chia
    thêm `numCpus`" — đó là sai hướng (sẽ cho ra giá trị rất nhỏ, vô
    nghĩa).
  - Ghi rõ convention này trong README: `cpu%` được hiểu là "% của 1 core",
    nên `200%` = dùng hết 2 cores, `400%` trên máy 4 cores = fully loaded.
- RSS: `process.memoryUsage().rss` (bytes) từ `/health/monitoring` (`rssBytes`
  raw). Trước khi sửa, controller chỉ trả `memoryUsageMb` (đã làm tròn
  MB) — bước triển khai sẽ thêm field `rssBytes` để raw artifact không
  bị mất precision.
- **Resolved Redis target** (KHÔNG hard-code `redis-cli -n 2` / `match:state:*`):
  - Lấy `REDIS_URL` từ cùng runtime config mà API dùng (`apps/api/src/modules/redis/redis.service.ts:15-18`).
  - Parse từ `REDIS_URL` (KHÔNG dùng default DB nào ngoài `0`): **scheme, host, port, database (path segment `/<n>`)**, và cờ **TLS** (scheme `rediss://` hoặc port 6380 thường đi với TLS).
  - Lấy `REDIS_KEY_PREFIX` từ cùng runtime config (`apps/api/src/modules/redis/redis.service.ts:19-22`).
  - **Authentication (auth)**: nếu `REDIS_URL` chứa userinfo (`user:password@host`), sampler PHẢI dùng **client config (file cấu hình hoặc env không log)** thay vì truyền trên command line. KHÔNG BAO GIỜ đặt `--user` / `--pass` / `--askpass` với secret thật trong command. Nếu phải dùng `redis-cli` ngoài, dùng `REDISCLI_AUTH` env var hoặc một `redis.conf` tham chiếu qua `redis-cli -u <redacted-url>` với secret từ env/file.
  - Pattern quét: `<prefix?>match:state:*` (prefix nếu có, ngược lại `match:state:*`).
  - **Redacted logging**: chỉ ghi các field `scheme`, `host`, `port`, `db`, `tls: boolean`, `keyPrefix`, `pattern` vào README và raw artifact. `userinfo`/password/token PHẢI được loại bỏ khỏi mọi log line, error message, và JSON record. Validation bằng regex ở CI: nếu phát hiện chuỗi `://[^@/]+@` trong `redisUrl` log, fail.
  - Sample mỗi **1 giây** qua một sampler script đọc cùng `REDIS_URL` / `REDIS_KEY_PREFIX` (KHÔNG hard-code). Kết quả ghi raw JSONL với schema ở checklist trên.

**Cửa sổ quan sát**:

- **Warm-up window**: từ lúc k6 bắt đầu ramp tới khi `ROUND_STARTED` đầu tiên được phát ra **VÀ** đủ 100 VU đã xác thực (readiness barrier — xem dưới). Mẫu thu thập trong window này **không tính** vào pass/fail.
- **Readiness barrier (bắt buộc cho A2)**: steady-state measurement **CHỈ bắt đầu** khi đồng thời thoả:
  1. `ROUND_STARTED` đầu tiên đã được phát ra, VÀ
  2. Cả **100 VU** đã emit event `AUTHENTICATED` tới một **cơ chế điều phối bên ngoài (external coordinator) hoặc cơ chế tổng hợp phía server (server-side aggregation)** nhận các idempotent AUTHENTICATED ACKs keyed by VU ID (ví dụ lưu trữ trong Redis Set) để hoạt động chính xác qua các isolated k6 VMs:
     - Định danh VU ID được gửi lên bộ điều phối phải là duy nhất trên toàn bộ test run (sử dụng `exec.vu.idInTest` hoặc ID dạng composite ổn định, tuyệt đối **KHÔNG dùng** `idInInstance` vì nó chỉ có tính duy nhất cục bộ trong mỗi instance của k6). Cả bản tin AUTHENTICATED acknowledgment gửi từ VU và danh sách báo cáo VU thiếu đều phải nhất quán sử dụng định danh duy nhất này.
     - Trên mỗi `AUTHENTICATED` ack, gửi định danh VU duy nhất trên toàn test run này (ví dụ `exec.vu.idInTest`) để bộ điều phối thêm vào Set (idempotent, NO-OP nếu VU ID đã tồn tại).
     - **KHÔNG dùng `Counter`**: vì `Counter` đếm tổng, khi `k6` thử lại (retry) có thể tăng giá trị giả ⇒ vượt 100 ⇒ readiness đạt sai. Sử dụng cơ chế Set đảm bảo tính idempotent: dù một VU gửi `AUTHENTICATED` nhiều lần, Set chỉ giữ một entry duy nhất cho VU đó.
     - Kiểm tra trạng thái sẵn sàng (readiness checks) và timeout sẽ được thực hiện tại bộ điều phối bằng cách kiểm tra kích thước Set (`Set.size === 100`, sử dụng `Set.size` thay vì gọi method `size()`).
       Nếu readiness gate không đạt trong `2 * HOLD` ⇒ **fail** benchmark. Khi fail, báo cáo rõ số lượng VU hiện tại (`Set.size = <n> < 100`) kèm theo danh sách các VU ID (sử dụng định danh duy nhất trên toàn bộ test run ở trên, ví dụ `exec.vu.idInTest`) còn thiếu.
- **Steady-state window**:
  - Bắt đầu từ khi readiness barrier thoả mãn, kéo dài ít nhất `HOLD` (đã có).
  - **Minimum steady-state duration**: `HOLD_MIN = 30s` (configurable qua env, mặc định 30s). **HOLD_MIN PHẢI ≥ 30s**: env parsing PHẢI dùng `clamped = max(30s, parsedValue)`. Nếu `parsedValue < 30s` ⇒ KHÔNG reject (vẫn dùng 30s), nhưng log cảnh báo rằng giá trị đã được clamp. Nếu steady-state window thực tế < `HOLD_MIN` (sau clamp) ⇒ **fail** benchmark.
  - **Minimum valid sample count**: `N_MIN = max(20, ceil(HOLD_MIN))` mẫu CPU hợp lệ trong steady-state (dùng `HOLD_MIN` đã clamp). Nếu `n_steady < N_MIN` ⇒ **fail** benchmark.
- **Cleanup window**: **30 giây** sau khi server phát `MATCH_FINISHED`. Dùng để đánh giá teardown.

**CPU/Memory — định nghĩa**:

> Quy ước: mọi ngưỡng CPU dưới đây hiểu theo **`100% = 1 core`** (xem "Nguồn dữ liệu & tần suất lấy mẫu"
> line 121-136). CpuSamplerService (`apps/api/src/modules/health/services/cpu-sampler.service.ts:43-48`)
> đã clamp về `100 * numCpus` để 1 host 4 cores có thể report tới 400%; `200%` = dùng hết 2 cores,
> `400%` trên máy 4 cores = fully loaded. Mọi `cpuUsage` từ `/health/monitoring` (`health.controller.ts:103`)
> theo convention này.

- **Peak CPU** ≤ **80% of 1 core** (lấy max của tất cả mẫu hợp lệ trong steady-state; bỏ qua mẫu `null` đầu tiên vì chưa có baseline).
- **P95 CPU** ≤ **70% of 1 core** (trong steady-state).
- **Peak RSS** ≤ **500 MB** (trong steady-state).
- **RSS delta (leak gate)**: `RSS(cleanup_window_end_anchor) − RSS(cleanup_window_start_anchor)` ≤ **+50 MB**. Vượt ngưỡng ⇒ đánh giá như leak bộ nhớ ⇒ fail.
- **Anchor sampling (xem "Anchor sampling & tolerance" bên dưới)**: vì sampler chạy 1 lần/giây, các mốc `cleanup_window_start` / `cleanup_window_end` / `pre_run_baseline` có thể rơi giữa hai tick. Sampler PHẢI **chủ động collect thêm một mẫu ngay tại hoặc ngay sau mỗi anchor** (xem "Anchor sampling & tolerance") thay vì dùng mẫu gần nhất một cách tự do.
- **Failure semantics** (KHÔNG được âm thầm bỏ qua):
  - Mọi mẫu CPU trả về `null` **SAU** mẫu baseline (≥ 1 mẫu hợp lệ đã có) ⇒ **fail** benchmark.
  - Mọi mẫu sampling lỗi (network/HTTP/redis-cli non-zero exit) **SAU** warm-up ⇒ **fail** benchmark.
  - Nếu steady-state không có đủ mẫu hợp lệ để tính peak/P95 (xem `N_MIN` ở trên) ⇒ **fail** benchmark.
  - Nếu anchor `cleanup_window_start` HOẶC `cleanup_window_end` thiếu/không lấy được ⇒ **fail** benchmark.

**Redis — định nghĩa**:

- **`match:state:*` count (steady-state)**: PHẢI bằng `expected` ở **MỌI mẫu** trong steady-state. KHÔNG chấp nhận biến thiên giữa các mẫu — rule cũ "±1" bị bãi bỏ.
  - `expected` cho **A2 (full-match) = 1**.
  - `expected` cho các scenario khác do owner scenario khai báo (A1 smoke: 0 sau khi match kết thúc, A3 spectator-flood: 1).
  - Một mẫu bất kỳ lệch ⇒ **fail** benchmark.
- **`match:state:*` count (cleanup)**: tại **3 mẫu liên tiếp cuối cleanup window**, số key phải bằng **0** (hoặc bằng baseline trước run nếu có match khác đang chạy). Một mẫu lệch ⇒ fail. Khi áp dụng tolerance, lấy 3 mẫu cuối trong cleanup window (3 mẫu có `ts` gần `cleanup_window_end` nhất theo "Anchor sampling & tolerance") — không yêu cầu timestamp trùng khớp byte-for-byte.
- **Redis memory delta**: `usedMemoryBytes(cleanup_window_end_anchor) − usedMemoryBytes(pre_run_baseline_anchor)` ≤ **+10%**. Vượt ⇒ fail. Cả hai anchor đều PHẢI là anchor sample lấy theo "Anchor sampling & tolerance".
- **Connected clients**: số `connected_clients` (Redis) phải giảm về giá trị trước run trong cleanup window (chỉ là tín hiệu phụ, không bắt buộc fail).
- **Anchor sampling & tolerance**:
  - Mục đích: tránh race condition khi timestamp mốc (`cleanup_window_start`, `cleanup_window_end`, `pre_run_baseline`) rơi giữa hai tick 1Hz.
  - **Quy tắc cứng**: sampler PHẢI chủ động thu thập một mẫu bổ sung ngay tại (hoặc ≤ 100ms sau) các mốc anchor. Nếu sampler chỉ chạy đúng 1Hz, anchor sample sẽ trùng với một tick 1Hz gần nhất; nếu trùng thì dùng mẫu 1Hz đó.
  - **Nearest-sample tolerance**: nếu anchor sample không thể lấy được (sampler 1Hz thuần), dùng mẫu 1Hz gần nhất trong khoảng `[anchor - 2s, anchor + 2s]`. Nếu không có mẫu nào trong khoảng này ⇒ **fail** benchmark.
  - Áp dụng cho: `pre_run_baseline` (RSS + Redis memory), `cleanup_window_start` (RSS), `cleanup_window_end` (RSS + Redis memory), `cleanup window 3 mẫu cuối` (Redis keyCount).
  - Validator PHẢI log anchor được chọn (`ts`, giá trị) vào report để có thể audit.

**Ánh xạ Đạt/Không đạt**:

- "Đạt" chỉ được ghi nhận khi **TẤT CẢ** các tiêu chí dưới đây đồng thời thoả mãn trong đúng cửa sổ quan sát tương ứng, **VÀ** readiness barrier + minimum steady-state duration + minimum sample count đều thoả mãn. **Bất kỳ** tiêu chí nào vi phạm ⇒ kết quả là "Không đạt" — KHÔNG được đánh dấu "Đạt" khi chỉ một phần đạt.
- **Tiêu chí load-quality (bắt buộc)**:
  - `error rate < 1%` — observation window: toàn bộ test run (warm-up + steady-state + cleanup). Threshold: `app_error_rate` k6 metric.
  - `p95 latency < 1000ms` — observation window: steady-state. Threshold: `answer_result_latency_ms.p(95)`.
  - `p99 latency < 2500ms` — observation window: steady-state. Threshold: `answer_result_latency_ms.p(99)`.
  - `Tỉ lệ disconnect đột ngột < 1%` — observation window: toàn bộ test run. Threshold: `ws_unexpected_disconnect / ws_connect_success` (tỷ lệ số unexpected socket close chia cho số session/kết nối thành công thực tế). Trường hợp `ws_connect_success = 0` (không có kết nối nào thành công) thì kết quả tỷ lệ disconnect đột ngột phải được đánh dấu là “Không đạt” hoặc “N/A” không thỏa mãn ngưỡng (fails the threshold), và KHÔNG được coi là 0%.
  - **CPU peak ≤ 80%** — observation window: steady-state.
  - **CPU p95 ≤ 70%** — observation window: steady-state.
  - **RSS peak ≤ 500 MB** — observation window: steady-state.
  - **RSS delta ≤ +50 MB** — observation window: cleanup (`cleanup_window_end − cleanup_window_start`).
  - **Redis `match:state:*` count == expected at every sample** — observation window: steady-state. expected: A2 = 1.
  - **Redis `match:state:*` count cleanup**: 3 mẫu liên tiếp cuối cleanup == 0 (hoặc baseline).
  - **Redis memory delta ≤ +10%** — observation window: `cleanup_window_end − pre_run_baseline`.
  - **Readiness barrier đạt** trong `2 * HOLD`.
  - **Steady-state duration ≥ HOLD_MIN** (= 30s sau khi clamp).
  - **`n_steady ≥ N_MIN`** (= `max(20, ceil(HOLD_MIN))`).
- **Báo cáo vi phạm**: mỗi vi phạm PHẢI được liệt kê theo **tên tiêu chí + giá trị đo + threshold + observation window** trong report. Ví dụ:
  - `"error rate: 1.42% > 1.00% (window: full run)"`
  - `"p95 latency: 1245ms > 1000ms (window: steady-state, n=68 samples)"`
  - `"RSS delta: +71MB > +50MB (window: cleanup, anchors: cleanup_window_start=482MB, cleanup_window_end=553MB)"`
  - `"match:state:* count: 1 sample at seq 12 = 0, expected 1 (window: steady-state)"`
  - `"steady-state duration: 22s < HOLD_MIN 30s"`
  - `"Set.size: 97 < 100 in 2*HOLD (missing VUs: 12, 45, 87)"`
- **Quyết định cuối cùng**:
  - "Đạt" chỉ ghi nhận khi tất cả các mục trên đều PASS, **không có** mục nào FAIL, **không có** mục nào thiếu sample.
  - "Không đạt" ghi nhận khi **một hoặc nhiều** mục FAIL; bắt buộc liệt kê từng mục FAIL.
  - Một số mục load-quality (error rate, p95, p99, disconnect) vượt ngưỡng ⇒ ngay lập tức "Không đạt" bất kể CPU/Memory/Redis ổn định — **không có ngoại lệ "đạt một phần"**.

- [ ] `memory-bank/progress.md` cập nhật trạng thái k6.

## Rủi ro

- Token/handshake trong kịch bản tải có thể khác flow thật → verify bằng smoke A1 trước khi scale.
- Cần môi trường có Redis + Postgres thật (không mock) để số liệu có ý nghĩa.
