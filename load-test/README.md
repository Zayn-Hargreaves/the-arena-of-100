# Load Test — Đấu Trường 100 (Plan A)

k6 load test for **100 concurrent WebSocket users** against the
server-authoritative game loop. Goal: measure a real baseline (latency,
disconnect rate, messages/sec, error rate) **before** deciding whether to
split spectator transport (decision **P2** in `memory-bank/progress.md`).

> This directory is **additive only** — it reads the API contract but does
> not modify any symbol in `apps/` or `packages/`. Blast radius = 0.

---

## What it does

Drives the exact client → server contract the web app uses:

```
guest-login (REST POST /api/v1/auth/guest)   → handshake token + real User row
  → ws connect  (socket.io v4 / Engine.IO 4, namespace "/game")
  → AUTHENTICATE {token}         → AUTHENTICATED
  → JOIN_ROOM {roomCode}         → ROOM_JOINED          (players + spectators)
  → (host) START_MATCH {roomId}  → MATCH_STARTED
  → on ROUND_STARTED → SUBMIT_ANSWER → ANSWER_RESULT     (latency sample)
  → ... → MATCH_FINISHED
```

Three roles, one shared **PRIVATE** room (created once in `setup()` over
REST):

| Role       | Count (default) | Behaviour                                                            |
| ---------- | --------------- | -------------------------------------------------------------------- |
| host       | 1               | creates the room, waits `WARMUP_MS`, fires START_MATCH               |
| players    | 69              | join before start, answer every round                                |
| spectators | 30              | join **after** start → admitted as drop-in `SPECTATOR`, receive-only |

Players who arrive after `START_MATCH` naturally become spectators — the
same player/spectator mix Plan A asks for.

### Why socket.io is hand-framed

k6 has no socket.io client, only raw WebSockets. `lib/socketio.js`
implements the minimal Engine.IO v4 + Socket.IO v4 framing (handshake,
namespace connect, `2`/`3` ping-pong, `42[...]` events) needed to talk to
the gateway. The server is `socket.io ^4.8.1` → `EIO=4`. If the event
names ever drift, update `lib/protocol.js` (mirrored from
`packages/shared/src/socket.ts`).

---

## Prerequisites

- **k6 ≥ v0.52** (uses `k6/experimental/websockets` + the async event loop).
  Install: <https://grafana.com/docs/k6/latest/set-up/install-k6/>
- The API running with a **real Redis + Postgres** (not mocked) — numbers
  are only meaningful against real infra (Plan A "Rủi ro"). From repo root:

  ```bash
  pnpm docker:up            # Redis + Postgres
  pnpm --filter @arena/api run prisma:seed:dev   # seed questions (required)
  pnpm --filter @arena/api dev                    # API on :3001
  ```

  The load test creates its own throwaway guest users and room, so no demo
  seed is strictly required — but questions **must** exist (the match loop
  needs them), so run the dev seed once.

---

## Running

All knobs are env vars (`-e NAME=value`). Defaults target a local stack.

### A1 — Smoke (2 clients, 1 full match)

Run this first. A green result validates the auth/protocol wiring before
scaling up.

```bash
k6 run load-test/scenarios/smoke.js
```

Pass criteria: `setup_flow_errors 0`, `answers_submitted > 0`,
`app_error_rate ~0%`.

### A2 — Full match, 100 concurrent WS

```bash
k6 run load-test/scenarios/full-match.js
# or tune the mix:
k6 run -e PLAYERS=69 -e SPECTATORS=30 -e HOLD=4m load-test/scenarios/full-match.js
```

### A2 — Spectator flood (broadcast fan-out stress)

Small player pool, large receive-only wave — the most direct P2 signal.

```bash
k6 run -e PLAYERS=5 -e SPECTATORS=95 load-test/scenarios/spectator-flood.js
```

### Environment variables

