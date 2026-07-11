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

- [ ] **Server-authoritative deadline validation cho answer handling**: dùng server clock (không tin frontend) để reject answer nhận được sau `roundEndTime` (`currentRound.endsAt`), bất kể trạng thái FE. Đã có sẵn ở `MatchStateMachine.submitAnswer` (line ~203: `if (serverTimestamp > this.currentRound.endsAt) throw new RoomError(ANSWER_SUBMISSION_CLOSED)`) — verify hành vi và **giữ nguyên invariant này** ở mọi nhánh (normal + recovery). Nếu chưa phủ, bổ sung test xác nhận answer gửi sau `endsAt` luôn bị reject, dù frontend còn `roundEndTime` lớn hơn.
- [ ] **Elimination semantics nhất quán giữa normal flow và `endRound` recovery path**:
  - Normal flow: `evaluateRound()` đánh ELIMINATED cho mọi player không có `answer.isCorrect` trong round hiện tại (line ~272-294).
  - Recovery path: `match-round-runner.ts:endRound` (line ~298-340) **PHẢI** xác định `eliminatedIds` dựa trên dữ liệu của **đúng round hiện tại**, KHÔNG dựa trên trạng thái tích luỹ của player. Hiện tại fallback heuristic `p.status === ELIMINATED && p.correctAnswers === round.roundNo - 1` (`match-round-runner.ts:332-339`) suy ra từ state tích luỹ, không phải round-scoped evidence — KHÔNG đủ.
  - **Vị trí logic (resolve boundary conflict)**:
    - **KHÔNG ĐƯỢC thêm public method mới vào `MatchStateMachine` ở Track C**. Scope rule Plan1 cấm tuyệt đối việc này (xem `Plan1.md`). Mọi đề xuất thêm public method phải được **escalate** (review với reviewer + Track D) trước khi thay đổi Plan1.md; mặc định là KHÔNG làm.
    - **Phương án duy nhất được phép ở Track C**: **Shared pure helper module bên ngoài class**. Tạo helper pure (ví dụ `eliminationsForRound(round, players)` trong một module dùng chung, ví dụ `packages/game-core/src/round-elimination.ts`), không phải method của class. Helper này dựa trên `currentRound.answers` + `correctAnswer` để xác định player bị loại; **thiếu answer cũng được coi là eliminated**. `match-round-runner.ts` import helper này và gọi từ nhánh recovery.
  - **Semantics của helper** (áp dụng cho pure helper ở trên):
    - Input: `currentRound` (chỉ round hiện tại) + `players` đang sống trước round đó.
    - Player bị loại trong round hiện tại nếu:
      1. Player không có entry trong `currentRound.answers` ⇒ **eliminated** (đã bao gồm AFK/disconnect-mid-round), HOẶC
      2. Player có entry trong `currentRound.answers` nhưng `isCorrect === false` ⇒ **eliminated**.
    - KHÔNG dùng `correctAnswers`, KHÔNG dùng `status` tích luỹ, KHÔNG dùng `eventLog` của round trước.
  - Thứ tự ưu tiên cho recovery (cập nhật Phase C2):
    1. **Ưu tiên 1**: đọc event `ROUND_EVALUATED` từ `eventLog` của state machine có cùng `roundNo` với round hiện tại (`match-round-runner.ts:310-330`); lấy `eliminatedIds` trực tiếp từ payload event.
    2. **Ưu tiên 2**: nếu event không có/không hợp lệ, dùng helper theo lựa chọn ở trên (Move-to-API hoặc Shared pure helper) dựa trên `currentRound.answers` + `correctAnswer` của state machine.
  - Thay thế hoàn toàn fallback dựa trên `p.correctAnswers` ở `match-round-runner.ts:332-339`; tập `eliminatedIds` cuối cùng phải **bằng đúng** tập mà `evaluateRound()` trả về trong normal flow cho cùng round đó.
  - **Bổ sung test** (cập nhật `match-round-runner.spec.ts` / `match-state-machine.spec.ts`):
    - Recovery xác nhận `eliminatedIds` chỉ gồm player bị loại trong round hiện tại (KHÔNG bao gồm player đã bị ELIMINATED ở round trước).
    - Player bị loại mới ở round hiện tại phải xuất hiện đúng trong `eliminatedIds` recovery.
    - Player KHÔNG có answer trong round hiện tại (AFK/disconnect) cũng xuất hiện trong `eliminatedIds` recovery.
    - So sánh: trong cùng điều kiện (cùng `currentRound.answers`, cùng `correctAnswer`), `eliminatedIds` của recovery ≡ `eliminatedIds` của `evaluateRound()`.
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
