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
- [ ] **Định danh client mới KHÔNG dựa vào sự hiện diện của `lastSeenSeqNo`** (client cũ cũng luôn gửi field này với giá trị 0, xem `apps/web/src/stores/socket-store.ts:620-625`). Triển khai **capability/version negotiation** hoặc một **compatibility flag** riêng trong `SNAPSHOT` request/response, ví dụ:
  - Thêm `protocolVersion` hoặc `supports: "delta"` vào `RequestSnapshotPayloadSchema` (`packages/shared/src/schemas.ts`) và vào handler.
  - Server đọc flag để quyết định trả raw full snapshot (client cũ) hay envelope `{ mode, ... }` (client mới).
  - Cập nhật `SnapshotPayload` (`packages/shared/src/socket.ts:104-121`) + `packages/shared/src/{events,schemas}.ts` tương ứng; giữ payload snapshot raw khi `mode === "full"` để `applySnapshotState` tiếp tục hydrate đúng shape hiện có.
- [ ] **CHỐT MỘT wire shape duy nhất cho snapshot response** (Phase D1 yêu cầu cứng, không được mơ hồ):
  - **Client cũ** (không kèm capability flag) ⇒ trả **raw full snapshot** (giữ nguyên shape `SnapshotPayload` hiện tại, KHÔNG áp dụng discriminated union cho client cũ).
  - **Client mới** (kèm capability flag) ⇒ LUÔN trả **envelope** theo strict runtime discriminated union keyed by `mode`:
    - **Variant `full` (strict)**:
      - PHẢI có field `snapshot: SnapshotPayload` (giữ nguyên fields + `correctAnswer` KHÔNG bao giờ xuất hiện).
      - KHÔNG được có field `events` (validator phải reject nếu `events` tồn tại cùng `mode: "full"`).
      - PHẢI có `lastEventSeqNo: number`.
    - **Variant `delta` (strict)**:
      - PHẢI có field `events: EventBatchPayload["events"]` (mảng event từ `eventLog` có `seqNo > lastSeenSeqNo`).
      - KHÔNG được có field `snapshot` (validator phải reject nếu `snapshot` tồn tại cùng `mode: "delta"`).
      - PHẢI có `lastEventSeqNo: number`.
    - **Strict unknown-field validation**: envelope validator (Zod với `.strict()`) phải reject payload có field nào ngoài `mode` / `snapshot` / `events` / `lastEventSeqNo`. Payload malformed/trống/sai shape ⇒ reject trước khi tới handler logic.
  - **Triển khai Zod discriminated union** (tất cả nested object PHẢI dùng `.strict()` để reject field lạ ở mọi cấp):

    ```text
    // Nested: SnapshotPayloadSchema với mọi nested object .strict()
    // (players, currentQuestion, ...) — KHÔNG được pass-through unknown fields.

    const SnapshotFullSchema = z.object({
      mode: z.literal("full"),
      snapshot: SnapshotPayloadSchema.strict(),
      lastEventSeqNo: z.number().int().nonnegative(),
      // replayCursor bắt buộc có mặt trong envelope (cả full và
      // delta) để client echo lại ở lần reconnect kế tiếp.
      replayCursor: z.string().min(1),
    }).strict();

    const EventItemSchema = z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      timestamp: z.number().int().nonnegative(),
      // `payload` is treated as opaque on the wire: replay is
      // strictly event-metadata driven (seqNo, matchId, type). The
      // schema therefore does NOT require events[*].payload to be
      // `.strict()`, and the all-levels strictness rule below is
      // documented as applying to envelope / event-metadata
      // objects, not to nested payload shapes. If a future change
      // makes any payload discriminated and recursive, the rule
      // must be re-stated for that subtree only.
      payload: z.unknown(),
      seqNo: z.number().int().nonnegative(),
      // matchId PHẢI có mặt trong mỗi event (server dùng để bind với match).
      matchId: idSchema,
    }).strict();

    const SnapshotDeltaSchema = z.object({
      mode: z.literal("delta"),
      events: z.array(EventItemSchema).min(0),  // allow empty: reconnect tại latestSeqNo
      lastEventSeqNo: z.number().int().nonnegative(),
      // replayCursor bắt buộc có mặt trong envelope delta.
      replayCursor: z.string().min(1),
    }).strict();

    const SnapshotEnvelopeSchema = z.discriminatedUnion("mode", [
      SnapshotFullSchema,
      SnapshotDeltaSchema,
    ]);
    ```

  - Quy ước cứng: `mode === "full"` PHẢI có `snapshot` và KHÔNG có `events`; `mode === "delta"` PHẢI có `events` (cho phép mảng rỗng) và KHÔNG có `snapshot`. Cả hai variants PHẢI có `lastEventSeqNo`. Tất cả nested object (`snapshot.players`, `snapshot.currentQuestion`, event-metadata fields, v.v.) cũng PHẢI dùng `.strict()` — unknown field ở bất kỳ cấp nào ⇒ reject (không silently fall-back). **Ngoại lệ duy nhất**: `events[*].payload` vẫn là `z.unknown()` (xem `EventItemSchema` ở trên). Nếu sau này một payload trở thành discriminated, cây con đó phải tự `.strict()` rõ ràng.
  - **Empty event log (chốt rõ — phân biệt client mới vs client đã hydrate)**:
    - **Client mới (chưa hydrate, không gửi `replayCursor`, không kèm capability flag hoặc gửi capability flag lần đầu)**: handler KHÔNG dùng `getDelta`. Handler gọi `getSnapshot(0)` và trả **raw full snapshot** (client cũ) HOẶC envelope `mode: "full"` (client mới gửi capability flag) — cả hai đều là full snapshot. Đây là hợp đồng "client mới phải nhận full snapshot" bất kể eventLog rỗng hay không.
    - **Client đã hydrate hợp lệ tại cursor 0** (gửi `replayCursor` hợp lệ với `seqNo === 0`, server verify chữ ký + match ok, `latestSeqNo === 0`, `eventLog` rỗng): handler trả envelope `mode: "delta"` với `events: []` và `lastEventSeqNo: 0` (delta hợp lệ, rỗng). KHÔNG ép full snapshot trong trường hợp này.
    - **Cursor tương lai (`replayCursor.seqNo > latestSeqNo`, kể cả khi `latestSeqNo === 0` mà token cũng `seqNo === 0` thì hợp lệ — chỉ khi `> 0`)**: handler fallback full + log cảnh báo (xem "Cursor sai match fallback" trong Phase D2).
    - **Log bị cắt (`replayCursor.seqNo < firstEventSeqNo - 1`, tức `latestSeqNo > 0` mà cursor quá cũ)**: handler fallback full + log cảnh báo.
    - Một match chưa có event nào với **client đã hydrate hợp lệ tại cursor 0** vẫn phải trả envelope delta hợp lệ (rỗng). Đây là test case bắt buộc (xem "Test cho match chưa có event nào" trong Phase D4). Và **client mới** cho cùng match đó phải nhận full snapshot — đây là test case bắt buộc thứ hai.

