# Plan D — Phase D1: Replay Contract Design (no code)

> Output của Phase D1. Nền để implement D2 (server) / D3 (client) / D4 (test).
> Base: nhánh `worktree-plan-c-afk-hardening` (Track C đã có trong worktree này).

## 0. Verify hiện trạng (đã đọc code)

| Điểm                                         | Sự thật trong code                                                                                                                                                | File                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSnapshot(lastEventSeqNo)` bỏ qua tham số | Chỉ echo lại `lastEventSeqNo` vào payload, luôn full                                                                                                              | [match-state-machine.ts:471-489](packages/game-core/src/match-state-machine.ts#L471-L489)                                                                |
| 2 caller trực tiếp (impact = **HIGH**)       | `handleRequestSnapshot` (`getSnapshot(payload.lastSeenSeqNo)`) và `auth.handler` reconnect (`getSnapshot(0)`)                                                     | [match.handler.ts:229](apps/api/src/gateways/handlers/match.handler.ts#L229), [auth.handler.ts:361](apps/api/src/gateways/handlers/auth.handler.ts#L361) |
| `eventLog` entry **chưa có seqNo**           | `{ type, payload?, timestamp }`                                                                                                                                   | [match-state-machine.ts:48-52](packages/game-core/src/match-state-machine.ts#L48-L52)                                                                    |
| Codec cũng chưa có seqNo                     | `EventLogEntry { type, payload?, timestamp }`, serialize/deserialize giữ nguyên mảng theo thứ tự                                                                  | [match-state.codec.ts:26-30](packages/game-core/src/match-state.codec.ts#L26-L30)                                                                        |
| **Slot delta đã dựng sẵn nhưng chưa dùng**   | `ServerEvent.EVENT_BATCH = "event_batch"` + `EventBatchPayload { events:[{id,type,timestamp,payload,seqNo}] }` — grep toàn repo: **không có nơi nào emit/handle** | [socket.ts:65](packages/shared/src/socket.ts#L65), [socket.ts:123-131](packages/shared/src/socket.ts#L123-L131)                                          |
| Client hardcode cursor = 0                   | `requestSnapshot(matchId, 0)` ở game page; `getSnapshot(0)` ở auth reconnect                                                                                      | [page.tsx:182](apps/web/src/app/[locale]/game/[matchId]/page.tsx#L182)                                                                                   |
| Cap cursor hiện tại quá nhỏ cho cursor thật  | `lastSeenSeqNo.max(MAX_ROUNDS*2)` = 100; comment tự ghi chú "phải re-derive nếu làm delta thật"                                                                   | [schemas.ts:151-155](packages/shared/src/schemas.ts#L151-L155)                                                                                           |

**Kết luận nền tảng:** thiết kế ban đầu đã chừa sẵn `EVENT_BATCH` + `EventBatchPayload` cho đúng việc này. Contract sẽ **tái dùng chúng**, không phát minh discriminated-union trên `SNAPSHOT`.

## 1. Quyết định contract: hai event riêng, không đổi `SNAPSHOT`

Plan D gốc phác "response `{mode:"delta"}` hoặc `{mode:"full"}`" (union trên 1 event). **Chọn khác đi** vì backward-compat + đã có sẵn `EVENT_BATCH`:

- **Full hydrate** → giữ nguyên event `SNAPSHOT` với `SnapshotPayload` (không đổi shape).
- **Delta replay** → event `EVENT_BATCH` với `EventBatchPayload` (đã có sẵn).
- Server chọn mode; client đăng ký cả hai handler.

### Vì sao hơn union trên `SNAPSHOT`

- **Backward-compat tự nhiên:** client cũ hardcode `lastSeenSeqNo=0` → luôn nhận `SNAPSHOT` full như cũ; client cũ **không** đăng ký handler `EVENT_BATCH` nên không bao giờ vỡ. Không phải bump version payload.
- Không phải đụng shape `SnapshotPayload` (đang được `applySnapshotState` dùng) → giảm blast radius trên HIGH-risk path.
- Tái dùng type đã tồn tại — đúng ý đồ thiết kế ban đầu.

## 2. Contract chi tiết

### 2.1 Request (giữ nguyên wire `REQUEST_SNAPSHOT`)

```
REQUEST_SNAPSHOT { matchId: string, lastSeenSeqNo: number }
```

Ngữ nghĩa **được kích hoạt thật** (trước đây là echo):

- `lastSeenSeqNo = 0` → client yêu cầu / chấp nhận full (hydrate lần đầu, hoặc client cũ).
- `lastSeenSeqNo > 0` → client báo "tôi đã thấy tới seqNo này, cho tôi phần sau" → đủ điều kiện nhận delta.

### 2.2 Response — Full: `SNAPSHOT` (SnapshotPayload, **shape không đổi**)

Điều kiện emit full (bất kỳ điều nào đúng):

- `lastSeenSeqNo === 0`, **hoặc**
- delta không khả dụng (xem §3 fallback).

Thay đổi ngữ nghĩa duy nhất: `lastEventSeqNo` trong payload phải là **seqNo của event mới nhất trong log** (head), **không** còn là echo tham số. → client học được cursor hiện tại để lần sau gửi đúng.

### 2.3 Response — Delta: `EVENT_BATCH` (EventBatchPayload, đã có sẵn)

```
EVENT_BATCH {
  events: Array<{ id: string; type: string; timestamp: number; payload: unknown; seqNo: number }>
}
```

- Chỉ chứa event có `seqNo > lastSeenSeqNo`, **thứ tự tăng dần theo seqNo**.
- `seqNo` cuối mảng = head hiện tại → client cập nhật cursor.
- Có thể rỗng (`events: []`) nếu client đã bắt kịp head (`lastSeenSeqNo === head`) — hợp lệ, client no-op.

> Cân nhắc D2: có thể thêm field `matchId` vào `EventBatchPayload` để client route đúng match (giống các payload khác). Đây là **thêm field optional**, không phá backward-compat. Chốt ở D2.

## 3. Quy tắc fallback về full (server-side, trong handler)

Gọi `head = seqNo của event cuối`; `floor = seqNo của event đầu còn trong log` (hiện log không cắt nên floor = seqNo đầu tiên). Emit **full `SNAPSHOT`** khi:

1. `lastSeenSeqNo === 0` — hydrate lần đầu / client cũ.
2. `lastSeenSeqNo < floor` — cursor cũ hơn phần log còn giữ (đã bị cắt / rehydrate từ Redis mất đoạn đầu) → không dựng đủ delta.
3. `lastSeenSeqNo > head` — cursor ở tương lai (bất thường: client state lỗi, hoặc match bị reset) → full cho an toàn.
4. eventLog rỗng hoặc không đọc được seqNo ổn định (defensive) → full.

Ngược lại (`floor <= lastSeenSeqNo <= head`) → emit **delta `EVENT_BATCH`** với các event `seqNo > lastSeenSeqNo`.

Trường hợp biên: `lastSeenSeqNo === head` → delta rỗng (đã bắt kịp). Vẫn đi path delta (rẻ hơn full), events = [].

## 4. seqNo: nguồn sự thật & vòng đời (định nghĩa cho D2)

- **Gán tại `logEvent`**: counter đơn điệu tăng dần trong instance, bắt đầu 1 cho event đầu tiên (0 dành cho "chưa thấy gì" ở client). `seqNo = ++this.eventSeqCounter`.
- **Bền qua serialize/rehydrate (RỦI RO chính của Plan D):** thêm `seqNo` vào `EventLogEntry` của codec + serialize + deserialize. `deserialize` phải khôi phục cả counter = `max(seqNo)` để event sau tiếp tục tăng đúng (không reset về 1 gây trùng seqNo sau reconnect từ Redis).
- **`id`** cho `EventBatchPayload`: dùng `${matchId}:${seqNo}` (ổn định, idempotent key phía client). Chốt format ở D2.
- **`lastEventSeqNo` (full snapshot)** = head seqNo hiện tại — thống nhất cùng thang đo với cursor.

> Vì eventLog là mảng append-only chưa cắt, về lý thuyết `seqNo` có thể = index+1. **Không** dùng index: một khi tương lai cắt log (§3 rule 2 mới có ý nghĩa) thì index != seqNo. Lưu seqNo tường minh ngay từ D2 để contract đúng lâu dài.

## 5. Thay đổi schema/shared cần ở D1→D2 (giữ backward-compat)

| File                                           | Thay đổi                                                                                                                  | Phá compat?                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/socket.ts`                | `EVENT_BATCH` + `EventBatchPayload` **đã có** — chỉ (tùy chọn) thêm `matchId` optional                                    | Không                                                                                                                          |
| `packages/game-core/src/match-state.codec.ts`  | `EventLogEntry` thêm `seqNo: number` + serialize/deserialize giữ nó; deserialize khôi phục counter                        | Không (chỉ mở rộng wire nội bộ Redis; đọc snapshot cũ thiếu seqNo → coi như "không có seqNo ổn định" → fallback full, an toàn) |
| `packages/shared/src/schemas.ts`               | Re-derive cap `lastSeenSeqNo.max(...)` từ kích thước log thực (hiện 100 quá nhỏ cho match nhiều round) + cập nhật comment | Không (nới cap)                                                                                                                |
| `packages/shared/src/state.ts` `MatchSnapshot` | Không đổi (giữ `lastEventSeqNo`)                                                                                          | —                                                                                                                              |

