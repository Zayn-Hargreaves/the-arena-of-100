# Plan: GameLoopService Implementation

> **Ngày tạo:** 2026-05-23
> **Ngày sửa cuối:** 2026-05-23 (Task 2 completed)
> **Tầm vực:** Backend - Orchestration Layer
> **Trạng thái:** Ready
>
> Mỗi task chunk là một đơn vị độc lập, chứa đầy đủ context cần thiết để agent 256k token thực thi mà không cần load lại toàn bộ codebase.

---

## 🔄 Review Fixes (23/05)

| #   | Vấn đề                                    | Fix                                                                        |
| --- | ----------------------------------------- | -------------------------------------------------------------------------- |
| F1  | `finishMatch()` return `void`             | Task 2: gọi `finishMatch()` rồi đọc `getState().winnerId`                  |
| F2  | Thiếu `excludeIds` tracking               | Task 2: thêm `usedQuestionIds` Map, gọi `getRandom(undefined, excludeIds)` |
| F3  | Double try-catch trong `handleStartMatch` | Task 4: gộp `startMatchLoop` vào try-catch hiện có                         |
| F4  | `PLAYER_DISCONNECTED` không tồn tại       | Task 6: dùng `ServerEvent.PLAYER_LEFT`                                     |
| F5  | `saveRound` đã return `id` sẵn            | Task 5: code mẫu dùng `round.id` trực tiếp                                 |
| F6  | Thiếu `persistStateMachine` explicit      | Task 2: thêm persist sau mỗi mutation state machine                        |
| F7  | `getRandom()` có thể throw                | Task 2: try-catch → end match gracefully khi hết câu hỏi                   |
| F8  | Cần verify global modules                 | Task 0a: kiểm tra `PrismaModule`/`RedisModule` là `@Global()`              |

---

## Tổng quan kiến trúc

```text
MatchHandler.handleStartMatch
  └─> MatchService.createMatch()            // tạo match + state machine
  └─> GameLoopService.startMatchLoop()      // NEW: điều phối toàn bộ game loop
        │
        ├─ executeCountdown()    [5s]       // COUNTDOWN → broadcast MATCH_STARTED
        ├─ executeRound()        [15s]      // fetch question → startRound → broadcast ROUND_STARTED
        ├─ endRound()            [sync]     // evaluateRound → broadcast PLAYER_ELIMINATED + ROUND_ENDED
        ├─ showResult()          [3s]       // ROUND_RESULT display (embedded in endRound timer)
        └─ checkMatchEnd()                  // shouldEndMatch? → loop | finishMatch → broadcast MATCH_FINISHED
```

**Các state transition (đã có trong MatchStateMachine):**

```text
CREATED → COUNTDOWN → ROUND_ACTIVE → ROUND_EVALUATING → ROUND_RESULT → ROUND_ACTIVE (loop)
     ↓                   ↓              ↓                  ↓               ↓
     └───────────────────┴──────────────┴──────────────────┴───────────────→ FINISHED
```

**Thời gian (GAME_CONFIG):**

- `COUNTDOWN_DURATION_MS` = 5,000 (5 giây)
- `ROUND_DURATION_MS` = 15,000 (15 giây)
- `RESULT_DISPLAY_MS` = 3,000 (3 giây)
- `MAX_ROUNDS` = 50 (safety limit)

**Các file sẽ thay đổi / tạo mới:**

| File                                                   | Action | Task                                  |
| ------------------------------------------------------ | ------ | ------------------------------------- |
| `apps/api/src/modules/match/game-loop.service.ts`      | CREATE | 1, 2                                  |
| `apps/api/src/modules/match/game-loop.service.spec.ts` | CREATE | 8                                     |
| `apps/api/src/modules/match/match.module.ts`           | MODIFY | 0, 3                                  |
| `apps/api/src/gateways/handlers/match.handler.ts`      | MODIFY | 4                                     |
| `apps/api/src/modules/match/match.service.ts`          | MODIFY | 5 (optional: verify saveRound return) |
| `apps/api/src/gateways/handlers/auth.handler.ts`       | MODIFY | 6                                     |

---

## ✅ 🔧 Task 0: Verify + Cập nhật MatchModule (import QuestionModule)

**Priority:** P0 — Làm trước tất cả task khác
**Dependencies:** Không
**Agent context needed:** `match.module.ts`, `question.module.ts`, `AppModule`

### Goal

`MatchModule` phải import `QuestionModule` để `GameLoopService` có thể inject `QuestionService`.
Đồng thời verify rằng `PrismaModule` và `RedisModule` đã là `@Global()` hoặc được import ở cấp `AppModule` — vì `MatchService` đang inject `PrismaService` và `RedisService` mà `MatchModule` không import chúng.

### Step 1: Verify global modules

```bash
grep -r "@Global()" apps/api/src/modules/prisma/
grep -r "@Global()" apps/api/src/modules/redis/
```

Nếu `PrismaModule` hoặc `RedisModule` KHÔNG có `@Global()` decorator:

- Kiểm tra `AppModule` imports — nếu đã import ở đó thì ok
- Nếu không → thêm chúng vào `MatchModule.imports` ở Step 2