- [ ] **Parser/client handling rõ ràng** (cập nhật socket-store FE):
  - Trong `apps/web/src/stores/socket-store.ts` (`ServerEvent.SNAPSHOT` handler) và `socket-store.updaters.ts:447-477`, **unwrap envelope trước** khi gọi `applySnapshotState`. Hàm `applySnapshotState` tiếp tục nhận raw shape để giữ ổn định.
  - Khi envelope có `mode: "delta"`, áp dụng tuần tự `events` lên state hiện tại (cập nhật `lastSeenSeqNo` để gửi kèm reconnect sau).
  - **Regression**: client cũ vẫn nhận raw full snapshot ⇒ parser phải phân biệt được bằng flag hoặc presence của field `mode`; KHÔNG ép unwrap nếu payload đã là raw.
  - **Envelope invalid (server trả về shape không hợp lệ)**: client PHẢI request full snapshot mới và KHÔNG apply bất kỳ event nào từ envelope. Lỗi phải được log + metric (nếu có).
- [ ] **Ràng buộc request với match trước khi đánh giá replayability**:
  - Trong `RequestSnapshotPayloadSchema` (`packages/shared/src/schemas.ts:124-156`) và handler `match.handler.ts:handleRequestSnapshot` (`apps/api/src/gateways/handlers/match.handler.ts:197-249`): PHẢI dựa trên `payload.matchId` VÀ socket room membership (`client.rooms.has(\`room:\${roomId}\`)`) — đây là 2 nguồn xác định match identity chính.
  - Server CÓ THỂ thêm kiểm tra event metadata (ví dụ `event.matchId` hoặc seqNo-to-match mapping) khi cần, nhưng KHÔNG ĐƯỢC suy luận match từ `lastSeenSeqNo` một mình.
  - Nếu `payload.matchId` không resolve được state machine ⇒ reject với `MATCH_NOT_FOUND` (đã có); không rơi vào fallback "trả full snapshot từ state machine khác".
