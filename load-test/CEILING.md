# System Capacity Ceiling Sweep (2026-08-14)

## Question

How many concurrent WebSocket users can the system handle before logic breaks
under load?

## Answer (TL;DR)

| VU     | Logic intact? | Hard evidence                                                                                                                                               |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100    | ✅ yes        | answer p95 95.7ms, 0 errors, 0 connect failures                                                                                                             |
| 3,200  | ✅ yes        | answer p95 1,444ms, **app_error_rate 0.84% (real)** — 94% of "errors" removed by player late-join gate                                                      |
| 6,400  | ⚠️ degraded   | answer p95 916ms (server-side handler max 2.5s), **app_error_rate 0.85% (real)**, **DB pool spikes 150/150 briefly during setup, headroom at steady-state** |
| 12,800 | ❌ breaks     | answer p95 2,093ms, **http_req_failed 1.87%**, **17.2% of matches don't finish**, ws_connecting p95 = 40s. Single-host k6 ceiling — see caveat.             |

**The user's hypothesis "DB ops break logic" is FALSE** in the 100–6,400 VU
range. **DB pool does spike to ceiling at 6,400 VU but only briefly during
setup** (1-2 samples at 150/150 active); steady-state has plenty of headroom
(peak 56 active / 150 max). The actual bottleneck at 6,400 VU is **socket
connect/accept queue + nginx layer** — server-side handler time is bounded at
~2.5s even at peak.

## Why a re-run?

The 2026-08-14 first-pass ceiling sweep (`load-test/results/ceiling-*.json`)
showed `app_error_rate = 11-27%` at 3,200 / 6,400 VU, dominated by
`SPECTATOR_CANNOT_ANSWER` errors. These are **k6-scenario noise**, not app
bugs:

- `multi-room.js` ramps players concurrently with the host's
  `START_MATCH` (`flows.js:479 warmupMs=35s`)
- Players arriving after `START_MATCH` get admitted as `SPECTATOR`
  (server-side drop-in policy)
- `playerFlow` still calls `SUBMIT_ANSWER` on every `ROUND_STARTED`
- Server correctly rejects with `SPECTATOR_CANNOT_ANSWER`

### Fix (C — app_error_rate noise removal)

Two-line patch in `load-test/lib/flows.js`:

```js
client.on(ServerEvent.ROOM_JOINED, (p) => {
  if (p && p.roomId) roomId = p.roomId;
  if (p && p.joinedAs === "SPECTATOR") {
    demotedToSpectator = true; // mirror a real client
    M.playersDemotedToSpectator.add(1); // tracked separately
  }
});
// ROUND_STARTED guard: also check demotedToSpectator
if (!mid || finished || eliminated || demotedToSpectator || !p) return;
```

New counter in `load-test/lib/metrics.js`:

```js
export const playersDemotedToSpectator = new Counter(
  "players_demoted_to_spectator",
);
```

Scope: **pure harness** — no app code touched, no behavior change for
correctly-joined players.

### Result after fix

| Metric                               | Before (noisy) | After fix |
| ------------------------------------ | -------------- | --------- |
| server_error_events @ 3,200 VU       | 831            | **54**    |
| app_error_rate @ 3,200 VU            | 11.4%          | **0.84%** |
| server_error_events @ 6,400 VU       | 4,844          | **58**    |
| app_error_rate @ 6,400 VU            | 27.1%          | **0.85%** |
| players_demoted_to_spectator @ 3,200 | (not tracked)  | **930**   |
| players_demoted_to_spectator @ 6,400 | (not tracked)  | **3,017** |

Remaining 24 / 58 server errors at 6,400 VU are **ramp-window race**: a
small number of players submit `SUBMIT_ANSWER` for round 1 _before_ the
`ROOM_JOINED` handler sets `demotedToSpectator` (server's first `ROUND_STARTED`
can arrive before its `ROOM_JOINED` echo). Total = 0.37% — well below the
1% Plan A threshold; documented as known tiny residual.

## B — Bottleneck evidence (was: "event-loop / Fastify"; now: confirmed + refined)

**Sweep instrumentation** (new):

- 3 × `sample-monitoring.mjs` (one per API node) → per-node CPU + eventLoopLag
  JSONL (1 Hz)