### Step 2: Thêm QuestionModule vào imports

**File:** `apps/api/src/modules/match/match.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { MatchService } from "./match.service";
import { MatchController } from "./match.controller";
import { QuestionModule } from "../question/question.module";

@Module({
  imports: [QuestionModule], // NEW
  controllers: [MatchController],
  providers: [MatchService],
  exports: [MatchService],
})
export class MatchModule {}
```

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## ✅ 🔧 Task 1: Tạo GameLoopService - Phase khởi tạo + countdown

**Priority:** P0
**Dependencies:** Task 0
**Agent context needed:** File này (toàn bộ), `match-state-machine.ts` (signatures), `shared/src/index.ts` (GAME_CONFIG, MatchStatus, ServerEvent, getRoomChannel), `match.service.ts` (signatures)

### Goal

Tạo file `game-loop.service.ts` với:

- Cấu trúc service + DI
- `startMatchLoop()` — entry point
- `executeCountdown()` — phase countdown 5s
- Timer management helpers

### File cần tạo

`apps/api/src/modules/match/game-loop.service.ts`

### Full implementation

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Server } from "socket.io";
import { MatchStateMachine } from "@arena/game-core";
import {
  GAME_CONFIG,
  MatchStatus,
  ServerEvent,
  getRoomChannel,
} from "@arena/shared";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";

@Injectable()
export class GameLoopService {
  private readonly logger = new Logger(GameLoopService.name);
  private activeTimers = new Map<string, Set<NodeJS.Timeout>>();
  // F2: Track used question IDs per match to avoid repeats
  private usedQuestionIds = new Map<string, Set<string>>();

  constructor(
    private readonly matchService: MatchService,
    private readonly questionService: QuestionService,
  ) {}

  // ============================================================
  // ENTRY POINT
  // ============================================================

  async startMatchLoop(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    // 1. Get state machine
    const stateMachine = await this.matchService.getStateMachine(matchId);
    if (!stateMachine) {
      this.logger.error(`State machine not found for match ${matchId}`);
      return;
    }

    // 2. Transition to COUNTDOWN
    stateMachine.transition(MatchStatus.COUNTDOWN);

    // F2: Init question tracking
    this.usedQuestionIds.set(matchId, new Set());

    // F6: Persist state machine to Redis
    await this.matchService.persistStateMachine(matchId);

    // 3. Broadcast MATCH_STARTED
    const channel = getRoomChannel(roomId);
    server.to(channel).emit(ServerEvent.MATCH_STARTED, {
      matchId,
      roomId,
      status: "COUNTDOWN",
      countdownMs: GAME_CONFIG.COUNTDOWN_DURATION_MS,
    });

    // 4. Start countdown timer
    await this.executeCountdown(matchId, roomId, server);
  }

  // ============================================================
  // PHASE 1: COUNTDOWN (5 seconds)
  // ============================================================

