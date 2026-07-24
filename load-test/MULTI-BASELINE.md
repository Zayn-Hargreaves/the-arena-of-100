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

2. **Run the standard scenario against the LB** (no scenario edits — `API_URL` is parameterized).
   Commit-tag the artifacts per the `load-test/README.md` convention
   `load-test/results/<scenario>-<commit>-<ts>.json`:

   ```bash
   COMMIT=$(git rev-parse --short HEAD); TS=$(date +%Y%m%dT%H%M%S)
   k6 run -e API_URL=http://localhost:8080 \
     --summary-export=load-test/results/multi-fullmatch-$COMMIT-$TS.json \
     load-test/scenarios/full-match.js
   ```

3. **Per-node monitoring** — one `sample-monitoring.mjs` per node against its DIRECT port
   (distinct `--out-name`), plus one for Redis. Gives per-node CPU/RSS + `match:state:*`:

   ```bash
   for n in 1:3011 2:3012 3:3013; do
     id=${n%%:*}; port=${n##*:}
     node load-test/scripts/sample-monitoring.mjs --scenario multi-fullmatch \
       --duration 6m --api-url http://localhost:$port \
       --out-dir load-test/results --out-name multi-fullmatch-$COMMIT-$TS.node-$id &
   done
   ```

4. **Distribution poller** — proves sockets land on ≥ 2 nodes (cross-node placement). Reads the
   ADMIN-protected `GET /api/v1/health/cluster` on each direct port and records
   `{ts, nodeId, socketCount}` per sample. The ADMIN JWT is supplied via env
   `CLUSTER_HEALTH_ADMIN_JWT` (or minted locally from `--jwt-secret`) and is **never** written
   into any artifact/log; 401/403 land in a separate `auth_failures` counter, never in socket
   data. D1's sockets-per-node chart reads the `-distribution.jsonl`:

   ```bash
   node load-test/scripts/poll-distribution.mjs \
     --nodes http://localhost:3011,http://localhost:3012,http://localhost:3013 \
     --duration 4m --interval 1000 \
     --out-dir load-test/results --out-name multi-fullmatch-$COMMIT-$TS
   # exit 0 iff sockets landed on >= 2 nodes; writes ...-distribution.{jsonl,summary.json}
   ```

5. **Capture** for the Stage D table: answer p50/p95/p99, disconnect rate, messages/sec,
   per-node CPU/RSS, socket distribution. Raw artifacts stay in `load-test/results/`.

## Pass / done

- Multi-node run completes green (`app_error_rate` excludes benign rejections — see the
  load-test README); the distribution poller exits 0 (sockets on ≥ 2 nodes); latency is
  comparable to the single-node baseline (some Redis adapter pub/sub overhead is expected —
  quantify it against the "before" column).
- Numbers recorded for the D1 before/after table; every figure traces back to a
  `load-test/results/` artifact.

## Artifacts produced

| File                                                      | Feeds                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `multi-fullmatch-<commit>-<ts>.json`                      | before/after table, throughput, answer p95/p99, disconnect |
| `multi-fullmatch-<commit>-<ts>.node-{1,2,3}.cpu.jsonl`    | per-node CPU/RSS chart                                     |
| `multi-fullmatch-<commit>-<ts>-distribution.jsonl`        | sockets-per-node-over-time chart                           |
| `multi-fullmatch-<commit>-<ts>-distribution.summary.json` | per-node peak split + ≥2-node assertion                    |
