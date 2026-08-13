# Active Context: Arena of 100

> **Core memory-bank file 4/4**
> Current working context only. Detailed history belongs in `progress.md`, git history, or supplementary docs.

## Current Working Mode

- **Phase 3 implementation complete 2026-08-12 (commit pending).** Spec §7 15-item checklist fully ticked; test counts: shared 61 / game-core 280 / API 1681 / web 247 / load-test 63 = **2332 tests pass**, no regression. Source of truth: `memory-bank/spec/class-cards-phase.md`.
- Memory-bank consolidation vẫn là baseline; spec thuộc supplementary folder `spec/`.
- Spec doc là authoritative cho Phase 1-3; mọi thay đổi update spec trước rồi reflect activeContext/progress.

## Verified Truth Right Now

- Baseline done: lobby lifecycle, heartbeat/presence sweep, graceful exit, admin kill-switch baseline, drop-in spectating, race/correctness hardening, gateway/schema tightening.
- Server-authoritative game loop is active.
- `MatchStateMachine` is the core domain state machine and should not be split broadly without a specific high-value refactor.
- `MatchStateMachine.tieBreak` is deterministic but still a private method, not a Strategy Pattern implementation.
- Admin kill-switch append-only audit event backend baseline is implemented (`appendAudit`, `eventLog.create`, `GET /admin/audit-events`).
- `Room.maxPlayers` is already exposed through realtime room create/join payloads and consumed by the game UI.
- `submitAnswer` now uses `submissionId` as a server-side idempotency key for duplicate retries in the same round.
- Distributed match runtime is implemented (Stage B: Redis Socket.IO adapter, fenced owner-lease + failover, owner-single-writer answers, presence leader election) and the Stage C measurement harness + D1 architecture narrative are in place (`docs/architecture-distributed.md`).
- **2026-07-28: multi-node k6 RUN done** — 800→3200 VU on the 3-node `docker:multi` cluster; two real bottlenecks found & fixed with numbers (consumer poll loop: answer p95 1126→201ms; pg pool default-10 ceiling → `DB_POOL_MAX`); capacity envelope linear 201/357/669ms p95 @ 800/1600/3200, 0 connect errors. Full story + interview prep: `career-assessment.md` §2026-07-28; raw: `load-test/results/`. Outstanding: **C3-owner-failover** numbers (baseline owner-lease); Plan A single-room 100-user baseline table (P2). **C3-card-batch-failover** is a separate Phase 3 gate.
- **2026-07-30: Content Roadmap locked — Class + Card Hybrid.** 2 classes (Công / Thủ) random assignment, 18 cards (10 Thủ + 8 Công), 20s round stream-lined overlay pattern, `CARD_RESOLVED_BATCH` aggregation, AOE cap 2/round, clock-drift safe rehydrate. Banned vĩnh viễn: `Time Drain` (snowball), `Push Down` (phá score determinism). Ban/pick draft defer; Territory mode defer vô thời hạn; Gauntlet scope-down (replaced bởi class+card). Full spec: `memory-bank/spec/class-cards-phase.md`. Timeline: 8 tuần (Phase 1: Week 1-2 / Phase 2: Week 3-6 / Phase 3: Week 7-8).
- **2026-08-12: Phase 3 implementation complete (commit pending).** Days 25-36 of the locked 8-week plan. Spec §7 15-item DoD checklist fully ticked. Test counts: shared 61 / game-core 280 / API 1681 / web 247 / load-test 63 = **2332 tests pass**, no regression. Highlights:
  - Daily streak ≥ 7 → card variant cosmetic unlock (DEFAULT / NEON / GOLD enum + `UserCardVariant` table; idempotent upsert; UI ring/glow overlay).
  - Daily leaderboard cross-show "Most cards played this week" — `LATERAL` aggregate over `MatchPlayer.cardsPlayed` (persisted at `finishMatch` from event-log traversal).
  - Profile page — `GET /users/me/class-stats` returns class winrate (ATTACK / DEFENSE per-class) + current streak + cards played count.
  - Shareable card unlock notification modal (viral hook).
  - **C3-card-batch-failover gate**: pure oracle + 22 vitest cases (2026-08-12 hardening: per-element validation + cohort invariant). Production code UNCHANGED (Phase 2 append-first design already satisfies the invariant).
  - VI i18n: 18 cards × 2 locales under `Cards.byId.{cardId}.name|description`.