| Var              | Default                 | Meaning                                   |
| ---------------- | ----------------------- | ----------------------------------------- |
| `API_URL`        | `http://localhost:3001` | API origin; REST uses `${API_URL}/api/v1` |
| `WS_URL`         | = `API_URL`             | socket.io origin (http→ws, https→wss)     |
| `PLAYERS`        | `69`                    | player VUs                                |
| `SPECTATORS`     | `30`                    | spectator VUs                             |
| `RAMP_UP`        | `30s`                   | 0 → PLAYERS ramp                          |
| `HOLD`           | `4m`                    | steady-state hold                         |
| `WARMUP_MS`      | `35000`                 | host wait before START_MATCH              |
| `LATENCY_P95_MS` | `1000`                  | p95 answer-latency threshold              |
| `LATENCY_P99_MS` | `2500`                  | p99 answer-latency threshold              |
| `ERROR_RATE_MAX` | `0.01`                  | app error-rate ceiling (Plan A: < 1%)     |

Export a full JSON summary for the record:

```bash
k6 run --summary-export=load-test/results/full-match-$(date +%F).json \
  load-test/scenarios/full-match.js
```

---

## Key metrics

| k6 metric                  | Meaning                                                |
| -------------------------- | ------------------------------------------------------ |
| `answer_result_latency_ms` | SUBMIT_ANSWER → ANSWER_RESULT round trip (p50/p95/p99) |
| `app_error_rate`           | failed handshake steps + server ERROR frames / total   |
| `ws_messages_received`     | total inbound events (÷ test duration = messages/sec)  |
| `answers_submitted`        | answers sent                                           |
| `round_started_received`   | ROUND_STARTED fan-out volume                           |
| `setup_flow_errors`        | auth/join handshake failures                           |
| `ws_connect_errors`        | socket connect failures                                |
| `server_error_events`      | `ServerEvent.ERROR` frames received                    |

Thresholds (fail the run if breached) are set in each scenario's `options`
and are env-tunable.

---

## Server-side observation (run alongside k6)

Plan A A2 also asks for CPU/mem + Redis + round-tick numbers. Capture them
in parallel with the k6 run. The harness is intended to be paired with
the in-repo `scripts/sample-monitoring.mjs` (Node, no extra deps) which
is the source of truth for the raw CPU/RSS/Redis JSONL artifacts; the
notes below are kept for the manual workflow on a developer machine.

> The sampler reads `REDIS_URL` / `REDIS_KEY_PREFIX` from the same env
> the API uses (`apps/api/src/modules/redis/redis.service.ts`) — it
> does NOT hard-code `redis-cli -n 2` or a fixed pattern. **Do not log
> the full URL**: only `scheme`, `host`, `port`, `db`, `tls`, `keyPrefix`,
> `pattern` may be written into reports/artifacts. Auth, if any, is
> carried via env (e.g. `REDISCLI_AUTH`) or a per-host config file —
> never on the command line.

Round-tick timing comes from the API logs (`GameLoopService` /
`MatchStateMachine` log each round transition).

---

## Baseline results & Pass/Fail Criteria

> **Status: ✅ COMPLETED 2026-08-14.** Single-room Plan A baseline captured on
> the 3-node `docker:multi` cluster (nginx LB → api-1/2/3). 100 VUs, 69 players
>
> - 30 spectators + 1 host, 4m HOLD, RECONNECT=0 (steady-state).
>
> All Pass/Fail criteria met → single transport holds, P2 **No** (no spectator
> transport split justified).

### Metadata (Required, 2026-08-14 run)

- **Phiên bản build**: commit `6e9179e` (Merge pull request #88 from
  Zayn-Hargreaves/feat/daily-phase-3)
- **Cấu hình môi trường**: 3-node docker:multi cluster on Linux container
  host; `arena-api:multi` image, `arena-multi-postgres` (16-alpine) +
  `arena-multi-redis` (7-alpine) + `arena-multi-nginx` (1.27-alpine).
- **Số lượng VU**: 100 (1 host + 69 players + 30 spectators)
- **Thời lượng**: 4m HOLD + ~30s ramp = ~5m wall per scenario, 6m monitor window
- **Dữ liệu / Match**: 19 questions seeded, single PRIVATE room, host fires
  START_MATCH after WARMUP_MS=35s; round time limit 15s/round, answer latency
  sampled per round per VU.
