# D1 — Architecture narrative

**Depends on:** C1 + C3 (real numbers). **Blast radius:** docs only.
**Commit:** `docs(distributed): architecture-distributed narrative + evidence`.

## Goal

The written system-design story that turns the refactor into a portfolio/interview asset. This
is the deliverable that actually "moves the needle" per `career-assessment.md`.

## New file — `docs/architecture-distributed.md`

Sections:

1. **Problem** — single-node ceiling: timer-driven loop (`MatchRoundRunner`) holds round timers
   in-process, so a node death loses the match; Socket.IO broadcasts don't cross nodes without
   an adapter. Cite the single-node baseline (100 WS, answer p95 28ms, 0 disconnect).
2. **Target topology** — Mermaid diagram: `k6 → nginx :8080 (least_conn, WS upgrade) → api1/2/3
→ shared Postgres + Redis`. Redis plays two roles: Socket.IO adapter bus **and** owner-lease
   store. Note the `least_conn` (k6/websocket-only) vs `ip_hash` (browser/polling) choice.
3. **Cross-node fan-out** — the Redis adapter; why every `server.to(room).emit` now reaches
   members on any node; the pub/sub channel model.
4. **Owner-lease + failover** — `match:owner:<id>` = `<nodeId>:<fence>`, TTL 15s + 5s heartbeat;
   single owner drives the loop; on owner death, TTL expiry → orphan sweep → another node
   acquires and `resumeMatchLoop` rebuilds timers from persisted `phaseEndsAt`. **State the
   no-split-brain invariant only as far as the evidence carries it** — the DB unique constraint
   alone does not prove it. Substantiate the claim by enumerating the guard coverage with
   references to the implementation and verification artifacts: (a) every canonical
   `match:state` write goes through the fenced Lua CAS in `persistStateMachine` (cite the B2c
   call sites at the three mutating boundaries and the B4b apply path); (b) every Socket.IO
   emission of authoritative events follows only an `APPLIED` CAS outcome / the fenced
   side-effect outbox (B2c item 3, B4b `fencedSideEffects`); (c) timer callbacks are gated by
   `assertOwnership` at `endRound` / `checkMatchEnd` / `finishMatchLoopInner` (B2c); (d) Redis
   side effects (command-stream acks, presence-leader mutations) validate their fence in the
   same atomic op (B4a consume contract, B5 per-mutation CAS). Cite the specs that verify each
   layer (B2c/B4b integration tests, B5 mid-sweep demotion test) and the C3 oracle's
   fence-checked, deduplicated round sequence as the runtime evidence. **If any transition,
   emission, timer, or Redis side effect is not demonstrably covered by those artifacts, do not
   claim the absolute invariant** — state the narrower, evidenced claim (e.g. "no unfenced
   canonical `match:state` write; broadcasts only on APPLIED") and list the uncovered paths
   explicitly, with the DB unique constraint described as a backstop, not the proof. Then
   describe single-writer answers.
5. **Measured evidence** (the payoff):
   - **Before/after table**: single-node vs 3-node — throughput (msgs/s), answer p95/p99,
     disconnect rate, per-node CPU/RSS, socket distribution.
   - **Distribution chart**: sockets-per-node over time.
   - **Failover timeline** (centerpiece): `t_match_started → t_kill → t_recover → MATCH_FINISHED`
     with `time_to_recover` annotated; overlay answer-latency showing the bounded spike +
     recovery; a round-index step chart proving monotonic advance with no duplicate across the kill.
   - **Reconnect stats**: success %, p95.
6. **Trade-offs & limits** — `least_conn` vs `ip_hash` (single-IP k6 caveat, browser polling);
   Redis as SPOF → note Sentinel/cluster as future work; lease-TTL vs recovery-time tension;
   adapter pub/sub overhead measured in C1.

## Charts

Every figure names its **source artifact and the exact fields it plots** — no number appears in
the doc without a file it can be recomputed from:

- **Before/after table + throughput + answer p95/p99 + disconnect/reconnect stats** ← the k6
  `--summary-export` JSONs, both named per the load-test convention
  `load-test/results/<scenario>-<commit>-<ts>.json` (see `load-test/README.md` §artifacts):
  the **"after"** column from the C1 multi-node run
  (`load-test/results/multi-fullmatch-<commit>-<ts>.json`) and the **"before"** column from the
  **single-node baseline export `load-test/results/full-match-<baseline-commit>-<ts>.json`**
  (currently the `full-match-ed0b4ae-*` artifact set from the `test/load-test-baseline-ed0b4ae`
  run; if only its `.cpu.jsonl`/`.redis.jsonl` samples exist, rerun the single-node scenario with
  `--summary-export` to produce the summary JSON before quoting numbers). Fields: messages/sec,
  `answer_latency` `p(95)`/`p(99)`, unexpected disconnect rate, and C2's `reconnect_ms` (Trend) /
  `reconnect_success` (Rate) metrics.
- **Failover timeline (centerpiece)** ← `load-test/results/failover-<commit>-<ts>.failover.json`
  (the C3 schema): `t_match_started`, `t_kill`, `t_owner_flip`, `t_recover`,
  `time_to_recover_ms`, `owner_before`/`owner_after` **including fences**, `rounds_before/after`
  - `duplicate_round_check` (the pass/fail summary), `match_finished`. Overlay the
    answer-latency series around `t_kill` (`answer_p95_failover_ms` vs `steady_state_p95_ms`)
    for the bounded-spike annotation. **The round-index step chart plots the artifact's
    `round_events` array** — the deduplicated ROUND_STARTED sequence with one
    `{t, eventId, roundIndex, fence}` entry per event that the C3 oracle evaluated — x = `t`,
    y = `roundIndex`, colored by `fence` to make the ownership handover visible. Do NOT try to
    reconstruct the chart from `duplicate_round_check`'s counts/violations alone; the sequence
    itself is the source.
- **Sockets-per-node over time (distribution chart)** ← the C1 distribution poller's JSONL
  (`load-test/results/<run>-distribution.jsonl`, one `{ts, nodeId, socketCount}` per line).
- **Per-node CPU/RSS** ← the `scripts/sample-monitoring.mjs` per-node JSONL outputs
  (`cpuUsage`, `rssBytes`/`totalMemBytes` fields).

If any of these artifacts is missing for a claimed number, produce the artifact first (rerun
C1/C3) rather than quoting the number unsourced. Generate the figures with a small Node script
in the style of `load-test/scripts/validate-results.mjs` (no extra deps), or as an
Artifact/HTML if a richer visual is wanted. Keep the raw artifacts linked next to each figure
so every number is auditable.

## Cross-updates

- Update `memory-bank/progress.md` + `activeContext.md`: mark the distributed vertical done,
  record the P2 decision update (distribution demonstrated, not just deferred).
- Link this doc from the repo README / `docs/PROJECT_STATUS.md`.

## Done

- `docs/architecture-distributed.md` complete with the diagram, before/after table, and failover
  timeline sourced from real artifacts; memory-bank updated.
