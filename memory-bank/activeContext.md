# Active Context: Arena of 100

## Current Focus

All critical fixes complete. Currently on branch `refactor/split-game-gateway` — gateway refactored, error handling pattern implemented, ready to transition to Phase 1 core game loop implementation.

## Recent Changes

- Created full monorepo structure with pnpm + Turborepo
- Implemented shared types package (events, state, socket protocol)
- Built MatchStateMachine in game-core (pure domain logic)
- Scaffolded NestJS backend with modules: auth, room, match, health
- Created Next.js frontend with Tailwind CSS + Zustand store
- Defined Prisma schema for PostgreSQL
- Set up Docker Compose for infrastructure
- Created comprehensive memory bank documentation
- **Completed architecture assessment (2026-05-09)**
- **Identified 3 critical issues + 5 significant gaps**
- **Set up CI/CD Pipeline & Vitest Infrastructure (2026-05-12)**
- **Implemented type-safe error handling pattern** — `RoomError` class with error codes, replacing fragile string matching (see [errorHandlingPattern.md](./errorHandlingPattern.md))
- **Refactored GameGateway** — split into handler classes (AuthHandler, RoomHandler, MatchHandler)
- **Fixed getState() shallow copy** — deep cloning players Map
- **CSRF Protection (2026-06-03)** — Added double-submit cookie pattern: `CsrfGuard` validates `X-CSRF-Token` header on state-changing requests; CSRF token cookie set on login/refresh; frontend `apiFetch()` auto-injects header (see [securityLayer.md](./securityLayer.md))
- **Rate Limiting (2026-06-03)** — Added `@nestjs/throttler` globally (100 req/min); stricter limits on admin endpoints: 5 sync/min, 2 resets/5min
- **Hardcoded locale redirect fix (2026-06-03)** — Root `page.tsx` now reads `routing.defaultLocale` instead of hardcoded `/vi`
- **Admin UI improvements (2026-06-03)** — Replaced `alert()` with `toast()` for migration check; added `typecheck` script to web package

## Architecture Assessment Summary

### 🔴 Critical Issues (Fix Before Phase 1)

1. ~~**GameGateway God Object**~~ [RESOLVED]: Refactored GameGateway into separate event handler classes (AuthHandler, RoomHandler, MatchHandler), making the main gateway a lean router.
2. ~~**In-Memory State Machines**~~ [RESOLVED]: Implemented Redis serialization & persistence for MatchStateMachine crash recovery.
3. ~~**Missing QuestionModule**~~ [RESOLVED]: QuestionModule fully implemented with REST endpoints for CRUD and bulk import, along with database seeding.

### 🟡 Significant Gaps

1. **Missing Test Coverage**: Vitest + coverage infrastructure set up, but no tests implemented yet
2. ~~**No Round Timer Management**: `ROUND_DURATION_MS = 15s` defined but no scheduler enforces it~~ [RESOLVED]
3. **Gateway ↔ Service Coupling**: Gateway does transport + application logic, needs Use Case layer
4. **Frontend Only Has Landing Page**: No lobby/game/spectator routes or components
5. **No Lobby Lifecycle Management**: Missing heartbeat validation and auto-start mechanisms for rooms

### 🟢 Architecture Score: 7.1/10

- Monorepo: 10/10, Package Boundaries: 9/10, Domain Logic: 8/10
- Backend: 6/10, Frontend: 4/10, Infra: 7/10, Testing: 3/10

## Active Decisions

