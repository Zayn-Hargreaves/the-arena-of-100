# System Patterns: Arena of 100

> **Core memory-bank file 2/4**
> Ghi lại những gì đang thật sự đúng trong code. Không ghi wish-list như đã implemented.

## Architecture Snapshot

- **Modular monolith** với boundary chính: `apps/api`, `apps/web`, `packages/shared`, `packages/game-core`.
- **Server-authoritative gameplay**: client gửi intent; server quyết định timing, answer validity, elimination, winner.
- **State machine + append-only event log** trong `packages/game-core`; chưa phải full event sourcing/replay source of truth.
- **Socket.io realtime transport** hiện tại cho players và spectator baseline.
- **Redis** cho transient state, room countdown, presence, reconnect snapshots.
- **PostgreSQL + Prisma** cho persistence/history; admin audit event riêng vẫn là near-term gap.

## Hard Invariants

### Match Authority

- Client không được tự kết thúc trận hoặc tự xác định winner.
- Round timing, answer cutoff, elimination, and winner determination đều chạy server-side.
- UI có thể optimistic lock-in answer, nhưng server response vẫn là source of truth.

### Match State Machine

- Match lifecycle được giữ trong `MatchStateMachine`.
- Không sửa state gameplay trực tiếp ở UI/client.
- Sai hoặc không trả lời trước deadline => bị loại trong round đó.
- `MatchStateMachine` có nhiều runtime flow phụ thuộc; refactor class-level là high risk, nên ưu tiên sửa nhỏ theo method-level impact.

### Spectator Rules

- Player bị loại vẫn nhận update, nhưng client render spectator/watch-only UI.
- Late join ongoing/finished match vào `JoinMode = "SPECTATOR"`.
- Spectator không được submit answer; server-side gate vẫn là source of truth.

### Event Discipline

- Gameplay state changes phải đi qua state-machine methods / transitions.
- Socket payload changes cần xem là shared contract changes vì `@arena/shared` là boundary chung.
- Audit-style operational changes cần append-only mindset; admin kill-switch audit event vẫn chưa implemented.

## Implemented Patterns

### State Machine Pattern

**Where**: `packages/game-core/src/match-state-machine.ts`

- `MatchStateMachine` quản lý match lifecycle: created/countdown/round/evaluation/result/finished semantics.
- `canTransition`, `transition`, `startRound`, `submitAnswer`, `evaluateRound`, `finishMatch`, reconnect/disconnect handling đều tập trung ở domain core.
- Đây là pattern có thật trong code, nhưng không nên gọi là GoF State Pattern thuần với per-state classes. Implementation hiện là explicit state machine trong một class.

### Factory Function

**Where**: `packages/shared/src/events.ts:createEvent`

- `createEvent()` tạo event envelope thống nhất: id, type, timestamp, payload, seqNo.
- Đây là factory function thật đang tồn tại.
- Không có `BotFactory`, `AvatarFactory`, `EmoteFactory`, hoặc `ContentModerationFactory` trong code hiện tại.

### Handler / Dispatcher Style Socket Flow

**Where**: `apps/api/src/gateways/game.gateway.ts` + `apps/api/src/gateways/handlers/*`

- Socket gateway dispatch event vào `AuthHandler`, `RoomHandler`, `MatchHandler`.
- Đây **không phải Command Pattern** theo nghĩa strict: không có `Command` interface, command objects, undo, queue, hoặc command bus.
- Với use case hiện tại, handler/service/state-machine layering là đủ sạch và ít ceremony hơn Command Pattern.

### Observer-Like Realtime Broadcast

**Where**: Socket.io room/channel emits

- Socket.io broadcast tạo observer-like behavior: clients subscribe room/match channel và react với server events.
- Không có explicit `Subject`/`Observer` classes. Đây là transport behavior, không phải custom GoF Observer implementation.

### NestJS Framework Patterns

