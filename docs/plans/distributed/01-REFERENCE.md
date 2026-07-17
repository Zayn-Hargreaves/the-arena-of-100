# Distributed Refactor — Shared Reference

> Read this once, then read only your phase file. All phase files assume the
> facts below. Line numbers are approximate anchors (verify with a quick grep).

## Stage A recap (already shipped — do not redo)

- `apps/api/src/adapters/redis-io.adapter.ts` — `RedisIoAdapter` wires
  `@socket.io/redis-adapter`; installed in `main.ts` before `app.listen`.
  Cross-node room broadcast works (verified 3-node).
- `apps/api/src/modules/cluster/cluster.service.ts` — `ClusterService`:
  - `readonly nodeId = process.env.INSTANCE_ID || os.hostname()` — **this is
    the node identity; B0 does NOT need to re-create it.**
  - `setServer(ns)`, `getLocalSocketCount()`.
  - `getOwnedMatchIds()` — **Stage-A placeholder** that SCANs `match:owner:*`.
    **B2b replaces this** with the in-memory owned set from `MatchOwnershipService`.
  - `@Global ClusterModule` exports it (inject anywhere).
- `infrastructure/docker-compose.multi.yml` — 3 API (`INSTANCE_ID` = api-1/2/3,
  host probe ports 3011/3012/3013), postgres(:5442), redis(:6389), nginx LB(:8080).
  `pnpm docker:multi:{build,up,down}`. **`REFRESH_EXPIRES_IN` must be integer
  seconds** (gotcha already fixed in compose).
- `GET /api/v1/health/cluster` (**ADMIN JWT required** — `@Roles(ADMIN)`, hidden in single-node
  production) → `{ nodeId, uptime, ownedMatches, socketCount }`.
- **Known deferred bug:** `PresenceService.sweep` runs on all 3 nodes → duplicate
  sweeps / `room.delete` races. Fixed in **B5**.

## The game loop (where the timers live)

**`apps/api/src/modules/match/match-round-runner.ts`** (`MatchRoundRunner`) is the
real loop; `game-loop.service.ts` is a thin facade. It owns its own
`MatchTimerRegistry` (`new MatchTimerRegistry()` ~line 73). Lifecycle:

- `startMatchLoop(matchId, roomId, server)` ~85 — load SM, room→IN_GAME,
  `transition(COUNTDOWN)`, init used-questions, persist, emit `MATCH_STARTED`, `executeCountdown`.
- `executeCountdown` ~139 — **`setTimeout(..., COUNTDOWN_DURATION_MS=5000)` @ ~150** → `executeRound`.
- `executeRound` ~188 — `transition(ROUND_ACTIVE)`, fetch question (exclude used),
  `startRound()` (sets `round.endsAt = now + ROUND_DURATION_MS`), persist,
  set `expectedAnswers`, emit `ROUND_STARTED` (carries `endsAt`).
  **`setTimeout(..., ROUND_DURATION_MS=15000)` @ ~257** → `endRound`.
- `endRound` ~275 — **H1 guard `timers.beginEndRound` @ ~285**; branch on `state.status`;
  persist round+answers to DB **before** `transition(ROUND_RESULT)` (~355-390);
  emit `ROUND_ENDED` + per-player `PLAYER_ELIMINATED`; `scheduleMatchEndCheck`.
  Recovered-round path `handleRecoveredRoundEnd` ~445-530 (when called on ROUND_EVALUATING).
- `scheduleMatchEndCheck` ~532 — **`setTimeout(..., RESULT_DISPLAY_MS=3000)` @ ~537** → `checkMatchEnd`.
- `checkMatchEnd` ~651 — `shouldEndMatch(MAX_ROUNDS=50)` → `finishMatchLoop`, else `executeRound` (next round).
- `finishMatchLoop`/`finishMatchLoopInner` ~673-747 — **B1 guard `timers.beginFinish` @ ~683**;
  `transition(FINISHED)`, `matchService.finishMatch(...)`, emit `MATCH_FINISHED`, `timers.disposeMatch`.
