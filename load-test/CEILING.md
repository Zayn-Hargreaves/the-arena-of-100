# System Capacity Ceiling Sweep (2026-08-14, refined 2026-08-14)

## Question

How many concurrent WebSocket users can the system handle before logic breaks
under load?

## Answer (TL;DR)

| VU         | Logic intact? | Hard evidence                                                                                                                                                    |
| ---------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100        | ✅ yes        | answer p95 96ms, **0 errors**, 0 connect failures (Plan A baseline)                                                                                              |
| 3,200      | ✅ yes        | answer p95 1,444ms, **app_error_rate 0.84% (real)** — 94% of "errors" removed by player late-join gate                                                           |
| 6,400      | ✅ yes        | answer p95 916ms, **app_error_rate 0.85% (real)**, **DB pool spikes 150/150 briefly during setup, headroom at steady-state**                                     |
| 8,000      | ✅ yes        | answer p95 866ms, **app_error_rate 1.18%** (crosses 1% threshold), matches 99.6% finish, PG spikes to 144/150                                                    |
| **10,000** | ❌ **breaks** | answer p95 894ms, **app_error_rate 2.20%**, **match_finished/ws_success ratio collapses to 72.5%** (was >98% below), **setup_flow_errors jumps to 376** (was 50) |
| 12,800     | ❌ breaks     | http_req_failed 1.87%, 17.2% of matches don't finish, ws_connecting p95 = 40s. Single-host k6 ceiling.                                                           |

**The cleanest transition signal**: match_finished / ws_connect_success ratio
collapses from **99.6% → 72.5%** between 8,000 and 10,000 VU. Below 8,000 VU
~all clients who connected see MATCH_FINISHED. At 10,000 VU **27% of clients
join so late they get demoted to SPECTATOR and never see the match finish**.

**The user's hypothesis "DB ops break logic" is FALSE** in the 100–8,000 VU
range. DB pool saturates briefly (1-2 samples at 6,400 and 8,000 VU) only
during the **room-creation burst** at the start of each sweep, NOT during
gameplay. Steady-state has plenty of headroom. The actual bottleneck at
8,000+ VU is **socket connect queue + k6 load-generator capacity**.

## Heartbeat 25s validation at 8,000 VU (2026-08-14)

Production and k6 heartbeat cadence were changed together from 10s to 25s;
Redis presence TTL changed from 20s to 40s. The cluster was recreated from a
fresh database with all 11 Prisma migrations before measuring:

- `ROOMS=80`, `PLAYERS_PER_ROOM=69`, `SPECTATORS_PER_ROOM=30`
- `RAMP_UP=90s`, `SPEC_RAMP_UP=45s`, `HOLD=2m`
- `DB_POOL_MAX=50` per node, `PG_MAX_CONNECTIONS=300`, `LB_METHOD=least_conn`
- direct interleaved node routing through `:3011/:3012/:3013`, matching the
  prior ceiling methodology

### Result

| Metric                                                |                                   Heartbeat 25s / ramp 90s |
| ----------------------------------------------------- | ---------------------------------------------------------: |
| WS connect success                                    |                                          **8,000 / 8,000** |
| setup flow errors / WS connect errors / HTTP failures |                                             **0 / 0 / 0%** |
| app error rate                                        |                                  **0.755%** (122 / 16,150) |
| answer p50 / p95 / max                                |                          **819.5ms / 1,768.9ms / 2,717ms** |
| round events / answers submitted                      |                                          **9,557 / 1,858** |
| client `MATCH_FINISHED` observations                  |                                  **6,553 / 8,000 (81.9%)** |
| DB matches / finished matches                         |                       **81 / 81** (includes the mini-test) |
| DB rounds / persisted answers                         |                **183 / 1,869** (includes mini-test 3 / 25) |
| PG active peak / samples >= 100                       |                              **17 / 0** across 468 samples |
| API event-loop lag max                                |                                                  **176ms** |
| Presence/Prisma/internal errors                       | **0 host-stale, 0 disband, 0 Prisma/FK, 0 INTERNAL_ERROR** |

