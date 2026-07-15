# Distributed Refactor — Phase Index ("9.5" depth vertical)

> **How to use this folder.** Each phase below is a **self-contained work
> unit sized for one focused implementation session** (one commit, ideally
> ≤ ~4 files touched). An implementer should read **`01-REFERENCE.md`**
> (shared facts, file map, Redis key schema, reused utilities, test
> commands) **plus the single phase file** they are working on — nothing
> else **from this folder**. The always-mandatory materials are exempt from
> that limit and must still be reviewed/used every session: **`CLAUDE.md`**
> (GitNexus mandates), **`memory-bank/progress.md`**, and the **GitNexus
> skill/process** that B1a and the Conventions below require. Keeping the
> per-session reading to those required materials + the two files above is
> what keeps each session small enough to avoid context compaction.
>
> Do the phases **in order** — later phases depend on earlier ones. Every
> phase ends green (tests + lint) and is committed before the next starts.

## Goal

Turn the single-process game server into a **multi-instance** system where
every match is owned by exactly one node via a Redis lease with heartbeat,
survives an owner node-kill (failover rebuilds its timers from persisted
state), and is **proven with measured evidence** (multi-instance load +
node-kill chaos test + architecture narrative). Approach chosen by the
user: **bespoke Redis owner-lease + failover** (not BullMQ), **full vertical - real measurement**.

## Status

- ✅ **Stage A — DONE & committed** (`a85ec21`, branch
  `feat/distributed-stage-a-redis-adapter`): Redis Socket.IO adapter
  (cross-node broadcast verified 3-node), Dockerfile, `docker-compose.multi.yml`
  - nginx sticky LB, `ClusterModule`/`ClusterService` (nodeId + socketCount),
    `GET /health/cluster`. See `01-REFERENCE.md` §"Stage A recap".

## Phase list (do in this order)

| #   | File                             | Deliverable                                                                                                                  | Touches                                                                   |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| B0  | `10-B0-redis-primitives.md`      | Redis lease (`acquireLease`/`renewLease`/`releaseLease`/`acquireLeaseWithFence` Lua) + `subscribe` wrapper on `RedisService` | redis.service.ts (+spec)                                                  |
| B1a | `20-B1a-impact-analysis.md`      | **Gate (no code):** run `gitnexus_impact` on the CRITICAL symbols, record blast radius, surface HIGH/CRITICAL to user        | writes an impact-analysis doc                                             |
| B1b | `21-B1b-phase-deadlines.md`      | `phaseEndsAt` on `MatchState`; set on every transition                                                                       | shared/state.ts, match-state-machine.ts (+spec)                           |
| B1c | `22-B1c-codec-v2.md`             | Codec `SERIALIZED_STATE_VERSION` 1→2 + back-compat + backfill                                                                | match-state.codec.ts (+spec)                                              |
| B2a | `30-B2a-ownership-store.md`      | `match:active` index store (add/remove/list)                                                                                 | match-ownership.store.ts (+spec)                                          |
| B2b | `31-B2b-ownership-service.md`    | `MatchOwnershipService`: acquire on launch + in-memory owned set + supersede `ClusterService.getOwnedMatchIds`               | match-ownership.service.ts, game-loop.service.ts, match.module.ts (+spec) |
| B2c | `32-B2c-heartbeat-fencing.md`    | Heartbeat renew loop + relinquish-on-loss + `assertOwnership` fencing at the 3 mutating boundaries                           | match-ownership.service.ts, match-round-runner.ts (+spec)                 |
| B3a | `40-B3a-resume-loop.md`          | `MatchRoundRunner.resumeMatchLoop` (rebuild timer from `phaseEndsAt`, F2 set from event log)                                 | match-round-runner.ts (+spec)                                             |
| B3b | `41-B3b-boot-orphan-recovery.md` | Boot scan of `match:active` + orphan lease acquire + resume; periodic orphan sweep + dead-letter                             | match-ownership.service.ts (+spec)                                        |
| B4a | `50-B4a-command-channel.md`      | Owner command channel (`match:cmd:<matchId>` publish + owner subscribe)                                                      | match-ownership.service.ts / new match-command.service.ts (+spec)         |
| B4b | `51-B4b-answer-single-writer.md` | `handleSubmitAnswer`: local optimistic ack + forward authoritative apply to owner                                            | match.handler.ts (+spec)                                                  |
| B5  | `60-B5-presence-leader.md`       | Presence leader election (sweep only if leader) + route IN_GAME disconnect to owner                                          | presence.service.ts (+spec)                                               |
| C1  | `70-C1-multi-baseline.md`        | Multi-instance k6 baseline via LB + per-node sampler + distribution assertion                                                | load-test/ (harness)                                                      |
| C2  | `71-C2-reconnect-harness.md`     | Reconnect in the k6 client + `reconnect_ms`/`reconnect_success` metrics                                                      | load-test/lib/                                                            |
| C3  | `72-C3-chaos-failover.md`        | `failover-match.js` + `chaos-failover.mjs` node-kill orchestrator + pass/fail                                                | load-test/                                                                |
| D1  | `80-D1-architecture-doc.md`      | `docs/architecture-distributed.md` narrative + charts                                                                        | docs/                                                                     |

## Correctness invariants (hold across all phases)

1. **At-most-once round advancement** — only the lease-holding owner arms/fires
   round timers and calls `endRound`/`finishMatchLoop`. Guarded by: owner-only
   timers + in-memory H1/B1 guards + `assertOwnership` fencing + DB uniqueness
   (`@@unique([matchId, roundNo])`, `finishMatch updateMany status != FINISHED`).
2. **No split-brain** — fencing token in `match:owner:<id>`; a paused old owner
   whose lease was taken cannot renew (its `<nodeId>:<fence>` no longer matches).
3. **No lost updates** — `match:state` is written by the **owner only** (B4);
   non-owners forward answers over the command channel.
4. **Pub/sub loss is safe** — a dropped nudge only defers round-end to the
   owner's 15s timer; never a correctness loss.

## Conventions

- One phase = one commit on a branch `feat/distributed-<phase>` (e.g.
  `feat/distributed-b0-primitives`), branched from the previous phase's tip
  (or `main` once merged). Commit message ends with the repo's Co-Authored-By trailer.
- Before editing any of `MatchStateMachine`, `MatchRoundRunner`, `MatchService`,
  `PresenceService`, `GameLoopService.launchRoomMatch`, `MatchHandler.handleSubmitAnswer`:
  run `gitnexus_impact({target, direction:"upstream"})` and **surface HIGH/CRITICAL
  to the user** (CLAUDE.md mandate). B1a does this once up front; re-run if a later
  phase touches a symbol not covered there.
- Run `gitnexus_detect_changes()` before each commit.
- Keep the full suite green (baseline 984/984 api after Stage A) + coverage gate ≥90%.