- `checkEarlyTermination` ~849 — all surviving answered → `clearTimers` + immediate `endRound`.

**The 3 mutating boundaries B2c must fence:** `endRound` (275), `checkMatchEnd` (651),
`finishMatchLoopInner` (706).

**`apps/api/src/modules/match/match-timer.registry.ts`** — in-memory only:
`activeTimers Map`, `usedQuestionIds Map<matchId,Set>` (F2 anti-repeat),
`expectedAnswers Map`, `endingRounds Set` (H1), `finishingMatches Set` (B1).
Methods: `ensureMatch/addTimer/clearTimers/hasTimers`, `initUsedQuestions/markQuestionUsed/getUsedQuestions`,
`setExpectedAnswers/getExpectedAnswers`, `beginEndRound/endEndRound/isEndingRound`,
`beginFinish/endFinish/isFinishing`, `disposeMatch`.

## State machine + persistence

- **`packages/game-core/src/match-state-machine.ts`**: `transition(newStatus)` ~132
  (sets `state.startedAt` on COUNTDOWN ~147, `state.endedAt` on FINISHED ~151/460);
  `startRound()` sets `currentRound.endsAt = now + ROUND_DURATION_MS` ~177;
  `getEventLog()`; `ROUND_STARTED` events carry the client-safe `question` incl.
  `questionId` (~202-207); `getSnapshot()` exposes `roundEndTime = currentRound.endsAt` ~517-535.
- **`packages/game-core/src/match-state.codec.ts`**: `serializeMatch` ~89-123 does
  `{ _stateVersion: SERIALIZED_STATE_VERSION, state: {...state}, ... }`; `deserializeMatch`
  does `{...parsed.state}`. `hasSupportedStateVersion` uses **strict `=== SERIALIZED_STATE_VERSION`**;
  `deserializeStartingPlayers` keys off it (bumping the version naively flips v1
  `startingPlayers` → UNAVAILABLE — the B1c trap).
- **`packages/shared/src/state.ts`**: `MatchState` ~73-85 (`status, currentRoundNo,
totalRounds, startedAt, endedAt, survivingPlayerIds, eliminatedPlayerIds, winnerId`);
  `RoundState` ~88-96 (`roundNo, startedAt, endsAt, status, answers, startingPlayers`);
  `AnswerState` carries `submissionId`. **`correctAnswer` is deliberately NOT persisted**
  (re-attached from DB).
- **`packages/shared/src/game-config.ts`**: `COUNTDOWN_DURATION_MS=5000`,
  `ROUND_DURATION_MS=15000`, `RESULT_DISPLAY_MS=3000`, `MAX_ROUNDS=50`, `MIN_PLAYERS_TO_START=2`.
- **`apps/api/src/modules/match/match.service.ts`**: `getStateMachine(matchId)` ~119
  (in-memory cache → Redis `match:state:<id>` deserialize → DB correctAnswer re-attach
  ~150-201); `persistStateMachine(matchId)` ~212-221 = **blind `redis.set(match:state:<id>, ...)`**
  (the lost-update hazard B4 fixes); `finishMatch` clears the Redis key ~335.
  Redis key **`match:state:<matchId>` TTL 86400s**.

## The recovery template to copy

**`apps/api/src/modules/match/lobby-countdown.service.ts`** already does Redis-backed
timer recovery — generalize its shape for `MatchOwnershipService`:

- `onModuleInit` ~142-232: list persisted rooms, read deadline, re-arm `setTimeout` if
  future / fire if past; **C4 buffering** `pendingRecovery` (~65, 87-134) because
  `afterInit`/`setServer` runs AFTER `onModuleInit` (drain in `setServer`).