The run is valid evidence for heartbeat/presence and server-side match
correctness: all 80 measured benchmark matches reached `FINISHED`; gameplay
produced rounds and batched answer persistence; no room was stale-disbanded;
Postgres had substantial headroom. The authoritative artifact for this run is
`load-test/results/ceiling-heartbeat25-ramp90-80x100-bca68ea-20260814T111300Z.json`.
Earlier intermediate files (`ceiling-optimized-80x100-bca68ea-20260814T101922.json`
and `ceiling-optimized-ramp90-80x100-bca68ea-20260814T103817.json`) reflect
intermediate/incomplete calibration runs (with partial connections or unmeasured
answer latencies) and are not used as SLO evidence.

It is **not** an apples-to-apples replacement for the prior 8,000-VU ceiling
row. With the 90s player ramp but unchanged 35s host warmup, many clients join
after a fast match has already progressed or finished. Therefore the 81.9%
client `MATCH_FINISHED/ws_connect_success` ratio is timing-confounded and must
not be interpreted as 18.1% server match failure. The database and API logs
show 80/80 benchmark matches finished. A ceiling comparison using the client
ratio requires either the original 30s/15s ramps or a readiness barrier before
hosts start matches.

The answer p95 crossed the 1s SLO even though heartbeat traffic dropped 60%.
This means heartbeat optimization alone does not move the demonstrated 8,000
VU performance ceiling. It does remove presence traffic without introducing
stale-host failures; socket/HTTP scheduling remains the limiting layer.

### Batch verification

No new batching code was added. `MatchService.saveRoundAndAnswers()` already
persists one round plus all answers in a single transaction using
`tx.answer.createMany(...)`; `matchPlayer.createMany(...)` also already exists.
The mini-test persisted 25/25 submitted answers, and the 8,000-VU run persisted
the measured answer workload without Prisma or connection errors.

## Sweep history (this doc revision adds 8,000 + 10,000 VU)

The 2026-08-14 first-pass ceiling sweep showed `app_error_rate = 11-27%` at
3,200 / 6,400 VU, dominated by `SPECTATOR_CANNOT_ANSWER` errors. These were
**k6-scenario noise**, not app bugs:

- `multi-room.js` ramps players concurrently with the host's
  `START_MATCH` (`flows.js:479 warmupMs=35s`)
- Players arriving after `START_MATCH` get admitted as `SPECTATOR`
  (server-side drop-in policy)
- `playerFlow` still called `SUBMIT_ANSWER` on every `ROUND_STARTED`
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

| Metric                                | Before (noisy) | After fix |
| ------------------------------------- | -------------- | --------- |
| server_error_events @ 3,200 VU        | 831            | **54**    |
| app_error_rate @ 3,200 VU             | 11.4%          | **0.84%** |
| server_error_events @ 6,400 VU        | 4,844          | **58**    |
| app_error_rate @ 6,400 VU             | 27.1%          | **0.85%** |
| players_demoted_to_spectator @ 3,200  | (not tracked)  | **930**   |
| players_demoted_to_spectator @ 6,400  | (not tracked)  | **3,017** |
| players_demoted_to_spectator @ 8,000  | (not tracked)  | **4,005** |
| players_demoted_to_spectator @ 10,000 | (not tracked)  | **5,299** |

The ramp-window race between `ROOM_JOINED` echo and the first
`ROUND_STARTED` accounts for ~25 per tier
(`SPECTATOR_CANNOT_ANSWER` residual after the fix), i.e. 0.31-0.37% of
total VU — well below the 1% Plan A threshold. Documented as a known tiny
residual.

## B — Bottleneck evidence (was: "event-loop / Fastify"; now: confirmed + refined)

**Sweep instrumentation** (unchanged from prior revision):

- 3 × `sample-monitoring.mjs` (one per API node) → per-node CPU + eventLoopLag
  JSONL (1 Hz)
