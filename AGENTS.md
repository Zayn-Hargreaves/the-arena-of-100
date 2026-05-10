# Arena of 100 - Agent Instructions

## Project Overview
Real-time multiplayer quiz battle royale game. 100 players compete, wrong answer = eliminated. Last player standing wins.

## Tech Stack
- **Monorepo**: pnpm + Turborepo
- **Frontend**: Next.js 15 + React 19 + Zustand + Tailwind CSS
- **Backend**: NestJS + Fastify + Socket.io
- **Database**: PostgreSQL (Prisma ORM)
- **Cache**: Redis
- **Infra**: Docker Compose

## Project Structure
```
arena-of-100/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # Next.js frontend
├── packages/
│   ├── shared/       # Shared types/events/constants
│   └── game-core/    # Pure game logic
├── infrastructure/   # Docker Compose files
└── memory-bank/      # Project documentation
```

## Essential Commands

### Setup & Run
```bash
# 1. Start infrastructure (PostgreSQL + Redis)
docker compose -f infrastructure/docker-compose.yml up -d

# 2. Install dependencies
pnpm install

# 3. Setup database
cp apps/api/.env.example apps/api/.env
pnpm db:push

# 4. Run development servers
pnpm dev
```

### Testing
```bash
# Run all tests
pnpm test

# Run game-core tests only
pnpm --filter @arena/game-core test

# Watch mode
pnpm --filter @arena/game-core test:watch
```

### Database
```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Open Prisma Studio
pnpm db:studio
```

## Package Boundaries
- **@arena/shared**: Shared types, events, constants - consumed by all other packages
- **@arena/game-core**: Pure game logic (state machine) - no external dependencies
- **@arena/api**: Backend (NestJS + Fastify + Socket.io) - depends on shared and game-core
- **@arena/web**: Frontend (Next.js) - depends only on shared

## Key Architecture Facts
- **Server-Authoritative**: All timing/validation on server (anti-cheat)
- **Event Sourcing**: All actions as immutable events (audit + replay)
- **Clean Architecture**: Domain logic isolated from infrastructure
- **Modular Monolith**: Single deployable with clear boundaries

## Critical Workflow Order
1. Always start Docker infrastructure first (`docker compose up -d`)
2. Install dependencies (`pnpm install`)
3. Setup database (`pnpm db:push`)
4. Run dev servers (`pnpm dev`)

## Repo-Specific Conventions
- **No account creation**: Guest login only for Time-to-Fun optimization
- **WebSocket events**: All real-time communication via Socket.io
- **State machine**: Match lifecycle managed by server-side state machine
- **Reconnect support**: Auto-sync state when players reconnect
- **Tie-break system**: Fair winner determination by response time

## Testing Quirks
- Game logic tests in `@arena/game-core` package
- Integration tests for API endpoints
- WebSocket event testing for real-time features

## Common Gotchas
- Database must be running before `pnpm db:push`
- Environment variables required in `apps/api/.env`
- Port conflicts: API runs on 3001, Web on 3000
- Redis required for session and game state management

## Documentation
See `memory-bank/` directory for detailed documentation:
- [Project Brief](memory-bank/projectbrief.md)
- [Product Context](memory-bank/productContext.md)
- [System Patterns](memory-bank/systemPatterns.md)
- [Progress](memory-bank/progress.md)
- [Active Context](memory-bank/activeContext.md)