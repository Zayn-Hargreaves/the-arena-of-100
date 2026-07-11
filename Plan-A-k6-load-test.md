# Plan A — k6 Load Test (100 concurrent WebSocket users)

> Track độc lập tuyệt đối. Chạy song song với B/C/D. Xem tổng quan: [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#1 & P2 (đây là **gate** cho quyết định spectator transport split).

## Mục tiêu

Đo baseline hành vi của game loop server-authoritative dưới **100 người dùng WebSocket đồng thời** để có số liệu thực (latency, drop, CPU/mem, Redis) trước khi quyết định có tách spectator transport hay không.

## Vì sao độc lập

Chỉ thêm thư mục `load-test/` + script CI. Không sửa symbol nào trong `apps/`/`packages/` → blast radius = 0, không xung đột với B/C/D.

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
- [ ] (Optional) Thêm job CI thủ công (`workflow_dispatch`) để chạy lại tải.

## File dự kiến thêm (không sửa file cũ)

```
load-test/
  config.js
  scenarios/full-match.js
  scenarios/spectator-flood.js
  lib/auth.js          # sinh handshake token
  lib/protocol.js
  lib/metrics.js
  README.md            # cách chạy + kết quả baseline
load-test/.github/workflows/load-test.yml — workflow CI bắt buộc
```

## Điểm tích hợp cần đọc (chỉ đọc, không sửa)

- Handshake auth: `apps/api/src/gateways/handlers/auth.handler.ts` (cơ chế token).
- Event names/payload: `packages/shared/src/events.ts`, `packages/shared/src/schemas.ts`.
- Seed dữ liệu: `apps/api/prisma/seed-demo.ts`.

## Acceptance

- [ ] 100 VU chạy hết 1 match không crash server, đáp ứng các tiêu chí pass/fail định lượng sau (thay cho đề xuất):
  - error rate < 1%
  - p95 latency < 1000ms
  - p99 latency < 2500ms
  - Tỉ lệ disconnect đột ngột < 1%
  - CPU/Memory server ổn định, không leak bộ nhớ
  - Bộ nhớ/key Redis ổn định, dọn dẹp sạch sau trận đấu
- [ ] Báo cáo trong `load-test/README.md` phải ghi rõ metadata bắt buộc gồm: phiên bản build (commit hash), cấu hình môi trường, số VU, thời lượng, dữ liệu/match và lệnh chạy để kết quả spectator split có thể tái lập.
- [ ] Chỉ kết luận P2 (spectator transport split) khi tất cả tiêu chí định lượng ở trên đều đạt.
- [ ] `memory-bank/progress.md` cập nhật trạng thái k6.

## Rủi ro

- Token/handshake trong kịch bản tải có thể khác flow thật → verify bằng smoke A1 trước khi scale.
- Cần môi trường có Redis + Postgres thật (không mock) để số liệu có ý nghĩa.