- [ ] **Backward-compat — chuẩn hóa ba nhánh client trong `MatchHandler.handleRequestSnapshot`**:
  - **Nhánh 1 — Client cũ (request KHÔNG kèm capability flag)**: gọi `getSnapshot(0)` và emit **raw full snapshot** (giữ nguyên `SnapshotPayload` cũ — KHÔNG có field `mode`/`replayCursor`). Đây là wire contract cũ; client cũ không parse envelope.
  - **Nhánh 2 — Client mới (request CÓ capability flag nhưng KHÔNG có `replayCursor` hợp lệ — lần đầu, hoặc cursor bị mất/hỏng)**: gọi `getSnapshot(0)` và emit **envelope `mode: "full"`** (`SnapshotFullSchema`, gồm `snapshot`, `lastEventSeqNo`, `replayCursor` mới). Server vẫn phát `replayCursor` mới ở đây để client echo lại ở lần reconnect kế tiếp.
  - **Nhánh 3 — Client mới (request CÓ capability flag VÀ CÓ `replayCursor` hợp lệ)**:
    - Verify `replayCursor` (schema, chữ ký HMAC, khớp `matchId` của match đã resolve, và chưa hết hạn `expiresAt`).
    - Verify fail ⇒ fallback full envelope (`mode: "full"`) + log cảnh báo. RETURN.
    - Đọc `eventLog` để lấy `firstEventSeqNo` và `latestSeqNo`.
    - Thực hiện các kiểm tra replayability (future-cursor `seqNo > latestSeqNo`, truncated-log `seqNo < firstEventSeqNo - 1`, và gap checks).
    - Nếu vi phạm bất kỳ kiểm tra nào trong các kiểm tra trên ⇒ fallback full envelope (`mode: "full"`) + log cảnh báo. RETURN. (Ngoại lệ: trường hợp empty-eventLog carve-out cho phép replay delta rỗng nếu `eventLog.length === 0` AND `replayCursor.seqNo === 0` AND `latestSeqNo === 0`).
    - Nếu hợp lệ ⇒ emit envelope `mode: "delta"` với `events` (kể cả rỗng) và `replayCursor` mới.
  - Ba nhánh là tách biệt, không dùng chung wire shape. Client cũ nhận raw; client mới luôn nhận envelope.
- [ ] **Quy tắc fallback** (cập nhật điều kiện, đồng bộ với "Empty event log" và "Fallback ownership"): chỉ trả full snapshot khi MỘT TRONG các trường hợp sau xảy ra ở handler (`MatchHandler.handleRequestSnapshot`):
  - Client mới: request không có `replayCursor` hợp lệ và không có capability flag ⇒ gọi `getSnapshot(0)` và trả **raw full snapshot** (client cũ) hoặc envelope `mode: "full"` (client mới có capability flag). Bắt buộc bất kể eventLog rỗng hay không — xem "Client mới" trong "Empty event log".
  - `replayCursor.seqNo` vượt quá `latestSeqNo` (cursor tương lai/gap ngược), HOẶC
  - `replayCursor.seqNo` nhỏ hơn `firstEventSeqNo - 1` (log bị cắt), HOẶC
  - Phát hiện gap bất thường (seqNo trong eventLog không liên tục), HOẶC
  - Cursor sai match (signature fail / `matchId` trong token không khớp match đã resolve / token hết hạn) — match identity xác định qua `payload.matchId`/room, KHÔNG qua seqNo.
  - **KHÔNG fallback full** trong trường hợp sau (đây là rule bắt buộc để không mâu thuẫn với "Empty event log"):
    - Client đã hydrate hợp lệ tại cursor 0 (gửi `replayCursor` hợp lệ với `seqNo === 0`, server verify chữ ký + match ok, `latestSeqNo === 0`, `eventLog` rỗng) ⇒ handler trả envelope `mode: "delta"` với `events: []` và `lastEventSeqNo: 0`. KHÔNG fallback full.
  - Lưu ý: trường hợp `replayCursor.seqNo = 9` và `eventLog[0].seqNo = 10` (client đã thấy tới seq 9, log bắt đầu từ 10) vẫn replay được: server trả delta các event có `seqNo > 9` (tức từ 10 trở đi). KHÔNG ép full fallback trong trường hợp này.
- [ ] Cập nhật schema/event liên quan (capability flag, envelope delta/full, giữ raw payload cho `mode: "full"`).
- [ ] Bổ sung handler tests:
  - Client cũ (không có capability flag) nhận raw full snapshot.
  - Client mới (có capability flag) nhận envelope đúng shape (`mode: "delta"` khi replayable, `mode: "full"` khi fallback).
  - `applySnapshotState` vẫn hydrate đúng khi payload là raw full snapshot (regression).
  - **Empty eventLog — hai nhánh tách biệt** (xem "Empty event log" trong Phase D1):
    - Client mới + eventLog rỗng ⇒ raw full snapshot (client cũ) hoặc envelope `mode: "full"` (client mới).
    - Client đã hydrate hợp lệ tại cursor 0 + eventLog rỗng ⇒ envelope `mode: "delta"`, `events: []`, `lastEventSeqNo: 0`.