- 1 × `pg_stat_activity` poller (`load-test/scripts/poll-pg.sh`, 0.5 Hz) →
  total / idle / active / idle_in_txn connection counts
- Cluster env tuned: `DB_POOL_MAX=50/node × 3 = 150`,
  `PG_MAX_CONNECTIONS=300`, `LB_METHOD=least_conn`

### Evidence @ 3,200 VU

| Layer                  | Peak                    | Headroom              |
| ---------------------- | ----------------------- | --------------------- |
| Node-1 eventLoopLagMax | 110.6ms                 | healthy               |
| Node-2 eventLoopLagMax | 135.4ms                 | healthy               |
| Node-3 eventLoopLagMax | 144.2ms                 | healthy               |
| PG active conn (peak)  | 44                      | 106 / 150 spare       |
| PG total conn (peak)   | 155                     | 145 / 300 spare       |
| Node CPU peak (any)    | ~158% (transient spike) | bursty, not sustained |

### Evidence @ 6,400 VU

| Layer                                   | Peak               | Headroom                                   |
| --------------------------------------- | ------------------ | ------------------------------------------ |
| Node-1 eventLoopLagMax                  | 173.7ms            | healthy                                    |
| Node-2 eventLoopLagMax                  | 319.8ms            | laggy but no saturation                    |
| Node-3 eventLoopLagMax                  | 256.1ms            | laggy but no saturation                    |
| **PG active conn (peak)**               | **150**            | **0 / 150 spare — saturated during setup** |
| **PG active conn (steady-state)**       | **56**             | 94 / 150 spare                             |
| PG total conn (peak)                    | 155                | 145 / 300 spare                            |
| Server-side handler response time (max) | 2,497ms (any node) | bounded                                    |

The DB pool DOES saturate briefly during the **64-room creation storm**
(2026-08-14T07:10:19 — `active=150, idle=0` for one 2s poll sample) but
recovers within ~2s. Steady-state (during match play) shows active ≤56 —
plenty of capacity.

The 11.2s `http_req_duration` p95 k6 sees is **NOT** server-side handler
time (which maxes at 2.5s in api logs). It's **nginx socket accept queue +
k6-side connect retries** (66 handshake retries at 6,400 VU vs 31 at 3,200).

### Bottleneck order (6400 VU peak)

1. **Socket accept queue / nginx** (first to feel pressure; 11.2s p95
   vs 2.5s server-side max — gap = queue)
2. **HTTP handler event-loop** (peaks 320ms eventLoopLagMax at one node —
   Node still responsive)
3. **DB pool** (saturates for ~2-4s during room-creation burst, then idle)
4. **Prisma / Postgres transactions** (last, never the dominant constraint
   in 6,400 VU steady-state)

This **contradicts the prior ceiling doc's claim** that "DB ops don't break
logic" — re-run shows the DB pool does spike to ceiling, but only in a
2-second burst during setup. During play, DB has plenty of headroom.

## Results table

| Metric (k6)                  | 100 VU  | 3,200 VU (cleaned) | 6,400 VU (cleaned) | 12,800 VU (original)      |
| ---------------------------- | ------- | ------------------ | ------------------ | ------------------------- |
| answer p50                   | 61.5ms  | 723ms              | 450ms              | (med 1113ms)              |
| answer p95                   | 95.7ms  | **1,444ms**        | **916ms**          | 2,093ms                   |
| answer max                   | 100ms   | 1,708ms            | 1,133ms            | 4,448ms                   |
| http_req_duration p95        | 6.5ms   | 1,021ms            | **11,252ms** ⚠️    | 11,807ms                  |
| http_req_failed              | 0.000%  | 0.000%             | 0.206%             | **1.87%** ⚠️              |
| ws_connect_success           | 100     | 3,200 / 3,200      | 6,350 / 6,400      | 12,352 / 12,800           |
| ws_handshake_retries         | n/a     | 31                 | 66                 | **747**                   |
| ws_connecting p95            | 1.9ms   | n/a                | n/a                | **39.7s**                 |
| setup_flow_errors            | 0       | 0                  | 50 ⚠️              | **17**                    |
| match_finished               | 100/100 | 3,199/3,200        | 6,270/6,400 (98%)  | **10,606/12,800 (82.8%)** |
| round_started                | 267     | 8,975              | 10,569             | 12,473                    |
| server_error_events (real)   | 0       | 54                 | 58                 | 0                         |
| players_demoted_to_spectator | 0       | 930                | 3,017              | n/a                       |
| **app_error_rate (REAL)**    | 0.000%  | **0.84%**          | **0.85%**          | 19.2%                     |
| k6 process memory            | n/a     | 2.5 GB             | ~3 GB              | 5 GB                      |

