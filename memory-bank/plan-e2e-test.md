# Plan: End-to-End Room → Match Flow

> **Mục tiêu**: Kết nối toàn bộ user journey từ landing page đến match kết thúc.
> **Chiến lược**: 8 Atomic Slices — mỗi slice 2-4 files, testable ngay sau khi hoàn thành.
> **Phụ thuộc**: Backend đã hoàn thiện (auth, room, match, game-loop, state-machine) và Component Library đã hoàn thành (Phases 1-4).

---

## Dependency Graph

```text
Component Library (Phases 1-4) ─────────────────────────────────────┐
   (không phụ thuộc)                                                │
   ▼                                                                │
Slice 1: Guest Login ────────────────────────────────────────────────┤
   │ (có thể dùng component library)                                 │
   ▼                                                                │
Slice 2: Socket Store Handlers ──────────────────────────────────────┤
   │ (cần Slice 1 để test)                                           │
   ├─────────────────────────────────────────────────────────────────┤
   ▼                                                                │
Slice 3: Create Room + Lobby UI ─────────────────────────────────────┤
   │ (cần Slice 2)                                                   │
   ▼                                                                │
Slice 4: Join Room + Redirect ───────────────────────────────────────┤
   │ (cần Slice 2, độc lập với Slice 3)                              │
   ▼                                                                │
Slice 5: Match Start + Countdown UI ─────────────────────────────────┤
   │ (cần Slice 3 hoặc 4 để có room, cần Slice 2 để có store)        │
   ▼                                                                │
Slice 6: Game UI (Question + Answer) ────────────────────────────────┤
   │ (cần Slice 5)                                                   │
   ▼                                                                │
Slice 7: Elimination + Results ──────────────────────────────────────┤
   │ (cần Slice 6)                                                   │
   ▼                                                                │
Slice 8: E2E Integration Test ───────────────────────────────────────┘
   (cần tất cả slices trên)
```

---

## Slice 1: Guest Login + Auth Flow

> **User story**: Người chơi vào landing page → nhập nickname → nhận JWT → WebSocket authenticated

### Files cần tạo/sửa

| File                                  | Action   | Mô tả                                                                                     |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `apps/web/src/app/page.tsx`           | **Edit** | Thay nút tĩnh bằng logic: state machine cho login flow (idle → entering → logging → done) |
| `apps/web/src/app/globals.css`        | **Edit** | Thêm style cho input, nút (đã có `btn-primary` cơ bản)                                    |
| `apps/web/src/lib/api.ts`             | **New**  | Helper `guestLogin(username) → { user }` gọi `POST /auth/guest` và để server set cookies  |
| `apps/web/src/stores/socket-store.ts` | **Edit** | Thêm action `login(username)` gọi REST rồi connect WS bằng cookie auth                    |

### Flow chi tiết

```text
1. User nhập nickname vào input
2. Click "Vào Game" → gọi POST /auth/guest { username }
3. Nhận `{ user { id, username } }` và `Set-Cookie` chứa access/refresh token httpOnly
4. Không lưu token trong localStorage; browser giữ cookie bảo mật
5. `socket-store.connect()` dùng `withCredentials: true` → server đọc access cookie và tự xác thực socket
6. Nhận `AUTHENTICATED { userId, username }` → set `isAuthenticated = true`
7. Transition sang màn hình chọn Create/Join Room
```

### State machine (trong page.tsx)

```typescript
type AuthState = "idle" | "entering" | "loading" | "authenticated";
```

### Verify sau Slice 1

- [ ] Nhập username, click → thấy loading → thấy authenticated
- [ ] Console log: "🔌 Connected" → "✅ Authenticated: [name]"
- [ ] Token được server set vào httpOnly cookies, không dùng localStorage
- [ ] Refresh trang → vẫn authenticated (dùng cookie cũ)

---

## Slice 2: Socket Store — Missing Event Handlers

