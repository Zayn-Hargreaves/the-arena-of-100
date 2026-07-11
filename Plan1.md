# Plan1 — P1 Near-Term: chia phase & song song hoá 4 PR

> Master index. Chi tiết từng PR nằm ở 4 file `Plan-A/B/C/D-*.md`.
> Nguồn ưu tiên: `memory-bank/progress.md` → mục **P1 — Near-Term Implementation**.

## 4 PR trong P1

| #   | PR                                      | File chi tiết                                          | Trạng thái nền hiện có                                                                     |
| --- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| A   | k6 load test (100 concurrent WS)        | [Plan-A-k6-load-test.md](Plan-A-k6-load-test.md)       | Chưa có hạ tầng k6 nào                                                                     |
| B   | Admin audit panel UI                    | [Plan-B-admin-audit-ui.md](Plan-B-admin-audit-ui.md)   | Backend xong (`admin-audit.ops.ts`, `GET /admin/audit-events`); FE chỉ có `admin/page.tsx` |
| C   | AFK docs + UX hardening                 | [Plan-C-afk-hardening.md](Plan-C-afk-hardening.md)     | Elimination có sẵn trong `MatchStateMachine`; cần chốt semantics + hardening UX            |
| D   | Replay contract (`lastSeenSeqNo` delta) | [Plan-D-replay-contract.md](Plan-D-replay-contract.md) | `submissionId` idempotency xong; `getSnapshot` hiện bỏ qua `lastEventSeqNo`                |

## Phân tích phụ thuộc & xung đột file

```
Track A (k6)          ── độc lập tuyệt đối (chỉ thêm thư mục load-test/)
Track B (admin UI)    ── độc lập (FE admin area; backend đã xong)
Track C (AFK)         ┐
                      ├─ CHỒNG NHAU: match-state-machine.ts + socket-store.ts
Track D (replay)      ┘
```

- **A, B**: không chạm bất kỳ symbol chung nào với các track khác → chạy song song thoải mái với tất cả.
- **C, D**: cùng đụng `packages/game-core/src/match-state-machine.ts` và `apps/web/src/stores/socket-store.ts`. **KHÔNG chạy song song** — làm tuần tự **C → D** (C chốt trạng thái elimination trước, D xây delta-replay trên nền eventLog đã ổn định).

## Chiến lược 2 làn (wave)

**Wave 1 — chạy song song 3 nhánh** (mỗi nhánh 1 branch/PR riêng):

- Làn 1: **A (k6)** — độc lập.
- Làn 2: **B (admin UI)** — độc lập.
- Làn 3: **C (AFK)** — bắt đầu, giữ trọn quyền sửa `match-state-machine.ts`.

**Wave 2 — sau khi C merge:**

- **D (replay)** — rebase trên main đã có C, tránh xung đột state machine.

> Vì sao A là "gate" nhưng vẫn xếp Wave 1: kết quả k6 chỉ chặn **P2 (spectator transport split)**, KHÔNG chặn B/C/D. Nên chạy A sớm và song song là tối ưu.

## Thứ tự đề xuất

1. Mở đồng thời **A + B + C** (3 branch từ `main`).
2. B thường nhỏ nhất → merge trước, rồi C.
3. Sau khi **C** vào `main` → mở **D**, rebase, làm nốt.
4. A về đích độc lập bất cứ lúc nào; số liệu của nó feed vào quyết định P2.

## Nhánh Git đề xuất

- `feat/k6-load-test` (A)
- `feat/admin-audit-panel-ui` (B)
- `feat/afk-ux-hardening` (C)
- `feat/replay-lastseen-delta` (D) — tạo sau khi C merge

## Ghi chú quy trình (theo repo hiện tại)

- Mọi PR merge qua GitHub PR (xem lịch sử: PR #55–#69).
- Trước khi commit mỗi PR: `gitnexus_impact` trên symbol đụng tới + `gitnexus_detect_changes` xác nhận scope.
- `MatchStateMachine` là hub CRITICAL (22 flow) → track C/D chỉ thêm method/đọc eventLog, **không** đổi chữ ký core hiện có.
