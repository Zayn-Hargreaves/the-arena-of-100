# C3 — Failover chaos test (the centerpiece)

**Depends on:** C2 + all of Stage B. **Blast radius:** load-test harness only.
**Commit:** `test(distributed): C3 node-kill failover chaos test`.

## Goal

Automated proof that a match survives its owner node being killed mid-flight. Produces the
failover timeline that anchors the Stage D narrative.

## New file — `load-test/scenarios/failover-match.js`

A trimmed `full-match` variant: fewer VUs (`PLAYERS=40 SPECTATORS=20`), longer `HOLD` so the
match spans the kill window, players/spectators use the C2 reconnect wrapper. Points at
`API_URL=http://localhost:8080`.

## New file — `load-test/scripts/chaos-failover.mjs` (Node orchestrator, outside k6)

Sequence:

1. Start `sample-monitoring.mjs` per node + Redis; start `coordinator.mjs` (readiness sidecar).
2. Spawn `k6 run -e API_URL=http://localhost:8080 load-test/scenarios/failover-match.js` as a
   child; parse stdout for anchors (readiness, MATCH_STARTED, ROUND_STARTED count).
3. **Wait for mid-match:** poll Redis (`match:state:<id>`) until a match is IN_GAME and ~40-50%
   through its rounds (read the round index; or count ROUND_STARTED anchors).
4. **Find the owner:** `GET match:owner:<matchId>` from Redis (value `"<nodeId>:<fence>"`);
   cross-check each node's `/health/cluster.ownedMatches`. The cluster health route is
   **ADMIN-protected**: the orchestrator sends `Authorization: Bearer $CLUSTER_HEALTH_ADMIN_JWT`
   (a JWT carrying the ADMIN role, provided via env var/secret — never written into artifacts
   or logs; 401/403 responses are recorded as harness auth failures, not as health data).
5. **Kill it:** resolve the container **dynamically from observed identity — do NOT hard-code a
   `nodeId → container` map**: either probe each candidate container's direct port
   (`/health/cluster.nodeId`, with the ADMIN JWT above) or match on Docker labels
   (`docker ps --filter "label=com.docker.compose.service"` + the compose service's
   `INSTANCE_ID`), or read the coordinator sidecar's node↔container report. **Before issuing
   `docker kill`, verify the resolved container's reported nodeId equals the owner nodeId from
   step 4** — abort the run (harness error, not a FAIL verdict) on mismatch, so a rename or
   scale-out never kills a bystander node. Then `docker kill <container>` (SIGKILL = honest
   chaos; lease TTL expiry drives takeover). Record `t_kill`. **Do not let compose auto-restart**
   during the window (compose sets `restart: "no"`).