> **Mục tiêu**: Store phải reactive với MỌI server event. Hiện tại 7 events chỉ `console.log`.

### Các handler cần thêm vào `socket-store.ts`

| ServerEvent         | Hiện tại    | Cần sửa thành                                                             |
| ------------------- | ----------- | ------------------------------------------------------------------------- |
| `MATCH_STARTED`     | ❌ Chưa có  | Set `match` với status COUNTDOWN, countdownMs                             |
| `ROUND_STARTED`     | ❌ Chưa có  | Set `match.currentQuestion`, `match.roundEndTime`, `match.currentRoundNo` |
| `ROUND_ENDED`       | ❌ Chưa có  | Cập nhật `match.players` status (surviving/eliminated)                    |
| `PLAYER_ELIMINATED` | ❌ Chưa có  | Update 1 player status → ELIMINATED                                       |
| `MATCH_FINISHED`    | ❌ Chưa có  | Set `match.status = FINISHED`, store winner                               |
| `PLAYER_JOINED`     | console.log | Thêm player vào `room.players[]`                                          |
| `PLAYER_LEFT`       | console.log | Xóa player khỏi `room.players[]`                                          |
| `MATCH_STARTING`    | console.log | Set `room.status = COUNTDOWN`                                             |

### Payload shapes (từ game-loop.service.ts)

```typescript
// MATCH_STARTED payload
{ matchId, roomId, status: "COUNTDOWN", countdownMs: 5000 }

// ROUND_STARTED payload
{ matchId, roundNo, question: { id, content, options }, endsAt: timestamp, roundDurationMs: 15000 }

// ROUND_ENDED payload
{ matchId, roundNo, correctAnswer, survivingPlayerIds: string[], eliminatedPlayerIds: string[] }

// PLAYER_ELIMINATED payload
{ matchId, roundNo, playerId, reason: "WRONG_ANSWER" | "TIMEOUT" }

// MATCH_FINISHED payload
{ matchId, winnerId, totalRounds, finishedAt, players: Player[] }
```

### Verify sau Slice 2

- [ ] Mở 2 browser tab, login cả 2
- [ ] Tab 1 tạo room → Tab 2 join → Tab 1 thấy player list update
- [ ] Start match → store có match data
- [ ] Kiểm tra `useSocketStore.getState()` sau mỗi event đều có data đúng

---

## Slice 3: Create Room + Lobby Page

> **User story**: Sau khi login, user tạo phòng → thấy lobby với room code + player list

### Files

| File                                          | Action   | Mô tả                                                             |
| --------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `apps/web/src/app/lobby/[roomCode]/page.tsx`  | **New**  | Lobby page hiển thị room code, player list, nút Start (host only) |
| `apps/web/src/components/LobbyPlayerList.tsx` | **New**  | Danh sách player với status badge                                 |
| `apps/web/src/components/RoomCodeDisplay.tsx` | **New**  | Hiển thị room code lớn + nút copy                                 |
| `apps/web/src/app/page.tsx`                   | **Edit** | Sau khi authenticated → hiện nút "Tạo Phòng" (gọi `createRoom`)   |

### Flow

```text
1. User click "Tạo Phòng" trên landing page
2. socket-store.createRoom("PUBLIC") → emit CREATE_ROOM
3. Nhận ROOM_CREATED { roomId, code } → store.room được set
4. Router.push(`/lobby/${code}`)
5. Lobby page đọc `store.room` → hiển thị:
   - Room code (to, copyable)
   - Player list (host có crown icon)
   - Nút "Bắt Đầu" (chỉ hiện nếu userId === host)
   - Số người chơi: 1/100
6. Khi có PLAYER_JOINED → player list tự update
```

### Verify sau Slice 3

- [ ] Tạo phòng → redirect tới `/lobby/XXXXXX`
- [ ] Hiển thị room code
- [ ] Mở tab 2, join room → tab 1 thấy player list cập nhật
- [ ] Nút "Bắt Đầu" chỉ hiện cho host

