# AFK & Elimination Policy — Đấu Trường 100

> Track C (Plan-C-afk-hardening). Nguồn semantics: `memory-bank/progress.md` → P1#2 + "Locked Decisions".
> Tài liệu này mô tả hành vi **đã được verify khớp code** ở cả 3 lớp: state machine → round runner → UI.

## 1. Semantics đã CHỐT

1. **Trả lời sai HOẶC không trả lời** trước khi round đang active hết hạn ⇒ **bị loại (eliminated) ngay trong round đó**.
2. Người bị loại **vẫn giữ kết nối** và tiếp tục xem trận như spectator/watch-only.
3. Người vào muộn (`late joiner`) khi trận đã ở trạng thái `IN_GAME`/`FINISHED` ⇒ join với vai trò `SPECTATOR`, không bao giờ được trả lời.

Ba điều trên là **bất biến**. Mọi code trong phạm vi Track C chỉ được _thêm_ guard/helper để bảo vệ chúng, không được đổi ý nghĩa.

## 2. Định nghĩa "AFK"

AFK = một **surviving player** không tồn tại answer hợp lệ cho round đang active tại thời điểm round kết thúc. Có hai đường dẫn tới cùng một kết quả:

| Trường hợp                             | `player.status` khi round kết thúc | Có answer trong `round.answers`? | Kết quả                            |
| -------------------------------------- | ---------------------------------- | -------------------------------- | ---------------------------------- |
| **AFK thuần** (còn kết nối, không bấm) | `ACTIVE`                           | Không                            | Eliminated (reason `TIMEOUT`)      |
| **Disconnect giữa round**              | `DISCONNECTED`                     | Không                            | Eliminated (reason `TIMEOUT`)      |
| **Trả lời sai**                        | `ACTIVE`                           | Có, `isCorrect=false`            | Eliminated (reason `WRONG_ANSWER`) |
| **Trả lời đúng**                       | `ACTIVE`                           | Có, `isCorrect=true`             | Sống sót, cộng điểm                |

Điểm mấu chốt: **disconnect KHÔNG loại người chơi ngay lập tức**. Nó chỉ đánh dấu `DISCONNECTED`. Việc loại chỉ xảy ra tại `evaluateRound()` khi round kết thúc — giống hệt AFK thuần. Nhờ vậy một người disconnect rồi reconnect kịp trong cùng round (và bấm trả lời đúng) vẫn sống.

## 3. Đường đi qua 3 lớp (verified)

### Lớp 1 — State machine (`packages/game-core/src/match-state-machine.ts`)

- `submitAnswer()` (line ~178): chặn answer nếu round không `ACTIVE`, nếu `serverTimestamp > round.endsAt` (`ANSWER_SUBMISSION_CLOSED`), hoặc nếu `player.status !== ACTIVE`. ⇒ Disconnect/eliminated/spectator không thể ghi answer.
- `evaluateRound()` (line ~253): với **mỗi id trong `survivingPlayerIds`**, nếu `!answer || !answer.isCorrect` ⇒ push vào `eliminatedIds`, set `player.status = ELIMINATED`. Đây là **điểm loại chính** — bao trùm cả AFK, disconnect, và sai. Người đúng được cộng `score` + `correctAnswers`.
- `disconnectPlayer()` (line ~423): chỉ set `isOnline=false` và `status=DISCONNECTED` **nếu chưa** ELIMINATED/WINNER. Không tự loại.
- `reconnectPlayer()` (line ~442): khôi phục `ACTIVE` **chỉ khi** đang `DISCONNECTED`. Người đã ELIMINATED reconnect vẫn giữ nguyên ELIMINATED (spectator).

### Lớp 2 — Round runner (`apps/api/src/modules/match/match-round-runner.ts`)

