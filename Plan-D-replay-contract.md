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
    }).strict();

    const EventItemSchema = z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      timestamp: z.number().int().nonnegative(),
      payload: z.unknown(),
      seqNo: z.number().int().nonnegative(),
      // matchId PHẢI có mặt trong mỗi event (server dùng để bind với match).
      matchId: idSchema,
    }).strict();

    const SnapshotDeltaSchema = z.object({
      mode: z.literal("delta"),
      events: z.array(EventItemSchema).min(0),  // allow empty: reconnect tại latestSeqNo
      lastEventSeqNo: z.number().int().nonnegative(),
    }).strict();

    const SnapshotEnvelopeSchema = z.discriminatedUnion("mode", [
      SnapshotFullSchema,
      SnapshotDeltaSchema,
    ]);
    ```

  - Quy ước cứng: `mode === "full"` PHẢI có `snapshot` và KHÔNG có `events`; `mode === "delta"` PHẢI có `events` (cho phép mảng rỗng) và KHÔNG có `snapshot`. Cả hai variants PHẢI có `lastEventSeqNo`. Tất cả nested object (`snapshot.players`, `snapshot.currentQuestion`, `events[*].payload`, v.v.) cũng PHẢI dùng `.strict()` — unknown field ở bất kỳ cấp nào ⇒ reject (không silently fall-back).
  - **No-new-events behavior (reconnect tại `lastSeenSeqNo == latestSeqNo`)**: handler PHẢI trả `mode: "delta"` với `events: []` và `lastEventSeqNo: latestSeqNo`. KHÔNG ép full snapshot trong trường hợp này (đã đủ thông tin để client biết "không có gì mới"). Nếu phát hiện `lastSeenSeqNo > latestSeqNo` (cursor tương lai) ⇒ fallback full.

- [ ] **Parser/client handling rõ ràng** (cập nhật socket-store FE):
  - Trong `apps/web/src/stores/socket-store.ts` (`ServerEvent.SNAPSHOT` handler) và `socket-store.updaters.ts:447-477`, **unwrap envelope trước** khi gọi `applySnapshotState`. Hàm `applySnapshotState` tiếp tục nhận raw shape để giữ ổn định.
  - Khi envelope có `mode: "delta"`, áp dụng tuần tự `events` lên state hiện tại (cập nhật `lastSeenSeqNo` để gửi kèm reconnect sau).
  - **Regression**: client cũ vẫn nhận raw full snapshot ⇒ parser phải phân biệt được bằng flag hoặc presence của field `mode`; KHÔNG ép unwrap nếu payload đã là raw.
  - **Envelope invalid (server trả về shape không hợp lệ)**: client PHẢI request full snapshot mới và KHÔNG apply bất kỳ event nào từ envelope. Lỗi phải được log + metric (nếu có).
- [ ] **Ràng buộc request với match trước khi đánh giá replayability**:
  - Trong `RequestSnapshotPayloadSchema` (`packages/shared/src/schemas.ts:124-156`) và handler `match.handler.ts:handleRequestSnapshot` (`apps/api/src/gateways/handlers/match.handler.ts:197-249`): PHẢI dựa trên `payload.matchId` VÀ socket room membership (`client.rooms.has(\`room:\${roomId}\`)`) — đây là 2 nguồn xác định match identity chính.
  - Server CÓ THỂ thêm kiểm tra event metadata (ví dụ `event.matchId` hoặc seqNo-to-match mapping) khi cần, nhưng KHÔNG ĐƯỢC suy luận match từ `lastSeenSeqNo` một mình.
  - Nếu `payload.matchId` không resolve được state machine ⇒ reject với `MATCH_NOT_FOUND` (đã có); không rơi vào fallback "trả full snapshot từ state machine khác".
- [ ] **Backward-compat**:
  - Request KHÔNG kèm capability flag (client cũ) ⇒ trả raw full snapshot (giữ nguyên shape hiện tại).
  - Request kèm capability flag (client mới) ⇒ trả envelope `{ mode: "delta" | "full", events?, snapshot?, lastEventSeqNo }`.