---

## Slice 4: Join Room + Redirect to Lobby

> **User story**: User nhập room code → join → vào lobby

### Files

| File                                       | Action   | Mô tả                                                      |
| ------------------------------------------ | -------- | ---------------------------------------------------------- |
| `apps/web/src/app/page.tsx`                | **Edit** | Sau authenticated → hiện input nhập code + nút "Vào Phòng" |
| `apps/web/src/components/JoinRoomForm.tsx` | **New**  | Input 6 ký tự + validation                                 |

### Flow

```text
1. User nhập room code (6 ký tự)
2. Click "Vào Phòng" → socket-store.joinRoom(code) → emit JOIN_ROOM
3. Nhận ROOM_JOINED { roomId, code, players }
4. Router.push(`/lobby/${code}`)
5. Lobby page hiển thị (dùng chung với Slice 3)
```

### Verify sau Slice 4

- [ ] Nhập code phòng đã tạo → join thành công → vào lobby
- [ ] Nhập code sai → hiện error message
- [ ] Player list hiển thị đúng tất cả người chơi

---

## Slice 5: Match Start + Countdown UI

> **User story**: Host bấm "Bắt Đầu" → tất cả player thấy countdown 5s → vào game

### Files

| File                                           | Action   | Mô tả                                                                      |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `apps/web/src/app/game/[matchId]/page.tsx`     | **New**  | Game page skeleton, hiển thị countdown/round/question                      |
| `apps/web/src/components/CountdownOverlay.tsx` | **New**  | Overlay countdown 5-4-3-2-1                                                |
| `apps/web/src/app/lobby/[roomCode]/page.tsx`   | **Edit** | Nút "Bắt Đầu" → gọi `startMatch(roomId)`, listen MATCH_STARTING → redirect |

### Flow

```text
1. Host click "Bắt Đầu" → emit START_MATCH
2. MATCH_STARTING { matchId, countdown } → store.room.status = "COUNTDOWN"
3. Router.push(`/game/${matchId}`)
4. Game page mount, listen MATCH_STARTED → hiển thị countdown overlay
5. Đếm ngược 5-4-3-2-1 (client-side animation, sync với server countdown)
6. Hết countdown → sẵn sàng nhận ROUND_STARTED (Slice 6)
```

### Verify sau Slice 5

- [ ] Host bấm "Bắt Đầu" → tất cả tab redirect tới `/game/{matchId}`
- [ ] Countdown overlay hiển thị đếm ngược
- [ ] Sau countdown, UI sẵn sàng cho round 1

---

## Slice 6: Game UI — Question Display + Answer Submit

> **User story**: Người chơi thấy câu hỏi + 4 đáp án + timer 15s → chọn đáp án → thấy kết quả

### Files

| File                                         | Action   | Mô tả                                   |
| -------------------------------------------- | -------- | --------------------------------------- |
| `apps/web/src/app/game/[matchId]/page.tsx`   | **Edit** | Thêm logic render question/answer/timer |
| `apps/web/src/components/QuestionCard.tsx`   | **New**  | Hiển thị câu hỏi + 4 option buttons     |
| `apps/web/src/components/RoundTimer.tsx`     | **New**  | Progress bar + số giây còn lại          |
| `apps/web/src/components/AnswerFeedback.tsx` | **New**  | Toast/overlay đúng/sai sau khi submit   |

### State machine (trong game page)

```typescript
type GamePhase = "countdown" | "question" | "answered" | "result";
```

### Flow