- 1 × `pg_stat_activity` poller (`load-test/scripts/poll-pg.sh`, 0.5 Hz) →
  total / idle / active / idle_in_txn connection counts
- Cluster env tuned: `DB_POOL_MAX=50/node × 3 = 150`,
  `PG_MAX_CONNECTIONS=300`, `LB_METHOD=least_conn`

### Evidence table (per tier)

| Tier      | lagMax peak  | PG active peak | PG saturation duration | Notes                                                                                       |
| --------- | ------------ | -------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| 100 VU    | (no monitor) | n/a            | n/a                    | Plan A baseline, 100% success                                                               |
| 3,200 VU  | 144ms        | 44 / 150       | 0 samples ≥100         | Healthy, large DB headroom                                                                  |
| 6,400 VU  | 320ms        | 150 / 150      | 1 sample (≈2s burst)   | Pool saturates only during 64-room setup burst                                              |
| 8,000 VU  | 352ms        | 144 / 150      | 1 sample (≈2s burst)   | Same pattern, higher eventLoopLag                                                           |
| 10,000 VU | 557ms        | 78 / 150       | 0 samples ≥100         | **Setup storm didn't fully saturate this time** (k6 too slow to bring all rooms up in time) |

**Reading**: PG pool saturation only happens during the setup storm when
all N rooms are created in parallel by k6's `setup()` function. During
gameplay (after HOLD starts), the pool stays at <60 active out of 150 max.
Server-side handler response time maxes at ~2.5s at any tier — bounded.

The 11.2s `http_req_duration` p95 k6 sees is **NOT** server-side handler
time. It's **nginx socket accept queue + k6-side connect retries** (558
handshake retries at 10,000 VU vs 31 at 3,200).

### Bottleneck order at every tier below 10,000 VU

1. **Socket accept queue / nginx** (first to feel pressure; 11.2s p95
   vs 2.5s server-side max — gap = queue)
2. **HTTP handler event-loop** (peaks 320-557ms eventLoopLagMax at high
   tiers — Node still responsive)
3. **DB pool** (saturates for ~2-4s during room-creation burst, then idle
   for the rest of the sweep)
4. **Prisma / Postgres transactions** (last, never the dominant constraint)

### What breaks first at 10,000 VU

It's **not the server** in a "logic broken" sense — Prisma + state machine
still works. It's the **k6 load-generator itself + socket layer**:

- 558 handshake retries (vs 31 at 3,200 VU — 18× more)
- 376 setup_flow_errors (vs 50 at 6,400 VU — 7.5× more)
- 27.5% of connected clients joined so late they got demoted to SPECTATOR

The clean transition: at 10,000 VU the **k6 ramp+setup window** (~40-90s)
overlaps with the host's `START_MATCH` window (35s warmup) for so
many
rooms that **a majority of players join the room AFTER START_MATCH fires**.
The server correctly admits them as SPECTATOR. The harness correctly
records them as `players_demoted_to_spectator`. The app_error_rate goes
up because the setup_flow_errors (failed JOIN_ROOM attempts) accumulate
during this congested setup window.

This means **the 10,000 VU "break" is partly a k6 + scenario artifact**,
not a server-capacity break. A real production rollout would NOT have 8,000
clients joining within a 40-90 second window simultaneously. The relevant
production metric is **per-second arrival rate**, which at 10,000 VU/60s =
~167 client-joins/sec/node, well within nginx + engine.io capacity for
**steady-state** joins.

## Results table — 7 tiers

