# Project Brief: Arena of 100

> High-level project charter and delivered scope specification.  
> Recruiter & System Design overview: see `recruiter-summary.md`

---

## Executive Overview

**Arena of 100** is an enterprise-grade, real-time multiplayer quiz battle royale game where 100 players compete concurrently. Players must answer trivia questions within tight countdown windows (15s); wrong or missed answers lead to immediate elimination, transitioning players into an engaging spectator mode until a single champion emerges.

The project serves as a **production-ready showcase of modern full-stack & distributed systems engineering**, featuring sub-second p95 latency under 8,000 concurrent WebSocket connections, automated Redis Sentinel failover, monotonic delta state synchronization, and 2,398+ automated tests.

---

## Delivered Scope & Features

### 1. Real-time Battle Royale Loop (100 Players)

- [x] **Server-Authoritative Timing & Anti-Cheat**: All countdowns, answer validity, and elimination decisions execute server-side.
- [x] **Instant Elimination & Sudden Death**: Wrong or expired answers trigger instant elimination. Simultaneous finalists resolve via high-precision response timestamps.
- [x] **Spectator Experience**: Eliminated or late-joining players smoothly transition to real-time watch mode.

### 2. Deep Tactical Mechanics (Class & Card Hybrid)

- [x] **Dynamic Class Allocation**: Players are assigned to Offense or Defense classes.
- [x] **18 Strategic Cards**: Tactical modifiers (Shields, Point Doublers, Freeze, Reveal) resolved via deterministic batch processing (`CARD_RESOLVED_BATCH` <= 50ms).
- [x] **Cosmetic Progression**: Daily Challenge streaks (>=7 days) unlock Neon and Gold card variants.

### 3. Matchmaking & Competitive Rankings

- [x] **Elo Ranking Engine**: Dynamic K-factor adjustment based on match placement and relative opponent skill.
- [x] **Redis ZSET Matchmaking Queue**: Fast ticket matching with expandable rating windows and automated bot backfill.
- [x] **Custom Rooms**: Public lobby discovery and private rooms with unique 6-character codes.

### 4. Distributed Resilience & Scalability

- [x] **Multi-Node Redis Adapter**: Seamless cross-worker WebSocket broadcast scaling across multiple backend instances.
- [x] **Redis Sentinel High Availability**: Automatic master failover with transparent `READONLY` error reconnection.
- [x] **Delta Replay State Sync (`EVENT_BATCH`)**: Monotonic sequence tracking enables delta replay within the retained window, falling back to full `SNAPSHOT` for zero or stale cursors.
- [x] **High-Throughput Concurrency**: Self-rearming event-driven consumer loop drops p95 answer latency from 1,126ms to 201ms (-82%).

---

## Quality & Testing Verification

- **2,398+ Automated Tests** passing across unit, integration, and chaos test suites.
- **k6 Distributed Load Testing**: Validated up to **8,000 concurrent WebSocket users** (80 rooms x 100 players) with **0 connection failures** and sub-second p95 answer latency.
- **Strict Monorepo Isolation**: Type-safe shared contracts across `@arena/shared`, `@arena/game-core`, `apps/api`, and `apps/web`.
