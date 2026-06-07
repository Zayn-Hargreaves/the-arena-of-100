# Test Coverage Cleanup — lobby-lifecycle PR

**Branch:** `feat/lobby-lifecycle-graceful-exit`
**Date:** 2026-06-07
**Trigger:** Codecov patch coverage 55.5% on PR #38 (282 missing lines).

## Final Results

| File                   | Codecov (PR #38) | Before this work | **After**  | Delta   |
| ---------------------- | ---------------- | ---------------- | ---------- | ------- |
| `game.gateway.ts`      | 42.85%           | 100%             | **100%**   | —       |
| `room.handler.ts`      | 90.90%           | 96.21%           | **99.24%** | +3.0%   |
| `redis.service.ts`     | 25.00%           | 78.75%           | **97.5%**  | +18.75% |
| `room.service.ts`      | 87.05%           | 95.97%           | **100%**   | +4.0%   |
| `game-loop.service.ts` | 43.79%           | 71.94%           | **95.26%** | +23.3%  |
| `presence.service.ts`  | 18.62%           | 18.62%           | **100%**   | +81.4%  |

**Overall statements coverage:** 89.53% → **94.98%** (+5.45%)
**Test count:** 533 → **587** (+54 new tests, all green)

## What was added

- `apps/api/src/modules/match/presence.service.spec.ts` (new, 16 tests)
  - Passthroughs: `updatePresence` / `clearPresence` / `isPresent`
  - `sweep()`: 6 paths (no server, no rooms, all-present, stale non-host, stale host in PRIVATE, stale host in PUBLIC, multi-room)
  - Lifecycle: 5s interval arming, interval callback, error catching, `isSweeping` reentrancy guard, `onModuleDestroy` cleanup
- `apps/api/src/modules/match/game-loop.service.spec.ts` (+30 tests)
  - `getCountdownEnd` (2 paths)
  - `armLobbyCountdownTimer` (2 paths: no server → drop+clear, with server → set timer)
  - `handleRoomPlayerLeft` (4 paths)
  - `forceStartRoomMatch` (1 path)
  - `launchRoomMatch` (6 paths: wrong status, not enough + autoStart, not enough + !autoStart, countdown-cleared-from-entry, happy path, error rollback)
  - `onModuleInit` recovery (7 paths: empty, missing payload, unparseable, future → re-arm, expired+server, expired+no-server, per-room error, top-level error)
  - `maybeStartPublicCountdown` additional paths (4)
- `apps/api/src/gateways/handlers/room.handler.spec.ts` (+1 test)
  - Regression test for the new "missing user relation" fail-fast guard (asserts the data-integrity error is logged + client gets generic INTERNAL_ERROR)
- `apps/api/src/modules/room/room.service.spec.ts` (+2 tests)
  - `getActiveRooms` (with rooms, empty)
- `apps/api/src/modules/redis/redis.service.spec.ts` (+6 tests)
  - `sismember` argument passthrough
  - `exists` 1→true, 0→false
  - `sadd`, `srem`, `incr`, `get`, `del`, `smembers` direct passthroughs

## Remaining minor gaps (not blocking)

- `redis.service.ts` lines 44-45: `getClient()` passthrough (tested transitively)
- `room.service.ts` branches 40, 212: `createRoom` default-arg fallthrough
- `room.handler.ts` line 117: ternary branch in the `player.userId === userId` username resolution
- `game-loop.service.ts` lines 262-267, 370-371: `persistLobbyCountdown` error log branch + `launchRoomMatch` re-fetch status check

These are all 1-2 line branches; chasing them would add cosmetic-only value.

## Verification

```bash
cd apps/api && pnpm test:coverage
# Test Files  51 passed (51)
#      Tests  587 passed (587)
# All files  94.98 stmts | 93.81 branch | 94.09 funcs | 94.98 lines
```

---

## Current State (before this work)

| File                   | Stmts  | Lines missing                           | Priority |
| ---------------------- | ------ | --------------------------------------- | -------- |
| `game.gateway.ts`      | 100%   | branch 80, 181                          | easy     |
| `room.handler.ts`      | 96.21% | 108-111, 117                            | easy     |
| `room.service.ts`      | 95.97% | 287-297 (`getActiveRooms`)              | easy     |
| `redis.service.ts`     | 78.75% | 89-95 (`sismember`), 110-112 (`exists`) | easy     |
| `game-loop.service.ts` | 71.94% | 211-312, 315-403                        | hard     |
| `presence.service.ts`  | 18.62% | 57, 60-61, **64-128 (sweep)**           | hard     |

**Overall:** 89.53% statements, 533 tests passing.

## Target

| File                   | Goal  | Why                                           |
| ---------------------- | ----- | --------------------------------------------- |
| `presence.service.ts`  | ≥ 95% | sweep is the main PR risk                     |
| `game-loop.service.ts` | ≥ 90% | recovery + launch + finish are critical paths |
| `redis.service.ts`     | 100%  | tiny, easy win                                |
| `room.service.ts`      | 100%  | tiny, easy win                                |
| `room.handler.ts`      | 100%  | new fail-fast guard needs regression test     |
| `game.gateway.ts`      | 100%  | only branch lines left                        |

**Overall target:** ≥ 93% statements, 533+ tests.

## Plan

### 1. New file: `apps/api/src/modules/match/presence.service.spec.ts`

Cover `PresenceService`:

- `updatePresence` / `clearPresence` / `isPresent` delegate to `RoomService`
- `sweep()`:
  - returns early when `server` is not set
  - returns early when no active rooms
  - **all-present players** → no removal, no events
  - **stale non-host players** → `removePlayerBatch` + per-player `PLAYER_LEFT` (`STALE`) + `handleRoomPlayerLeft`
  - **stale host in PRIVATE room** → `disbandRoom` + `ROOM_COUNTDOWN_CANCELLED` (`HOST_STALE`) + `PLAYER_LEFT` (`HOST_STALE`)
  - **stale host in PUBLIC room** → batch removal path
  - reentrancy: `isSweeping` guard (parallel invocation)
- `onModuleInit` sets the interval
- `onModuleDestroy` clears the interval and survives `null`

Use `vi.useFakeTimers` + call `setServer` + trigger the interval callback explicitly via `vi.advanceTimersByTimeAsync(5000)`.

### 2. Extend `apps/api/src/modules/match/game-loop.service.spec.ts`

Add a new top-level `describe("Lobby Countdown Recovery & Launch", ...)` block covering:

- `onModuleInit` (recovery) — 6 paths:
  - no rooms in `room:countdowns` set → returns
  - room with no payload key → SREM from index
  - room with bad (NaN) payload → `clearPersistedCountdown`
  - expired countdown + server set → `launchRoomMatch` (autoStart)
  - expired countdown + no server → `clearPersistedCountdown`
  - future countdown → re-arm timer (no `launchRoomMatch` immediately)
  - per-room Redis error → log and continue
  - top-level error → log and reset `recoveryInFlight`
- `armLobbyCountdownTimer` (private):
  - no server → delete + clear persistence
  - with server → set timer
- `persistLobbyCountdown` / `clearPersistedCountdown` (private) — covered indirectly via `onModuleInit` paths + `maybeStartPublicCountdown` error path
- `getCountdownEnd` — direct, simple
- `handleRoomPlayerLeft` — 4 paths:
  - no countdown active
  - room status not COUNTDOWN
  - room players still ≥ MIN
  - happy path: cancel + emit + status update
- `forceStartRoomMatch` — delegates to `launchRoomMatch` with `isAutoStart: false`
- `launchRoomMatch` — 5 paths:
  - wrong status → `ROOM_ALREADY_STARTED`
  - countdown cleared from entry
  - below MIN + autoStart → emit cancel + throw
  - below MIN + !autoStart → throw without cancel emit
  - happy path → createMatch + start loop
  - error path → rollback to WAITING
- `checkEarlyTermination` — additional path: not all answered yet (no-op)

### 3. Easy wins

- `redis.service.spec.ts`:
  - `sismember` 1→true, 0→false
  - `exists` 1→true, 0→false
- `room.service.spec.ts`:
  - `getActiveRooms` returns the right list
- `room.handler.spec.ts`:
  - `handleJoinRoom` throws `Error` when player has no `user` relation
- `game.gateway.spec.ts`:
  - `handleHeartbeat` `Error` branch in the try/catch warn (line 181)
  - `afterInit` `Authorization` branch already covered; verify the `else` branch in middleware (line 80) — the "Bearer " without actual token

## Verification

```bash
cd apps/api && pnpm test:coverage
```

Expected:

- All 533+ existing tests still pass
- `presence.service.ts` ≥ 95%
- `game-loop.service.ts` ≥ 90%
- All 4 small files → 100%
- Total statements ≥ 93%

## Risk

- Fake timers + 5s interval: must `vi.useRealTimers()` in `afterEach` to prevent leaking intervals across tests.
- `redis.mock.ts` `getClient()` returns the same client instance, so `vi.mocked` on the client persists between tests → `vi.clearAllMocks()` in `afterEach` matters.
- `onModuleInit` recovery is a one-shot — the `recoveryInFlight` guard means we can only trigger it once per instance. Use `new GameLoopService(...)` per test.
