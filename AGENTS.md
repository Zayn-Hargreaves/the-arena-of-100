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

## MCP Servers

- **CodeGraphContext**: Code graph indexing for semantic code navigation and understanding. Use `cgc` CLI to re-index when major structural changes are made.
- **shadcn**: UI component generation (frontend agent).

## Common Gotchas

- Database must be running before `pnpm db:push`
- Environment variables required in `apps/api/.env`
- Port conflicts: API runs on 3001, Web on 3000
- Redis required for session and game state management

## Documentation

### Core Memory-Bank Files (read these first, in order)

1. [Product Context](memory-bank/productContext.md)
2. [System Patterns](memory-bank/systemPatterns.md)
3. [Progress](memory-bank/progress.md)
4. [Active Context](memory-bank/activeContext.md)

### Memory-Bank Read Policy

- The 4 files above are the **only default memory-bank context** for agents.
- Other files under `memory-bank/` are **supplementary / legacy notes**.
- Do **not** read supplementary docs by default.
- Read supplementary docs only when:
  - the user explicitly asks for them, or
  - one of the 4 core files explicitly points to them.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **the-arena-of-100** (5482 symbols, 12358 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                          | Use for                                  |
| ------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/the-arena-of-100/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/the-arena-of-100/clusters`       | All functional areas                     |
| `gitnexus://repo/the-arena-of-100/processes`      | All execution flows                      |
| `gitnexus://repo/the-arena-of-100/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

## OpenCode Kit Routing

This project also uses the OpenCode Kit (migrated from Antigravity). For agent routing protocol, automatic agent selection, and the "Applying knowledge of @..." workflow, see `.opencode/rules/GEMINI.md` and `.opencode/skills/intelligent-routing/SKILL.md`.