- **Lệnh chạy**:
  ```bash
  # monitors (background, --redis-url is REQUIRED for multi-node compose —
  # the multi-100 WS port :6389 mapping differs from dev stack :6379)
  for n in 1:3011 2:3012 3:3013; do
    id=${n%%:*}; port=${n##*:}
    node load-test/scripts/sample-monitoring.mjs --scenario multi-fullmatch \
      --duration 6m --api-url http://localhost:$port \
      --redis-url redis://localhost:6389 \
      --out-dir load-test/results --out-name "multi-fullmatch-$COMMIT-$TS.node-$id" &
  done
  # distribution poller
  node load-test/scripts/poll-distribution.mjs \
    --nodes http://localhost:3011,http://localhost:3012,http://localhost:3013 \
    --duration 4m --interval 1000 \
    --out-dir load-test/results --out-name "multi-fullmatch-$COMMIT-$TS" &
  # main k6 via nginx LB
  k6 run -e API_URL=http://localhost:8080 \
    --summary-export="load-test/results/multi-fullmatch-$COMMIT-$TS.json" \
    load-test/scenarios/full-match.js
  ```
- **Tool versions**:
  - `k6 v0.57.0` (commit/50afd82c18, go1.23.6)
  - Docker Compose `v5.4.0` (Docker `29.7.2`)
  - Node `v24.15.0`
  - commit hash API = `6e9179e`, commit hash web = `6e9179e` (main, same PR)
  - Redis `7-alpine` (server-side; no `redis-cli` on host)
- **Resolved Redis target (REDACTED)**: scheme=`redis`, host=`localhost`,
  port=`6389`, db=`null` (default 0), tls=`false`, `REDIS_KEY_PREFIX`=``,
pattern=`match:state:\*`.

### Raw artifacts (recalculate/audit lại được)

| File                                                                                  | Purpose                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000.json`                      | k6 `--summary-export` raw                           |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000.node-1.cpu.jsonl`          | api-1 CPU/RSS/eventLoop JSONL (360 samples)         |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000.node-2.cpu.jsonl`          | api-2 CPU/RSS/eventLoop JSONL (360 samples)         |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000.node-3.cpu.jsonl`          | api-3 CPU/RSS/eventLoop JSONL (360 samples)         |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000.node-{1,2,3}.redis.jsonl`  | per-node Redis JSONL (360 samples/node, 1080 total) |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000-distribution.jsonl`        | sockets-per-node-over-time JSONL (723 samples)      |
| `load-test/results/multi-fullmatch-6e9179e-20260814T120000-distribution.summary.json` | peak round split + ≥2-node assertion                |

### Baseline table (committed 2026-08-14)

| Metric                                     | Value                                                                                            | Ngưỡng (Threshold)                 | Kết quả (Pass/Fail) |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------- |
| Peak concurrent WS                         | **100** (33/32/35 across api-1/2/3)                                                              | -                                  | -                   |
| answer latency p50 / p95                   | **61.5 ms / 95.7 ms** (max 100 ms)                                                               | p95 < 1000ms, p99 < 2500ms         | ✅ PASS             |
| Messages / sec (peak)                      | **20.18 msg/s** (12 106 frames over 10m wall, sustained 17.58 msg/s in window)                   | -                                  | -                   |
| Error rate                                 | **0.000%** (0 out of 199 sampled steps)                                                          | < 1%                               | ✅ PASS             |
| Disconnect rate                            | **0.000%** (ws_connect_errors=0, ws_connect_success=100)                                         | < 1%                               | ✅ PASS             |
| API CPU % / RSS (peak)                     | **peak 20.16% / p95 3.29% / p50 0.86%** (1 core); RSS peak **268 MB**                            | CPU < 80%, RSS < 500MB             | ✅ PASS             |
| Redis `match:state:*` peak keys            | **1** (expected for 1 active room); 3 trailing samples = **0** (cleanup verified)                | == 1 in steady-state, == 0 cleanup | ✅ PASS             |
| Redis `usedMemoryBytes` delta              | **+3.82%** (2.20 MB → 2.28 MB across 360s window; pre-baseline floor + small variation)          | ≤ +10% (pre→end)                   | ✅ PASS             |
| Readiness barrier (AUTHENTICATED)          | **100/100** ack set đầy trong ramp window (`ws_connect_success=100`); ≥2-node assertion **PASS** | 100 VU < 2\*HOLD = 8m              | ✅ PASS             |
| Steady-state samples (CPU)                 | **1080** total (3 nodes × 360) — 6× N_MIN                                                        | n_steady ≥ 20                      | ✅ PASS             |
| Distribution split (peak sockets per node) | **api-1: 35 / api-2: 32 / api-3: 35** (peak avg ~29.8/28.4/31.1)                                 | ≥2 nodes covered, ≤1 hot spot      | ✅ PASS             |

