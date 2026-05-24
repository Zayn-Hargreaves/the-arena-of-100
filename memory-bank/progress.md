# Progress: Arena of 100

## Current Status: 🏗️ Backend Complete → Frontend Implementation

### ✅ Completed (Phase 0: Planning & Setup)

- [x] Requirements analysis and scope definition
- [x] Tech stack selection (NestJS + Fastify + Next.js + Zustand)
- [x] Architecture design (Modular Monolith + Event-Driven)
- [x] Monorepo structure setup (pnpm + Turborepo)
- [x] Shared types and constants package
- [x] Game-core state machine (pure domain logic)
- [x] Backend scaffold (NestJS modules: auth, room, match, health)
- [x] Frontend scaffold (Next.js + Tailwind + Zustand store)
- [x] Database schema (Prisma with PostgreSQL)
- [x] Infrastructure (Docker Compose for PostgreSQL + Redis)
- [x] Memory bank documentation
- [x] **Architecture assessment & review (2025-05-09)**
- [x] **CI/CD Pipeline with GitHub Actions & Vitest setup (2026-05-12)**

### 🔴 Critical Fixes (Phase 0.5: Before Feature Development)

- [x] Add QuestionModule (service + controller + seed data)
- [x] Add MatchStateMachine.serialize()/deserialize() for Redis persistence
- [x] Refactor GameGateway from God Object → split or handler delegation
- [x] ~~Fix `MatchStartedPayload` missing interface in events.ts~~ [RESOLVED - already defined]
- [x] Fix shallow copy issue in `getState()` (Map not deep cloned)
- [x] Implement type-safe error handling pattern (`RoomError` class replaces string matching)

### 🚧 In Progress (Phase 1: Core Implementation)

#### Backend — ✅ Complete

- [x] Install dependencies (`pnpm install`)
- [x] Database migration and seeding
- [x] Implement GameLoopService (countdown → round → evaluate → repeat)
- [x] Implement round timer management (auto-end on timeout)
- [x] Unit tests for game-core state machine

#### Frontend — 🚧 Needs Implementation (theo thứ tự phụ thuộc)

> Chi tiết: xem [plan-e2e-test.md](./plan-e2e-test.md)

- [ ] Guest login page + API client (`POST /auth/guest` → JWT → WS authenticate) _(Slice 1)_
- [ ] Socket store — add 7 missing event handlers (MATCH_STARTED, ROUND_STARTED, ROUND_ENDED, PLAYER_ELIMINATED, MATCH_FINISHED, PLAYER_JOINED/LEFT reactive) _(Slice 2)_
- [ ] Create Room page + Lobby UI (`/lobby/[roomCode]`, player list, room code display) _(Slice 3)_
- [ ] Join Room page + redirect to lobby _(Slice 4)_
- [ ] Game page `/game/[matchId]` — countdown overlay, question display, answer buttons, round timer _(Slice 5-6)_
- [ ] Result page `/result/[matchId]` + elimination display _(Slice 7)_
- [ ] Connect socket-store to all UI components (xóa console.log, reactive binding)
- [ ] Frontend routing setup (App Router pages: `/`, `/lobby/[code]`, `/game/[matchId]`, `/result/[matchId]`)

#### Integration

- [ ] End-to-end room creation → join → match flow _(Slice 8 — integration test & edge cases)_

#### Product Features (phụ thuộc frontend hoàn thiện)

- [ ] Frictionless onboarding system with content moderation
- [ ] Lobby lifecycle management (auto-start, host controls, heartbeat validation)
- [ ] Spectator mode with micro-interactions
- [ ] Graceful exit mechanism
- [ ] Asset preloading system with fallback
- [ ] Mass-spectator isolation infrastructure
- [ ] Anonymous identity tracking with device fingerprinting
- [ ] Optimistic UI implementation with smart recovery
- [ ] Game operations tools for emergency interventions

### 📋 Upcoming (Phase 2: Polish & Testing)

- [ ] Drop-in spectating for late joiners
- [ ] AFK sweeping logic
- [ ] Reconnect logic with snapshot + event replay
- [ ] Tie-break and sudden death implementation
- [ ] Post-match flow (victory screen, rematch)
- [ ] Content delivery system with anti-repetition
- [ ] Accessibility features (screen reader, keyboard nav, color-blind mode)
- [ ] Runtime question fallback
- [ ] Leaderboard and analytics endpoints
- [ ] Error handling and edge cases
- [ ] Comprehensive testing (integration + E2E)
- [ ] UI polish and animations
- [ ] Comprehensive testing of anonymous identity tracking
- [ ] Validation of optimistic UI recovery mechanisms
- [ ] Testing of game operations emergency procedures

### 🔮 Future (Phase 3: Production Ready)

- [ ] Rate limiting
- [ ] Sound effects
- [ ] Advanced question management
- [ ] Tournament mode
- [ ] Social features
- [ ] Mobile responsive improvements

## Known Issues / Technical Debt

### 🔴 Critical (Blocks Development)