- `executeRound()`: đặt timer `ROUND_DURATION_MS` → `endRound`. `setExpectedAnswers` = số surviving trước round.
- `checkEarlyTermination()`: nếu tất cả surviving đã answer trước hạn → clear timer, gọi `endRound` sớm.
- `endRound()` (line ~249):
  - **Normal flow** (`ROUND_ACTIVE` + round `ACTIVE`): transition → `ROUND_EVALUATING`, gọi `evaluateRound()`, persist.
  - **Recovery flow** (`ROUND_EVALUATING` + round `COMPLETED`): dựng lại `eliminatedIds` từ event log `ROUND_EVALUATED` (fallback heuristic nếu thiếu). Chỉ để **re-broadcast**, không mutate state (state đã loại xong trước khi crash).
  - Guard idempotency `beginEndRound` chống double-run (timer 15s đua với early-termination).
  - Phát `PLAYER_ELIMINATED` cho từng id với `answeredThisRound = round.answers.has(playerId)`.
- `handlePlayerDisconnect()` / `handleMatchPlayerLeft()`: gọi `disconnectPlayer()` + persist + broadcast `PLAYER_LEFT`. Không loại.

### Lớp 3 — Events & UI

- `game-loop.events.ts` `emitPlayerEliminated()`: `reason = answeredThisRound ? "WRONG_ANSWER" : "TIMEOUT"`. Đây là nguồn "lý do bị loại" cho FE.
- Wire: `PLAYER_ELIMINATED` payload (`packages/shared/src/events.ts`) mang `reason: "WRONG_ANSWER" | "TIMEOUT"`.
- FE store (`socket-store.ts`): khi `data.playerId === userId` set `isEliminated=true` + lưu `eliminationReason`; luôn stamp `status=ELIMINATED` cho player trong `match.players` (realtime, không đợi `ROUND_ENDED`).
- FE UI:
  - `eliminated-overlay.tsx`: overlay watch-only, hiển thị **lý do** (sai / hết giờ).
  - `answer-panel.tsx`: khoá input khi `isEliminated || isSpectator`.
  - `player-grid.tsx` / `opponents-sidebar.tsx`: badge ELIMINATED đồng bộ realtime.

## 4. Edge cases

| Edge case                                                      | Hành vi mong đợi                                                    | Cơ chế bảo đảm                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Disconnect **ngay trước** deadline, không answer               | Eliminated trong round (TIMEOUT)                                    | vẫn nằm trong `survivingPlayerIds` → `evaluateRound` loại                                                      |
| Disconnect rồi **reconnect kịp** trong cùng round, answer đúng | Sống sót                                                            | `reconnectPlayer` phục hồi ACTIVE; `submitAnswer` chấp nhận                                                    |
| Reconnect **sau khi đã bị loại**                               | Trở lại làm spectator/watch-only                                    | snapshot trả `status=ELIMINATED`; `isEliminated` suy ra từ roster; `reconnectPlayer` không hồi sinh ELIMINATED |
| Answer đến **sau** `round.endsAt` (clock skew / mạng chậm)     | Bị từ chối `ANSWER_SUBMISSION_CLOSED` → coi như không answer → loại | guard `serverTimestamp > endsAt` trong `submitAnswer`                                                          |
| Late joiner vào giữa trận                                      | SPECTATOR, không answer được                                        | `room.joinMode==="SPECTATOR"` + server gate ở `handleSubmitAnswer`                                             |
| Double `PLAYER_ELIMINATED` (recovery re-broadcast)             | UI idempotent, không đổi trạng thái lần 2                           | reducer set `status=ELIMINATED` là idempotent; guard stale matchId                                             |
| Crash giữa `evaluateRound` và `ROUND_RESULT`                   | Không loại nhầm/thiếu                                               | H3: DB persist trước khi advance; recovery path dựng lại eliminatedIds                                         |

## 5. Bất biến API (Track C constraint)

`MatchStateMachine` public API **không đổi** trong Track C — không được thêm, sửa, hay xoá bất kỳ public method nào. Lý do: blast radius **CRITICAL** (`gitnexus_impact` → 29 impactedCount / 18 processes / 3 modules, xem `docs/impact-analysis-C.md` §1.1). Mọi thay đổi (kể cả thêm method private/protected) phải verify bằng full `@arena/game-core` + match suite trước khi PR.
