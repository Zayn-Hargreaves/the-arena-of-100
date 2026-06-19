# System Patterns: Arena of 100

> **Core memory-bank file 2/4**
> Ghi lại **những gì đang thật sự đúng trong code**, không ghi wish-list như đã implemented.

## Architecture Snapshot

- **Modular monolith**
- **Server-authoritative** gameplay
- **Event-sourced match state** trong `packages/game-core`
- **Socket.io** cho realtime transport hiện tại
- **Redis** cho transient state, presence, countdown persistence, reconnect support
- **PostgreSQL + Prisma** cho persistence/audit/history

## Hard Invariants

### Match authority

- Client chỉ gửi intent
- Server quyết định round timing, answer validity, elimination, winner
- Client không được tự kết thúc trận hoặc tự xác định winner

### Match state machine

- Match lifecycle được giữ trong `MatchStateMachine`
- Không sửa state gameplay trực tiếp ở UI/client
- Sai hoặc không trả lời đúng hạn => xử elimination trong `evaluateRound()`

### Spectator rules

- Eliminated player vẫn nhận update, nhưng ở spectator UI
- Late join ongoing/finished match vào `JoinMode = "SPECTATOR"`
- Spectator không được submit answer; server gate vẫn là source of truth

### Event discipline

- State changes phải đi qua event / state-machine transition
- Audit-style changes cần append-only mindset
- Socket payload changes phải cân nhắc blast radius cao vì `@arena/shared` là boundary chung

## Current Real-Time Topology

### Implemented today

- Players và spectator baseline hiện cùng reuse room/match realtime path hiện có
- Reconnect dùng snapshot hydrate
- Presence sweep đang cover **lobby stale cleanup**, không phải distributed AFK engine

### Not implemented yet

- SSE spectator channel riêng
- distributed game-loop locks
- multi-instance Socket.io adapter

## Monolith-First Migration Seams

### Spectator scale path

Khi cần scale hơn, hướng nâng cấp là:

1. tách spectator transport khỏi player transport
2. batch spectator updates theo interval thấp hơn (ví dụ 1s)
3. chỉ làm sau khi có load evidence từ `k6`

### Concurrency path

Khi cần multi-instance:

1. Redis-backed/distributed locks cho timer-sensitive guards
2. Socket.io adapter đa instance
3. runtime ownership / recovery rules rõ hơn cho game loop

## UI/Data Patterns

### Optimistic UX

- Hiện tại UI đã có answer lock-in cơ bản
- Chưa có full rollback + idempotency path
- Hướng đúng là: lock ngay, gửi idempotency key, rollback rõ ràng nếu server reject

### Moderation

- Hướng MVP: sanitize/replace ở boundary
- Hướng hậu MVP: fingerprint, repeat-offender policy, shadow ban

## Operational Patterns

- Admin kill-switch là best-effort orchestrator
- Audit logging backend đã có append helper + query endpoint
- Reset không purge audit rows nữa

## Core Risks Still Open

1. `Room.maxPlayers` chưa expose qua payload join/create realtime
2. Optimistic answer rollback chưa full
3. Moderation mới ở mức intent, chưa thành pipeline MVP
4. Load characteristics 100 concurrent WS chưa có evidence đo thực nghiệm

## Supplementary / Legacy Docs

Nếu cần đào sâu historical reasoning, tham khảo supplementary docs. Core file này chỉ giữ pattern đang có hiệu lực.