  private async executeCountdown(
    matchId: string,
    roomId: string,
    server: Server,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        this.logger.log(`Countdown ended for match ${matchId}`);
        await this.executeRound(matchId, roomId, server);
        resolve();
      }, GAME_CONFIG.COUNTDOWN_DURATION_MS);

      this.addTimer(matchId, timer);
    });
  }

  // ============================================================
  // TIMER MANAGEMENT
  // ============================================================

  private addTimer(matchId: string, timer: NodeJS.Timeout): void {
    if (!this.activeTimers.has(matchId)) {
      this.activeTimers.set(matchId, new Set());
    }
    this.activeTimers.get(matchId)!.add(timer);
  }

  private clearTimers(matchId: string): void {
    const timers = this.activeTimers.get(matchId);
    if (timers) {
      for (const t of timers) {
        clearTimeout(t);
      }
      this.activeTimers.delete(matchId);
    }
  }

  // ============================================================
  // PUBLIC: Cancel match (called from handler on error)
  // ============================================================

  cancelMatchLoop(matchId: string): void {
    this.clearTimers(matchId);
    this.usedQuestionIds.delete(matchId);
    this.logger.warn(`Match loop cancelled: ${matchId}`);
  }
}
```

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## ✅ 🔧 Task 2: Tạo GameLoopService - Phase round → evaluate → result → finish

**Priority:** P0
**Dependencies:** Task 1
**Agent context needed:** `game-loop.service.ts` (Task 1 code), `match-state-machine.ts` (toàn bộ signatures), `question.service.ts` (getRandom signature), `match.service.ts` (finishMatch, saveRound, saveAnswer signatures), `shared/src/state.ts` (QuestionState, RoundState, PlayerInfo)

### Goal

Implement đầy đủ flow: round active → evaluate → result → check end → repeat/ finish.

### Status

✅ Hoàn thành - Đã implement đầy đủ các phương thức cần thiết trong `game-loop.service.ts`

### Những gì đã được thực hiện

1. **Implement phương thức `executeRound`**:
   - Chuyển trạng thái sang ROUND_ACTIVE
   - Lấy câu hỏi ngẫu nhiên từ QuestionService với cơ chế tránh lặp (F2)
   - Xử lý lỗi khi không có câu hỏi nào khả dụng (F7)
   - Khởi tạo vòng chơi trong state machine
   - Lưu trạng thái vào Redis sau mỗi mutation (F6)
   - Đếm số lượng người chơi còn sống để hỗ trợ early termination (Task 7)
   - Broadcast sự kiện ROUND_STARTED với câu hỏi (không bao gồm đáp án đúng)

2. **Implement phương thức `endRound`**:
   - Chuyển trạng thái sang ROUND_EVALUATING
   - Đánh giá kết quả vòng chơi
   - Chuyển trạng thái sang ROUND_RESULT
   - Lưu kết quả vòng chơi và câu trả lời vào cơ sở dữ liệu (F5)
   - Chuyển đổi Maps sang arrays để tương thích với Socket.io
   - Broadcast sự kiện ROUND_ENDED với đáp án đúng
   - Gửi thông báo loại bỏ người chơi cho từng người chơi bị loại
   - Thiết lập timer 3s để chuyển sang checkMatchEnd

3. **Implement phương thức `checkMatchEnd`**:
   - Kiểm tra xem trận đấu có nên kết thúc không
   - Nếu có thì gọi finishMatchLoop
   - Nếu không thì tiếp tục vòng chơi mới

4. **Implement phương thức `finishMatchLoop`**:
   - Chuyển trạng thái sang FINISHED
   - Xác định người chiến thắng (F1)
   - Lưu kết quả trận đấu vào cơ sở dữ liệu
   - Broadcast sự kiện MATCH_FINISHED
   - Dọn dẹp tài nguyên (timers, usedQuestionIds)

5. **Thêm thuộc tính `expectedAnswers`**:
   - Hỗ trợ chức năng early termination trong Task 7

### Các method cần thêm vào `game-loop.service.ts`:

### `executeRound(matchId, roomId, server)`

```typescript
private async executeRound(
  matchId: string,
  roomId: string,
  server: Server,
): Promise<void> {
  // 1. Get state machine
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  // 2. Transition to ROUND_ACTIVE
  stateMachine.transition(MatchStatus.ROUND_ACTIVE);

  // F7: Fetch question with error handling
  let question;
  try {
    // F2: Exclude already-used question IDs
    const excludeIds = [...(this.usedQuestionIds.get(matchId) ?? new Set())];
    question = await this.questionService.getRandom(undefined, excludeIds);
  } catch (error) {
    this.logger.error(
      `Failed to fetch question for match ${matchId} — ending match`,
      error,
    );
    // End match gracefully if no questions available
    await this.finishMatchLoop(matchId, roomId, server, null);
    return;
  }

  // F2: Track used question
  this.usedQuestionIds.get(matchId)!.add(question.id);

  // 3. Start round in state machine (pass correctAnswer internally)
  const questionState = {
    id: question.id,
    content: question.content,
    options: question.options,
    correctAnswer: question.correctAnswer, // used internally by state machine
    difficulty: question.difficulty,
  };
  stateMachine.startRound(questionState);

  // F6: Persist after mutation
  await this.matchService.persistStateMachine(matchId);

  // 4. Count surviving players BEFORE broadcast (for early termination tracking)
  const state = stateMachine.getState();
  const survivingCount = state.survivingPlayerIds.length;
  // Store expected answer count (used by Task 7)
  this.expectedAnswers?.set(matchId, survivingCount);

  // 5. Broadcast ROUND_STARTED (STRIP correctAnswer from question!)
  const channel = getRoomChannel(roomId);
  const round = stateMachine.getCurrentRound()!;
  const clientQuestion = {
    id: question.id,
    content: question.content,
    options: question.options,
    difficulty: question.difficulty,
  };
  server.to(channel).emit(ServerEvent.ROUND_STARTED, {
    matchId,
    roundNo: state.currentRoundNo,
    question: clientQuestion,
    endsAt: round.endsAt,
    roundDurationMs: GAME_CONFIG.ROUND_DURATION_MS,
  });

  // 6. Set 15s timer → endRound
  const timer = setTimeout(async () => {
    await this.endRound(matchId, roomId, server);
  }, GAME_CONFIG.ROUND_DURATION_MS);
  this.addTimer(matchId, timer);
}
```

### `endRound(matchId, roomId, server)`

```typescript
private async endRound(
  matchId: string,
  roomId: string,
  server: Server,
): Promise<void> {
  // 1. Get state machine
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  // 2. Transition to ROUND_EVALUATING
  stateMachine.transition(MatchStatus.ROUND_EVALUATING);

  // 3. Evaluate round
  const { survivingIds, eliminatedIds, correctAnswer } =
    stateMachine.evaluateRound();

  // 4. Transition to ROUND_RESULT
  stateMachine.transition(MatchStatus.ROUND_RESULT);

  // F6: Persist after mutation
  await this.matchService.persistStateMachine(matchId);

  // 5. Save round + answers to DB (Task 5)
  const state = stateMachine.getState();
  const currentRound = stateMachine.getCurrentRound()!;
  const roundRecord = await this.matchService.saveRound(
    matchId,
    state.currentRoundNo,
    currentRound.question.id,
  );
  // F5: roundRecord.id is available from Prisma create return
  for (const [playerId, answer] of currentRound.answers) {
    await this.matchService.saveAnswer(
      matchId,
      roundRecord.id,
      playerId,
      answer.answer,
      answer.isCorrect,
      answer.responseTimeMs,
    );
  }

  // 6. Convert Maps to arrays for Socket.io serialization
  const playerInfos = Array.from(state.players.values());

  // 7. Broadcast ROUND_ENDED (KHÔNG gửi correctAnswer trong question object)
  const channel = getRoomChannel(roomId);
  server.to(channel).emit(ServerEvent.ROUND_ENDED, {
    matchId,
    roundNo: state.currentRoundNo,
    correctAnswer, // standalone field, NOT inside question
    survivingPlayerIds: survivingIds,
    eliminatedPlayerIds: eliminatedIds,
    playerResults: playerInfos,
  });

  // 8. Per-player eliminated notification
  for (const playerId of eliminatedIds) {
    const player = state.players.get(playerId);
    if (!player) continue;
    server.to(channel).emit(ServerEvent.PLAYER_ELIMINATED, {
      matchId,
      playerId,
      playerName: player.name,
      reason: currentRound.answers.has(playerId) ? "WRONG_ANSWER" : "TIMEOUT",
    });
  }

  // 9. Set 3s timer → checkMatchEnd
  const timer = setTimeout(async () => {
    await this.checkMatchEnd(matchId, roomId, server);
  }, GAME_CONFIG.RESULT_DISPLAY_MS);
  this.addTimer(matchId, timer);
}
```

### `checkMatchEnd(matchId, roomId, server)`

```typescript
private async checkMatchEnd(
  matchId: string,
  roomId: string,
  server: Server,
): Promise<void> {
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  if (stateMachine.shouldEndMatch()) {
    await this.finishMatchLoop(matchId, roomId, server);
  } else {
    // Loop: next round
    await this.executeRound(matchId, roomId, server);
  }
}
```

### `finishMatchLoop(matchId, roomId, server)`

```typescript
private async finishMatchLoop(
  matchId: string,
  roomId: string,
  server: Server,
): Promise<void> {
  // 1. Get state machine
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  // 2. Transition to FINISHED
  stateMachine.transition(MatchStatus.FINISHED);

  // F1: finishMatch() returns void. winnerId is set internally on state.
  stateMachine.finishMatch();
  const state = stateMachine.getState();
  const winnerId = state.winnerId!;

  // F6: Persist lần cuối
  await this.matchService.persistStateMachine(matchId);

  // 3. Persist match result to DB (updates room status, cleans memory + Redis)
  await this.matchService.finishMatch(matchId, winnerId);

  // 4. Broadcast MATCH_FINISHED
  const channel = getRoomChannel(roomId);
  const playerInfos = Array.from(state.players.values());
  server.to(channel).emit(ServerEvent.MATCH_FINISHED, {
    matchId,
    winnerId,
    totalRounds: state.currentRoundNo,
    players: playerInfos,
  });

  // 5. Cleanup
  this.clearTimers(matchId);
  this.usedQuestionIds.delete(matchId);

  this.logger.log(
    `Match ${matchId} finished. Winner: ${winnerId}. Rounds: ${state.currentRoundNo}`,
  );
}
```

### Property cần thêm vào class (cho Task 7)

```typescript
// Add to class body for early termination (used by Task 7)
private expectedAnswers = new Map<string, number>();
```

### Lưu ý

- `QuestionState` cho client **KHÔNG** chứa `correctAnswer` — field này được gửi standalone trong `ROUND_ENDED`
- `Map` → `Array` khi gửi qua Socket.io (`Array.from(state.players.values())`)
- Mỗi mutation state machine đều có `persistStateMachine` call (F6)
- Câu hỏi không lặp lại nhờ `usedQuestionIds` tracking (F2)
- Hết câu hỏi → match kết thúc graceful với `finishMatchLoop(matchId, roomId, server, null)` (F7)

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## 🔧 Task 3: Register GameLoopService vào MatchModule

**Priority:** P0
**Dependencies:** Task 2
**Agent context needed:** `match.module.ts` (hiện tại), `game-loop.service.ts` (để verify exports)

### Goal

Register `GameLoopService` trong NestJS DI container và export để các handler dùng được.

### File cần sửa

`apps/api/src/modules/match/match.module.ts`

### Implementation

```typescript
import { Module } from "@nestjs/common";
import { MatchService } from "./match.service";
import { MatchController } from "./match.controller";
import { GameLoopService } from "./game-loop.service";
import { QuestionModule } from "../question/question.module";