```text
1. Nhận ROUND_STARTED { question: { id, content, options }, roundNo, endsAt }
   → store.match.currentQuestion = question
   → store.match.roundEndTime = endsAt
   → UI: QuestionCard hiện câu hỏi + 4 nút đáp án
   → RoundTimer bắt đầu đếm ngược từ endsAt

2. User click 1 đáp án
   → emit SUBMIT_ANSWER { matchId, roundNo, answer, clientTimestamp }  // clientTimestamp = telemetry-only, not used for anti-cheat
   → UI: disable tất cả nút, hiển thị "đã chọn"

3. Nhận ANSWER_RESULT { isCorrect, responseTimeMs }
   → AnswerFeedback: ✅ Đúng! hoặc ❌ Sai!
   → Nếu đúng: giữ nguyên, chờ ROUND_ENDED
   → Nếu sai: hiển thị player sẽ bị loại
```

### Verify sau Slice 6

- [ ] Câu hỏi hiển thị đúng content + 4 options
- [ ] Timer chạy ngược từ 15s
- [ ] Click đáp án → disable các nút khác → gửi SUBMIT_ANSWER
- [ ] Nhận ANSWER_RESULT → hiện feedback đúng/sai
- [ ] Hết 15s không trả lời → tự động hết round

---

## Slice 7: Elimination Display + Results Screen

> **User story**: Sau mỗi round thấy ai bị loại → cuối match thấy màn hình kết quả

### Files

| File                                            | Action   | Mô tả                                                        |
| ----------------------------------------------- | -------- | ------------------------------------------------------------ |
| `apps/web/src/app/game/[matchId]/page.tsx`      | **Edit** | Thêm xử lý ROUND_ENDED, PLAYER_ELIMINATED, MATCH_FINISHED    |
| `apps/web/src/components/EliminationBanner.tsx` | **New**  | Banner "Bạn đã bị loại!" / danh sách người bị loại round này |
| `apps/web/src/components/PlayerStatusBar.tsx`   | **New**  | Top bar hiển thị số người còn sống / tổng                    |
| `apps/web/src/app/result/[matchId]/page.tsx`    | **New**  | Màn hình kết quả: winner, stats, nút chơi lại                |

### Flow

```text
1. Nhận ROUND_ENDED { correctAnswer, survivingPlayerIds, eliminatedPlayerIds }
   → Hiển thị đáp án đúng
   → PlayerStatusBar cập nhật số survivors
   → Nếu user bị loại: EliminationBanner hiện "Bạn đã bị loại!"
   → Sau 3s → round tiếp theo (ROUND_STARTED) hoặc match kết thúc

2. Nhận PLAYER_ELIMINATED { playerId, reason }
   → Cập nhật status của player trong store
   → Nếu là mình: hiện full-screen "Bạn đã bị loại!"

3. Nhận MATCH_FINISHED { winnerId, totalRounds, players }
   → Router.push(`/result/${matchId}`)
   → Result page: hiện winner + bảng xếp hạng + nút "Chơi lại"
```

### Verify sau Slice 7

- [ ] Sau round, thấy đáp án đúng + số người còn sống
- [ ] Khi bị loại → hiện banner/thông báo rõ ràng
- [ ] Kết thúc match → redirect sang result page
- [ ] Result page hiển thị winner + ranking
- [ ] Nút "Chơi lại" → quay về lobby/create room

---

## Slice 8: E2E Integration Test + Polish

> **Mục tiêu**: Chạy flow end-to-end thật, verify tất cả edge cases, fix lỗi còn sót.

### Test scenarios

| #   | Scenario                                                   | Expected                                     |
| --- | ---------------------------------------------------------- | -------------------------------------------- |
| 1   | 2 players: login → create → join → start → answer → finish | Cả 2 thấy đủ flow, winner đúng               |
| 2   | Player trả lời sai → bị loại                               | Hiện elimination banner, vẫn thấy tiếp match |
| 3   | Player không trả lời (timeout) → bị loại                   | Hiện "Hết giờ!", bị loại                     |
| 4   | Player disconnect giữa match → reconnect                   | Snapshot restore, UI đồng bộ                 |
| 5   | Refresh trang giữa game                                    | Vẫn vào được game, state đúng                |
| 6   | Multiple rounds đến khi còn 1 người                        | Match kết thúc đúng, tie-break hoạt động     |