- [ ] **Quy tắc fallback** (cập nhật điều kiện): chỉ trả full snapshot khi một trong các trường hợp sau:
  - `lastSeenSeqNo` vượt quá `latestSeqNo` (client tương lai/gap ngược), HOẶC
  - `lastSeenSeqNo` nhỏ hơn `firstEventSeqNo - 1` (client đã bị cắt log), HOẶC
  - Phát hiện gap bất thường (seqNo trong eventLog không liên tục, hoặc `lastSeenSeqNo` thuộc match khác — match identity đã xác định qua `payload.matchId`/room, KHÔNG qua seqNo), HOẶC
  - `eventLog` rỗng / chưa có event nào.
  - Lưu ý: trường hợp `lastSeenSeqNo = 9` và `eventLog[0].seqNo = 10` (client đã thấy tới seq 9, log bắt đầu từ 10) vẫn replay được: server trả delta các event có `seqNo > 9` (tức từ 10 trở đi). KHÔNG ép full fallback trong trường hợp này.
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
    2. **Room authorization FIRST**: nếu client chưa ở channel `room:${roomId}` ⇒ trả `UNAUTHORIZED` NGAY. Hiện tại handler đang lookup state machine TRƯỚC rồi mới check room (xem `apps/api/src/gateways/handlers/match.handler.ts:203-220`); Phase D2 PHẢI đảo lại: room check phải chạy trước resolve `payload.matchId` thông qua state machine.
    3. Resolve `payload.matchId` qua state machine; nếu không có ⇒ `MATCH_NOT_FOUND`.
    4. Apply rule delta/full (xem "Quy tắc fallback" ở trên).
    5. Validate envelope (xem "Strict validation" ở trên) trước khi emit.
    6. `lastSeenSeqNo` KHÔNG ĐƯỢC tham gia vào việc xác định match identity.

### Phase D2 — Server: dựng delta

- [ ] Thêm `getDelta(lastSeenSeqNo)` đọc `eventLog`, trả các event có seqNo > lastSeenSeqNo. **Chỉ thêm method, không đổi chữ ký `getSnapshot` cũ** (giữ full-hydrate cho caller khác).
- [ ] **Bind `lastSeenSeqNo` vào resolved match (không chỉ validate con số)**: hiện tại Plan-D đề xuất dựa trên `eventLog` của state machine, nhưng `seqNo` chỉ là số nguyên và có thể trùng giữa các match (đặc biệt sau khi process restart nếu counter không được bảo toàn qua serialize/rehydrate). PHẢI chọn **một trong hai** cơ chế sau:
  - **Phương án A — Signed token**: thay trường `lastSeenSeqNo: number` bằng `replayCursor: string` (JWT hoặc HMAC chứa `{ matchId, seqNo, issuedAt }`) mà server đã phát cho client ở lần gửi event/response trước đó. Client KHÔNG tự tạo token, chỉ echo lại token nhận được. Server verify chữ ký + match `matchId` với match đã resolve (xem handler ordering bên dưới) + check `seqNo <= latestSeqNo` + check `token.expiresAt` nếu có. Sai bất kỳ mục nào ⇒ reject cursor, fallback full.
  - **Phương án B — Globally unique seqNo**: state machine đảm bảo `seqNo` là globally unique (không reset khi restart), ví dụ bằng cách kết hợp `matchId` hoặc dùng monotonic counter cố định. Mỗi event PHẢI có `matchId` trong payload (xem `EventItemSchema` ở trên). Server tìm event có `seqNo === lastSeenSeqNo` để verify match identity trước khi cho replay. Không tìm thấy ⇒ reject cursor, fallback full.
  - Chọn phương án A hoặc B trong Phase D1; **KHÔNG** dùng `lastSeenSeqNo` numeric đơn thuần (vì không chứng minh được match ownership).
  - Trong mọi test/handler test, bổ sung case "cursor sai match" (dùng `lastSeenSeqNo` / token của match khác) ⇒ fallback full + log cảnh báo.