@Module({
  imports: [QuestionModule],
  controllers: [MatchController],
  providers: [MatchService, GameLoopService],
  exports: [MatchService, GameLoopService],
})
export class MatchModule {}
```

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## 🔧 Task 4: Cập nhật MatchHandler để gọi GameLoopService

**Priority:** P0
**Dependencies:** Task 3
**Agent context needed:** `match.handler.ts` (hiện tại), `game-loop.service.ts` (signatures), `shared/src/socket.ts` (ServerEvent, StartMatchPayload)

### Goal

Sau khi `MatchService.createMatch()`, gọi `GameLoopService.startMatchLoop()`.

**F3 Fix:** Gộp `startMatchLoop` vào try-catch hiện có, không tạo double try-catch.

### File cần sửa

`apps/api/src/gateways/handlers/match.handler.ts`

### Current code (để tham khảo)

```typescript
async handleStartMatch(client: Socket, server: Server, payload: { roomId: string }) {
  try {
    const userId = this.requireAuth(client);
    const room = await this.roomService.getRoom(payload.roomId);
    if (room.hostId !== userId) throw new RoomError(ErrorCode.NOT_ROOM_HOST);
    const match = await this.matchService.createMatch(payload.roomId);
    server.to(`room:${payload.roomId}`).emit(ServerEvent.MATCH_STARTING, {
      matchId: match.id,
      countdown: GAME_CONFIG.COUNTDOWN_DURATION_MS / 1000,
    });
  } catch (error) { /* existing error handling */ }
}
```

### New code (thay toàn bộ method)

```typescript
import { GameLoopService } from "../../modules/match/game-loop.service";

