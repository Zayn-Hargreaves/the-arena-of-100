# Plan D — Replay Contract (`lastSeenSeqNo` delta replay)

> **Wave 2 — bắt đầu SAU khi Track C merge vào main** (xung đột file với C). Xem [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#4. `submissionId` idempotency đã xong; phần này là delta replay còn treo.

## Vấn đề hiện tại (đã verify)

`MatchStateMachine.getSnapshot(lastEventSeqNo)` tại `match-state-machine.ts:471` **nhận tham số `lastEventSeqNo` nhưng bỏ qua nó** — luôn trả về full snapshot và chỉ echo lại con số. Handler `match.handler.ts:229` gọi `stateMachine.getSnapshot(payload.lastSeenSeqNo)` rồi emit `SNAPSHOT`. Tức là reconnect hiện luôn là **full hydrate**, chưa có delta.

Trong khi đó `eventLog` đã tồn tại sẵn trong state machine (`push` tại line ~493, serialize tại ~505/517, rehydrate ~548/553) — đây là nền để dựng delta replay.

## Mục tiêu

Khi client reconnect với `lastSeenSeqNo`, server trả **chỉ các event sau mốc đó** (delta) thay vì full snapshot, giảm payload và giữ thứ tự event. Fallback về full snapshot khi delta không khả dụng (gap quá lớn / eventLog đã bị cắt).

## ⚠️ Phụ thuộc Track C

Cùng đụng `packages/game-core/src/match-state-machine.ts` và `apps/web/src/stores/socket-store.ts`. **Chờ C merge**, rebase D lên main mới, rồi làm — tránh xung đột elimination logic.

## Phase

### Phase D1 — Thiết kế contract (không code)

- [ ] `gitnexus_impact({target: "getSnapshot", direction: "upstream"})` + trace flow `handleRequestSnapshot`.
- [ ] Định nghĩa contract và cơ chế tương thích ngược (backward compatibility) cho `SNAPSHOT`:
  - Request từ client KHÔNG có `lastSeenSeqNo` (client cũ) -> Trả trực tiếp payload snapshot đầy đủ (full snapshot) để bảo đảm client cũ hoạt động bình thường, hoặc triển khai capability/version negotiation.
  - Request từ client CÓ `lastSeenSeqNo` (client mới) -> Trả về payload có cấu trúc `{ mode: "delta", events: [...] }` hoặc `{ mode: "full", snapshot }`.
- [ ] Quy tắc fallback: nếu `lastSeenSeqNo < eventLog[0].seqNo` (đã bị cắt) hoặc gap bất thường -> trả full.
- [ ] Cập nhật schema/event trong `packages/shared/src/{events,schemas}.ts` (giữ backward-compat: client cũ vẫn nhận full).
- [ ] Bổ sung các handler tests cho cả client cũ và mới, bao phủ cả trường hợp phản hồi full và delta.

### Phase D2 — Server: dựng delta

- [ ] Thêm `getDelta(lastSeenSeqNo)` đọc `eventLog`, trả các event có seqNo > lastSeenSeqNo. **Chỉ thêm method, không đổi chữ ký `getSnapshot` cũ** (giữ full-hydrate cho caller khác).
- [ ] Bổ sung validation trong `getDelta` và logic chọn replay tại `match.handler.ts` để chỉ trả delta khi:
  - `eventLog` không rỗng.
  - `lastSeenSeqNo` hợp lệ và thuộc đúng match hiện tại.
  - `lastSeenSeqNo` không vượt quá `latestSeqNo`.
  - Các `seqNo` liên tục và đầy đủ từ `lastSeenSeqNo + 1` đến `latestSeqNo`.
- [ ] Xử lý fallback về full snapshot cho mọi trường hợp thiếu mốc, gap, log bị cắt, hoặc thuộc match khác.
- [ ] Gán seqNo ổn định cho mỗi event trong `logEvent` và bảo đảm cơ chế snapshot/rehydrate (serialize/rehydrate) lưu trữ và bảo toàn cả `seqNo` và bộ đếm `next-sequence` (next-sequence counter).

### Phase D3 — Client: áp dụng delta

- [ ] `socket-store.ts` / `socket-store.updaters.ts`: nhận `mode: "delta"` → apply tuần tự event lên state hiện tại; `mode: "full"` → hydrate như cũ.
- [ ] Theo dõi `lastSeenSeqNo` phía client (cập nhật mỗi event nhận được) để gửi kèm khi reconnect.
- [ ] Xử lý out-of-order / trùng seqNo (idempotent apply).

### Phase D4 — Test & chốt

- [ ] Unit game-core: `getDelta` trả đúng tập event sau mốc; fallback full khi gap.
- [ ] Handler test: reconnect với client cũ & mới, bao phủ cả phản hồi full và delta. Thêm test bao phủ từng trường hợp fallback (eventLog rỗng, lastSeenSeqNo sai match, lastSeenSeqNo > latestSeqNo, gap giữa các seqNo, log bị cắt) và xác nhận response mode là full.
- [ ] Test Redis round-trip: xác nhận serialize/rehydrate bảo toàn `seqNo` và bộ đếm `next-sequence`, khởi động lại không tạo `seqNo` trùng, và xác nhận delta replay không bỏ sót hoặc trả sai event.
- [ ] `gitnexus_detect_changes()`; cập nhật `progress.md` (xoá "Full reconnect/event replay contract" khỏi "Not Done Yet").

## File dự kiến chạm

- `packages/game-core/src/match-state-machine.ts` (thêm `getDelta` + seqNo cho eventLog).
- `apps/api/src/gateways/handlers/match.handler.ts` (chọn mode).
- `packages/shared/src/{events,schemas}.ts` (contract delta/full).
- `apps/web/src/stores/{socket-store,socket-store.updaters,socket-store.types}.ts`.

## Acceptance

- [ ] Reconnect với `lastSeenSeqNo` hợp lệ nhận delta; state sau delta == full-hydrate.
- [ ] Fallback full hoạt động chính xác khi eventLog không đủ, có gap, hoặc sai match.
- [ ] Backward-compat: client không gửi `lastSeenSeqNo` vẫn nhận trực tiếp payload snapshot đầy đủ (hoặc qua fallback full) như cũ.
- [ ] `getSnapshot` cũ giữ nguyên chữ ký (chỉ mở rộng `getDelta`).
- [ ] `seqNo` và bộ đếm `next-sequence` được bảo toàn qua serialize/rehydrate; khởi động lại không tạo `seqNo` trùng.
- [ ] Kết quả kiểm thử Redis round-trip xác nhận delta replay không bỏ sót hoặc trả sai event.

## Rủi ro

- eventLog hiện chưa chắc có seqNo ổn định qua serialize/rehydrate (Redis snapshot) → phải kiểm tra `deserializeMatch` giữ nguyên thứ tự/seqNo trước khi tin dùng cho delta.
- Đụng state machine (CRITICAL) → chỉ thêm, verify full suite.
- Giao `socket-store.ts` with C → chỉ bắt đầu sau khi C merge.