- `armLobbyCountdownTimer` ~326: `setTimeout(launch, max(endsAt - Date.now(), 0))`.
- Exponential-backoff retry + dead-letter (`room:recovery:dead-letter`) ~391-480.
- **`game-loop.countdown-store.ts`**: key `room:countdown:<roomId>` (TTL 50s) + index
  SET `room:countdowns` (SADD/SMEMBERS) — mirror this for `match:active`.

## Presence

**`apps/api/src/modules/match/presence.service.ts`**: `onModuleInit` starts
`setInterval(sweep, 5000)` ~35-50 (in-process `isSweeping` reentrancy flag); `sweep` ~70-242
iterates `roomService.getActiveRooms()` **globally** and mutates room/match state
(disband, remove players, `gameLoopService.handlePlayerDisconnect` for IN_GAME stale ~168).
**Not multi-node safe** → B5 makes it leader-only and routes IN_GAME disconnects to the owner.

## SUBMIT_ANSWER path

**`apps/api/src/gateways/handlers/match.handler.ts`**: `handleSubmitAnswer(client, payload)` ~76 →
`getStateMachine` ~82 → roster/status guards (spectator/disconnected) ~88-105 →
`stateMachine.submitAnswer(...)` ~110 → `persistStateMachine` ~117 → `client.emit(ANSWER_RESULT)` ~124 →
replay guard (dup submissionId) ~159-165 → early-termination
`gameLoopService.checkEarlyTermination(matchId, roomId, client.nsp.server)` ~174.

## Redis primitives (`apps/api/src/modules/redis/redis.service.ts`)

Present: `getClient()`, `get/set(key,val,ttl?)/del`, `setIfAbsent(key,val,ttl?)` (SET NX EX,
the lock primitive), `getJSON/setJSON`, `sadd/srem/smembers/sismember`, `incr`,
`publish(channel,msg)`, `eval(script, keys[], args[])`, `exists`. Single ioredis client
(subscribe needs a **separate `client.duplicate()`** connection). **Missing (B0 adds):**
CAS `renewLease`/`releaseLease` (Lua via `eval`), `subscribe(channel, handler)`.

## Redis key schema (introduced across B0–B5)

| Key                              | Type                         | TTL                       | Introduced | Meaning                                                   |
| -------------------------------- | ---------------------------- | ------------------------- | ---------- | --------------------------------------------------------- |
| `match:owner:<matchId>`          | string `"<nodeId>:<fence>"`  | 15s                       | B2         | current owner lease                                       |
| `match:fence:<matchId>`          | int (`INCR`)                 | none (cleared on finish)  | B2         | monotonic fencing token                                   |
| `match:active`                   | SET of matchId               | none                      | B2         | in-flight match index (recovery)                          |
| `match:recovery:dead-letter[:*]` | set/string                   | 7d                        | B3b        | unrecoverable matches (ops-facing index)                  |
| `match:tombstone:<matchId>`      | string `"<reason>:<fence>"`  | 7d                        | B3b        | canonical terminal marker; acquisition Lua rejects on it  |
| `match:cmd:<matchId>`            | **stream** (XADD/XREADGROUP) | trimmed/deleted on finish | B4         | non-owner → owner commands (durable, at-least-once + ack) |
| `presence:leader`                | string `"<nodeId>:<fence>"`  | 15s                       | B5         | single-sweeper lease (fenced)                             |
| `presence:leader:fence`          | int (`INCR`)                 | none                      | B5         | monotonic leader fencing token                            |

Lease TTL 15s, heartbeat every 5s (renew 3× before expiry). All deadlines are wall-clock
(`Date.now()`); rebuild uses `remaining = clamp(deadline - now, 0, phaseMax)`.

**Clock-skew budget (operational contract for wall-clock deadlines).**
Because a deadline written by node A is read by node B on failover, inter-node clock skew
directly shifts phase timing.

- **Max acceptable skew: 2s** (well under `RESULT_DISPLAY_MS=3s`, the shortest phase). All nodes
  MUST run NTP/chrony; the compose stack assumes the host clock is synced.