async handleStartMatch(
  client: Socket,
  server: Server,
  payload: { roomId: string },
) {
  try {
    const userId = this.requireAuth(client);

    const room = await this.roomService.getRoom(payload.roomId);
    if (room.hostId !== userId) {
      throw new RoomError(ErrorCode.NOT_ROOM_HOST);
    }

    const match = await this.matchService.createMatch(payload.roomId);

    // NEW: Start game loop (F3: inside same try-catch, no double catch)
    await this.gameLoopService.startMatchLoop(match.id, payload.roomId, server);

    this.logger.log(`Match loop started: ${match.id}`);
  } catch (error) {
    const code =
      error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
    const msg =
      error instanceof RoomError
        ? ERROR_MESSAGES[error.code]
        : error instanceof Error
          ? error.message
          : String(error);
    this.emitError(client, code, msg);
  }
}
```

### Update constructor

```typescript
constructor(
  private readonly roomService: RoomService,
  private readonly matchService: MatchService,
  private readonly gameLoopService: GameLoopService,  // NEW
) {
  super();
}
```

### Note

- Không còn broadcast `MATCH_STARTING` ở đây — `GameLoopService` sẽ broadcast `MATCH_STARTED`
- Error từ `startMatchLoop` được catch chung trong try-catch (F3)

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
pnpm --filter @arena/api test -- match.handler
```

---

## 🔧 Task 5: Persist round + answer vào DB

**Priority:** P1
**Dependencies:** Task 2
**Agent context needed:** `game-loop.service.ts` (endRound), `match.service.ts` (saveRound, saveAnswer)

### Goal

Khi `endRound()` chạy, lưu `MatchRound` và `Answer` records vào PostgreSQL.

### Status

✅ Code đã được viết trong `endRound` ở Task 2. Task này chỉ cần **verify** rằng flow hoạt động.

### Code trong endRound (đã có ở Task 2)

```typescript
// F5: saveRound returns full MatchRound (with id from Prisma create)
const roundRecord = await this.matchService.saveRound(
  matchId,
  state.currentRoundNo,
  currentRound.question.id,
);

for (const [playerId, answer] of currentRound.answers) {
  await this.matchService.saveAnswer(
    matchId,
    roundRecord.id, // ← F5: dùng trực tiếp, không cần sửa saveRound
    playerId,
    answer.answer,
    answer.isCorrect,
    answer.responseTimeMs,
  );
}
```

### MatchService.saveRound hiện tại (đã return MatchRound có id)

```typescript
// match.service.ts line 190
async saveRound(matchId: string, roundNo: number, questionId: string) {
  return this.prisma.matchRound.create({
    data: { matchId, roundNo, questionId },
  });
  // Returns: { id, matchId, roundNo, questionId, createdAt }
}
```

### Action

Không cần sửa code. Verify sau khi Task 2 hoàn thành:

```bash
pnpm --filter @arena/api typecheck
```

---

## 🔧 Task 6: Xử lý disconnect trong match

**Priority:** P2
**Dependencies:** Task 2
**Agent context needed:** `auth.handler.ts` (handleDisconnect), `game-loop.service.ts` (handlePlayerDisconnect), `room.service.ts` (getUserActiveRooms signature), `shared/src/state.ts` (PlayerStatus), `shared/src/socket.ts` (ServerEvent.PLAYER_LEFT)

### Goal

Khi player disconnect giữa match:

1. Mark player `DISCONNECTED` trong state machine
2. Broadcast `PLAYER_LEFT` (F4: dùng event có sẵn)
3. Khi round kết thúc, player không trả lời → bị eliminate

### Step 1: Thêm `handlePlayerDisconnect` vào GameLoopService

