# 🎯 Arena of 100 — Coding Guidelines & Lưu Ý

> File này là checklist bạn cần **đọc trước mỗi lần code**. Mọi quy tắc dưới đây được rút ra từ architecture assessment thực tế trên codebase.

---

## 📐 Kiến Trúc Tổng Quan

```
┌──────────────────────────────────────────────────┐
│                    TRANSPORT                      │
│   gateways/ (Socket.io)  │  controllers/ (HTTP)   │
├──────────────────────────────────────────────────┤
│                 APPLICATION (Use Cases)            │
│   Orchestrate domain logic, emit socket events     │
├──────────────────────────────────────────────────┤
│                    DOMAIN                          │
│   packages/game-core (pure logic, zero deps)       │
│   packages/shared (types, events, constants)       │
├──────────────────────────────────────────────────┤
│                 INFRASTRUCTURE                     │
│   Prisma (PostgreSQL)  │  Redis  │  Socket.io      │
└──────────────────────────────────────────────────┘

  ⬆️ Dependencies flow INWARD (transport → domain, never reverse)
```

### Dependency Rules
- `packages/shared` → **KHÔNG import** từ bất kỳ package nào khác
- `packages/game-core` → chỉ import từ `@arena/shared`
- `apps/api` → import từ `@arena/shared` + `@arena/game-core`
- `apps/web` → chỉ import từ `@arena/shared` (KHÔNG import game-core)

---

## 🔴 CRITICAL — Phải Nhớ Mọi Lúc

### 1. Server-Authoritative (Anti-Cheat)
```typescript
// ✅ ĐÚNG — Timestamp từ server
const serverTimestamp = Date.now();
const result = stateMachine.submitAnswer(userId, answer, serverTimestamp);

// ❌ SAI — Dùng timestamp từ client
const result = stateMachine.submitAnswer(userId, answer, payload.clientTimestamp);
```

### 2. KHÔNG Gửi `correctAnswer` Cho Client
```typescript
// ✅ ĐÚNG — Question snapshot không có correctAnswer
const questionForClient = {
  id: question.id,
  content: question.content,
  options: question.options,
};

// ❌ SAI — Leak đáp án
client.emit('round_started', { ...round }); // round có thể chứa correctAnswer
```

### 3. State Machine Persistence
```typescript
// ✅ ĐÚNG — Persist sau mỗi transition
stateMachine.transition(MatchStatus.ROUND_ACTIVE);
await this.redis.setJSON(`match:${matchId}:sm`, stateMachine.serialize());

// ❌ SAI — Chỉ lưu trong RAM
this.stateMachines.set(matchId, stateMachine); // Server restart = mất hết
```

### 4. State Transitions Phải Qua Guard
```typescript
// ✅ ĐÚNG — Check trước khi transition
if (stateMachine.canTransition(MatchStatus.ROUND_ACTIVE)) {
  stateMachine.transition(MatchStatus.ROUND_ACTIVE);
}

// ❌ SAI — Force set status
state.status = MatchStatus.ROUND_ACTIVE; // Bypass state machine
```

---

## 🟡 Backend — Quy Tắc Quan Trọng

### Gateway Handlers — Chỉ Làm Transport
```typescript
// ✅ ĐÚNG — Gateway chỉ parse + delegate + respond
@SubscribeMessage(ClientEvent.SUBMIT_ANSWER)
async handleSubmitAnswer(client: Socket, payload: SubmitAnswerPayload) {
  try {
    const userId = this.getUserId(client);
    const result = await this.matchUseCases.submitAnswer(userId, payload);
    client.emit(ServerEvent.ANSWER_RESULT, result);
  } catch (error) {
    client.emit(ServerEvent.ERROR, this.formatError(error));
  }
}

// ❌ SAI — Gateway chứa business logic
@SubscribeMessage(ClientEvent.SUBMIT_ANSWER)
async handleSubmitAnswer(client: Socket, payload: SubmitAnswerPayload) {
  const stateMachine = this.matchService.getStateMachine(payload.matchId);
  const serverTimestamp = Date.now();
  const result = stateMachine.submitAnswer(userId, payload.answer, serverTimestamp);
  // ... 30 dòng logic khác
}
```

### Error Handling — Dùng Typed Errors
```typescript
// ✅ ĐÚNG — WsException cho WebSocket
import { WsException } from '@nestjs/websockets';
throw new WsException({ code: ErrorCode.ROOM_NOT_FOUND, message: ERROR_MESSAGES[ErrorCode.ROOM_NOT_FOUND] });

// ❌ SAI — Error string thuần
throw new Error(ErrorCode.ROOM_NOT_FOUND);
```