**Không đổi chữ ký `getSnapshot`** (Acceptance). D2 thêm `getDelta(lastSeenSeqNo)` + (tùy) `getHeadSeqNo()`; handler chọn mode.

## 6. Luồng quyết định phía handler (pseudo, cho D2)

```
handleRequestSnapshot(client, { matchId, lastSeenSeqNo }):
  sm = getStateMachine(matchId)            // auth + room-membership gate như cũ
  head  = sm.getHeadSeqNo()                // 0 nếu log rỗng
  floor = sm.getFloorSeqNo()               // seqNo event đầu còn giữ
  if lastSeenSeqNo === 0
     or lastSeenSeqNo < floor
     or lastSeenSeqNo > head
     or head === 0:
        emit SNAPSHOT  = sm.getSnapshot(head)      // full, lastEventSeqNo = head
  else:
        emit EVENT_BATCH = { events: sm.getDelta(lastSeenSeqNo) }   // seqNo > lastSeenSeqNo
```

`auth.handler` reconnect (`getSnapshot(0)`) giữ nguyên → luôn full (đúng, vì server-driven reconnect chưa biết cursor client).

## 6b. Quyết định D3 (đã chốt khi implement)

**Phát hiện:** eventLog là **event tóm tắt kiểu audit**, không đủ dựng `currentQuestion`/timer như full-hydrate. `ROUND_STARTED` chỉ có `{roundNo, questionId}`.