6. **Measure recovery:**
   - `t_recover` = the `t` (canonical first observation, see dedup rule below) of the **first
     deduplicated `ROUND_STARTED` after `t_kill` carrying the new owner's fence
     (`fence === owner_after.fence`)** — the same event-based definition Step 0 verifies. This
     event may legitimately be observed **before** the orchestrator's periodic poll notices the
     owner flip; `t_owner_flip` is recorded as **separate evidence** that the lease moved (and
     moved after the kill), never as a bound on `t_recover`.
     `time_to_recover = t_recover − t_kill`.
   - **Recovery oracle (split-brain check):** before evaluating rounds, **deduplicate the
     observed `ROUND_STARTED` wrapper logs by `eventId`** (or the event's sequence number) —
     multiple clients/log lines re-observe the same broadcast, and a re-observed event must not
     be miscounted as a repeated round. **Dedup canonicalization rule:** for each `eventId`,
     keep exactly one entry with the **smallest observed `t`** (the first observation) and order
     the deduplicated sequence by that canonical `t`; later duplicate observations are
     discarded. `t_recover_derived` and every verdict computation read only these canonical
     first-observation entries, so the artifact and verdict are deterministic no matter how many
     clients re-observed each broadcast or in what order the raw logs arrived. Over the
     deduplicated sequence require **strictly
     increasing `roundIndex`** values (not merely "no repeated round number" — a regression like
     3→2 is also split-brain), and for each post-kill event compare the event's **fence** against
     the fence of the current `match:owner` value at observation time: an event carrying a stale
     fence is a split-brain violation even when its round number is unique. Record every
     violation with the offending eventIds/fences.
   - `reconnect_success` / `reconnect_ms` p95 (from k6).
   - answer p95 in a bounded window around `t_kill` (bounded spike, not a stall).
   - `MATCH_FINISHED` still delivered to surviving clients.
7. Write `load-test/results/failover-<commit>-<ts>.failover.json` with an explicit,
   machine-readable schema — every field the PASS/FAIL verdict reads must be present:

   **One clock for every timestamp:** all `t_*` fields and `round_events[].t` are stamped by
   the **orchestrator's single monotonic clock** (`performance.now()` anchored once to epoch at
   `t_start`) at the moment the **orchestrator observes** each event — never node clocks, Redis
   time, or k6 VU clocks — so every temporal comparison in the verdict compares like with like.

   ```jsonc
   {
     "t_start": 0,
     "t_match_started": 0,
     "t_kill": 0,
     "t_owner_flip": 0, // when the orchestrator's PERIODIC POLL first saw the new lease — may lag (and even postdate) the first new-fence round event
     "t_recover": 0, // = t of the first qualifying post-kill ROUND_STARTED in round_events (verified below)
     "time_to_recover_ms": 0, // derived; the verdict recomputes it from evidence (below)
     "owner_before": { "nodeId": "api-2", "fence": 7 },
     "owner_after": { "nodeId": "api-3", "fence": 8 },
     "nodes_alive_after": ["api-1", "api-3"],
     "rounds_before": 0,
     "rounds_after": 0,
     // The deduplicated ROUND_STARTED sequence the oracle evaluated — the raw
     // evidence behind duplicate_round_check AND the source for D1's
     // round-index step chart. One entry per eventId; duplicate observations of
     // the same eventId keep the SMALLEST t (canonical first observation), and
     // the sequence is ordered by that canonical t. t_recover_derived and all
     // verdict math read only these canonical entries (deterministic across
     // clients/instances/log order).
     "round_events": [{ "t": 0, "eventId": "…", "roundIndex": 1, "fence": 7 }],
     "duplicate_round_check": {
       "passed": true,
       "deduped_event_count": 0,
       "violations": [],
     },
     "match_finished": true,
     "answer_p95_failover_ms": 0,
     "steady_state_p95_ms": 0,
     "reconnect": {
       "successes": 0,
       "unexpected_closes": 0,
       "rate": 1.0,
       "p95_ms": 0,
     },
     "thresholds": {
       "answer_p95_multiplier_max": 5,
       "time_to_recover_max_ms": 20000,
       "reconnect_success_min": 0.99,
       "min_unexpected_closes": 1, // reconnect coverage gate (see below)
     },
     "verdict": "PASS", // "PASS" | "FAIL" | "INCONCLUSIVE"
   }
   ```

   The `thresholds` block encodes the "~5×" and "~20s" comparisons as data so the verdict is
   reproducible from the artifact alone. `reconnect.rate = successes / unexpected_closes`,
   where the **denominator is the count of non-intentional closes observed by k6** (the same
   events that start a reconnect loop, per C2) — successes over that same population, never
   over attempts. **Zero-denominator rule (display) + coverage gate (verdict):** when
   `unexpected_closes === 0`, `rate` is defined as **`1.0` for display only** — never
   `NaN`/`null` — and the raw `successes`/`unexpected_closes` are always recorded alongside so
   the vacuous case stays visible in the artifact. But a node-kill run that observed **zero**
   unexpected closes did not exercise reconnect at all (the killed owner's sockets should have
   dropped) — vacuous success must not silently become an overall PASS. The reconnect criterion
   therefore carries a **coverage gate**: `unexpected_closes ≥ thresholds.min_unexpected_closes`
   (default 1; raise it toward the killed node's expected socket share for stricter runs). A run
   that fails the gate while every other criterion passes gets `verdict = "INCONCLUSIVE"`
   (reconnect unproven — rerun with the C2 wrapper enabled / check the kill actually dropped
   sockets), never `"PASS"`.

## Pass / fail (encode in the orchestrator)

**Step 0 — validate the timeline before trusting derived fields.** All timestamps come from the
orchestrator's single monotonic clock (see the schema note above), so they are mutually
comparable. The verdict function first checks timestamp sanity:
`t_start ≤ t_match_started ≤ t_kill < t_owner_flip` and `t_kill < t_recover` (all present,
finite, non-zero where required). **Deliberately NOT required: `t_owner_flip ≤ t_recover`.**
`t_owner_flip` is when the orchestrator's _periodic poll_ first saw the new lease; a perfectly
valid post-failover ROUND_STARTED can be observed **during the poll gap**, before the flip is
noticed — the poll timestamp orders the poll, not the takeover itself. It then **derives the
recovery timestamp from the evidence instead of trusting the recorded one**:
`t_recover_derived` = the `t` of the **first `round_events` entry with `t > t_kill` and
`fence === owner_after.fence`** — the fence, not the poll timestamp, is what proves the event
was emitted under the new owner (both come from the same broadcast payload, so no cross-clock
comparison is involved). If **no qualifying event exists** in `round_events`, or the supplied
`t_recover` disagrees with `t_recover_derived`, the artifact is rejected (**FAIL** with an
`invalid_artifact` reason) before any threshold is evaluated. `time_to_recover_ms` is then
recomputed as `t_recover_derived − t_kill` (the recorded derived field is compared and must
agree), and **the verified recomputed value** is what feeds the threshold evaluation below.

**Verdict-function unit tests (extract the verdict into a pure module and test it with vitest —
it is plain Node, no k6 runtime):**

- **Poll-gap case:** feed an artifact whose `round_events` contains a new-fence ROUND_STARTED at
  `t_kill < t < t_owner_flip` (event observed during the poll gap). The verdict must **accept**
  the artifact, select that event as `t_recover_derived`, and compute `time_to_recover_ms` from
  it — not reject it for preceding `t_owner_flip`. Pair it with the negative case: no new-fence
  event at all → `invalid_artifact`.
- **Duplicate-log determinism:** feed the dedup stage raw observations containing the same
  `eventId` at several different `t` values (several clients observing one broadcast), in
  shuffled arrival orders across runs. Assert the produced `round_events` contains exactly one
  entry per `eventId` carrying the **smallest** `t`, the sequence order is identical across the
  shuffles, and `t_recover_derived` / the verdict are byte-identical — duplicate logs never
  change the artifact or the verdict.

`verdict = "PASS"` iff **all** of the artifact fields satisfy their thresholds:
`match_finished === true`; `duplicate_round_check.passed === true` (deduped, strictly increasing
round indexes, no stale-fence event); `owner_after.nodeId ∈ nodes_alive_after` and
`≠ owner_before.nodeId`; **`owner_after.fence > owner_before.fence`** (a takeover MUST mint a
strictly higher fence — an equal/lower fence means no real fenced takeover happened) **and the
fence transition was observed after the kill (`t_owner_flip > t_kill`)**;
`reconnect.rate ≥ thresholds.reconnect_success_min` **and the coverage gate
`reconnect.unexpected_closes ≥ thresholds.min_unexpected_closes`** (rate `1.0` from a zero
denominator is display-only and cannot satisfy this criterion);
`answer_p95_failover_ms ≤ thresholds.answer_p95_multiplier_max × steady_state_p95_ms`;
verified `time_to_recover_ms ≤ thresholds.time_to_recover_max_ms` (≈ lease TTL + margin).
**`verdict = "INCONCLUSIVE"`** when the reconnect coverage gate is the only unsatisfied
criterion (reconnect unproven, everything else green). FAIL when any other criterion — including
either fence condition — is not satisfied (stall, duplicate/regressing round advance,
stale-fence broadcast, non-increasing owner fence, owner flip not after the kill, or clients
never get post-failover ROUND_STARTED), or when Step 0 rejects the artifact.

Optionally a second run using `docker stop` (SIGTERM, graceful `onModuleDestroy`) to contrast
graceful drain vs hard kill in the narrative.

## Done

- One `chaos-failover.mjs` run prints PASS + a `*.failover.json` timeline; artifacts in
  `load-test/results/`. This is the direct input to Stage D's failover chart.
