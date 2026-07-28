# 🏟️ Arena of 100 - Game Đấu Trường 100

Real-time multiplayer quiz battle royale game. 100 players enter, only 1 survives!

## 🎮 Features

- **Battle Royale Quiz**: 100 players compete, wrong answer = eliminated
- **Real-time Gameplay**: WebSocket-powered instant updates
- **Room System**: Create public/private rooms with unique codes
- **Reconnect Support**: Auto-sync state when reconnecting
- **Tie-break System**: Fair winner determination by response time
- **Server-Authoritative**: Anti-cheat, server controls all timing

## 🛠️ Tech Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js 15 + React 19 + Zustand + Tailwind CSS |
| Backend   | NestJS + Fastify + Socket.io                   |
| Database  | PostgreSQL (Prisma ORM)                        |
| Cache     | Redis (sessions, game state)                   |
| Real-time | Socket.io (WebSocket)                          |
| Infra     | Docker Compose                                 |
| Monorepo  | pnpm + Turborepo                               |

## 📁 Project Structure

```
arena-of-100/
├── apps/
│   ├── api/          # NestJS backend (Fastify + Socket.io)
│   └── web/          # Next.js frontend
├── packages/
│   ├── shared/       # Shared types, events, constants
│   └── game-core/    # Pure game logic (state machine)
├── infrastructure/
│   └── docker-compose.yml  # PostgreSQL + Redis
├── memory-bank/      # Project documentation
└── turbo.json        # Turborepo config
```

## 🏗️ Architecture

- **Distributed match runtime** (horizontal scale + failover): [`docs/architecture-distributed.md`](docs/architecture-distributed.md) — Redis Socket.IO adapter, fenced owner-lease, node-kill failover, and the load/chaos evidence plan.

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.x
- Docker & Docker Compose

### 1. Start Infrastructure

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Setup Database

```bash
# Copy env file
cp apps/api/.env.example apps/api/.env

# Push schema to database
pnpm db:push

# Seed questions (after implementing seed script)
pnpm --filter @arena/api run prisma:seed
```

### 4. Run Development Servers

```bash
pnpm dev
```

This starts:

- **API Server**: http://localhost:3001
- **Web App**: http://localhost:3000

## 🎯 How to Play

1. **Open** http://localhost:3000
2. **Enter username** (guest login, no password)
3. **Create Room** or **Join Room** with code
4. **Wait** for players to join
5. **Host starts** the match
6. **Answer questions** within 15 seconds
7. **Wrong answer = eliminated!**
8. **Last player standing wins!** 🏆

## 📡 API Endpoints

### REST

| Method | Path                | Description       |
| ------ | ------------------- | ----------------- |
| GET    | `/api/health`       | Health check      |
| POST   | `/api/auth/guest`   | Guest login       |
| POST   | `/api/rooms`        | Create room       |
| POST   | `/api/rooms/join`   | Join room         |
| GET    | `/api/rooms/public` | List public rooms |

### WebSocket Events (Socket.io)

| Event              | Direction | Description               |
| ------------------ | --------- | ------------------------- |
| `authenticate`     | C→S       | Login with JWT            |
| `create_room`      | C→S       | Create new room           |
| `join_room`        | C→S       | Join room by code         |
| `start_match`      | C→S       | Start game (host only)    |
| `submit_answer`    | C→S       | Submit answer             |
| `request_snapshot` | C→S       | Request state (reconnect) |
| `snapshot`         | S→C       | Full game state           |
| `round_started`    | S→C       | New round with question   |
| `answer_result`    | S→C       | Answer feedback           |
| `match_finished`   | S→C       | Winner announced          |

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run game-core tests only
pnpm --filter @arena/game-core test

# Watch mode
pnpm --filter @arena/game-core test:watch
```

## 📖 Documentation

Detailed documentation is available in the `memory-bank/` directory:

- [Project Brief](memory-bank/projectbrief.md) - Scope and requirements
- [Product Context](memory-bank/productContext.md) - User experience goals
- [System Patterns](memory-bank/systemPatterns.md) - Architecture and design patterns
- [Tech Context](memory-bank/techContext.md) - Tech stack and setup
- [Progress](memory-bank/progress.md) - Current status and milestones
- [Active Context](memory-bank/activeContext.md) - Current focus and next steps

## 🏗️ Architecture

### Design Patterns Applied (GoF)

- **State Pattern**: Match state machine (CREATED → COUNTDOWN → ROUND_ACTIVE → ...)
- **Command Pattern**: Socket event handlers (each action is a command)
- **Observer Pattern**: Real-time event broadcasting (room/match channels)
- **Strategy Pattern**: Tie-break logic (pluggable algorithms)
- **Factory Pattern**: Event creation (`createEvent()` factory)

### Key Principles

- **Server-Authoritative**: All timing and validation on server (anti-cheat)
- **Event Sourcing**: All actions as immutable events (audit + replay)
- **Clean Architecture**: Domain logic isolated from infrastructure
- **Modular Monolith**: Single deployable with clear module boundaries

## 📝 License

MIT