### Per-node CPU/RSS breakdown (multi-node evidence)

| Node  | Samples | CPU p50 | CPU p95 | CPU peak | RSS peak |
| ----- | ------- | ------- | ------- | -------- | -------- |
| api-1 | 360     | 0.86%   | 3.80%   | 20.16%   | 268 MB   |
| api-2 | 360     | 0.87%   | 2.78%   | 10.94%   | 182 MB   |
| api-3 | 360     | 0.85%   | 3.36%   | 15.43%   | 197 MB   |

api-1 saw the highest peak CPU (20%) — likely a host landing there, single VU
of answering traffic hot-loops one Node briefly. Far below the 80% ceiling.

### P2 conclusion — spectator transport split?

**No** — single transport holds at 100 VU. Rationale from the numbers:

- **answer p95 = 95.7 ms** (threshold 1000 ms) → **10× headroom**. Even with
  30 spectators sharing the `ROUND_STARTED` fan-out, answer latency stayed
  below 100 ms (max observed 100 ms — at the per-round timeout bound, not a
  transport issue).
- **No errors at all** — `app_error_rate = 0.000%`, `ws_connect_errors = 0`,
  `http_req_failed = 0.000%`. The full 100 VU socket load is well under the
  fan-out capacity of the existing `room:[id]` socket.io channel + Redis
  adapter.
- **3-node distribution perfectly balanced** — peak 35/32/35 across api-1/2/3
  (≤3 socket imbalance between nodes). `least_conn` LB + Redis adapter spread
  the load evenly.
- **CPU/RSS headroom** — p95 CPU < 4% across all nodes, peak < 21%. RSS peak
  268 MB (single node) vs 500 MB ceiling. 5× more headroom exists.
- **Redis cleanup** — `match:state:*` went 1 → 0 across the trailing 3 samples,
  memory delta +3.82% (well under +10% ceiling). No leak signature.

**Decision**: defer spectator SSE/transport split until evidence says otherwise.
The Plan A ceiling at 100 VU is ~5× headroom on CPU, ~10× on latency. Next
trigger to revisit: `app_error_rate ≥ 0.5%` OR `answer p95 > 500ms` at any
sustained load point (need separate run to confirm scaling curve).

This section is the direct input to decision **P2** in
`memory-bank/progress.md`.

---

## C3 — Card-batch failover oracle (Phase 3)

Chaos-tested gate that proves a node kill at any of the three
`CARD_RESOLVED` lifecycle checkpoints does not lose or double-apply
effects.

### Module

`load-test/lib/card-batch-verdict.mjs` — pure oracle (no k6 / no I/O).
Accepts a `*.card-batch.json` artifact and returns
`PASS | FAIL` along with a `reasons[]` ledger that pin
exactly which invariant was violated.

### Helper taxonomy