- **Measure it (owned by B2c/health):** on every heartbeat tick (B2c) a node reads the shared
  Redis server clock once (`TIME`) and publishes its **offset from that common reference**,
  `node:clock:<nodeId> = Date.now() - redisServerTimeMs` (a small signed number), with a short
  TTL. Publishing an _offset against a common clock_ — not a raw `Date.now()` — is what makes the
  measurement independent of heartbeat age: a peer's entry is up to one interval old, so directly
  comparing stale peer `Date.now()` values against the local `Date.now()` would report a false
  ~heartbeat-cycle "skew" even on perfectly synchronized nodes. Each node's offset is captured
  instantaneously against Redis, so synchronized nodes yield ~equal offsets regardless of when
  they last beat.
  **Enumerate peers via an index, not a wildcard `GET`:** `RedisService` has no SCAN, so B2c
  maintains a `node:clocks` SET (`SADD <nodeId>` on heartbeat); the health path does
  `SMEMBERS node:clocks` then `GET node:clock:<id>` per member — and when a member's clock key has
  expired (missing), `SREM` it from the index so dead nodes don't linger. (Alternative: add a
  `scanStream`/`SCAN` primitive to `RedisService` and scan `node:clock:*`; the SET index is
  preferred for parity with `match:active`.) Then **`maxSkew = max(offset) - min(offset)` across
  live members** — the reference-free peer-to-peer spread, which every node computes identically.
  (This is deliberately NOT `max|offset_peer - offset_self|`: that self-relative form depends on
  which node evaluates it and can under-report the true pairwise spread when `offset_self` sits
  between the extremes. The spread definition is the single canonical `maxSkew` calculation; the
  1s/2s alert thresholds below apply to it.) Exported as the `maxSkew` field on
  `GET /api/v1/health/cluster` for scraping.
  These responsibilities (offset publication, index maintenance, skew computation, health output)
  belong explicitly to **B2c/health** — not to any later phase. B2c must add tests that assert:
  (a) each heartbeat publishes `node:clock:<nodeId>` (offset) with the expected short TTL and
  `SADD`s the node into `node:clocks`;
  (b) **synchronized nodes report ~0 skew even when their heartbeats fired a cycle apart** (no
  false heartbeat-cycle skew), while a genuinely skewed peer IS still detected;
  (c) an expired clock key is pruned from `node:clocks` on read; and
  (d) `/health/cluster` surfaces the computed `maxSkew` field.
- **Alert threshold: warn at 1s, page at 2s.**
- **Behavior when exceeded:** the `clamp(deadline - now, 0, phaseMax)` already bounds the damage
  (a skewed deadline can only fire between "immediately" and "one full phase early/late", never
  runaway). On failover, if `now` is _past_ a rebuilt deadline the phase fires immediately
  (acceptable — a round/result just ends slightly early); the risk is a phase ending _too_
  early for players. If skew exceeds the budget, prefer restarting NTP over trusting the
  timers; a match mid-flight is not corrupted (state is DB-persisted), only its pacing.

## Test & verify commands

```bash
# unit (fast)
pnpm --filter @arena/api exec vitest run <path/to.spec.ts>
pnpm --filter @arena/game-core exec vitest run <path>
# full api suite (~984 tests) + lint
pnpm --filter @arena/api test
pnpm --filter @arena/api lint
# build
pnpm --filter @arena/api build
# multi-node cluster (Stage C + integration verify)
pnpm docker:multi:build && pnpm docker:multi:up
curl -s localhost:3011/api/v1/health/cluster   # per-node
docker kill arena-api-<n>                       # chaos
pnpm docker:multi:down
```

Integration tests that need two "nodes" against one Redis: instantiate the service
twice with distinct `INSTANCE_ID` against a real (or `ioredis-mock`) Redis and assert
exactly-once behavior — see each phase's Tests section.