1. **NestJS + Fastify**: Chosen for performance and enterprise patterns
2. **Socket.io**: Chosen for WebSocket with fallback support
3. **Zustand**: Chosen over Redux for simplicity and performance
4. **Modular Monolith**: Single deployable unit with clear module boundaries
5. **Event Sourcing**: All game actions as events for audit and replay
6. **Frictionless Onboarding**: Prioritized over account creation for Time-to-Fun optimization with content moderation
7. **Lobby Lifecycle Management**: Auto-start for public rooms, host controls for private with heartbeat validation
8. **Micro-interactions**: Emotes system instead of chat for spectator engagement
9. **Performance Optimization**: Event batching and throttling for real-time interactions
10. **Scalable Infrastructure**: Separate communication channels for players and spectators
11. **Resilience**: Graceful error handling and fallback mechanisms
12. **Security**: Content moderation and rate limiting
13. **Accessibility**: WCAG compliance and inclusive design
14. **Product Engineering Focus**: Building production-ready user experiences, not just technical demos
15. **Anonymous Identity Tracking**: Device fingerprinting for persistent guest identity
16. **Optimistic UI**: Instant feedback with smart recovery mechanisms
17. **Game Operations**: Administrative tools for emergency interventions
18. **Testing Framework**: Vitest chosen for its performance and native ESM support
19. ~~**Zod Validation Migration**~~: Custom `ZodValidationPipe` for request/body parsing, gradual module-by-module migration, and Zod schema-based response serialization. (Completed)
20. **Distributed Session Management**: Redis-based session tracking (`@socket.io/redis-adapter` or custom Redis cache) selected for production scaling, while maintaining high-performance O(1) in-memory tracking (using client.data.userId lookup) for the current development phase.
21. **Persistent Guest Identity via Device ID (Model C)**: Approved using client-generated device ID (`guestId`) stored in localStorage as the primary unique key for guest logins. This resolves the unique username hijacking security risk and supports duplicate nicknames safely.
22. **Candy 3D Jelly UI Exclusive Theme (2026-05-31)**: No dark/light mode toggles. Using Candy Light-Gradient backgrounds, thick ink borders (#2B2D42), glossy reflection buttons, and springy interactive wobbles.
23. **Unified Sidebar Layout (2026-05-31)**: Thống nhất sidebar layout cho toàn bộ authenticated pages, kể cả Profile page.
24. **Procedural Avatar System (2026-05-31)**: Dynamic vector procedural avatar fallback rendering and native spritesheet animation loop components (MelbitSprite).
25. **3D Shadow Interaction (2026-05-31)**: Flat offset 3D shadows depressing on click/hover for tactile feedback.
26. **Design System Source of Truth**: [migrateDesignSystem.md](./migrateDesignSystem.md) acts as the official step-by-step phased roadmap for system migration to ensure compatibility with 256k token models.
27. **Type-Safe Error Handling**: Implemented custom `RoomError` class with structured error codes, replacing brittle string-matching of error messages in handlers and services (see [errorHandlingPattern.md](./errorHandlingPattern.md)).

## Pending Decisions (From Assessment)

- [x] Gateway refactor strategy: Split 1 gateway into multiple handler classes (Command Pattern selected & implemented)
- [ ] Timer strategy: `setTimeout` in NestJS vs. Redis-based distributed timers
- [x] Test framework: Vitest vs. Jest for game-core (Vitest selected)
- [ ] Frontend routing structure: `/lobby/[code]`, `/game/[matchId]`
- [x] Guest login hijacking security fix: Scheduled for a separate PR to migrate auth.service lookup from `username` to device-based `guestId` (Model C).

## Next Steps (Immediate — Priority Order)

### Pre-requisites

1. Start Docker containers for PostgreSQL + Redis
2. Run `pnpm db:push` to create database tables

### Critical Fixes (Before Features)

1. ~~Add `QuestionModule` + seed data~~ (Completed)
2. ~~Add `MatchStateMachine.serialize()/deserialize()` + Redis persistence~~ (Completed)
3. ~~Refactor `GameGateway` → split or delegate to handler classes~~ (Completed)
4. ~~Migrate validation/serialization from class-validator/transformer to Zod~~ (Completed - see [processTechDebt.md](./processTechDebt.md))

### Core Game Loop (MVP Minimum)

1. ~~Implement `GameLoopService` (countdown → round → evaluate → repeat)~~ (Completed)
2. ~~Implement round timer (auto-end round when time expires)~~ (Completed)
3. ~~Unit tests for `game-core` state machine~~ (Completed)

### Frontend + Integration

1. Build lobby + game UI pages with routing
2. Connect socket-store to UI components
3. End-to-end flow test

## Key Files Reference

```
packages/shared/src/
├── events.ts      # Event types and factory
├── state.ts       # State interfaces
├── socket.ts      # Socket protocol (client/server events)
└── index.ts       # Constants and utilities

packages/game-core/src/
└── match-state-machine.ts  # Core game logic (state transitions, domain serialization)

apps/api/src/
├── main.ts        # Entry point
├── app.module.ts  # Root module
├── gateways/      # WebSocket gateway (refactored into handler classes)
└── modules/       # Feature modules (QuestionModule completed)
    └── match/match.service.ts  # Match orchestration (Redis persistence for crash recovery)

apps/web/src/
├── app/           # Next.js pages (NEEDS: lobby/game/spectator routes)
├── stores/        # Zustand stores
└── components/    # React components (NEEDS: all game UI)
```

## Important Patterns to Remember

- All timestamps are server-side (anti-cheat)
- Client sends intent, server validates and executes
- State transitions are guarded (can't skip states)
- Events are immutable (append-only)
- Redis for fast state, PostgreSQL for persistence
- **State machines MUST be persisted to Redis after each transition**
- **Gateway handlers should delegate to Use Case / Service layer**
- **Never expose correctAnswer to client via snapshot or events**
- Lobby lifecycle management differs for public vs private rooms
- Micro-interactions require event batching for performance
- Graceful exit prioritized over AFK detection for resource management
- Asset preloading ensures fairness across all players
- Mass-spectator isolation prevents server overload
- Content moderation protects product reputation
- Accessibility features ensure inclusive design
- Device fingerprinting enables persistent identity
- Optimistic UI requires careful rollback handling
- Administrative tools need secure access controls

## Current Blockers

- ~~**🔴 In-Memory state machines**~~ [RESOLVED]: Redis persistence implemented
- ~~**🔴 GameGateway monolith**~~ [RESOLVED]: Refactored into handler classes
- Missing frictionless onboarding functionality with content moderation
- No lobby lifecycle management with heartbeat validation
- No graceful exit mechanism
- Missing spectator mode with micro-interactions
- No asset preloading system with fallback
- No mass-spectator isolation infrastructure
- No anonymous identity tracking with device fingerprinting
- No optimistic UI with smart recovery mechanisms
- No game operations tools for emergency interventions