- [ ] Cập nhật schema/event liên quan (capability flag, envelope delta/full, giữ raw payload cho `mode: "full"`).
- [ ] Bổ sung handler tests:
  - Client cũ (không có capability flag) nhận raw full snapshot.
  - Client mới (có capability flag) nhận envelope đúng shape (`mode: "delta"` khi replayable, `mode: "full"` khi fallback).
  - `applySnapshotState` vẫn hydrate đúng khi payload là raw full snapshot (regression).
  - **Match identity**:
    - `payload.matchId` không khớp state machine ⇒ `MATCH_NOT_FOUND`, KHÔNG trả snapshot của match khác.
    - Client không ở `room:${roomId}` ⇒ `UNAUTHORIZED` (đã có ở match.handler.ts:218-221).
    - Cấm handler dùng `lastSeenSeqNo` để suy luận match.
  - **Strict validation**:
    - Envelope `mode: "full"` có `events` ⇒ reject (validator `.strict()` fail).
    - Envelope `mode: "delta"` có `snapshot` ⇒ reject.
    - Envelope thiếu `lastEventSeqNo` ⇒ reject.
    - Envelope có field lạ (vd `foo`) ⇒ reject.
  - **Thứ tự xử lý trong handler (handler ordering — bắt buộc)**:
    1. `this.requireAuth(client)` (auth check).
    2. **Room authorization FIRST, before any state-machine work**: handler thực hiện một **minimal match-to-room lookup** chỉ để xác định authorization — tức là lấy `roomId` cho `payload.matchId` (qua `matchService.getRoomIdByMatchId` hoặc tương đương, không đụng tới `eventLog` / `currentRound` / `state.players` của state machine). Nếu client chưa ở `room:${roomId}` ⇒ trả `UNAUTHORIZED` NGAY, **không** resolve state machine, **không** đọc event log. Hiện tại handler đang lookup state machine TRƯỚC rồi mới check room (xem `apps/api/src/gateways/handlers/match.handler.ts:203-220`); Phase D2 PHẢI đảo lại.
    3. **Resolve match state machine** (sau khi đã pass auth + room check) để có `stateMachine.getState().roomId` cho việc trả full snapshot nếu cần. Nếu resolve fail ⇒ `MATCH_NOT_FOUND`.
    4. Apply rule delta/full (xem "Quy tắc fallback" ở trên).
    5. Validate envelope (xem "Strict validation" ở trên) trước khi emit.
    6. `lastSeenSeqNo` KHÔNG ĐƯỢC tham gia vào bất kỳ bước xác định match/room nào.

### Phase D2 — Server: dựng delta

