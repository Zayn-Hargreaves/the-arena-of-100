# Plan C — AFK Docs + UX Hardening

> Wave 1. Giữ trọn quyền sửa `match-state-machine.ts`. **D chạy SAU C** (xung đột file). Xem [Plan1.md](Plan1.md).
> Nguồn: `memory-bank/progress.md` → P1#2 + "Locked Decisions".

## Semantics đã CHỐT (không bàn lại — chỉ thực thi cho đúng)

- Trả lời sai **hoặc** không trả lời trước hạn round đang active ⇒ **eliminated trong round đó**.
- Người bị eliminated **vẫn kết nối** như spectator/watch-only UI.
- Late joiner vào `IN_GAME`/`FINISHED` ⇒ join làm `SPECTATOR`.

## Mục tiêu

Đảm bảo hành vi AFK/elimination khớp đúng semantics đã chốt ở **cả 3 lớp** (state machine → round runner → UI), viết doc rõ ràng, và hardening trải nghiệm khi bị loại.

## Nền hiện có (cần đọc trước khi sửa)

- `packages/game-core/src/match-state-machine.ts` — elimination tại **line ~280** (đánh dấu ELIMINATED) và **line ~430** (guard status). Đây là logic lõi.
- `apps/api/src/modules/match/match-round-runner.ts` — `endRound` (line ~249), guard `ELIMINATED` (line ~336), timer 15s → endRound.
- FE: `apps/web/src/components/game/eliminated-overlay.tsx`, `answer-panel.tsx`, `player-grid.tsx`, `opponents-sidebar.tsx`; store `socket-store.ts` / `socket-store.updaters.ts`.

## ⚠️ Ranh giới xung đột với Track D

C và D cùng đụng `match-state-machine.ts` và `socket-store.ts`. **C phải merge trước.** Trong lúc làm C, không rebase D lên; D chờ C vào main.

## Phase

### Phase C1 — Xác minh & viết doc semantics (không đổi code)

- [ ] `gitnexus_impact({target: "MatchStateMachine", direction: "upstream"})` — xác nhận blast radius (CRITICAL, ~22 flow) trước khi đụng.
- [ ] Trace đường "hết hạn round mà player chưa answer" qua state machine → round runner → event phát ra. Ghi lại đúng/sai so với semantics.
- [ ] Viết `docs/afk-policy.md` (hoặc mục trong memory-bank): định nghĩa AFK, thời điểm loại, hành vi spectator sau loại, các edge case (disconnect ngay trước deadline, reconnect sau khi bị loại).

### Phase C2 — Hardening logic (BE)

- [ ] Đảm bảo player không answer trước `roundEndTime` bị đánh ELIMINATED nhất quán (kiểm tra cả nhánh recovery trong `endRound`).
- [ ] Edge: disconnect giữa round vs. AFK (không answer nhưng còn kết nối) — cùng kết quả loại trong round, khác đường đi. Verify cả hai.
- [ ] Chỉ **thêm** helper/guard nếu cần; **không** đổi chữ ký public của `MatchStateMachine`. Nếu phải thêm method → giữ nhỏ, pure, có unit test riêng (theo [[refactor-thresholds]]).

### Phase C3 — Hardening UX (FE)

- [ ] `eliminated-overlay.tsx`: hiển thị rõ lý do (sai / hết giờ), chuyển sang watch-only mượt.
- [ ] `answer-panel.tsx`: khoá input ngay khi bị loại; countdown rõ ràng trước deadline.
- [ ] `player-grid.tsx` / `opponents-sidebar.tsx`: trạng thái eliminated đồng bộ realtime qua `socket-store.updaters.ts`.
- [ ] Xử lý reconnect sau khi bị loại: snapshot hydrate phải trả về đúng trạng thái spectator (giao với D nhưng chỉ ở mức đọc snapshot hiện tại, chưa cần delta).

### Phase C4 — Test & chốt

- [ ] Unit test game-core cho các nhánh elimination (theo `match-state-machine.spec.ts` hiện có).
- [ ] Test round-runner cho AFK path (theo `match-round-runner.spec.ts` vừa tách ở PR trước).
- [ ] Test FE component cho overlay/answer-panel khoá đúng lúc.
- [ ] `gitnexus_detect_changes()` xác nhận scope; cập nhật `progress.md`.

## File dự kiến chạm

- BE: `packages/game-core/src/match-state-machine.ts`, `apps/api/src/modules/match/match-round-runner.ts`.
- FE: `apps/web/src/components/game/{eliminated-overlay,answer-panel,player-grid,opponents-sidebar}.tsx`, `apps/web/src/stores/socket-store.updaters.ts`.
- Docs: `docs/afk-policy.md` + `memory-bank/progress.md`.

## Acceptance

- [ ] AFK/elimination khớp semantics đã chốt ở cả 3 lớp, có test bao phủ edge case.
- [ ] Doc AFK policy tồn tại và khớp code.
- [ ] `MatchStateMachine` public API không đổi (chỉ thêm, không sửa/xoá).

## Rủi ro

- **CRITICAL blast radius**: mọi thay đổi state machine ảnh hưởng ~22 flow → chỉ thêm, verify bằng full game-core + match suite trước khi PR.
- Giao với D ở `socket-store.ts` → merge C trước, D rebase sau.