```typescript
// Thêm vào game-loop.service.ts

async handlePlayerDisconnect(matchId: string, userId: string, server: Server): Promise<void> {
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  const state = stateMachine.getState();
  const player = state.players.get(userId);
  if (!player) return;

  // Mark as disconnected
  player.status = PlayerStatus.DISCONNECTED;
  player.isOnline = false;

  // F6: Persist
  await this.matchService.persistStateMachine(matchId);

  // F4: Use PLAYER_LEFT event (exists in ServerEvent enum)
  const channel = getRoomChannel(state.roomId);
  server.to(channel).emit(ServerEvent.PLAYER_LEFT, {
    playerId: userId,
    playerName: player.name,
    reason: "DISCONNECTED",
  });

  this.logger.log(`Player ${userId} disconnected from match ${matchId}`);
}
```

### Step 2: Cập nhật AuthHandler.handleDisconnect

**File:** `apps/api/src/gateways/handlers/auth.handler.ts`

Thêm inject `GameLoopService`:

```typescript
import { GameLoopService } from "../../modules/match/game-loop.service";

// Trong handleDisconnect, thêm sau khi xóa khỏi connectedPlayers:
async handleDisconnect(client: Socket) {
  const userId = client.data?.userId;
  if (userId) {
    const currentSocketId = this.connectedPlayers.get(userId);
    if (currentSocketId === client.id) {
      this.connectedPlayers.delete(userId);

      // NEW: Notify active matches
      try {
        const userActiveRooms = await this.roomService.getUserActiveRooms(userId);
        for (const rp of userActiveRooms) {
          if (rp.room.currentMatchId) {
            await this.gameLoopService.handlePlayerDisconnect(
              rp.room.currentMatchId,
              userId,
              client.nsp as unknown as Server,
            );
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to notify match of disconnect for ${userId}`, error);
      }

      this.logger.log(`Player disconnected: ${userId}`);
    }
  }
}
```

### Note

- `PlayerStatus.DISCONNECTED` đã có trong enum
- Sử dụng `ServerEvent.PLAYER_LEFT` (có sẵn) thay vì event mới (F4)
- `submitAnswer` trong state machine kiểm tra `player.status !== PlayerStatus.ACTIVE` → DISCONNECTED player không thể trả lời → sẽ bị eliminate ở cuối round

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## 🔧 Task 7: Early round termination

**Priority:** P1
**Dependencies:** Task 2, Task 4
**Agent context needed:** `game-loop.service.ts` (endRound, expectedAnswers Map), `match.handler.ts` (handleSubmitAnswer)

### Goal

Nếu tất cả surviving players đã submit answer trước khi hết 15s, kết thúc round ngay lập tức.

### Step 1: `expectedAnswers` Map đã được tạo ở Task 2

```typescript
// Đã có trong executeRound (Task 2):
this.expectedAnswers.set(matchId, survivingCount);
```

### Step 2: Thêm method `checkEarlyTermination` vào GameLoopService

```typescript
// Thêm vào game-loop.service.ts

async checkEarlyTermination(matchId: string, roomId: string, server: Server): Promise<void> {
  const stateMachine = await this.matchService.getStateMachine(matchId);
  if (!stateMachine) return;

  const round = stateMachine.getCurrentRound();
  const expected = this.expectedAnswers.get(matchId) ?? 0;

  if (round && round.answers.size >= expected && round.status === "ACTIVE") {
    this.logger.log(
      `Early termination: all ${expected} players answered in match ${matchId}`,
    );
    // Clear the pending 15s timer
    this.clearTimers(matchId);
    // Go directly to endRound
    await this.endRound(matchId, roomId, server);
  }
}
```

### Step 3: Gọi từ MatchHandler.handleSubmitAnswer

**File:** `apps/api/src/gateways/handlers/match.handler.ts`

Thêm sau khi `persistStateMachine` trong `handleSubmitAnswer`:

```typescript
// Sau khi submit thành công:
await this.matchService.persistStateMachine(payload.matchId);