## Current Architectural Decisions

- Keep monolith-first architecture until load evidence says otherwise.
- Keep gateway -> handler -> service -> `MatchStateMachine` flow for socket actions.
- Do not introduce Command Pattern for current socket use cases.
- Consider Strategy Pattern only for focused tie-break refactor if/when needed.
- Treat BotFactory/AvatarFactory/EmoteFactory/ContentModerationFactory as planned/future only.
- **Class + Card Hybrid (Phase 2)**: 2 classes (Công / Thủ) random server-side, 18 cards milestone-based, 20s round flow. Card events là event log extension (Track D compatible), KHÔNG transient state. Client rehydrate dựa trên `serverTimestamp` + `remainingMs` + `targetPlayerIds` (clock drift safe, MUTATION/TEMPORARY split). AOE cap 2/round + immediate apply + ≤50ms `CARD_RESOLVED_BATCH` micro-batch. **durable ordering of inner `CARD_RESOLVED` events**: mỗi inner `CARD_RESOLVED` event có stable identity và `seqNo` được persist TRƯỚC khi apply state, rồi apply ngay lập tức; replay/failover dedup từng effect dùng identity + `seqNo` đó. `CARD_RESOLVED_BATCH` chỉ là transport frame — KHÔNG có replay identity riêng, `seqNo` của batch KHÔNG phải replay cursor. Banned: `Time Drain`, `Push Down`. Chi tiết: `memory-bank/spec/class-cards-phase.md`.
- **Phase 3 (Integration & Polish) — implementation complete 2026-08-12 (commit pending)**: card variant cosmetic unlock (default / neon / gold enum, threshold 7/14/21…); profile stats (class winrate, streak, sabotage count); shareable card unlock notification; VI i18n card names; **C3-card-batch-failover gate (chaos-only, no production change)**.

## Immediate Priority Queue

1. Commit the 2026-08-12 Phase 3 implementation (complete locally 2026-08-12; commit pending) in two groups: (a) DB + service + UI (Days 25-31), (b) chaos oracle + i18n + ship prep (Days 32-36). Finish each group fully before running `gitnexus_detect_changes()`; run it immediately before that group's commit. Verify only expected symbols + execution flows changed. Do NOT mix groups across commits.
2. Phase 3 → Phase 4 transition: decide whether to ship (a) Ban/pick draft (orthogonal, already deferred), (b) Elo + matchmaking queue (needs Daily + Card data thật), (c) Redis HA (Sentinel) — pick from `career-assessment.md` interview-prep list.
3. **C3-owner-failover** RUN still pending — distinct from Phase 3 C3-card-batch-failover (which is implementation-complete as chaos oracle).
4. Plan A single-room 100-user baseline table — still a P2 deliverable.
5. Optional fixes (cheap, not urgent): Prisma `IN (NULL)` no-ops; `rooms.status` index; harness polling → WS-event wait (needed only to measure >3200).
6. Historical roadmap reference only: xem `progress.md` §Content Roadmap v1 nếu
   cần rationale cũ của roadmap 2026-07-28 đã bị supersede.

## Open Product / Engineering Gaps

- Admin audit panel UI is optional because backend audit event support now exists.
- In-match AFK policy should follow locked product semantics: missing active round deadline means elimination in that round.
- Mass-spectator transport split is deferred until `k6` evidence exists.
- Moderation MVP is completed; deeper fingerprint/shadow-ban is post-MVP.
- **Class + Card Hybrid (Phase 1-3, locked 2026-07-30, Phase 3 implementation complete 2026-08-12, commit pending)**: spec §7 all DoD items ticked. Source of truth: `memory-bank/spec/class-cards-phase.md`. Phase 1 (Daily Challenge) Week 1-2 ✅; Phase 2 (Class+Card) Week 3-6 ✅; Phase 3 (Integration + VI i18n) Week 7-8 ✅. Phase 4 (next orthogonal work — see Priority #2).

## Agent Read Policy

Default context files are only:

1. `memory-bank/productContext.md`
2. `memory-bank/systemPatterns.md`
3. `memory-bank/progress.md`
4. `memory-bank/activeContext.md`

Other memory-bank files are supplementary / legacy notes. Read them only when explicitly requested or when a core doc points to them.
