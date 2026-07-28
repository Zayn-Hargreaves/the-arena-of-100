# Active Context: Arena of 100

> **Core memory-bank file 4/4**
> Current working context only. Detailed history belongs in `progress.md`, git history, or supplementary docs.

## Current Working Mode

- Current focus: memory-bank consolidation and truth-in-docs cleanup.
- Current branch/worktree has doc changes in `AGENTS.md`, `CLAUDE.md`, `plan.md`, and core memory-bank files.
- `systemPatterns.md` has been corrected to distinguish implemented patterns from future/planned seams.
- Command Pattern is intentionally not part of current implementation.
- Factory Pattern is only implemented as `createEvent()` today; other factories are future seams only.

## Verified Truth Right Now

- Baseline done: lobby lifecycle, heartbeat/presence sweep, graceful exit, admin kill-switch baseline, drop-in spectating, race/correctness hardening, gateway/schema tightening.
- Server-authoritative game loop is active.
- `MatchStateMachine` is the core domain state machine and should not be split broadly without a specific high-value refactor.
- `MatchStateMachine.tieBreak` is deterministic but still a private method, not a Strategy Pattern implementation.
- Admin kill-switch append-only audit event backend baseline is implemented (`appendAudit`, `eventLog.create`, `GET /admin/audit-events`).
- `Room.maxPlayers` is already exposed through realtime room create/join payloads and consumed by the game UI.
- `submitAnswer` now uses `submissionId` as a server-side idempotency key for duplicate retries in the same round.
- Distributed match runtime is implemented (Stage B: Redis Socket.IO adapter, fenced owner-lease + failover, owner-single-writer answers, presence leader election) and the Stage C measurement harness + D1 architecture narrative are in place (`docs/architecture-distributed.md`).
- **2026-07-28: multi-node k6 RUN done** — 800→3200 VU on the 3-node `docker:multi` cluster; two real bottlenecks found & fixed with numbers (consumer poll loop: answer p95 1126→201ms; pg pool default-10 ceiling → `DB_POOL_MAX`); capacity envelope linear 201/357/669ms p95 @ 800/1600/3200, 0 connect errors. Full story + interview prep: `career-assessment.md` §2026-07-28; raw: `load-test/results/`. Work NOT yet committed (9 files). Outstanding runs: C3 chaos/failover numbers; Plan A single-room 100-user baseline table (P2).

## Current Architectural Decisions

- Keep monolith-first architecture until load evidence says otherwise.
- Keep gateway -> handler -> service -> `MatchStateMachine` flow for socket actions.
- Do not introduce Command Pattern for current socket use cases.
- Consider Strategy Pattern only for focused tie-break refactor if/when needed.
- Treat BotFactory/AvatarFactory/EmoteFactory/ContentModerationFactory as planned/future only.

## Immediate Priority Queue

1. Commit the 2026-07-28 perf work (2 groups: cluster-boot/config fixes + consumer-loop fix) with `load-test/results/` artifacts.
2. Write the "Performance investigation" docs page (timeline → hypothesis → experiment → numbers) — this is the 5-minute system-design interview script.
3. Interview prep: rehearse the 3 stories + probe answers in `career-assessment.md` §2026-07-28 (Redis SPOF answer is mandatory).
4. Optional runs: C3 chaos/failover numbers on the new cluster; Plan A 100-user baseline table (P2 conclusion).
5. Optional fixes (cheap, not urgent): Prisma `IN (NULL)` no-ops; `rooms.status` index; harness polling → WS-event wait (needed only to measure >3200).

## Open Product / Engineering Gaps

- Admin audit panel UI is optional because backend audit event support now exists.
- In-match AFK policy should follow locked product semantics: missing active round deadline means elimination in that round.
- Mass-spectator transport split is deferred until `k6` evidence exists.
- Moderation MVP is completed; deeper fingerprint/shadow-ban is post-MVP.

## Agent Read Policy

Default context files are only:

1. `memory-bank/productContext.md`
2. `memory-bank/systemPatterns.md`
3. `memory-bank/progress.md`
4. `memory-bank/activeContext.md`

Other memory-bank files are supplementary / legacy notes. Read them only when explicitly requested or when a core doc points to them.