- [ ] **Fallback ownership (chốt cho Phase D1, đồng bộ với "Empty event log" và "Quy tắc fallback")**:
  - `MatchStateMachine.getDelta(seqNo: number)` chỉ trả về `events: EventItem[]` (event-only). Method này **không** quyết định full vs delta; **không** trả full snapshot khi cursor gap hoặc không hợp lệ; **không** throw khi cursor nằm ngoài khả dụng. Caller chịu trách nhiệm fallback. Tham số `seqNo` là số nguyên **nội bộ** — caller (`MatchHandler.handleRequestSnapshot`) chịu trách nhiệm giải mã `replayCursor` thành `seqNo` đã verify chữ ký + match trước khi gọi. `seqNo` KHÔNG xuất hiện trên wire dưới dạng field contract cho client mới (xem "Cursor strategy").
  - `getDelta` chỉ kiểm tra dữ liệu event/contiguity: filter `eventLog` theo `seqNo > inputSeqNo`; **KHÔNG** sửa đổi internal state; **KHÔNG** gọi `getSnapshot` hoặc trả về object kiểu full.
    - Nếu `inputSeqNo > latestSeqNo` (cursor tương lai) ⇒ trả `events: []` (mảng rỗng).
    - Nếu `inputSeqNo < firstEventSeqNo - 1` (log bị cắt) ⇒ trả `events: []` (mảng rỗng).
    - Nếu `inputSeqNo === latestSeqNo === 0` và `eventLog` rỗng (match chưa có event nào, client đã hydrate hợp lệ tại cursor 0) ⇒ trả `events: []` (delta hợp lệ, rỗng). KHÔNG throw, KHÔNG fallback.
    - Caller (`MatchHandler.handleRequestSnapshot`) đọc `eventLog` riêng (hoặc dùng cờ riêng) để quyết định có fallback full hay không — KHÔNG dựa vào `getDelta` để biết cursor không hợp lệ.
  - `MatchStateMachine.getSnapshot(lastEventSeqNo)` giữ nguyên chữ ký, vẫn trả full snapshot (giữ tương thích với `auth.handler.ts:syncReconnection`).
  - **Caller (`MatchHandler.handleRequestSnapshot`)**: sở hữu toàn bộ quyết định mode. Quy trình chuẩn hóa (đồng bộ với "Quy tắc fallback", "Empty event log", và ba nhánh client trong "Backward-compat"):
    1. `requireAuth` + room authorization (xem "Thứ tự xử lý trong handler").
    2. Resolve match identity qua `payload.matchId` + room membership (KHÔNG dùng seqNo cho match identity).
    3. **Phân nhánh client theo ba nhánh của "Backward-compat"**:
       - **Nhánh 1** (client cũ, không capability flag) ⇒ gọi `getSnapshot(0)`, emit raw full snapshot. RETURN.
       - **Nhánh 2** (client mới có capability flag nhưng KHÔNG có `replayCursor` hợp lệ) ⇒ gọi `getSnapshot(0)`, emit envelope `mode: "full"` với `replayCursor` mới. RETURN.
       - **Nhánh 3** (client mới có capability flag VÀ CÓ `replayCursor` hợp lệ) ⇒ tiếp tục bước 4.
    4. Verify `replayCursor` (schema + chữ ký HMAC + match identity + chưa hết hạn `expiresAt`). Sai bất kỳ mục nào ⇒ fallback full envelope (`mode: "full"`) + log cảnh báo. RETURN.
    5. Đọc `eventLog` để xác định `eventLog.length`, `firstEventSeqNo`, và `latestSeqNo` (dùng trực tiếp từ `eventLog`, không qua `getDelta`).
    6. **Empty-eventLog carve-out (Ngoại lệ hóa điều kiện eventLog rỗng)**: nếu `eventLog.length === 0` AND `replayCursor` đã verify ở bước 4 AND `replayCursor.seqNo === 0` AND `latestSeqNo === 0` ⇒ handler emit envelope `mode: "delta"` với `events: []` và `lastEventSeqNo: 0`. KHÔNG fallback full. Đây là trường hợp "match chưa có event nào, client đã hydrate hợp lệ tại cursor 0". RETURN.
    7. **Kiểm tra replayability (future-cursor, truncated-log, và gap checks)**:
       - Nếu `replayCursor.seqNo > latestSeqNo` (cursor tương lai / future-cursor), HOẶC
       - Nếu `replayCursor.seqNo < firstEventSeqNo - 1` (log bị cắt / truncated-log), HOẶC
       - Nếu phát hiện gap bất thường (các `seqNo` của eventLog từ `replayCursor.seqNo + 1` đến `latestSeqNo` không liên tục hoặc không đầy đủ).
         ⇒ Thực hiện fallback full envelope (`mode: "full"`) + log cảnh báo. RETURN.
    8. Gọi `getDelta(inputSeqNo)` (với `inputSeqNo = replayCursor.seqNo` đã verify) để lấy danh sách `events`.
    9. Trả envelope `mode: "delta"` với `events` và `replayCursor` mới. RETURN.
  - **Lưu ý quan trọng về empty-eventLog**: carve-out ở bước 6 chỉ áp dụng khi TẤT CẢ điều kiện sau đúng đồng thời:
    - `replayCursor` đã được verify đầy đủ ở bước 4 (schema, chữ ký, match identity, và expiry).
    - `eventLog.length === 0` (match chưa có event nào).
    - `replayCursor.seqNo === 0` VÀ `latestSeqNo === 0`.
      Mọi trường hợp khác (eventLog rỗng nhưng cursor không hợp lệ, hoặc `replayCursor.seqNo > 0` mà log bị cắt từ đầu, hoặc cursor tương lai, gap, log bị cắt) đều rơi vào fallback full ở bước 4 hoặc bước 7. Kết quả: `getDelta` event-only, full-snapshot fallback là việc của handler — đồng bộ với Phase D1 wire shape và Phase D4 unit tests.
  - D4 unit tests:
    - **Game-core tests cho `getDelta`**: chỉ assert tập event (filtered theo `seqNo > inputSeqNo`) và tính liên tục (contiguous seqNo từ `cursor+1`). KHÔNG assert về `mode`, KHÔNG assert full snapshot, KHÔNG assert rằng `getDelta` ném lỗi khi cursor không hợp lệ.
      - Nếu `inputSeqNo > latestSeqNo` ⇒ assert trả `events: []` (mảng rỗng).
      - Nếu `inputSeqNo < firstEventSeqNo - 1` ⇒ assert trả `events: []` (mảng rỗng).
      - Nếu `inputSeqNo === latestSeqNo === 0` và eventLog rỗng ⇒ assert trả `events: []` (delta hợp lệ, rỗng).
    - **Handler tests cho `MatchHandler.handleRequestSnapshot`**: mock `getDelta` (event-only) + `getSnapshot` (full) và assert mode ở handler (delta envelope vs full envelope), assert `replayCursor` echo, assert fallback full trên cursor không hợp lệ.
