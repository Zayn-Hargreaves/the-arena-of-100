# Plan: Remaining Hardening + Memory-Bank Consolidation

> **Trạng thái đồng bộ:** 2026-06-18 / 2026-06-19
> File này **thay thế** plan cũ cho PR `fix/match-race-frontend-correctness`. PR đó đã merge từ 2026-06-14; các follow-up L2/L3, home gradient, và admin audit backend cũng đã land. Ground truth hiện tại nằm ở code live + 4 core memory-bank files.

## 1. Ground Truth

### Đã xong

- ✅ Lobby lifecycle + heartbeat + graceful exit baseline
- ✅ Admin kill-switch baseline
- ✅ Drop-in spectating baseline
- ✅ Match race + frontend correctness hardening (B1-B3, F1-F8)
- ✅ Gateway + schema tightening + home gradient cleanup (L2, L3, PR 6)
- ✅ Admin audit trail backend (`EventLog` schema/service/controller/query endpoint)

### Xác nhận semantics đã chốt

- **AFK trong match**: nếu player **không trả lời round active trước deadline**, state machine sẽ xử như **không trả lời = eliminated ngay round đó**.
- **Sau khi bị loại**, client render player ở **spectator/watch-only UI**.
- **Late join ongoing/finished match**: vào với `JoinMode = "SPECTATOR"`.
- **Moderation MVP**: làm **vừa đủ cho MVP**; enhancement sâu hơn defer tới sau MVP.
- **Mass spectator**: ưu tiên **monolithic-first**; chưa đẩy sang distributed/SSE riêng cho tới khi có load evidence.
- **k6 load test**: tách **PR riêng**.

## 2. Memory-Bank Consolidation Decision

Từ phiên này trở đi, memory-bank chỉ có **4 file core** để agent đọc mặc định:

1. `memory-bank/productContext.md`
2. `memory-bank/systemPatterns.md`
3. `memory-bank/progress.md`
4. `memory-bank/activeContext.md`

### Rules

- `AGENTS.md` phải trỏ vào **4 file này trước**.
- Các file khác trong `memory-bank/` **không bị xóa**.
- Các file khác được xem là **supplementary / legacy notes**.
- Chỉ đọc supplementary docs khi:
  - user yêu cầu trực tiếp, hoặc
  - một trong 4 core docs dẫn chiếu rõ ràng.

## 3. Immediate Documentation Work

### P0 — Doc Sync + Scope Reduction

- Overwrite `plan.md` để phản ánh ground truth mới
- Slim lại 4 core memory-bank files để giảm context bloat
- Sửa mismatch giữa docs cũ và code live:
  - PR 3 không còn là "in progress" ở backend
  - L2/L3 không còn pending
  - Home gradient không còn pending
  - AFK semantics không còn ghi "2 missed rounds" ở core docs
- Update `AGENTS.md` để mọi agent đọc 4 core docs trước, không default sang docs khác

## 4. Remaining Implementation Queue

### P1 — `Room.maxPlayers` payload hardening

Goal:

- expose `maxPlayers` trong `RoomCreatedPayload` + `RoomJoinedPayload`
- bỏ fallback `GAME_CONFIG.MAX_PLAYERS` ở game UI khi payload thật đã có

### P2 — Optimistic answer rollback

Goal:

- thêm idempotency/client sequence key cho submit answer
- có rollback path rõ ràng khi server reject
- giữ UI lock-in nhưng không kẹt trạng thái

### P3 — In-match AFK hardening

Goal:

- docs và implementation cùng bám semantics thật của game-core:
  - no answer before deadline => eliminated trong round đó
  - eliminated player tiếp tục ở spectator UI
- focus là **operator clarity + UX clarity**, không phải tạo luật "2 missed rounds" mới

### P4 — Moderation MVP

Goal:

- nickname profanity filtering/safe replacement
- admin terminate message sanitize hoặc fallback default message
- note rõ deferred items sau MVP:
  - device fingerprint enforcement
  - violation counter
  - shadow ban
  - richer multilingual dictionaries

### P5 — Optional admin audit UI closeout

Goal:

- consume `GET /admin/audit-events`
- panel/filter/pagination cơ bản trong admin page

### P6 — k6 load test (separate PR)

Goal:

- đo baseline 100 concurrent WS
- publish p50/p95/p99 + reconnect storm notes
- dùng kết quả này để quyết định có cần spectator transport tách riêng sớm hay không

## 5. Deferred Until Evidence or Post-MVP

- Mass-spectator SSE/distributed transport
- Full device fingerprint + shadow ban pipeline
- Full WCAG audit sweep
- Playwright browser E2E
- Post-match rematch + share
- Multi-instance Socket.io adapter / distributed game-loop locks

## 6. Definition of Done for This Planning Reset

- `plan.md` không còn nói về PR `fix/match-race-frontend-correctness` như next PR
- 4 core memory-bank files ngắn gọn, đồng bộ, không mâu thuẫn nhau
- `AGENTS.md` default sang 4 core docs thay vì toàn bộ memory-bank
- legacy docs vẫn giữ nguyên trong repo, không bị xóa

## 7. Notes

- Nếu sau này cần đào lại historical detail của các PR cũ, dùng `memory-bank/progress.md` + git history, không nhét lại vào `activeContext.md`.
- Nếu một supplementary doc vẫn hữu ích, giữ nó như tài liệu archive/reference, nhưng không cho agent đọc mặc định nữa.
