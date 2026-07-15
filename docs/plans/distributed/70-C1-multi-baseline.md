# C1 — Multi-instance baseline (measurement)

**Depends on:** B-stages merged (a correct multi-node system). **Blast radius:** load-test
harness only. **Commit:** `test(distributed): C1 multi-instance baseline`.

> Uses the load-test harness. NOTE: the polished harness (host-lifetime fix,
> benign-rejection split, sampler) lives on branch `test/load-test-baseline-ed0b4ae`.
> Rebase/merge that onto the distributed line first, or cherry-pick `load-test/`.

## Goal

Capture the 3-node numbers and prove the load actually spreads — the "after" column of the
before/after table in Stage D.

## Steps

1. `pnpm docker:multi:build && pnpm docker:multi:up`. Confirm 3 nodes healthy + LB :8080.
2. Run the existing scenarios against the LB (no scenario edits — `API_URL` is parameterized):
   ```bash
   k6 run -e API_URL=http://localhost:8080 --summary-export=load-test/results/multi-fullmatch-<commit>-<ts>.json \
     load-test/scenarios/full-match.js
   ```
3. **Per-node monitoring:** run `scripts/sample-monitoring.mjs` once per node against the direct
   ports (`--api-url http://localhost:3011`, `3012`, `3013`, distinct `--out-name`) to get
   per-node CPU/RSS, plus one for Redis (`match:state:*`, adapter memory).
4. **Distribution assertion:** during the hold, poll each node's
   `GET /api/v1/health/cluster` (the exact protected route — it requires a JWT carrying the
   **ADMIN role**; it is NOT public) and read `.socketCount` (a tiny loop in an orchestrator
   script or inline). Authenticate with `Authorization: Bearer $CLUSTER_HEALTH_ADMIN_JWT`,
   supplied to the orchestrator via an **environment variable / secret** — the token must
   **never be written into `load-test/results/` artifacts, logs, or the JSONL samples**.
   Record each sample as a JSONL line `{ts, nodeId, socketCount}` in
   `load-test/results/<run>-distribution.jsonl` (D1's sockets-per-node chart reads this).
   Record 401/403 responses in a **separate `auth_failures` counter** — an auth failure is a
   harness problem, not a distribution sample, and must never be counted as (or averaged into)
   socket-count data. Assert sockets landed on **≥ 2 nodes** (proves cross-node), and record
   the per-node split.
5. Capture: answer p50/p95/p99, disconnect rate, messages/sec, per-node CPU/RSS, socket
   distribution. Store raw artifacts in `load-test/results/` (same convention as the Plan A baseline).

## Pass / done

- Multi-node run completes green (app_error_rate excludes benign rejections — see the load-test
  README); sockets spread across ≥2 nodes; latency comparable to the single-node baseline
  (some overhead from the adapter pub/sub is expected — quantify it).
- Numbers recorded for the Stage D before/after table.
