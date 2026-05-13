# Tech Context: Arena of 100

## Tech Stack

### Frontend

| Technology       | Version | Purpose                      |
| ---------------- | ------- | ---------------------------- |
| Next.js          | 15.x    | React framework (App Router) |
| React            | 19.x    | UI library                   |
| Zustand          | 5.x     | State management             |
| Socket.io-client | 4.x     | WebSocket client             |
| Tailwind CSS     | 3.x     | Utility-first CSS            |
| TypeScript       | 5.x     | Type safety                  |

### Backend

| Technology | Version    | Purpose                    |
| ---------- | ---------- | -------------------------- |
| NestJS     | 10.x       | Node.js framework          |
| Fastify    | via NestJS | HTTP adapter (performance) |
| Socket.io  | 4.x        | WebSocket server           |
| Prisma     | 6.x        | ORM for PostgreSQL         |
| ioredis    | 5.x        | Redis client               |
| Zod        | 3.x        | Runtime validation         |
| JWT        | 9.x        | Authentication             |

### Infrastructure

| Technology | Version | Purpose                  |
| ---------- | ------- | ------------------------ |
| PostgreSQL | 16.x    | Primary database         |
| Redis      | 7.x     | Cache, sessions, pub/sub |
| Docker     | latest  | Containerization         |
| pnpm       | 9.x     | Package manager          |
| Turborepo  | 2.x     | Monorepo build system    |

### CI/CD

| Technology               | Version | Purpose                                                                    |
| ------------------------ | ------- | -------------------------------------------------------------------------- |
| GitHub Actions           | -       | Automated workflow orchestration (see `.github/workflows/`, e.g. `ci.yml`) |
| Turborepo Remote Caching | -       | Distributed build and test cache (see `turbo.json` remote cache setup)     |

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.x
- Docker & Docker Compose

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://arena:arena123@localhost:5432/arena_of_100"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="arena-100-super-secret-key"
JWT_EXPIRES_IN="24h"

# Server
PORT=3001
CORS_ORIGIN="http://localhost:3000"
```

### Running Locally

```bash
# 1. Start infrastructure
docker compose -f infrastructure/docker-compose.yml up -d

# 2. Install dependencies
pnpm install

# 3. Setup database
pnpm db:push

# 4. Run development servers
pnpm dev
```

## Code Quality

### TypeScript Strict Mode

- All code is TypeScript strict
- No `any` unless absolutely necessary
- Shared types in `@arena/shared`

### Linting

- ESLint 9.x
- Consistent code style

### Testing

- Vitest for unit and integration tests
- Coverage reporting via `@vitest/coverage-v8`
- Target: 80% coverage
- Automated execution in CI/CD pipeline
- Vitest for unit and integration tests
- Coverage reporting via `@vitest/coverage-v8`
- Target: 80% coverage
- Automated execution in CI/CD pipeline
- Testing priorities: unit/integration tests for game-core package first, then E2E tests for critical user flows (future)

## Performance Considerations

### WebSocket

- Binary protocol for low latency (future)
- Room-based broadcasting (not global)
- Connection pooling

### Redis

- In-memory game state
- Snapshot caching (TTL: 2 hours)
- Atomic operations for concurrency

### Database

- Indexed queries (match_id, seq_no)
- Pagination for leaderboards
- Connection pooling via Prisma

## Security

### Anti-Cheat

- Server-authoritative timestamps
- No game logic on client
- Answer validation on server

### Authentication

- JWT with refresh tokens
- Token stored in Redis (revocable)
- Guest login (no sensitive data)

### Rate Limiting (Future)

- Redis-based rate limiting
- Per-user and per-IP limits

## Deployment (Future)

### Docker Compose (Production)

- PostgreSQL with persistent volume
- Redis with AOF persistence
- API server behind nginx
- Next.js standalone build

### Scaling Considerations

- Horizontal scaling: multiple API instances
- Redis for shared state
- PostgreSQL read replicas
- Load balancer with sticky sessions (WebSocket)