- [ ] **Bắt buộc server-authoritative validation cho delta envelope** trước khi gửi/phát ra. Replay validity phải dựa trên **event metadata hoặc match-scoped event log** chứ KHÔNG dựa trên `lastSeenSeqNo` một mình:
  - `eventLog` không rỗng.
  - Cursor (`replayCursor` hoặc `lastSeenSeqNo` + match binding) đã được verify bằng cơ chế ở phương án A/B ở trên, thuộc đúng match đã resolve ở bước "handler ordering" dưới đây.
  - `seqNo` không vượt quá `latestSeqNo` (cũng không thấp hơn `firstEventSeqNo - 1`).
  - Các `seqNo` trong delta liên tục và đầy đủ từ `cursor.seqNo + 1` đến `latestSeqNo` (cho phép `events: []` nếu `cursor.seqNo === latestSeqNo`).
  - Mỗi event trong delta PHẢI có `matchId` khớp với `payload.matchId` đã resolve; nếu thiếu/không khớp ⇒ fallback full.
  - Bất kỳ vi phạm nào ở trên ⇒ fallback full snapshot, KHÔNG trả delta sai.
- [ ] **Trước khi apply delta phía client** (Phase D3, `socket-store.updaters.ts`), client cũng PHẢI validate envelope đã được server ký (server-authoritative nhưng client vẫn defense-in-depth):
  - `events[0].seqNo === currentLastSeenSeqNo + 1` (contiguous về phía trước).
  - Mỗi `events[i+1].seqNo === events[i].seqNo + 1` (contiguous nội bộ).
  - `events[i].matchId` (nếu có field) === `payload.matchId` mà client đã gửi.
  - `events[last].seqNo === envelope.lastEventSeqNo`.
  - Bất kỳ vi phạm nào ⇒ client PHẢI request full snapshot mới và KHÔNG apply delta.
- [ ] Xử lý fallback về full snapshot cho mọi trường hợp thiếu mốc, gap, log bị cắt, hoặc thuộc match khác.
- [ ] Gán seqNo ổn định cho mỗi event trong `logEvent` và bảo đảm cơ chế snapshot/rehydrate (serialize/rehydrate) lưu trữ và bảo toàn cả `seqNo` và bộ đếm `next-sequence` (next-sequence counter).

### Phase D3 — Client: áp dụng delta

- [ ] `socket-store.ts` / `socket-store.updaters.ts`: nhận `mode: "delta"` → apply tuần tự event lên state hiện tại; `mode: "full"` → hydrate như cũ.
- [ ] Theo dõi `lastSeenSeqNo` phía client (cập nhật mỗi event nhận được) để gửi kèm khi reconnect.
- [ ] **Phân biệt rõ giữa delta replay (apply) và live event handling — KHÔNG dùng chung logic deduplicate/buffer**:
  - **Delta replay** (`envelope.mode === "delta"`, áp dụng từ `applySnapshotState` envelope branch): validate envelope trước khi apply (xem "Trước khi apply delta phía client" trong Phase D2). **Reject gap, duplicate, hoặc out-of-order** — bất kỳ vi phạm nào ⇒ request full snapshot mới, KHÔNG apply bất kỳ event nào từ delta đó. KHÔNG tự ý deduplicate hoặc buffer.
  - **Live event** (`applyRoundEndedState`, `applyPlayerEliminatedState`, ...): cho phép idempotency/buffer nhỏ (e.g. dedup theo `eventId` cho retry socket, hoặc buffer out-of-order tới một ngưỡng nhỏ) vì socket có thể drop/resend. Tuy nhiên, phải có giới hạn rõ ràng (timeout buffer, max size) để không trở thành unbounded queue.
  - Hai luồng KHÔNG dùng chung helper. Nếu cùng apply một event vì hai đường dẫn (ví dụ delta replay rồi server lại phát lại event đó live), phải có cơ chế loại trừ (vd. set `appliedEventIds`) để không apply trùng.
- [ ] Xử lý out-of-order / trùng seqNo: **chỉ áp dụng cho live events** (xem bullet trên). Delta replay KHÔNG dùng cơ chế này — gap/dup ⇒ full snapshot.

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