- [ ] **Cursor strategy (chốt cho Phase D1) — chọn Phương án A: signed `replayCursor`**:
  - **Wire contract cho client mới** (kèm capability flag, xem "Backward-compat" ở trên): request thay `lastSeenSeqNo: number` bằng `replayCursor: string` (HMAC token chứa `{ matchId, seqNo, issuedAt, expiresAt }`) trong `RequestSnapshotPayloadSchema` (`packages/shared/src/schemas.ts:124-156`). Response envelope `{ mode, snapshot?, events?, lastEventSeqNo, replayCursor }` — `replayCursor` PHẢI nằm trong envelope (cả `SnapshotFullSchema` và `SnapshotDeltaSchema`) để client echo lại ở lần reconnect kế tiếp. `lastEventSeqNo` giữ tên này trong response vì nó là event-metadata echo, không phải field contract.
  - **Wire contract cho client cũ** (không kèm capability flag): vẫn gửi `lastSeenSeqNo: number` (hiện tại luôn = 0, xem `apps/web/src/stores/socket-store.ts:620-625`). Response là **raw full snapshot** (`SnapshotPayload` cũ, KHÔNG có `mode`/`replayCursor`) — KHÔNG phải envelope `mode: "full"`. Đây là chốt rõ: client cũ nhận raw full snapshot; client mới nhận envelope `{ mode, ..., replayCursor }`. Hai shape này là hai nhánh tách biệt, không dùng chung.
  - Server phát `replayCursor` mới cho client ở mỗi `SNAPSHOT` envelope và mỗi `EVENT_BATCH` broadcast (nếu event-batch mode được bật).
  - Client KHÔNG tự tạo `replayCursor`; chỉ echo lại token nhận được ở response gần nhất.
  - **Nếu vẫn dùng `lastSeenSeqNo` numeric nội bộ** (cho audit/log/debug): ghi rõ field đó KHÔNG thuộc wire contract cho client mới. Validator Zod chỉ validate `replayCursor` (string) cho request mới; `lastEventSeqNo` chỉ xuất hiện trong response.
  - **Cursor sai match fallback**: handler verify chữ ký + match `matchId` trong token với match đã resolve. Sai bất kỳ mục nào (signature fail / match mismatch / token hết hạn) ⇒ fallback full + log cảnh báo. Bổ sung test bắt buộc trong Phase D4: client gửi `replayCursor` của match khác ⇒ expect envelope `mode: "full"` + warning log.
  - **Backward compat (chốt)**: client cũ gửi `lastSeenSeqNo: number` (không có `replayCursor` và không có capability flag) ⇒ server route qua `getSnapshot(0)` và emit **raw full snapshot** (giữ nguyên `SnapshotPayload` cũ). KHÔNG wrap trong envelope `mode: "full"`. Client mới gửi `replayCursor` (và capability flag) ⇒ server emit envelope `{ mode, snapshot?, events?, lastEventSeqNo, replayCursor }` qua `SnapshotFullSchema` / `SnapshotDeltaSchema` `.strict()`. Test trong D4: client cũ nhận raw payload không có `mode`; client mới nhận envelope có `mode` + `replayCursor`.
- [ ] **Bắt buộc server-authoritative validation cho delta envelope** trước khi gửi/phát ra. Replay validity phải dựa trên **event metadata hoặc match-scoped event log** chứ KHÔNG dựa trên `lastSeenSeqNo` một mình:
  - `eventLog` không rỗng.
  - Cursor (`replayCursor` hoặc `lastSeenSeqNo` + match binding) đã được verify bằng cơ chế ở phương án A/B ở trên, thuộc đúng match đã resolve ở bước "handler ordering" dưới đây.
  - `seqNo` không vượt quá `latestSeqNo` (cũng không thấp hơn `firstEventSeqNo - 1`).
  - Các `seqNo` trong delta liên tục và đầy đủ từ `cursor.seqNo + 1` đến `latestSeqNo` (cho phép `events: []` nếu `cursor.seqNo === latestSeqNo`).
  - Mỗi event trong delta PHẢI có `matchId` khớp với `payload.matchId` đã resolve; nếu thiếu/không khớp ⇒ fallback full.
  - Bất kỳ vi phạm nào ở trên ⇒ fallback full snapshot, KHÔNG trả delta sai.
