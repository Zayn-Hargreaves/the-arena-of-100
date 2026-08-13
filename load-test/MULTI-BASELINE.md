# C1 — Multi-instance baseline runbook

Captures the **3-node "after" numbers** for the Stage D before/after table and proves the
load actually spreads across the cluster. Blast radius: load-test harness only — no app code.

> Prereq: the polished single-node harness (host-lifetime fix, benign-rejection split,
> sampler) is already on this line. The single-node **"before"** column comes from the
> `full-match-<baseline-commit>-*` artifact set produced by the `test/load-test-baseline-ed0b4ae`
> run; if only its `.cpu.jsonl`/`.redis.jsonl` samples exist, rerun the single-node scenario
> with `--summary-export` first so a summary JSON exists to quote.

## Topology

`docker-compose.multi.yml`: nginx LB `:8080` (`least_conn`, WS upgrade) → `arena-api-1/2/3`
(`INSTANCE_ID=api-1/2/3`, direct probe ports `:3011/:3012/:3013`) → shared Postgres + Redis.
`restart: "no"` on the api nodes (C3 kills one on purpose — don't auto-resurrect).

## Steps

1. **Bring up the cluster** and confirm 3 healthy nodes + the LB:

   ```bash
   pnpm docker:multi:build && pnpm docker:multi:up
   curl -fsS http://localhost:8080/api/v1/health   # LB up
   for p in 3011 3012 3013; do curl -fsS http://localhost:$p/api/v1/health >/dev/null && echo "api $p ok"; done
   ```

2. **Start monitors + distribution poller, then run k6** (background sampling must cover
   the full scenario wall time — monitors 6m / poller 4m). Commit-tag artifacts per the
   `load-test/README.md` convention `load-test/results/<scenario>-<commit>-<ts>.json`:

   ```bash
   COMMIT=$(git rev-parse --short HEAD); TS=$(date +%Y%m%dT%H%M%S)
   MONITOR_PIDS=()
   for n in 1:3011 2:3012 3:3013; do
     id=${n%%:*}; port=${n##*:}
     node load-test/scripts/sample-monitoring.mjs --scenario multi-fullmatch \
       --duration 6m --api-url http://localhost:$port \
       --out-dir load-test/results --out-name multi-fullmatch-$COMMIT-$TS.node-$id &
     MONITOR_PIDS+=($!)
   done

   node load-test/scripts/poll-distribution.mjs \
     --nodes http://localhost:3011,http://localhost:3012,http://localhost:3013 \
     --duration 4m --interval 1000 \
     --out-dir load-test/results --out-name multi-fullmatch-$COMMIT-$TS &
   POLL_PID=$!
   # exit 0 iff sockets landed on >= 2 nodes in one sample round (plus harness health);
   # writes ...-distribution.{jsonl,summary.json}

    ORCH_STATUS=0

    k6 run -e API_URL=http://localhost:8080 \
      --summary-export=load-test/results/multi-fullmatch-$COMMIT-$TS.json \
      load-test/scenarios/full-match.js
    K6_STATUS=$?
    if [ "$K6_STATUS" -eq 0 ]; then
      echo "[orchestrate] k6: PASS (exit 0)"
    else
      echo "[orchestrate] k6: FAIL (exit $K6_STATUS)"
      ORCH_STATUS=1
    fi

    if wait "$POLL_PID"; then
      echo "[orchestrate] distribution poller: PASS (exit 0)"
    else
      echo "[orchestrate] distribution poller: FAIL (exit $?)"
      ORCH_STATUS=1
    fi

    for pid in "${MONITOR_PIDS[@]}"; do
      if wait "$pid"; then
        echo "[orchestrate] monitor pid $pid: PASS (exit 0)"
      else
        echo "[orchestrate] monitor pid $pid: FAIL (exit $?)"
        ORCH_STATUS=1
      fi
    done

    exit "$ORCH_STATUS"
   ```

3. **Capture** for the Stage D table: answer p50/p95/p99, disconnect rate, messages/sec,
   per-node CPU/RSS, socket distribution. Raw artifacts stay in `load-test/results/`.

## Pass / done

- Multi-node run completes green (`app_error_rate` excludes benign rejections — see the
  load-test README); the distribution poller exits 0 (sockets on ≥ 2 nodes in one sample
  round; auth/poll errors = 0; all probe URLs covered); latency is comparable to the
  single-node baseline (some Redis adapter pub/sub overhead is expected — quantify it
  against the "before" column).
- Numbers recorded for the D1 before/after table; every figure traces back to a
  `load-test/results/` artifact.

## Artifacts produced

| File                                                      | Feeds                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `multi-fullmatch-<commit>-<ts>.json`                      | before/after table, throughput, answer p95/p99, disconnect |
| `multi-fullmatch-<commit>-<ts>.node-{1,2,3}.cpu.jsonl`    | per-node CPU/RSS chart                                     |
| `multi-fullmatch-<commit>-<ts>-distribution.jsonl`        | sockets-per-node-over-time chart                           |
| `multi-fullmatch-<commit>-<ts>-distribution.summary.json` | peak-round split + concurrent ≥2-node assertion            |

## C3 — Card-batch failover gate (Phase 3, spec §5.3)

Chaos-injects a node kill at one of three checkpoints in the
`CARD_RESOLVED` / `CARD_RESOLVED_BATCH` lifecycle:

| Checkpoint        | When                                                            | Invariant                                                         |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `append_pre_emit` | Between inner `CARD_RESOLVED` event append and outer batch emit | All persisted events surface at least once on a surviving node    |
| `mid_batch_flush` | During the ≤50 ms `CARD_RESOLVED_BATCH` micro-batch flush       | New owner must NOT double-apply any effect (dedupe by `seqNo`)    |
| `pre_ack`         | After emit sent, before the client ack                          | Recovery replays exactly the committed batch — no drops, no dupes |

The strict invariant — same across all three checkpoints:

> Every persisted `CARD_RESOLVED` (by its canonical `seqNo`) appears at
> least once in transport post-failover; no `(playerId, effectId)`
> pair is observed with two distinct `seqNos` (zombie / split-brain
> fingerprint).

### Pass / done

- `load-test/lib/card-batch-verdict.test.mjs` — 22 vitest cases pass.
  Mocks 5-effect session through the 3-checkpoint matrix plus dedupe,
  conflict, lost-effect, double-apply, and timeline-shape assertions.
  The cohort invariant (`cohort_missed` pre/post-flip, plus the
  happy-path round-trip PASS) is part of the 2026-08-12 hardening
  — keeps the chaos gate scoped to effects that MUST survive a
  failover (persisted before the kill, observed after the flip).
- Production code unchanged (Phase 2 append-first design already
  satisfies the invariant); this gate is a regression detector, not a
  fix-it-first deliverable.

### Artifacts produced

| File                                                      | Feeds                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `load-test/results/card-batch-chaos-<commit>-<ts>.json`   | Per-checkpoint timeline + observed/expected effect sets (format = oracle input) |
| (Planned) `multi-fullmatch-<commit>-<ts>.card-batch.json` | Live 3-node run inject for each checkpoint                                      |

> Note — distinct from C3-owner-failover: that gate covers the
> owner-lease flip during steady-state rounds; this gate covers a
> narrower window (mid-batch-failover) and a different dedupe key
> (effect `seqNo`, not round `eventId`). They MUST stay separated
> per spec §7 DoD.