**Chọn (user):** _Enrich eventLog + delta đầy đủ_.

- Server: `ROUND_STARTED` mang thêm `question` (client-safe, KHÔNG có correctAnswer) + `endsAt`.
- Shared: thêm union `ReplayEvent` (discriminated theo `type`) để client type-safe.
- Client: `applyEventBatchState` **mirror từng live updater** → delta đưa client tới đúng state một client-giữ-kết-nối sẽ có.

**Ranh giới trách nhiệm của delta** (đã xác minh so với luồng live, không phải so full-hydrate — vì live ≠ full sẵn có):

- Delta tái tạo: `status`, `currentRoundNo`, `currentQuestion`, `roundEndTime`, `players[].status` (elimination), `remainingCount`, `isEliminated`.
- Delta **không** đụng: `players[].score`, `players[].isOnline` — **luồng live cũng không cập nhật các field này trên `match.players`** (score chỉ có ở full-hydrate; presence đi qua `room.players`). Full SNAPSHOT là đường refresh chúng.
- `ANSWER_SUBMITTED`/`TIE_BREAK`/`PLAYER_DISCONNECTED`/`PLAYER_RECONNECTED` → no-op trên match (cursor vẫn tiến), khớp live.

**Điểm tích hợp còn mở (follow-up, cần phối hợp Track C):** `auth.handler.syncReconnection` hiện tự đẩy **full** SNAPSHOT (`getSnapshot(0)`) mỗi lần reconnect. Delta chỉ kích hoạt qua đường client chủ động `REQUEST_SNAPSHOT` kèm cursor (page.tsx gửi `lastSeenSeqNo` thật). Để reconnect mặc định dùng delta cần sửa auth.handler (vùng C) — **cố ý để ngoài D3**.

## 7. Client (định hướng cho D3, không code ở D1)

- Track `lastSeenSeqNo` trong store: cập nhật = `max` seqNo của mọi event nhận (full snapshot set = `lastEventSeqNo`; mỗi entry `EVENT_BATCH` set = `seqNo` của nó).
- Reconnect/hydrate: gửi `requestSnapshot(matchId, lastSeenSeqNo)` (thay `0` hardcode ở [page.tsx:182](apps/web/src/app/[locale]/game/[matchId]/page.tsx#L182)).
- Handler `EVENT_BATCH`: apply tuần tự theo seqNo lên state hiện tại; **idempotent** — bỏ qua event có `seqNo <= lastSeenSeqNo` (chống trùng/out-of-order).
- `SNAPSHOT` giữ nguyên `applySnapshotState`.
- **Property test D4:** apply(delta trên state tại cursor) == full-hydrate tại head.

## 8. Acceptance (map ngược Plan D)

- [x] Contract định nghĩa: request `lastSeenSeqNo` → `SNAPSHOT` (full) hoặc `EVENT_BATCH` (delta). _(§2)_
- [x] Quy tắc fallback rõ ràng (cắt log / gap / cursor tương lai / rỗng). _(§3)_
- [x] Backward-compat: `lastSeenSeqNo=0` và client cũ → full, không đăng ký `EVENT_BATCH`. _(§1)_
- [x] `getSnapshot` giữ chữ ký; chỉ thêm path/method mới. _(§5)_
- [ ] (D2) seqNo bền qua serialize/rehydrate — **rủi ro số 1**, phải test trước khi tin dùng.

## 9. Việc mở — ĐÃ CHỐT (vào D2)

1. **Cap `lastSeenSeqNo`** = `GAME_CONFIG.MAX_ROUNDS * GAME_CONFIG.MAX_PLAYERS * 2` = **10.000** (derive, bỏ hằng số ma `MAX_ROUNDS*2`). Worst-case ~5.5k event/match có headroom; server vẫn validate floor/head độc lập.
2. **`EventBatchPayload` thêm `matchId: string`** (required) — đồng nhất mọi payload khác, client route đa-match.
3. **`id` event = `${matchId}:${seqNo}`** (deterministic) — idempotent key, không dùng uuid/random.