- [ ] **Trước khi apply delta phía client** (Phase D3, `socket-store.updaters.ts`), client cũng PHẢI validate envelope đã được server ký (server-authoritative nhưng client vẫn defense-in-depth). Quy tắc:
  - **Nếu `events` rỗng**: chỉ validate `envelope.lastEventSeqNo === currentLastSeenSeqNo`. KHÔNG truy cập `events[0]` hoặc `events[last]`. Pass ⇒ cập nhật `lastSeenSeqNo` = `envelope.lastEventSeqNo` và return. Đây là đường hợp lệ cho reconnect tại latest cursor và cho match chưa có event nào (initial cursor).
  - **Nếu `events` không rỗng**: validate (mọi event bắt buộc có `matchId` — không có ngoại lệ "(nếu có field)"):
    - `events[0].seqNo === currentLastSeenSeqNo + 1` (contiguous về phía trước).
    - Mỗi `events[i+1].seqNo === events[i].seqNo + 1` (contiguous nội bộ).
    - Với **mọi** `events[i]`: `event.matchId` PHẢI là non-empty string VÀ `event.matchId === currentMatchId` (matchId client đã gửi trong request, lưu lại cùng envelope). Bất kỳ event nào thiếu `matchId`, có `matchId` rỗng, hoặc `matchId` khác `currentMatchId` ⇒ reject. KHÔNG có ngoại lệ nào cho phép event thiếu/khác matchId.
    - `events[last].seqNo === envelope.lastEventSeqNo`.
  - Bất kỳ vi phạm nào ở nhánh nào ⇒ client PHẢI request full snapshot mới và KHÔNG apply delta.
- [ ] Xử lý fallback về full snapshot cho mọi trường hợp thiếu mốc, gap, log bị cắt, hoặc thuộc match khác.
- [ ] Gán seqNo ổn định cho mỗi event trong `logEvent` và bảo đảm cơ chế snapshot/rehydrate (serialize/rehydrate) lưu trữ và bảo toàn cả `seqNo` và bộ đếm `next-sequence` (next-sequence counter).

### Phase D3 — Client: áp dụng delta

- [ ] `socket-store.ts` / `socket-store.updaters.ts`: nhận `mode: "delta"` → apply tuần tự event lên state hiện tại; `mode: "full"` → hydrate như cũ.
- [ ] **Live cursor source (chốt cho Phase D1)**: cursor chỉ được cập nhật từ `SNAPSHOT.lastEventSeqNo` và `EVENT_BATCH` events (server-broadcast batch có seqNo + matchId đầy đủ). Cụ thể:
  - `ROUND_ENDED`, `PLAYER_ELIMINATED`, `ANSWER_RESULT` KHÔNG mang seqNo trong payload hiện tại (xem `packages/shared/src/events.ts:157-181` cho `RoundEndedPayload` / `PlayerEliminatedPayload` và `packages/shared/src/socket.ts:133-140` cho `AnswerResultPayload`). Cập nhật `lastSeenSeqNo` từ các event này sẽ tạo coupling sai với replay cursor.
  - Live updaters trong `apps/web/src/stores/socket-store.ts` (`applyRoundEndedState`, `applyPlayerEliminatedState`, `applyAnswerResultState`) KHÔNG được tự ghi `lastSeenSeqNo`. Cursor chỉ được cập nhật ở nơi duy nhất: `applySnapshotState` (từ `envelope.lastEventSeqNo`) và một handler `EVENT_BATCH` mới trong `socket-store.ts` (nếu / khi batch broadcast được bật). Tài liệu hoá rule này trong socket-store comment.
  - Phase D1 KHÔNG yêu cầu thêm `seqNo` vào payload của `ROUND_ENDED` / `PLAYER_ELIMINATED` / `ANSWER_RESULT` (đó là scope của một track contract-mở-rộng riêng, ngoài D).
- [ ] **Phân biệt rõ giữa delta replay (apply) và live event handling — KHÔNG dùng chung logic deduplicate/buffer**:
  - **Delta replay** (`envelope.mode === "delta"`, áp dụng từ `applySnapshotState` envelope branch): validate envelope trước khi apply (xem "Trước khi apply delta phía client" trong Phase D2). **Reject gap, duplicate, hoặc out-of-order** — bất kỳ vi phạm nào ⇒ request full snapshot mới, KHÔNG apply bất kỳ event nào từ delta đó. KHÔNG tự ý deduplicate hoặc buffer.
  - **Live event** (`applyRoundEndedState`, `applyPlayerEliminatedState`, ...): cho phép idempotency/buffer nhỏ (e.g. dedup theo `eventId` cho retry socket, hoặc buffer out-of-order tới một ngưỡng nhỏ) vì socket có thể drop/resend. Tuy nhiên, phải có giới hạn rõ ràng (timeout buffer, max size) để không trở thành unbounded queue.
  - Hai luồng KHÔNG dùng chung helper. Nếu cùng apply một event vì hai đường dẫn (ví dụ delta replay rồi server lại phát lại event đó live), phải có cơ chế loại trừ (vd. set `appliedEventIds`) để không apply trùng.
- [ ] Xử lý out-of-order / trùng seqNo: **chỉ áp dụng cho live events** (xem bullet trên). Delta replay KHÔNG dùng cơ chế này — gap/dup ⇒ full snapshot.

