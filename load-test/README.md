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

## Baseline results & Pass/Fail Criteria ← fill after a real run

> **Status: NOT YET RUN.** The harness is validated (`k6 inspect` parses all
> three scenarios; smoke reaches `setup`), but no baseline has been captured
> because it needs a live Redis + Postgres stack. Fill this table from a real
> run, then update `memory-bank/progress.md` and write the P2 conclusion below.

### Tiêu chí Pass/Fail định lượng (Pass/Fail Criteria):

- **Error Rate**: `app_error_rate` < 1%
- **Latency**: p95 answer latency < 1000ms, p99 answer latency < 2500ms
- **Disconnect Rate**: `ws_unexpected_disconnect / ws_connect_success` < 1%
  (`ws_connect_success = 0` ⇒ fails the threshold, not 0%)
- **CPU & Memory** (steady-state):
  peak CPU ≤ 80% (sampled per second),
  p95 CPU ≤ 70%,
  peak RSS ≤ 500 MB,
  RSS delta cleanup ≤ +50 MB.
  **CPU convention**: `%` = `% of 1 core`; `200%` = 2 fully loaded cores.
- **Redis**:
  `match:state:*` count == expected at every steady-state sample
  (A2 full-match = 1),
  3 trailing cleanup samples == 0 (or baseline),
  `usedMemoryBytes(cleanup_window_end) − usedMemoryBytes(pre_run_baseline)`
  ≤ +10%.
- **Readiness**: 100 VU `AUTHENTICATED` ack set đầy trong `2 * HOLD`,
  VU ID là `exec.vu.idInTest` (không dùng `idInInstance`).
- **Steady-state**: `HOLD_MIN = max(30s, parsed HOLD)`;
  `N_MIN = max(20, ceil(HOLD_MIN))` mẫu CPU hợp lệ trong steady-state.

_Lưu ý: Chỉ kết luận P2 (có cần spectator transport split hay không) khi toàn bộ các tiêu chí định lượng trên đều đạt._

### Metadata bắt buộc để tái lập kết quả (Required Metadata):

- **Phiên bản build**: [Commit Hash hoặc Tag]
- **Cấu hình môi trường**: [Thông số phần cứng CPU/RAM, Hệ điều hành, phiên bản Node.js & Redis]
- **Số lượng VU**: [Số lượng Virtual Users đồng thời, mặc định 100]
- **Thời lượng**: [Tổng thời gian chạy test]
- **Dữ liệu / Match**: [Số câu hỏi mỗi trận, số người chơi thật, số spectator]
- **Lệnh chạy**: [Lệnh k6 đầy đủ được sử dụng]
- **Tool versions**: `k6 --version`, `redis-cli --version`,
  commit hash API, commit hash web, `node --version` của sampler.
- **Resolved Redis target (REDACTED)**: scheme / host / port / db /
  tls / `REDIS_KEY_PREFIX` / scan pattern. KHÔNG ghi `REDIS_URL` nguyên
  bản, userinfo, password, token vào README hoặc raw artifact.

### Raw artifacts bắt buộc (để bất kỳ tiêu chí nào ở trên đều có thể recalculate/audit lại):

- `load-test/results/<scenario>-<commit>-<ts>.json` — k6 `--summary-export` raw.
- `load-test/results/<scenario>-<commit>-<ts>.cpu.jsonl` — CPU/RSS JSONL
  (mỗi dòng: `ts`, `cpu`, `rssBytes`, `totalMemBytes`, `roomCount`, optional `error`).
- `load-test/results/<scenario>-<commit>-<ts>.redis.jsonl` — Redis JSONL
  (mỗi dòng: `ts`, `usedMemoryBytes`, `connectedClients`, `keyCount`,
  `pattern`, `db`, `redisUrl` đã redacted).
- Validator chạy `scripts/validate-results.mjs` xuất
  `load-test/results/<scenario>-<commit>-<ts>.report.json` +
  `<scenario>-<commit>-<ts>.report.md` (pass/fail + anchor timestamps).

Mọi giá trị p95/peak/delta trong bảng "Baseline results" PHẢI truy
ngược được về raw artifact (đường dẫn + số dòng / timestamp).

| Metric                                            | Value | Ngưỡng (Threshold)             | Kết quả (Pass/Fail) |
| ------------------------------------------------- | ----- | ------------------------------ | ------------------- |
| Peak concurrent WS                                |       | -                              | -                   |
| answer latency p50 / p95 / p99                    |       | p95 < 1s, p99 < 2.5s           |                     |
| Messages / sec (peak)                             |       | -                              | -                   |
| Error rate                                        |       | < 1%                           |                     |
| Disconnect rate (unexpected / ws_connect_success) |       | < 1%                           |                     |
| API CPU % / RSS (peak)                            |       | CPU < 80% (1 core), RSS < 500M |                     |
| Redis `match:state:*` peak keys                   |       | Phải dọn dẹp sạch              |                     |
| Redis `usedMemoryBytes` delta                     |       | ≤ +10% (pre→end)               |                     |
| Readiness barrier (AUTHENTICATED)                 |       | 100 VU < 2\*HOLD               |                     |
| Steady-state samples (CPU)                        |       | n_steady ≥ 20                  |                     |

### P2 conclusion — spectator transport split? ← fill after a run

- **Do we need it?** ☐ Yes ☐ No — _rationale from the numbers above._
- Evidence: e.g. "p95 answer latency stayed under Xms with 95 receive-only
  spectators sharing the ROUND_STARTED fan-out, error rate Y% → single
  transport holds" **or** "latency degraded past the threshold at N
  spectators → split justified."

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