// NEW: Check early termination
await this.gameLoopService.checkEarlyTermination(
  payload.matchId,
  roomId, // NOTE: cần lấy roomId — match có roomId trong state
  server,
);
```

**Lấy roomId:** Có thể lấy từ state machine:

```typescript
const roomId = stateMachine.getState().roomId;
```

### Kiểm tra

```bash
pnpm --filter @arena/api typecheck
```

---

## 🔧 Task 8: Unit tests cho GameLoopService

**Priority:** P0
**Dependencies:** Task 2, 3
**Agent context needed:** Toàn bộ `game-loop.service.ts`, `match-state-machine.ts` signatures, `shared` types

### Goal

Test coverage cho toàn bộ GameLoopService.

### File cần tạo

`apps/api/src/modules/match/game-loop.service.spec.ts`

### Test cases

| #   | Method             | Mô tả                                                                         |
| --- | ------------------ | ----------------------------------------------------------------------------- |
| 1   | `startMatchLoop`   | Transition COUNTDOWN, broadcast MATCH_STARTED, persist                        |
| 2   | `executeCountdown` | Timer 5s chạy, sau đó gọi executeRound (fast-forward)                         |
| 3   | `executeRound`     | Fetch question, startRound, broadcast ROUND_STARTED, KHÔNG leak correctAnswer |
| 4   | `endRound`         | evaluateRound, broadcast ROUND_ENDED + PLAYER_ELIMINATED, save to DB          |
| 5   | `checkMatchEnd`    | shouldEndMatch=false → loop lại executeRound                                  |
| 6   | `checkMatchEnd`    | shouldEndMatch=true → gọi finishMatchLoop                                     |
| 7   | `finishMatchLoop`  | finishMatch (F1: check winnerId từ state), broadcast MATCH_FINISHED, cleanup  |
| 8   | `cancelMatchLoop`  | Clear timers, remove from maps                                                |
| 9   | Error handling     | getRandom() throws → finishMatchLoop called gracefully (F7)                   |
| 10  | excludeIds         | Second call uses previous question IDs (F2)                                   |
| 11  | Early termination  | All players answered → endRound gọi ngay                                      |
| 12  | Disconnect         | handlePlayerDisconnect marks player, broadcasts PLAYER_LEFT (F4)              |

### Mock strategy

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { GameLoopService } from "./game-loop.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchStatus,
  PlayerStatus,
  ServerEvent,
  GAME_CONFIG,
} from "@arena/shared";

describe("GameLoopService", () => {
  let service: GameLoopService;
  let matchService: jest.Mocked<Partial<MatchService>>;
  let questionService: jest.Mocked<Partial<QuestionService>>;
  let mockServer: jest.Mocked<Partial<Server>>;
  let stateMachine: MatchStateMachine;

  beforeEach(async () => {
    // Create real state machine with test players
    const players = [
      {
        id: "p1",
        name: "Player 1",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
      {
        id: "p2",
        name: "Player 2",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 0,
        correctAnswers: 0,
        isOnline: true,
      },
    ];
    stateMachine = new MatchStateMachine("match-1", "room-1", players);

    matchService = {
      getStateMachine: jest.fn().mockResolvedValue(stateMachine),
      persistStateMachine: jest.fn().mockResolvedValue(undefined),
      finishMatch: jest.fn().mockResolvedValue({}),
      saveRound: jest.fn().mockResolvedValue({ id: "round-1" }),
      saveAnswer: jest.fn().mockResolvedValue({}),
    };

    questionService = {
      getRandom: jest.fn().mockResolvedValue({
        id: "q1",
        content: "Test question",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      }),
    };

    mockServer = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameLoopService,
        { provide: MatchService, useValue: matchService },
        { provide: QuestionService, useValue: questionService },
      ],
    }).compile();

    service = module.get<GameLoopService>(GameLoopService);
  });

  // === TEST 1: startMatchLoop ===
  it("should transition to COUNTDOWN and broadcast MATCH_STARTED", async () => {
    jest.useFakeTimers();

    const emitSpy = jest.fn();
    (mockServer.to as jest.Mock).mockReturnValue({ emit: emitSpy });

    await service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    expect(stateMachine.getState().status).toBe(MatchStatus.COUNTDOWN);
    expect(matchService.persistStateMachine).toHaveBeenCalledWith("match-1");
    expect(emitSpy).toHaveBeenCalledWith(
      ServerEvent.MATCH_STARTED,
      expect.objectContaining({ matchId: "match-1", status: "COUNTDOWN" }),
    );

    jest.useRealTimers();
  });

  // === TEST 7: finishMatchLoop (F1 fix verified) ===
  it("should finish match and read winnerId from state", async () => {
    // Setup: transition through required states
    stateMachine.transition(MatchStatus.COUNTDOWN);
    stateMachine.transition(MatchStatus.ROUND_ACTIVE);
    stateMachine.startRound({
      id: "q1",
      content: "Q",
      options: ["A", "B"],
      correctAnswer: "A",
      difficulty: "MEDIUM",
    });
    stateMachine.submitAnswer("p1", "A", Date.now());
    stateMachine.submitAnswer("p2", "B", Date.now());
    stateMachine.evaluateRound();

    const emitSpy = jest.fn();
    (mockServer.to as jest.Mock).mockReturnValue({ emit: emitSpy });

    // F1: finishMatch() returns void, winnerId read from state
    stateMachine.finishMatch();
    const winnerId = stateMachine.getState().winnerId;
    expect(winnerId).toBe("p1"); // p1 answered correctly

    expect(stateMachine.getState().status).toBe(MatchStatus.FINISHED);
  });

  // === TEST 9: Error handling (F7) ===
  it("should end match gracefully when getRandom throws", async () => {
    jest.useFakeTimers();
    questionService.getRandom = jest
      .fn()
      .mockRejectedValue(new Error("No questions"));

    stateMachine.transition(MatchStatus.COUNTDOWN);
    await service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );

    // Fast-forward past countdown
    jest.advanceTimersByTime(GAME_CONFIG.COUNTDOWN_DURATION_MS + 100);
    // Flush all pending async operations
    await Promise.resolve();
    await Promise.resolve();

    // Match should be finished due to error
    expect(stateMachine.getState().status).toBe(MatchStatus.FINISHED);

    jest.useRealTimers();
  });

  // === TEST 10: excludeIds (F2) ===
  it("should exclude used question IDs", async () => {
    jest.useFakeTimers();
    questionService.getRandom = jest
      .fn()
      .mockResolvedValueOnce({
        id: "q1",
        content: "Q1",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      })
      .mockResolvedValueOnce({
        id: "q2",
        content: "Q2",
        options: ["A", "B"],
        correctAnswer: "A",
        difficulty: "MEDIUM",
      });

    // First round
    stateMachine.transition(MatchStatus.COUNTDOWN);
    await service.startMatchLoop(
      "match-1",
      "room-1",
      mockServer as unknown as Server,
    );
    jest.advanceTimersByTime(GAME_CONFIG.COUNTDOWN_DURATION_MS + 100);
    await Promise.resolve();
    await Promise.resolve();

    // Second call should have excludeIds
    expect(questionService.getRandom).toHaveBeenLastCalledWith(
      undefined,
      expect.arrayContaining(["q1"]),
    );

    jest.useRealTimers();
  });
});
```