- ~~**GameGateway God Object**~~ [RESOLVED] — Refactored to delegate Socket.io events to separate class handlers (AuthHandler, RoomHandler, MatchHandler).
- ~~**In-memory state machines**~~ [RESOLVED] — Implemented Redis serialization & persistence for MatchStateMachine crash recovery.
- ~~**Missing QuestionModule**~~ [RESOLVED] — QuestionModule fully implemented with REST endpoints for CRUD and bulk import, along with database seeding.
- ~~**`MatchStartedPayload` undefined**~~ [RESOLVED] — already defined in events.ts with matchId, playerIds, startTime
- ~~**`getState()` shallow copy**~~ [RESOLVED] — Fixed shallow copy issue in getState() by deep cloning the players Map.

### 🟡 Significant

- No Game Loop Orchestrator (match lifecycle not implemented)
- No round timer enforcement (15s timeout not scheduled)
- Gateway does transport + application logic (missing Use Case layer)
- `connectedPlayers` Map lookup inefficient (iterates to find by socketId)
- Room playerCount update uses non-atomic read-modify-write
- ~~Error handling uses `throw new Error(ErrorCode.X)` instead of `WsException`~~ [RESOLVED] — Implemented `RoomError` class with type-safe error codes (see [errorHandlingPattern.md](./errorHandlingPattern.md))
- `correctAnswer` potentially leaks via state machine type casting
- `SocketNamespace` missing SPECTATOR entry
- `packages/config` directory exists but is empty
- **Dependency Risk**: `class-validator` & `class-transformer` are unmaintained, migration to Zod completed (packages removed as direct dependencies, code migrated to use Zod validation/serialization)

### 🟢 Nice-to-Have

- Missing frictionless onboarding functionality with content moderation
- No lobby lifecycle management with heartbeat validation
- No drop-in spectating for late joiners
- No AFK player handling
- No graceful exit mechanism
- Missing spectator mode with micro-interactions
- No asset preloading system with fallback
- No mass-spectator isolation infrastructure
- Incomplete post-match flow
- No content delivery system
- No accessibility features
- No runtime question fallback
- No bot/demo system for testing
- No anonymous identity tracking with device fingerprinting
- No optimistic UI with smart recovery mechanisms
- No game operations tools for emergency interventions

## Architecture Assessment Scores

| Dimension                | Score      | Notes                                     |
| ------------------------ | ---------- | ----------------------------------------- |
| Monorepo Structure       | 10/10      | Turborepo + Remote Caching                |
| Package Boundaries       | 9/10       | Clean separation, correct dependency flow |
| Domain Logic (game-core) | 8/10       | Good state machine, needs serialization   |
| Backend Architecture     | 6/10       | Modules OK, gateway bloated, no game loop |
| Frontend Architecture    | 4/10       | Only scaffold, no real UI                 |
| Infrastructure           | 7/10       | Docker OK, missing dev tooling            |
| DevOps/CI-CD             | 10/10      | GitHub Actions pipeline configured        |
| Testing                  | 3/10       | Vitest setup with coverage enabled        |
| **Overall**              | **6.7/10** | Solid foundation, CI/CD & Testing ready   |

## Milestones

| Milestone                | Target         | Status         |
| ------------------------ | -------------- | -------------- |
| Base Scaffold            | Week 1         | ✅ Complete    |
| Architecture Review      | Week 1         | ✅ Complete    |
| Critical Fixes           | Week 2 (start) | ✅ Complete    |
| Core Game Loop (Backend) | Week 2         | ✅ Complete    |
| Frontend UI (8 Slices)   | Week 2-3       | 🚧 In Progress |
| Integration & E2E Test   | Week 3         | 📋 Pending     |
| Product Features         | Week 3-4       | 📋 Pending     |
| MVP Launch               | Week 4         | 🔮 Future      |

## What Works Now

- Project structure and CI/CD configuration
- Vitest testing infrastructure with coverage reporting
- Turborepo Remote Caching
- Shared type definitions (events, state, socket protocol)
- Match state machine (pure logic, no dependencies)
- Backend modules: auth (JWT), room (CRUD + WS), match (orchestration), question (CRUD + seed)
- GameLoopService: countdown → round → evaluate → repeat loop
- Round timer: auto-end round when time expires (15s)
- GameGateway: refactored into handler classes (Auth, Room, Match)
- State machine Redis persistence (serialize/deserialize)
- Frontend landing page (static, needs login integration)
- Zustand socket store (partial — 7 event handlers missing)
- Docker infrastructure (PostgreSQL + Redis)
- Redis service with full operation support

## What's Next (Priority Order)

> Chi tiết frontend plan: xem [plan-e2e-test.md](./plan-e2e-test.md)

1. **Slice 1**: Guest login page + API client (`POST /auth/guest` → JWT → WS authenticate)
2. **Slice 2**: Socket store — add 7 missing event handlers (MATCH_STARTED, ROUND_STARTED, ROUND_ENDED, PLAYER_ELIMINATED, MATCH_FINISHED, PLAYER_JOINED/LEFT reactive)
3. **Slice 3**: Create Room page + Lobby UI (`/lobby/[roomCode]`)
4. **Slice 4**: Join Room page + redirect to lobby
5. **Slice 5**: Game page — match start + countdown UI
6. **Slice 6**: Game page — question display + answer submit + timer
7. **Slice 7**: Elimination display + Result page (`/result/[matchId]`)
8. **Slice 8**: E2E integration test (toàn bộ flow) + edge cases