### Edge cases cần fix

- [ ] Nếu API_URL sai → hiện error message thân thiện
- [ ] Nếu token hết hạn → tự refresh hoặc redirect login
- [ ] Nếu room full (100 người) → hiện thông báo
- [ ] Nếu bắt đầu match với <2 người → hiện lỗi
- [ ] Nếu 2 tab cùng 1 user → tab cũ bị kick

### Verify sau Slice 8

- [ ] Chạy tất cả scenarios trên → pass
- [ ] Không có console error
- [ ] UI responsive trên mobile
- [ ] Performance: không lag khi 100 players join room

---

## File Inventory — Tất cả files sẽ thay đổi

### Component Library (Phases 1-4) — ✅ Completed

> Đã hoàn thành đầy đủ thư viện component theo thiết kế hệ thống:
>
> - Phase 1: Design Tokens và CSS Layers
> - Phase 2: Core Components (Icon, Spinner, Skeleton, GlassPanel, Divider)
> - Phase 3: Interactive Components (Button, Input, Badge, Avatar)
> - Phase 4: Molecular Components (FormField, Tooltip, Toast, Modal)

### E2E Flow Files

| File                                            | Slice | Action  |
| ----------------------------------------------- | ----- | ------- |
| `apps/web/src/app/page.tsx`                     | 1,3,4 | Edit    |
| `apps/web/src/app/globals.css`                  | 1     | Edit    |
| `apps/web/src/lib/api.ts`                       | 1     | **New** |
| `apps/web/src/stores/socket-store.ts`           | 1,2   | Edit    |
| `apps/web/src/app/lobby/[roomCode]/page.tsx`    | 3,5   | **New** |
| `apps/web/src/components/LobbyPlayerList.tsx`   | 3     | **New** |
| `apps/web/src/components/RoomCodeDisplay.tsx`   | 3     | **New** |
| `apps/web/src/components/JoinRoomForm.tsx`      | 4     | **New** |
| `apps/web/src/app/game/[matchId]/page.tsx`      | 5,6,7 | **New** |
| `apps/web/src/components/CountdownOverlay.tsx`  | 5     | **New** |
| `apps/web/src/components/QuestionCard.tsx`      | 6     | **New** |
| `apps/web/src/components/RoundTimer.tsx`        | 6     | **New** |
| `apps/web/src/components/AnswerFeedback.tsx`    | 6     | **New** |
| `apps/web/src/components/EliminationBanner.tsx` | 7     | **New** |
| `apps/web/src/components/PlayerStatusBar.tsx`   | 7     | **New** |
| `apps/web/src/app/result/[matchId]/page.tsx`    | 7     | **New** |

**Tổng**: 3 edit + 13 new files. Mỗi slice xử lý 2-4 files.

---

## Tiến độ

| Slice                          | Trạng thái   | Ngày bắt đầu | Ngày hoàn thành |
| ------------------------------ | ------------ | ------------ | --------------- |
| Component Library (Phases 1-4) | ✅ Completed | 2026-05-24   | 2026-05-24      |
| 1: Guest Login + Auth          | ⏳ Pending   | —            | —               |
| 2: Socket Store Handlers       | ⏳ Pending   | —            | —               |
| 3: Create Room + Lobby         | ⏳ Pending   | —            | —               |
| 4: Join Room                   | ⏳ Pending   | —            | —               |
| 5: Match Start + Countdown     | ⏳ Pending   | —            | —               |
| 6: Game UI (Q&A)               | ⏳ Pending   | —            | —               |
| 7: Elimination + Results       | ⏳ Pending   | —            | —               |
| 8: E2E Integration Test        | ⏳ Pending   | —            | —               |