### Redis Operations — Atomic Khi Có Thể
```typescript
// ✅ ĐÚNG — Atomic increment
await this.redis.incr(`room:${roomId}:playerCount`);

// ❌ SAI — Read-modify-write (race condition)
const cached = await this.redis.getJSON(`room:${roomId}`);
cached.playerCount++;
await this.redis.setJSON(`room:${roomId}`, cached);
```

### Validation & Serialization — Sử dụng Zod

- **KHÔNG sử dụng** `class-validator` và `class-transformer` (đã bị gỡ bỏ khỏi dự án).
- **Input Validation**: Dùng custom `ZodValidationPipe` gắn ở route parameter level để validate DTO.
- **Output Serialization**: Dùng `@ZodSerialize(schema)` decorator gắn ở controller method level để tự động lọc dữ liệu nhạy cảm (như `correctAnswer` của câu hỏi) trả về cho client.
- **Swagger Integration**: Định nghĩa DTO class `implements` type infer từ Zod schema, kết hợp sử dụng các decorator `@ApiProperty()` để tài liệu hóa API.
- Chi tiết hướng dẫn xem tại [Zod Migration Guide](./zodMigrationGuide.md).

### Module Structure — Mỗi Feature Một Module
```
apps/api/src/modules/<feature>/
├── <feature>.module.ts      # NestJS module declaration
├── <feature>.service.ts     # Domain/business logic
├── <feature>.controller.ts  # HTTP endpoints (optional)
└── <feature>.gateway.ts     # Socket handlers (if needed)
```

---

## 🟡 Frontend — Quy Tắc Quan Trọng

### Zustand Store — Tách Theo Concern
```typescript
// ✅ ĐÚNG — Store riêng cho mỗi domain
useSocketStore   // Connection + transport
useGameStore     // Game state (match, round, answers)
useRoomStore     // Room state (lobby, players)
useAuthStore     // Auth state (user, token)

// ❌ SAI — Mega store
useAppStore      // Chứa tất cả socket + game + room + auth
```

### Socket Events — KHÔNG Gọi Trực Tiếp Trong Components
```typescript
// ✅ ĐÚNG — Qua store action
const submitAnswer = useGameStore((s) => s.submitAnswer);
submitAnswer(matchId, roundNo, 'A');

// ❌ SAI — Socket trực tiếp trong component
socket.emit('submit_answer', { matchId, roundNo, answer: 'A' });
```

### Optimistic UI Pattern
```typescript
// ✅ ĐÚNG — Lock UI ngay, rollback nếu server reject
const handleAnswer = (answer: string) => {
  setSelectedAnswer(answer);  // Optimistic: lock ngay
  setIsLocked(true);
  submitAnswer(matchId, roundNo, answer); // Gửi server
};

// Listen for server confirmation/rejection
useEffect(() => {
  if (answerResult?.rejected) {
    setSelectedAnswer(null);  // Rollback
    setIsLocked(false);
  }
}, [answerResult]);
```

---

## 🟡 Game-Core — Quy Tắc Domain Logic

### Pure Functions — Zero Side Effects
```typescript
// ✅ ĐÚNG — game-core KHÔNG có side effects
// Không import Redis, Prisma, Socket.io
// Không có async operations
// Chỉ input → output

// ❌ SAI — Side effects trong game-core
import { RedisService } from '../../apps/api/...'; // NEVER
```

### State Machine — Immutable Returns
```typescript
// ✅ ĐÚNG — Return copies, không references
getState(): Readonly<MatchState> {
  return {
    ...this.state,
    players: new Map(this.state.players),  // Deep copy Map
    survivingPlayerIds: [...this.state.survivingPlayerIds],
    eliminatedPlayerIds: [...this.state.eliminatedPlayerIds],
  };
}

// ❌ SAI — Return reference (caller có thể mutate)
getState() { return this.state; }
```

### Testing — Mỗi Function Đều Cần Test
```typescript
// game-core tests nên cover:
// 1. Happy path state transitions
// 2. Invalid transition guards
// 3. Answer submission edge cases (timeout, duplicate, eliminated player)
// 4. Round evaluation (all correct, all wrong, mixed)
// 5. Tie-break scenarios
// 6. Serialize/deserialize round-trip
```

---

## 📋 Checklist Trước Khi Commit

### Mỗi File
- [ ] Không import ngược chiều dependency (domain ← transport)
- [ ] Error dùng `ErrorCode` enum, không dùng string magic
- [ ] Có comment cho logic phức tạp (WHY, không phải WHAT)