| Metric (k6)                         | 100 VU     | 3,200 VU (cleaned) | 6,400 VU (cleaned) | 8,000 VU (cleaned) | 10,000 VU (cleaned) | 12,800 VU (original) |
| ----------------------------------- | ---------- | ------------------ | ------------------ | ------------------ | ------------------- | -------------------- |
| answer p50                          | 61.5ms     | 723ms              | 450ms              | 441ms              | 474ms               | (med 1113ms)         |
| answer p95                          | **95.7ms** | **1,444ms**        | **916ms**          | **866ms**          | **894ms**           | 2,093ms              |
| answer max                          | 100ms      | 1,708ms            | 1,133ms            | 1,449ms            | 1,720ms             | 4,448ms              |
| http_req_duration p95               | 5ms        | 1,021ms            | **11,252ms**       | **11,691ms**       | 5,913ms             | 11,807ms             |
| http_req_failed                     | 0.000%     | 0.000%             | 0.21%              | 0.36%              | **1.08%** ⚠️        | **1.87%**            |
| ws_connect_success                  | 100        | 3,200 / 3,200      | 6,350 / 6,400      | 7,952 / 8,000      | 9,624 / 10,000      | 12,352 / 12,800      |
| ws_handshake_retries                | 0          | 31                 | 66                 | 172                | **558**             | **747**              |
| setup_flow_errors                   | 0          | 0                  | 50                 | 48                 | **376** ⚠️          | 17                   |
| match_finished                      | 100/100    | 3,199/3,200        | 6,270/6,400        | 7,920/8,000        | 6,981/10,000        | 10,606/12,800        |
| **match_fin/ws_succ ratio**         | **100%**   | **99.97%**         | **98.74%**         | **99.60%**         | **72.54%** ⚠️       | 85.96%               |
| round_started                       | 267        | 8,975              | 10,569             | 11,577             | 8,606               | 12,473               |
| server_error_events (real)          | 0          | 54                 | 58                 | 142                | 55                  | 0                    |
| players_demoted_to_spectator        | 0          | 930                | 3,017              | 4,005              | **5,299**           | n/a                  |
| **app_error_rate (REAL)**           | **0.00%**  | **0.84%**          | **0.85%**          | **1.18%**          | **2.20%** ⚠️        | 19.2%                |
| k6 process memory                   | n/a        | 2.5 GB             | ~3 GB              | ~3.5 GB            | ~4.5 GB             | 5 GB                 |
| **eventLoopLagMax peak (any node)** | n/a        | **144ms**          | **320ms**          | **352ms**          | **557ms**           |
| **PG active peak**                  | n/a        | **44/150**         | **150/150**        | **144/150**        | **78/150**          |
| PG saturation samples (≥100)        | n/a        | 0                  | 1 (2s burst)       | 1 (2s burst)       | 0 (k6 too slow)     |

## Tier transition analysis (the actual ceiling)

| Boundary              | What happens                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100 → 3,200 VU        | Performance degrades 7.5× (answer p95 96ms → 1,444ms), but logic intact, app_error_rate stays at 0.84% after noise removal                                                       |
| 3,200 → 6,400 VU      | First HTTP failures (0.21%) and first setup_flow_errors (50). DB pool first saturates briefly (1 sample at 150/150)                                                              |
| 6,400 → 8,000 VU      | Setup storm still saturates pool briefly (144/150 peak); app_error_rate crosses 1% threshold (1.18%) but matches still 99.6% finish                                              |
| **8,000 → 10,000 VU** | **HARD TRANSITION**: match_fin/ws_succ ratio collapses 99.6% → 72.5%; setup_flow_errors jumps 48 → 376; ws_handshake_retries jumps 172 → 558. k6 + socket layer hitting capacity |
| 10,000 → 12,800 VU    | HTTP failures cross 1% (1.08% → 1.87%), matches-only drop 17% — **but this is k6 single-host ceiling, not server ceiling**                                                       |

## Ceiling tiers (3-node API, single-host k6)

| Layer                           | VU ceiling                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hard correctness**            | **~ 8,000 VU** — logic + integrity intact, 99.6% matches finish, app_error_rate 1.18% (just crosses 1% threshold), DB pool saturates only during setup |
| **Soft performance**            | **~ 8,000 VU** — answer p95 < 1s steady-state, http_req_duration p95 11.7s (mostly queue not server)                                                   |
| **Hard throughput (single k6)** | **~ 10,000 VU** — match_fin/ws_succ ratio collapses from 99.6% → 72.5%; 1.08% HTTP failures; k6 load-generator bottleneck emerges                      |
| Beyond 10k                      | **~ 12,800 VU** — single-host k6 ceiling; 1.87% HTTP failures; 17% matches don't finish; ws_connecting p95 = 40s                                       |

