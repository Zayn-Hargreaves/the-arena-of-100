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

- [ ] **Pre-edit impact analysis (required, full symbol set)** — run `gitnexus_impact({direction: "upstream"})` on **every** symbol the change set touches, not only `MatchStateMachine`. For each symbol, record direct callers, affected processes, and risk level. Latest run (re-run if the GitNexus index changes):
  - `MatchStateMachine` (class, `packages/game-core/src/match-state-machine.ts`): direct dependents = 3, affected processes = 19, **risk = CRITICAL** (`timer`, `executeRound`, `endRound`, `checkMatchEnd`, `startMatchLoop`, `disconnectPromise`, `constructor`, `handleTrackedUserSwitchDisconnect`, `handleRequestSnapshot`, `handleSubmitAnswer`, `handleAuthenticate`, `finishMatchLoopInner`, `handleStartMatch`, `handleMatchPlayerLeft`, `handleLeaveRoom` (gateway), `syncReconnection`, `createFromRoom`, `handleLeaveRoom` (handler), `launchRoomMatch`).
  - `MatchStateMachine.submitAnswer` (method, `packages/game-core/src/match-state-machine.ts:177`): GitNexus index reports 0 in-code direct callers (call site uses dynamic dispatch on the state machine instance); obvious runtime caller = `MatchHandler.handleSubmitAnswer` reachable from `apps/api/src/gateways/game.gateway.ts:handleSubmitAnswer`. **Risk assessment procedure (do not skip)**:
    1. Check `gitnexus_detect_changes` / `gitnexus list_repos` for index freshness. If the index is stale (missing new files / symbols, or `gitnexus` warning surfaced in `gitnexus://repo/the-arena-of-100/context`), run `npx gitnexus analyze`, wait for completion, then re-run `gitnexus_impact({target: "submitAnswer", direction: "upstream", file_path: "packages/game-core/src/match-state-machine.ts", kind: "Method"})`.
    2. Record the new direct-callers / affected-processes / risk-level result explicitly. **Do NOT retain `LOW` if the index was stale or the data is incomplete**; in that case, the recorded risk is `UNKNOWN` and the next step applies.
    3. **Decision rule for `submitAnswer` hardening (in-scope Track C edit)**:
       - **`HIGH` or `CRITICAL` risk, but the change is in-scope Track C (no public API change, blast radius does not exceed 19 affected processes listed in this Phase C1, and the risk is now known)** ⇒ **block the edit until a recorded approval artifact exists**, then proceed. Informal "notify + confirm scope" is NOT sufficient on its own; a `HIGH`/`CRITICAL` change to `MatchStateMachine` requires a durable evidence trail.
         - **Required approval artifact** (commit / PR comment / Plan-D memory note — anything the next agent can read):
           1. **Impact output**: the verbatim `gitnexus_impact({target: "submitAnswer", ...})` result (or class-level result if the edit touches the class), including the full list of direct callers and 19 affected processes.
           2. **Confirmed scope**: explicit statement that the change does NOT add any public method, modify any existing public method signature, or otherwise alter the public API or contract of `MatchStateMachine` in any way (not limited to only the signatures listed in Plan1's locked list), and does NOT expand blast radius beyond the 19 processes listed in this Phase C1.
           3. **Diff/Revision binding**: The exact commit SHA or PR revision to which this approval applies. For uncommitted changes, define a pre-edit identifier using the base SHA plus a hash of the proposed patch/diff (e.g., from `git diff`), and require approval validation against that identifier before editing. Revalidation and artifact recreation are strictly mandated once the actual commit SHA or PR revision exists or if the diff changes.
           4. **Reviewer approval**: name + GitHub handle of the reviewer who approved the in-scope `HIGH`/`CRITICAL` edit.
           5. **Confirmation timestamp**: ISO 8601 timestamp recorded alongside the approval.
         - The edit is **blocked** until all five pieces exist and are fully validated against the current diff/revision. Without the artifact, treat the change as if it had risk `UNKNOWN` and apply the STOP rule below.
         - Do NOT auto-stop simply because risk is `HIGH`/`CRITICAL`; the recorded artifact is the safeguard, not the absence of one. The implementer must produce the artifact and satisfy these requirements before editing.
       - **`HIGH` or `CRITICAL` risk AND the change requires a new public method on `MatchStateMachine`, or expands blast radius beyond the 19 processes in this Phase C1 list, or risk is `UNKNOWN` because the index could not be refreshed, OR the approval artifact cannot be produced (no reviewer available / out-of-band scope confirmation missing)** ⇒ **STOP and escalate** to reviewer + Track D per the Plan1 scope rule. Re-plan before editing.
  - `MatchRoundRunner.endRound` (method, `apps/api/src/modules/match/match-round-runner.ts`): direct callers = 2 (`timer`, `checkEarlyTermination`), affected processes = 1 (`timer`), **risk = LOW**.
  - `applySnapshotState` (function, `apps/web/src/stores/socket-store.updaters.ts:447`): direct callers = 1 (`connect` in `socket-store.ts`), affected processes = 1, **risk = LOW**.
  - `applyRoundEndedState` (function, `apps/web/src/stores/socket-store.updaters.ts:322`): direct callers = 1 (`connect`), **risk = LOW**.
  - `applyPlayerEliminatedState` (function, `apps/web/src/stores/socket-store.updaters.ts:384`): direct callers = 1 (`connect`), **risk = LOW**.
  - FE components `AnswerPanel` (`apps/web/src/components/game/answer-panel.tsx:28`), `EliminatedOverlay` (`eliminated-overlay.tsx:10`), `PlayerGrid` (`player-grid.tsx:20`), `OpponentsSidebar` (`opponents-sidebar.tsx:28`): all show as `0` upstream callers in the index (no test/spec graph traversal); **risk = LOW** (purely presentational changes).
  - **If any of the above flips to HIGH/CRITICAL** (e.g. a future `MatchStateMachine` change is added): apply the same decision rule as `submitAnswer` — review-scope + reviewer confirmation for in-scope edits, STOP only when scope expands, public API changes, or risk is `UNKNOWN`.
- [ ] `gitnexus_impact({target: "MatchStateMachine", direction: "upstream"})` — xác nhận blast radius (CRITICAL, ~19 flow) trước khi đụng.
- [ ] Trace đường "hết hạn round mà player chưa answer" qua state machine → round runner → event phát ra. Ghi lại đúng/sai so với semantics.
- [ ] Viết `docs/afk-policy.md` (hoặc mục trong memory-bank): định nghĩa AFK, thời điểm loại, hành vi spectator sau loại, các edge case (disconnect ngay trước deadline, reconnect sau khi bị loại).

### Phase C2 — Hardening logic (BE)

- [ ] **Server-authoritative deadline validation cho answer handling**: dùng server clock (không tin frontend) để reject answer nhận được sau `roundEndTime` (`currentRound.endsAt`), bất kể trạng thái FE. Đã có sẵn ở `MatchStateMachine.submitAnswer` (line ~203: `if (serverTimestamp > this.currentRound.endsAt) throw new RoomError(ANSWER_SUBMISSION_CLOSED)`) — verify hành vi và **giữ nguyên invariant này** ở mọi nhánh (normal + recovery). Nếu chưa phủ, bổ sung test xác nhận answer gửi sau `endsAt` luôn bị reject, dù frontend còn `roundEndTime` lớn hơn.
- [ ] **Elimination semantics nhất quán giữa normal flow và `endRound` recovery path**:
  - Normal flow: `evaluateRound()` đánh ELIMINATED cho mọi player không có `answer.isCorrect` trong round hiện tại (line ~272-294).
  - Recovery path: `match-round-runner.ts:endRound` (line ~298-340) **PHẢI** xác định `eliminatedIds` dựa trên dữ liệu của **đúng round hiện tại**, KHÔNG dựa trên trạng thái tích luỹ của player. Hiện tại fallback heuristic `p.status === ELIMINATED && p.correctAnswers === round.roundNo - 1` (`match-round-runner.ts:332-339`) suy ra từ state tích luỹ, không phải round-scoped evidence — KHÔNG đủ.
  - **Vị trí logic (resolve boundary conflict)**:
    - **KHÔNG ĐƯỢC thêm public method mới vào `MatchStateMachine` ở Track C**. Scope rule Plan1 cấm tuyệt đối việc này (xem `Plan1.md`). Mọi đề xuất thêm public method phải được **escalate** (review với reviewer + Track D) trước khi thay đổi Plan1.md; mặc định là KHÔNG làm.
    - **Shared pure helper trong game-core**: Tạo helper pure `eliminationsForRound(round)` trong một module dùng chung `packages/game-core/src/round-elimination.ts`, không phải method của class. Helper nhận `currentRound` object có kiểu `RoundState & { correctAnswer: string; startingPlayers: string[] | typeof UNAVAILABLE }` — chỉ được gọi khi cả hai field đều hợp lệ (xem điều kiện gọi bên dưới) — và xác định correctness bằng **so sánh trực tiếp `answer.answer === currentRound.correctAnswer`** (raw string equality, giống hệt `submitAnswer` trong state machine) — **không dựa vào field `isCorrect` đã lưu** (field đó có thể chưa được populate trên recovery path). `match-round-runner.ts` và `evaluateRound()` trong state machine cùng sử dụng helper này để bảo đảm cả hai nhánh tính correctness bằng cùng một phép so sánh duy nhất.
  - **Lưu trữ startingPlayers**:
    - Bổ sung thuộc tính round-scoped `startingPlayers: string[] | typeof UNAVAILABLE` trên `currentRound`. Kiểu này dùng **một sentinel duy nhất** `UNAVAILABLE` (ví dụ `const UNAVAILABLE = Symbol("UNAVAILABLE")` hoặc một string literal type riêng biệt) cho mọi trường hợp không thể khôi phục — **tuyệt đối không dùng `null`, `undefined`, hay mảng rỗng mặc định** làm giá trị đại diện. `startingPlayers` là snapshot danh sách `survivingPlayerIds` **tại thời điểm `startRound()` được gọi**, trước mọi mutation của round. Thuộc tính này PHẢI được serialize cùng state (trong `serializeMatch`) và PHẢI được rehydrate đầy đủ (trong `deserializeMatch`).
    - **Sentinel serialization mapping (bắt buộc)**: Vì `Symbol` không thể serialize qua JSON, codec PHẢI ánh xạ nhất quán giữa in-memory sentinel và wire representation:
      - **In-memory**: `const UNAVAILABLE = Symbol("UNAVAILABLE")` — dùng trong TypeScript runtime.
      - **Serialize**: khi `startingPlayers === UNAVAILABLE`, codec ghi giá trị sentinel string `"__UNAVAILABLE__"` vào blob JSON. Khi `startingPlayers` là `string[]` hợp lệ, ghi mảng trực tiếp.
      - **Deserialize**: khi blob JSON chứa `"__UNAVAILABLE__"` tại vị trí `currentRound.startingPlayers`, codec trả `UNAVAILABLE` (Symbol) cho in-memory state. Khi blob chứa một mảng hợp lệ, trả mảng đó.
      - **Round-trip test bắt buộc**: `deserialize(serialize(state))` với `startingPlayers === UNAVAILABLE` phải bảo toàn chính xác sentinel, tức `result.currentRound.startingPlayers === UNAVAILABLE` (so sánh strict reference equality với Symbol). Tương tự, `startingPlayers` là `string[]` hợp lệ phải bảo toàn mảng chính xác qua round-trip.
      - **Reject collision**: nếu một player ID nào đó có giá trị `"__UNAVAILABLE__"` (cực kỳ unlikely nhưng phải phòng), mảng `startingPlayers` chứa giá trị đó vẫn là mảng hợp lệ — sentinel chỉ được nhận diện khi trường `startingPlayers` là một **string đơn** (không phải mảng).
    - **Codec (`match-state.codec.ts`)**: mở rộng `serialize` để emit `_stateVersion: 1` và include `currentRound.startingPlayers` trong blob đầu ra. Mở rộng `deserialize` để đọc `_stateVersion` và trả `startingPlayers: UNAVAILABLE` trong **tất cả** các trường hợp sau — không có ngoại lệ, không suy diễn, không mặc định:
      - **Version validation nghiêm ngặt (bắt buộc)**: `deserialize` PHẢI kiểm tra `_stateVersion` bằng **đúng một điều kiện duy nhất**: `_stateVersion === 1` (strict equality với numeric integer literal `1`). Cách kiểm tra chuẩn: `typeof raw._stateVersion === 'number' && Number.isInteger(raw._stateVersion) && raw._stateVersion === 1`. **Tất cả** các giá trị sau PHẢI dẫn đến `startingPlayers: UNAVAILABLE` mà KHÔNG parse tiếp phần `startingPlayers`/`correctAnswer`:
        - `_stateVersion` vắng mặt / `undefined` (blob cũ, version 0 ngầm định).
        - `_stateVersion === 0` (version 0 tường minh).
        - `_stateVersion` là số âm (ví dụ `-1`).
        - `_stateVersion` là số thập phân (ví dụ `1.5`, `0.99`).
        - `_stateVersion === NaN` (kết quả parse lỗi).
        - `_stateVersion` là string (ví dụ `"1"`, `""`).
        - `_stateVersion === null`.
        - `_stateVersion` là boolean (ví dụ `true`, `false`).
        - `_stateVersion > 1` (phiên bản tương lai chưa biết — fail-closed, KHÔNG throw, KHÔNG parse tiếp).
        - Bất kỳ giá trị nào khác không phải exact `1` integer.
      - Blob có `_stateVersion === 1` (pass strict check ở trên) nhưng `currentRound` thiếu `startingPlayers` ⇒ `UNAVAILABLE`.
      - Blob có `_stateVersion === 1` nhưng `currentRound` thiếu `correctAnswer` (cross-check sẽ không thể chạy nên coi như không thể khôi phục) ⇒ `UNAVAILABLE`.
        Recovery path nhận `UNAVAILABLE` (từ bất kỳ lý do nào ở trên) PHẢI fallback về full snapshot **ngay lập tức** mà **không gọi helper** (`eliminationsForRound` KHÔNG được invoked) — recovery code kiểm tra `startingPlayers === UNAVAILABLE` trước bất kỳ logic nào khác. Thêm trường `_stateVersion: number` vào serialized blob (bắt đầu từ version 1 khi `startingPlayers` được thêm) để migration future-proof; version 0 (không có trường) tương đương với trường hợp `startingPlayers` bị thiếu.
    - **Test codec bắt buộc** (thêm vào `match-state.codec.spec.ts` hoặc tương đương):
      1. **Round-trip preservation — `startingPlayers`**: `deserialize(serialize(state))` bảo toàn chính xác `currentRound.startingPlayers` và `_stateVersion === 1`; không có field nào bị mất hay biến đổi. Test cả hai nhánh: `startingPlayers` là `string[]` hợp lệ (bảo toàn mảng) VÀ `startingPlayers === UNAVAILABLE` (bảo toàn sentinel qua mapping `"__UNAVAILABLE__"` → `Symbol`).
      2. **Round-trip preservation — `correctAnswer`**: vì L3 invariant omit `correctAnswer` khi serialize (bảo mật), `deserialize(serialize(state))` PHẢI trả `currentRound.correctAnswer === undefined`. Test xác nhận: (a) `correctAnswer` KHÔNG xuất hiện trong serialized JSON blob, (b) sau `deserialize`, `currentRound.correctAnswer` là `undefined`, (c) chỉ sau khi gọi `attachCorrectAnswer(answer)` thì `currentRound.correctAnswer === answer`. Đây là hành vi thiết kế (L3), không phải lỗi — nhưng khi `_stateVersion === 1` mà `correctAnswer` vắng mặt (trường hợp bình thường sau deserialize), `startingPlayers` vẫn được bảo toàn (KHÔNG set thành `UNAVAILABLE` chỉ vì `correctAnswer` chưa attach). **Thay đổi so với rule trước**: condition "thiếu `correctAnswer` → `UNAVAILABLE`" chỉ áp dụng khi **recovery path cần `correctAnswer` để gọi helper** — tức là caller (`match-round-runner.ts`) kiểm tra `correctAnswer` vắng mặt VÀ `startingPlayers` hợp lệ ⇒ gọi `attachCorrectAnswer` trước; nếu attach thất bại ⇒ fallback. Codec `deserialize` **KHÔNG** tự set `startingPlayers = UNAVAILABLE` chỉ vì `correctAnswer` vắng mặt — nó trả `startingPlayers` nguyên bản từ blob (hoặc `UNAVAILABLE` nếu blob version không hợp lệ / thiếu `startingPlayers`).
      3. **Legacy version 0 / missing startingPlayers**: blob có `_stateVersion: 0` hoặc không có trường `_stateVersion`, và có `currentRound` nhưng thiếu `startingPlayers` ⇒ `deserialize` phải trả `startingPlayers: UNAVAILABLE` (không phải `[]`, không phải giá trị suy diễn từ player list).
      4. **Reject / fail-closed cho future version**: blob có `_stateVersion: 2` (hoặc bất kỳ số nào > 1) ⇒ `deserialize` phải trả `startingPlayers: UNAVAILABLE` (fail-closed), KHÔNG throw, KHÔNG parse tiếp.
      5. **Malformed `_stateVersion` values**: test tất cả giá trị malformed sau — mỗi giá trị phải dẫn đến `startingPlayers: UNAVAILABLE`: `_stateVersion: "1"` (string), `_stateVersion: null`, `_stateVersion: true`, `_stateVersion: false`, `_stateVersion: 1.5` (fractional), `_stateVersion: -1` (negative), `_stateVersion: NaN`, `_stateVersion: 0`, `_stateVersion: undefined` (missing key). Mỗi test case xác nhận `deserialize` KHÔNG throw VÀ trả `startingPlayers: UNAVAILABLE`.
      6. **Recovery nhận UNAVAILABLE**: khi `deserialize` trả `startingPlayers: UNAVAILABLE` (bất kể lý do), recovery path trong `match-round-runner.ts` PHẢI fallback full snapshot — test xác nhận helper KHÔNG được gọi và `eliminationsForRound` KHÔNG được invoked.
  - **Semantics của helper**:
    - Input: `currentRound` đầy đủ với `startingPlayers` là `string[]` hợp lệ (NOT `UNAVAILABLE`, non-empty) **và** `correctAnswer` đã được attach (qua `attachCorrectAnswer`). Helper KHÔNG BAO GIỜ được gọi khi `startingPlayers === UNAVAILABLE` hoặc khi `correctAnswer` vắng mặt — caller (`match-round-runner.ts`) phải kiểm tra cả hai điều kiện này trước khi gọi helper; thiếu một trong hai ⇒ fallback full snapshot ngay.
    - Player bị loại trong round hiện tại nếu:
      1. Player nằm trong `currentRound.startingPlayers` nhưng không có entry trong `currentRound.answers` ⇒ **eliminated** (bao gồm AFK/disconnect-mid-round), HOẶC
      2. Player có entry trong `currentRound.answers` nhưng `answer.answer !== currentRound.correctAnswer` (so sánh raw string) ⇒ **eliminated**.
    - KHÔNG dùng `answer.isCorrect` (có thể sai trên recovery path), KHÔNG dùng `correctAnswers` tích luỹ, KHÔNG dùng `status` tích luỹ, KHÔNG dùng `eventLog` của round trước.
  - Thứ tự ưu tiên cho recovery (cập nhật Phase C2):
    1. **Ưu tiên 1**: đọc **tất cả** event `ROUND_EVALUATED` từ `eventLog` của state machine có `roundNo === currentRound.roundNo`. **Từ chối toàn bộ event set ngay lập tức (fail-closed, chuyển sang Ưu tiên 2) nếu** bất kỳ tình huống nào sau đây xảy ra:
       - Tìm thấy **nhiều hơn một** event `ROUND_EVALUATED` cho cùng `roundNo` (ambiguous set — không chọn đầu hay cuối, từ chối toàn bộ).
       - Không tìm thấy **đúng một** event duy nhất sau khi lọc theo `roundNo`.
       - `currentRound.correctAnswer` vắng mặt (cross-check không thể chạy — fail-closed, không dùng event).
       - `currentRound.startingPlayers === UNAVAILABLE` (subset check và cross-check đều không thể chạy — fail-closed).
         Chỉ khi tìm thấy **đúng một** event DUY NHẤT và `correctAnswer` + `startingPlayers` đều hợp lệ, tiến hành validate event đó theo **tất cả** điều kiện sau:
       - `e.type === "ROUND_EVALUATED"`.
       - `e.payload` là object có `roundNo: number` và `eliminatedIds: string[]`.
       - `(e.payload as { roundNo: number }).roundNo === currentRound.roundNo` (khớp đúng round).
       - `eliminatedIds` là mảng (có thể rỗng), mọi phần tử là string, **không trùng lặp** (`new Set(eliminatedIds).size === eliminatedIds.length`).
       - Mọi phần tử trong `eliminatedIds` đều thuộc `currentRound.startingPlayers` (subset check).
       - **Bắt buộc cross-check với helper**: `eliminatedIds` từ event PHẢI khớp chính xác với kết quả `eliminationsForRound(currentRound)` (same set, same cardinality) — nếu không khớp, **từ chối event, chuyển sang Ưu tiên 2**.
       - Nếu bất kỳ điều kiện validate nào thất bại ⇒ từ chối event, chuyển sang Ưu tiên 2.
    2. **Ưu tiên 2**: dùng `eliminationsForRound(currentRound)` trực tiếp. Chỉ gọi helper khi **cả hai** điều kiện sau đều thoả: `currentRound.startingPlayers` là `string[]` hợp lệ (NOT `UNAVAILABLE`, non-empty) **VÀ** `correctAnswer` đã được attach. Nếu thiếu một trong hai ⇒ fail-closed về full snapshot ngay, không gọi helper (xem **Migration/fail-closed** và **Lưu trữ startingPlayers** ở trên).
  - Thay thế hoàn toàn fallback dựa trên `p.correctAnswers` ở `match-round-runner.ts:332-339`; tập `eliminatedIds` cuối cùng phải **bằng đúng** tập mà `evaluateRound()` trả về trong normal flow cho cùng round đó.
  - **Bổ sung test** (cập nhật `match-round-runner.spec.ts` / `match-state-machine.spec.ts`):
    - Recovery xác nhận `eliminatedIds` chỉ gồm player bị loại trong round hiện tại (KHÔNG bao gồm player đã bị ELIMINATED ở round trước).
    - Player bị loại mới ở round hiện tại phải xuất hiện đúng trong `eliminatedIds` recovery.
    - Player KHÔNG có answer trong round hiện tại (AFK/disconnect) cũng xuất hiện trong `eliminatedIds` recovery.
    - So sánh: trong cùng điều kiện (cùng `currentRound.answers`, cùng `correctAnswer`), `eliminatedIds` của recovery ≡ `eliminatedIds` của `evaluateRound()`.
- [ ] Edge: disconnect giữa round vs. AFK (không answer nhưng còn kết nối) — cùng kết quả loại trong round, khác đường đi. Verify cả hai.
- [ ] Chỉ **thêm** helper/guard nếu cần; **không** đổi chữ ký public của `MatchStateMachine`. Nếu cần method mới trên `MatchStateMachine` để hỗ trợ elimination recovery → **KHÔNG** tự ý thêm. Bắt buộc **escalate** cho reviewer + Track D trước khi thay đổi `Plan1.md` scope rule; mặc định giữ rule "không thêm public method". Phương án thay thế đã chốt: dùng shared pure helper ở `packages/game-core/src/round-elimination.ts` (xem Phase C2).

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

- **CRITICAL blast radius**: mọi thay đổi state machine ảnh hưởng ~19 flow → chỉ thêm, verify bằng full game-core + match suite trước khi PR.
- Giao với D ở `socket-store.ts` → merge C trước, D rebase sau.