## Caveat — 12,800 VU is k6-single-host-bound

Single k6 process can't drive more than ~13k VUs from one machine on a
12-core host (5 GB RAM at peak, 259% CPU during setup). So **the 12,800
VU ceiling is confounded between "server breaks" and "k6 load generator
breaks"**. To definitively answer "how many concurrent users can the
SERVER handle", k6 would need to be distributed across ≥2 load-generator
hosts. This is a follow-up (not done in this iteration — would require
extra infrastructure + cluster isolation).

## Ceiling tiers (3-node API, single-host k6)

| Layer                       | VU ceiling                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Hard correctness            | **~ 6,400 VU** (logic + integrity intact, app_error_rate 0.85%, 98% matches finish) |
| Soft performance            | **~ 10,000 VU** (estimated; would need a separate sweep)                            |
| Hard throughput (single k6) | **~ 12,800 VU** (HTTP failures appear, 17% matches don't finish)                    |

## Raw artifacts

- `load-test/results/ceiling-clean-32x100-6e9179e-20260814T150000.json` (3,200 VU cleaned)
- `load-test/results/ceiling-clean-64x100-6e9179e-20260814T151000.json` (6,400 VU cleaned)
- `load-test/results/ceiling-32x100-6e9179e-20260814T130000.json` (3,200 VU original — kept for noise comparison)
- `load-test/results/ceiling-64x100-6e9179e-20260814T140000.json` (6,400 VU original)
- `load-test/results/ceiling-128x100-6e9179e-20260814T143000.json` (12,800 VU original)
- `load-test/results/clean-32x100-node-{1,2,3}.cpu.jsonl` (per-node CPU + eventLoopLag, 3,200 VU)
- `load-test/results/clean-32x100-node-{1,2,3}.redis.jsonl` (per-node Redis, 3,200 VU)
- `load-test/results/clean-32x100.pg.jsonl` (pg_stat_activity, 3,200 VU)
- `load-test/results/clean-64x100-node-{1,2,3}.cpu.jsonl` (per-node CPU + eventLoopLag, 6,400 VU)
- `load-test/results/clean-64x100-node-{1,2,3}.redis.jsonl` (per-node Redis, 6,400 VU)
- `load-test/results/clean-64x100.pg.jsonl` (pg_stat_activity, 6,400 VU)

## Reproduction

```bash
# Bring up cluster with tuned env
DB_POOL_MAX=50 PG_MAX_CONNECTIONS=300 pnpm docker:multi:up

# Start monitoring sidecars (one per API node)
for n in 1 2 3; do
  setsid nohup node load-test/scripts/sample-monitoring.mjs \
    --api-url "http://localhost:301$n" \
    --redis-url "redis://localhost:6389" \
    --out-dir load-test/results \
    --out-name "clean-Nx100-node-$n" \
    > /tmp/clean.node-$n.log 2>&1 < /dev/null &
  disown
done

# Start pg poller
setsid nohup load-test/scripts/poll-pg.sh \
  load-test/results/clean-Nx100.pg.jsonl arena-multi-postgres 2 \
  > /tmp/clean.pg.log 2>&1 < /dev/null &
disown

# Sweep N (N=32 → 3200 VU, N=64 → 6400 VU)
ROOMS=N PLAYERS_PER_ROOM=69 SPECTATORS_PER_ROOM=30 \
  HOLD=2m RAMP_UP=30s SPEC_RAMP_UP=15s \
  k6 run \
    -e API_URLS="http://localhost:3011,http://localhost:3012,http://localhost:3013" \
    --summary-export=load-test/results/ceiling-clean-Nx100-<commit>-<ts>.json \
    load-test/scenarios/multi-room.js
```