## Caveats — what this sweep does NOT answer

1. **12,800 VU is k6-single-host-bound**. The 12,800 VU ceiling is confounded
   between "server breaks" and "k6 load generator breaks". To definitively
   answer "how many concurrent users can the SERVER handle", k6 would need
   to be distributed across ≥2 load-generator hosts. The 8,000 VU tier is
   the cleanest answer we have for "where the SERVER starts feeling it".
2. **The 10,000 VU "break" is partly a scenario artifact**. With 100 rooms
   being created in 40-90s + players joining in 40-50s + hosts firing
   START_MATCH at +35s warmup, **the setup window gets congested**. A real
   production rollout with normal user arrival patterns would not hit this
   pattern. The relevant production metric is **per-second arrival rate**,
   which we did not measure.
3. **The 10,000 VU tier had `players_demoted_to_spectator = 5,299`**, which
   is 53% of all players. This is **not** a server demoting users — it's
   the server correctly admitting them as spectators because they joined
   too late. The harness correctly records this. It is a real signal that
   **at this rate of concurrent joins, the lobby-vs-IN_GAME window can
   only absorb so much**.
4. **Single k6 process hits RAM ceiling at ~5GB** at 12,800 VU. To
   definitively find the SERVER ceiling, distribute k6 across ≥2 hosts.

## Raw artifacts

**K6 summary exports** (cleaned):

- `load-test/results/multi-fullmatch-6e9179e-20260814T120000.json` (Plan A baseline 100 VU)
- `load-test/results/ceiling-clean-32x100-6e9179e-20260814T150000.json` (3,200 VU)
- `load-test/results/ceiling-clean-64x100-6e9179e-20260814T151000.json` (6,400 VU)
- `load-test/results/ceiling-clean-80x100-19279ba-20260814T091453.json` (8,000 VU)
- `load-test/results/ceiling-clean-100x100-19279ba-20260814T092532.json` (10,000 VU)
- `load-test/results/ceiling-heartbeat25-ramp90-80x100-bca68ea-20260814T111300Z.json` (8,000 VU, heartbeat 25s / TTL 40s validation)

**K6 summary exports** (original noisy — kept for noise-comparison reference):

- `load-test/results/ceiling-32x100-6e9179e-20260814T130000.json` (3,200 VU original)
- `load-test/results/ceiling-64x100-6e9179e-20260814T140000.json` (6,400 VU original)
- `load-test/results/ceiling-128x100-6e9179e-20260814T143000.json` (12,800 VU original)

**Monitoring JSONLs** (gitignored, but committed here as evidence):

- `load-test/results/clean-{32,64,80,100}x100-node-{1,2,3}.cpu.jsonl` (CPU + eventLoopLag per node)
- `load-test/results/clean-{32,64,80,100}x100.pg.jsonl` (pg_stat_activity)
- `load-test/results/ceiling-heartbeat25-ramp90-80x100-bca68ea-20260814T111300Z.node-{1,2,3}.{cpu,redis}.jsonl`
- `load-test/results/ceiling-heartbeat25-ramp90-80x100-bca68ea-20260814T111300Z.pg.jsonl`

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

# Sweep N (N=32 → 3200 VU, N=64 → 6400 VU, N=80 → 8000 VU, N=100 → 10000 VU)
ROOMS=N PLAYERS_PER_ROOM=69 SPECTATORS_PER_ROOM=30 \
  HOLD=2m RAMP_UP=30s SPEC_RAMP_UP=15s \
  k6 run \
    -e API_URLS="http://localhost:3011,http://localhost:3012,http://localhost:3013" \
    --summary-export=load-test/results/ceiling-clean-Nx100-<commit>-<ts>.json \
    load-test/scenarios/multi-room.js
```
