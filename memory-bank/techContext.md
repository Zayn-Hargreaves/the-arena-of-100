# Tech Context: Arena of 100

> **Core memory-bank file**  
> Technical stack, environment specifications, and developer tooling.  
> Recruiter & System Design overview: see `recruiter-summary.md`

---

## 1. Technical Stack Breakdown

### Frontend Application (`apps/web`)

| Technology           | Version | Purpose                                                                       |
| :------------------- | :------ | :---------------------------------------------------------------------------- |
| **Next.js**          | 15.x    | React framework (App Router architecture, SSR/SSG, optimized font loading)    |
| **React**            | 19.x    | Component UI library                                                          |
| **Zustand**          | 5.x     | Modular slice-based state management (Socket store, Match store, Daily store) |
| **Socket.io-client** | 4.x     | Real-time WebSocket connection handling & event streaming                     |
| **Tailwind CSS**     | 3.x     | Design system styling, responsive layouts                                     |
| **next-intl**        | 3.x     | Type-safe internationalization (English & Vietnamese)                         |
| **Lucide React**     | -       | Iconography library                                                           |

### Backend API & Real-time Services (`apps/api`)

| Technology       | Version    | Purpose                                                              |
| :--------------- | :--------- | :------------------------------------------------------------------- |
| **NestJS**       | 10.x       | Structured backend application framework                             |
| **Fastify**      | via NestJS | High-performance HTTP engine (replacing default Express)             |
| **Socket.io**    | 4.x        | Multi-node WebSocket gateway with Redis Adapter                      |
| **Prisma ORM**   | 6.x        | Type-safe database queries & migration management                    |
| **ioredis**      | 5.x        | High-throughput Redis client with Sentinel HA & cluster support      |
| **Zod**          | 3.x        | Strict runtime boundary validation for HTTP payloads & socket events |
| **JWT & Bcrypt** | 9.x        | Session tokens and guest identification                              |

### Shared Core Packages

| Package                | Purpose                                                                                             |
| :--------------------- | :-------------------------------------------------------------------------------------------------- |
| **`@arena/shared`**    | Shared interfaces, DTO schemas, event envelope factories, card IDs, constants                       |
| **`@arena/game-core`** | Zero-dependency deterministic state machine (`MatchStateMachine`), card resolution engine, Elo math |

### Infrastructure & Operations

| Technology                | Purpose                                                                      |
| :------------------------ | :--------------------------------------------------------------------------- |
| **PostgreSQL 16**         | Primary relational database (matches, users, card variants, audit events)    |
| **Redis 7 (Sentinel HA)** | Distributed session cache, socket pub/sub bus, matchmaking ZSET, lease locks |
| **Docker Compose**        | Multi-container local orchestration (Standard & Sentinel HA topologies)      |
| **Turborepo & pnpm**      | High-speed monorepo build orchestration with caching                         |
| **k6 & Vitest**           | Distributed load-testing harness and unit/integration test runners           |

---

## 2. Environment Configuration

Example configuration for backend (`apps/api/.env`):

```env
# Server
PORT=3001
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000"

# Database
DATABASE_URL="postgresql://arena:arena123@localhost:5432/arena_of_100?connection_limit=20"
DB_POOL_MAX=20

# Redis Standalone
REDIS_URL="redis://localhost:6379"

# Redis Sentinel HA (Optional / Production)
# REDIS_SENTINELS="localhost:26379,localhost:26380,localhost:26381"
# REDIS_SENTINEL_MASTER_NAME="mymaster"

# Auth
JWT_SECRET="arena-100-super-secret-key-change-in-prod"
JWT_EXPIRES_IN="24h"
```

---

## 3. Local Development & Quick Start

```bash
# 1. Start Infrastructure (PostgreSQL + Redis)
docker compose -f infrastructure/docker-compose.yml up -d

# (Or for Redis Sentinel HA cluster)
# docker compose -f infrastructure/docker-compose.sentinel.yml up -d

# 2. Install all dependencies
pnpm install

# 3. Synchronize Database Schema & Seed Initial Trivia Data
pnpm db:push
pnpm --filter @arena/api run prisma:seed

# 4. Start Monorepo in Development Mode
pnpm dev
# Web: http://localhost:3000 | API: http://localhost:3001
```

---

## 4. Testing Architecture & Discipline

- **Unit & Integration Tests**: Run using Vitest across all workspace packages with strict assertions.
- **Coverage Standard**: >=90% coverage threshold across business logic in `@arena/game-core` and `@arena/api`.
- **Zero Global Regressions**: All 2,398 automated test assertions pass deterministically without race conditions.