### Phase D4 — Test & chốt

- [ ] Unit game-core: `getDelta` trả đúng tập event sau mốc. KHÔNG throw trong bất kỳ trường hợp cursor không hợp lệ nào — trả `events: []` cho: (1) `inputSeqNo > latestSeqNo` (cursor tương lai), (2) `inputSeqNo < firstEventSeqNo - 1` (log bị cắt), (3) `inputSeqNo === latestSeqNo === 0` + eventLog rỗng (client đã hydrate hợp lệ tại cursor 0). KHÔNG có test fallback full ở `getDelta` (fallback là việc của handler, xem "Fallback ownership" trong Phase D2).
- [ ] Handler test: reconnect với client cũ & mới, bao phủ cả phản hồi full và delta. Thêm test bao phủ từng trường hợp fallback (eventLog rỗng + client mới ⇒ full, `replayCursor` sai match, `replayCursor.seqNo > latestSeqNo`, gap giữa các seqNo, log bị cắt) và xác nhận response mode là full. Test mode assertion ở handler, không ở `getDelta`.
- [ ] **Test cho match chưa có event nào, phân biệt hai client**:
  - **Client mới (lần đầu, không có `replayCursor` hoặc capability flag mới)**: handler phải trả **full snapshot** (raw với client cũ, envelope `mode: "full"` với client mới có capability flag). KHÔNG trả delta.
  - **Client đã hydrate hợp lệ tại cursor 0** (gửi `replayCursor` hợp lệ với `seqNo === 0`, `latestSeqNo === 0`): handler phải trả envelope `mode: "delta"`, `events: []`, `lastEventSeqNo: 0` — KHÔNG fallback full.
  - Hai test này bảo vệ contract khi eventLog rỗng.
- [ ] Test client-side: empty-events branch (`socket-store.updaters.ts`) chỉ kiểm tra `envelope.lastEventSeqNo === currentLastSeenSeqNo`, KHÔNG truy cập `events[0]` / `events[last]`. Test non-empty branch với contiguous + `event.matchId === currentMatchId` (mọi event bắt buộc) + last-seqNo checks.
- [ ] Test Redis round-trip: xác nhận serialize/rehydrate bảo toàn `seqNo` và bộ đếm `next-sequence`, khởi động lại không tạo `seqNo` trùng, và xác nhận delta replay không bỏ sót hoặc trả sai event.
- [ ] `gitnexus_detect_changes()` xác nhận scope (kỳ vọng: `MatchStateMachine` (CRITICAL) cho `getDelta` mới, `MatchHandler.handleRequestSnapshot` (HIGH) cho handler ordering + envelope, `shared` schemas cho token + envelope, FE socket-store cho client validation); cập nhật `progress.md` (xoá "Full reconnect/event replay contract" khỏi "Not Done Yet").

## File dự kiến chạm

- `packages/game-core/src/match-state-machine.ts` (thêm `getDelta` + seqNo cho eventLog).
- `apps/api/src/gateways/handlers/match.handler.ts` (chọn mode).
- `packages/shared/src/{events,schemas}.ts` (contract delta/full).
- `apps/web/src/stores/{socket-store,socket-store.updaters,socket-store.types}.ts`.

## Acceptance

- [ ] Reconnect với `replayCursor` hợp lệ nhận delta envelope (kèm `replayCursor` mới để echo ở lần kế tiếp); state sau delta == full-hydrate.
- [ ] Fallback full hoạt động chính xác khi eventLog không đủ, có gap, hoặc sai match.
- [ ] Backward-compat: client cũ gửi `lastSeenSeqNo: 0` (không có `replayCursor` / capability flag) nhận **raw full snapshot** (giữ nguyên `SnapshotPayload` cũ). Client mới gửi `replayCursor` (kèm capability flag) nhận envelope `{ mode, snapshot?, events?, lastEventSeqNo, replayCursor }`. Hai nhánh tách biệt, không lẫn.
- [ ] `getSnapshot` cũ giữ nguyên chữ ký (chỉ mở rộng `getDelta`).
- [ ] `seqNo` và bộ đếm `next-sequence` được bảo toàn qua serialize/rehydrate; khởi động lại không tạo `seqNo` trùng.
- [ ] Kết quả kiểm thử Redis round-trip xác nhận delta replay không bỏ sót hoặc trả sai event.

## Rủi ro

- eventLog hiện chưa chắc có seqNo ổn định qua serialize/rehydrate (Redis snapshot) → phải kiểm tra `deserializeMatch` giữ nguyên thứ tự/seqNo trước khi tin dùng cho delta.
- Đụng state machine (CRITICAL) → chỉ thêm, verify full suite.
- Giao `socket-store.ts` with C → chỉ bắt đầu sau khi C merge.