**Where**: controllers, services, guards, pipes, interceptors

- Controllers/services/modules là NestJS convention, không phải Template Method Pattern.
- Guards/pipes/interceptors đang là framework-supported cross-cutting mechanisms cho auth, CSRF, validation, serialization, throttling.

## Not Implemented / Future Seams

### Command Pattern

- Không dùng hiện tại.
- Không cần cho current memory-bank use cases như join room, submit answer, start match, leave room, reconnect, request snapshot, hoặc admin terminate.
- Chỉ revisit nếu có requirement rõ: queue command, retry/idempotency per command, undo/rollback, scheduled commands, approval workflow, hoặc replay user intents trước domain events.

### Strategy Pattern

- `MatchStateMachine.tieBreak` hiện là private method, chưa phải Strategy Pattern.
- Strategy đáng cân nhắc cho tie-break vì blast radius method-level thấp và behavior có thể cần variant sau này.
- Không tách toàn bộ `MatchStateMachine` domain logic nếu chưa có lý do cụ thể.

### Future Factories

Factory Pattern có thể dùng sau này khi object creation có nhiều variant:

- bot players: difficulty/personality/accuracy/response-time profiles
- avatar generation: nhiều visual provider/theme/style
- emote events: metadata, cooldown, tier/effect variants
- match creation: classic/ranked/private/tournament variants

Content moderation nhiều khả năng phù hợp hơn với Strategy hoặc Chain of Responsibility; factory nếu có chỉ nên dùng để assemble pipeline.

## Current Real-Time Topology

### Implemented Today

- Players và spectator baseline reuse room/match realtime path hiện có.
- Reconnect dùng snapshot hydrate.
- Presence sweep cover lobby stale cleanup, chưa phải distributed AFK engine.

### Not Implemented Yet

- SSE spectator channel riêng.
- Distributed game-loop locks.
- Multi-instance Socket.io adapter.
- Load evidence cho 100 concurrent WebSocket users.

## Monolith-First Migration Seams

### Spectator Scale Path

Khi cần scale hơn:

1. tách spectator transport khỏi player transport
2. batch spectator updates theo interval thấp hơn, ví dụ 1s
3. chỉ làm sau khi có load evidence từ `k6`

### Concurrency Path

Khi cần multi-instance:

1. Redis-backed/distributed locks cho timer-sensitive guards
2. Socket.io adapter đa instance
3. runtime ownership / recovery rules rõ hơn cho game loop

## UI/Data Patterns

### Optimistic UX

- UI có answer lock-in + correlated rollback theo `submissionId`.
- Server-side `submitAnswer` đã replay canonical result cho duplicate retry cùng `submissionId` trong cùng round.
- Defer tiếp: reconnect/event replay thật theo `lastSeenSeqNo`; hiện snapshot hydrate vẫn là baseline.

### Moderation

- Hướng MVP: sanitize/replace ở input boundary.
- Hướng hậu MVP: fingerprint, repeat-offender policy, shadow ban.
- Không ghi moderation factory là implemented cho tới khi có code thật.

## Operational Patterns

- Admin kill-switch hiện là best-effort orchestrator.
- Admin kill-switch audit row append + paginated audit query đã có backend baseline.
- Reset không nên purge audit rows sau khi audit event backend được implement.

## Core Risks Still Open

1. Reconnect/event replay theo `lastSeenSeqNo` vẫn chưa thành contract thật; snapshot hydrate là baseline hiện tại.
2. Admin audit panel UI mới là optional closeout; backend audit baseline đã có.
3. Moderation mới ở mức MVP boundary pipeline; deeper fingerprint/shadow-ban vẫn deferred.
4. Load characteristics 100 concurrent WS chưa có evidence đo thực nghiệm.

## Supplementary / Legacy Docs

Nếu cần đào sâu historical reasoning, tham khảo supplementary docs. Core file này chỉ giữ pattern đang có hiệu lực.