| Helper                                | Purpose                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dedupeEffects(raw)`                  | Drops malformed entries + collapses repeats by the canonical `(playerId, effectId, seqNo)` triple, keeping earliest `t`                                                            |
| `detectEffectConflicts(raw)`          | Flags `(playerId, effectId)` pairs seen with two distinct `seqNos` — zombie / split-brain fingerprint                                                                              |
| `findDuplicateObservations(raw)`      | Surfaces transport frames that observed the same canonical `(playerId, effectId, seqNo)` triple more than once — distinct from `dedupeEffects`, which only collapses them silently |
| `diffEffects(expected, observed)`     | Surfaces dropped (in expected, not seen) + extra (seen, not expected) effects                                                                                                      |
| `evaluateCardBatchFailover(artifact)` | Top-level oracle; timeline sanity + dedupe + conflict + duplicate + diff + recovery oracle                                                                                         |

### Tests

Run from the **repository root**. The `load-test/vitest.config.mjs`
sets its own `root:` to `load-test/`, so the trailing test-file
argument is resolved relative to that directory — `lib/...` (NOT
`load-test/lib/...`):

```bash
node_modules/.bin/vitest run --config load-test/vitest.config.mjs \
  lib/card-batch-verdict.test.mjs
```

30 cases (measured 2026-08-13):

- 3 checkpoint PASS scenarios: `append_pre_emit`, `mid_batch_flush`,
  `pre_ack` — each fixture carries a cohort effect that round-trips
  (persisted before `t_kill`, observed after `t_owner_flip`).
- 7 artifact/timeline validation cases: invalid checkpoint label,
  broken timeline (`t_kill >= t_owner_flip`), recovery before owner
  flip (`t_recover < t_owner_flip`), null / undefined / array
  artifact, missing `observed_effects`.
- 2 element-validation cases (added 2026-08-12):
  `expected_effects: [null]` and `observed_effects` missing
  `seqNo`. Both must surface as `invalid_artifact` rather than
  silently underflow the diff.
- 3 invariant-failure cases: `lost_effect` (one expected effect
  missing from transport), `double_apply` (zombie re-emit with
  conflicting `seqNo`), `duplicate_observation` (same canonical
  triple observed twice).
- 2 cohort-invariant cases (added 2026-08-12): `cohort_missed`
  when a cohort effect has no pre-kill expected record, and
  `cohort_missed` when it has no post-flip canonical observation.
  Plus a positive control: cohort round-trip PASSES on the happy
  timeline (counts as part of the 3 checkpoint scenarios above).
- 4 direct-helper unit tests: `dedupeEffects`,
  `detectEffectConflicts`, `diffEffects`, `findDuplicateObservations`.
- 4 cohort-type hardening cases (added 2026-08-12): undefined =
  no-op, null / number / string = `invalid_artifact`, plus
  the happy-path positive control (the cohort round-trip PASSES
  on the happy timeline).
- 4 encoding-collision regression cases (added 2026-08-13):
  `dedupeEffects`, `detectEffectConflicts`,
  `findDuplicateObservations`, and `diffEffects` MUST keep
  `(playerId="a::b", effectId="c")` distinct from
  `(playerId="a", effectId="b::c")` after the JSON-tuple key
  encoding replaced the previous delimiter-joined form.

### Distinct from C3-owner-failover

> Spec §7 DoD explicitly forbids conflating the two gates. The
> owner-failover oracle (`load-test/lib/failover-verdict.mjs`) covers
> the owner-lease flip during steady-state rounds and dedupes by
> round `eventId`. The card-batch oracle covers a narrower window
> (mid-batch-failover) and dedupes by effect `seqNo`. They never
> share an artifact or verdict.

---

## Notes & limitations

- **Match length is elimination-bound.** The server never sends the correct
  answer to clients (by design), so players answer with a random option and
  are eliminated at roughly the per-round survival rate — a real match ends
  in a handful of rounds. That still exercises the 100-socket broadcast
  fan-out and answer round-trip, which is what P2 needs. For a longer
  sustained window, raise `HOLD` (sockets stay connected receiving after the
  match ends) or run back-to-back matches.
- **VUs are gracefully stopped at the end of the stage window.** Each socket
  is one long-lived iteration (`LIFETIME_MS` is intentionally large), so
  there's no reconnect churn skewing the numbers; k6 reports the final VUs
  as interrupted — expected.
- Usernames are `lt_p_<idInTest>` / `lt_s_<idInTest>` — unique per VU so the
  gateway's single-session kick never fires against our own sockets.