### Backend Changes
- [ ] Gateway handler ≤ 15 dòng (chỉ parse-delegate-respond)
- [ ] State machine thay đổi → persist vào Redis
- [ ] Không gửi `correctAnswer` trong bất kỳ client-facing event nào
- [ ] Redis operations dùng atomic khi update counters/sets
- [ ] Timestamps luôn dùng `Date.now()` server-side

### Frontend Changes
- [ ] Socket calls qua store actions, không trực tiếp
- [ ] Loading/error states cho mọi async operation
- [ ] Optimistic UI có rollback path

### Game-Core Changes
- [ ] Function pure, không side effects
- [ ] Return copies, không references
- [ ] Có unit test cho function mới/thay đổi
- [ ] Serialize/deserialize vẫn hoạt động sau thay đổi

---

## 🗂️ File Quan Trọng & Vai Trò

| File | Vai Trò | Lưu Ý |
|------|---------|--------|
| `packages/shared/src/events.ts` | Event types + factory | Thêm event mới → update union type ở cuối file |
| `packages/shared/src/state.ts` | State interfaces | Thay đổi → check game-core + API compatibility |
| `packages/shared/src/socket.ts` | Socket protocol | Thêm event → update BOTH ClientEvent/ServerEvent enums |
| `packages/shared/src/index.ts` | Constants + errors | Thêm ErrorCode → update ERROR_MESSAGES map |
| `packages/game-core/src/match-state-machine.ts` | Core game logic | Thay đổi → chạy tests + check serialize |
| `apps/api/src/gateways/game.gateway.ts` | WebSocket gateway | **REFACTOR TARGET** — đang là God Object |
| `apps/api/src/modules/match/match.service.ts` | Match lifecycle | **State machines phải persist** |
| `apps/api/src/modules/room/room.service.ts` | Room CRUD | playerCount update cần atomic |
| `apps/api/prisma/schema.prisma` | DB schema | Thay đổi → `pnpm db:push` + generate |
| `apps/web/src/stores/socket-store.ts` | Socket connection | Transport only, tách game state ra store khác |

---

## ⚡ Quick Reference — State Transitions

```
Match Lifecycle:
CREATED → COUNTDOWN → ROUND_ACTIVE → ROUND_EVALUATING → ROUND_RESULT → ROUND_ACTIVE (loop)
                                                                         ↘ FINISHED

Room Lifecycle:
WAITING → COUNTDOWN → IN_GAME → FINISHED

Player Lifecycle:
ACTIVE → ELIMINATED → (becomes spectator)
ACTIVE → DISCONNECTED → (reconnect → ACTIVE or timeout → ELIMINATED)
ACTIVE → WINNER
```

---

## 🎮 Game Loop Flow (Cần Implement)

```
1. Host clicks "Start Match"
2. Server: createMatch() → status = CREATED
3. Server: transition(COUNTDOWN) → emit MATCH_STARTING (5s countdown)
4. Server: setTimeout(5s) → transition(ROUND_ACTIVE)
5. Server: pickQuestion() → startRound(question) → emit ROUND_STARTED
6. Server: setTimeout(15s) → auto-end round if not all answered
7. Server: transition(ROUND_EVALUATING) → evaluateRound()
8. Server: transition(ROUND_RESULT) → emit ROUND_ENDED (3s display)
9. Server: Check shouldEndMatch()
   → YES: transition(FINISHED) → finishMatch() → emit MATCH_FINISHED
   → NO:  transition(ROUND_ACTIVE) → goto step 5
```

---

## ⚠️ Gotchas — Những Bẫy Hay Gặp

1. **Map serialization**: `JSON.stringify(new Map())` = `"{}"`. Phải convert Map → Object/Array trước khi serialize.

2. **Socket.io rooms vs channels**: `client.join('room:xxx')` là Socket.io room. `room:xxx:players` là Redis set. Đừng nhầm.

3. **Prisma DateTime vs Date.now()**: Prisma dùng `DateTime` (Date object), game-core dùng `number` (Unix ms). Cần convert.

4. **Fastify + Socket.io**: NestJS Fastify adapter cần cấu hình riêng cho Socket.io. Check `@nestjs/platform-socket.io` compatible version.

5. **CORS dual config**: CORS phải set ở CẢ `main.ts` (HTTP) VÀ `@WebSocketGateway()` decorator (WS).

6. **`nanoid` ESM-only**: Version mới chỉ hỗ trợ ESM. Nếu gặp lỗi import, dùng `nanoid@3` (CJS compatible) hoặc dynamic import.

7. **Zustand devtools**: Luôn dùng `devtools()` middleware trong development để debug store changes.

8. **Event seqNo**: Event sequence number phải TĂNG DẦN, KHÔNG ĐƯỢC trùng. Dùng Redis `INCR` để generate.