### Chạy tests

```bash
pnpm --filter @arena/api test -- game-loop.service
```

---

## 📋 Thứ tự thực hiện

```text
Task 0 (MatchModule update + verify globals)
  └─> Task 1 (GameLoopService - countdown)
        └─> ✅ Task 2 (GameLoopService - round/evaluate/result/finish)
              ├─> Task 3 (Register in DI)
              │     └─> Task 4 (Update MatchHandler)
              ├─> Task 5 (DB persistence)  ✅ đã có code trong Task 2, chỉ verify
              ├─> Task 6 (Disconnect)      // có thể làm song song
              ├─> Task 7 (Early term)      // có thể làm song song
              └─> Task 8 (Tests)           // nên làm sau cùng
```

**Song song hóa tối đa:**

- Task 5, 6, 7 có thể chạy đồng thời sau khi Task 2 hoàn thành
- Task 3, 4 có thể chạy đồng thời (khác file)
- Task 8 chạy sau khi tất cả logic ổn định

---

## 🔗 Cross-reference: Các file quan trọng

| File                                                | Vai trò                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/game-core/src/match-state-machine.ts`     | State machine — tất cả methods. `finishMatch()` return void (F1)                                         |
| `packages/shared/src/index.ts`                      | `GAME_CONFIG` — tất cả timing constants                                                                  |
| `packages/shared/src/state.ts`                      | `MatchStatus`, `PlayerStatus`, `RoundState`, `PlayerInfo`, `QuestionState` types                         |
| `packages/shared/src/socket.ts`                     | `ServerEvent` (có `PLAYER_LEFT`, không có `PLAYER_DISCONNECTED` - F4), `ClientEvent`, `getRoomChannel()` |
| `apps/api/src/modules/match/match.service.ts`       | `MatchService` — `saveRound()` returns full `MatchRound` (F5)                                            |
| `apps/api/src/modules/question/question.service.ts` | `QuestionService` — `getRandom(difficulty?, excludeIds?)` (F2, F7)                                       |
| `apps/api/src/gateways/handlers/match.handler.ts`   | `MatchHandler` — handleStartMatch, handleSubmitAnswer                                                    |
| `apps/api/src/gateways/handlers/auth.handler.ts`    | `AuthHandler` — handleDisconnect (Task 6)                                                                |
| `apps/api/src/modules/match/match.module.ts`        | Module wiring (Task 0, 3)                                                                                |

---

## ⚠️ Những điểm cần lưu ý

1. **`correctAnswer` không có trong `QuestionState` interface** — state machine dùng cast `as RoundState & { correctAnswer: string }`. Khi broadcast `ROUND_ENDED`, gửi `correctAnswer` standalone, không gửi trong question object.

2. **`Map` không serialize được qua Socket.io** — dùng `Array.from(map.values())` hoặc `Array.from(map.entries())`.

3. **Persist Redis sau mỗi mutation state machine** (F6) — mỗi lần gọi `transition()`, `startRound()`, `evaluateRound()`, `finishMatch()` đều phải có `persistStateMachine` đi kèm.

4. **`finishMatch()` returns void** (F1) — winner được set vào `state.winnerId` bên trong method. Đọc qua `getState().winnerId` sau khi gọi.

5. **`saveRound()` đã return full `MatchRound`** (F5) — dùng `roundRecord.id` trực tiếp, không cần sửa service.

6. **Dùng `ServerEvent.PLAYER_LEFT` cho disconnect** (F4) — không tạo event mới.

7. **Timer chain không recursive** — mỗi phase tạo 1 `setTimeout`, callback gọi phase tiếp theo. Không lo stack overflow.

8. **`getRandom()` có thể throw** (F7) — try-catch và gọi `finishMatchLoop` để kết thúc match sạch.

9. **Double try-catch trong handler đã được fix** (F3) — `startMatchLoop` nằm trong try-catch hiện có của `handleStartMatch`.

10. **Server restart recovery (out of scope MVP)** — state machine có thể deserialize từ Redis nhưng timer chain mất. Có thể thêm `onModuleInit` recovery ở Phase 2.
