# Active Context: Arena of 100

> **Core memory-bank file 4/4**
> Current working context only. Detailed history belongs in `progress.md`, git history, or supplementary docs.

## Current Working Mode

- **Content Roadmap được chốt 2026-07-30** — Class + Card Hybrid (2 classes / 18 cards / 8 tuần). Source of truth: `memory-bank/spec/class-cards-phase.md`. Daily Challenge (Phase 1) ship trước.
- Memory-bank consolidation vẫn là baseline; spec mới thuộc supplementary folder `spec/`.
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

## Current Architectural Decisions

- Keep monolith-first architecture until load evidence says otherwise.
- Keep gateway -> handler -> service -> `MatchStateMachine` flow for socket actions.
- Do not introduce Command Pattern for current socket use cases.
- Consider Strategy Pattern only for focused tie-break refactor if/when needed.
- Treat BotFactory/AvatarFactory/EmoteFactory/ContentModerationFactory as planned/future only.
- **Class + Card Hybrid (Phase 2)**: 2 classes (Công / Thủ) random server-side, 18 cards milestone-based, 20s round flow. Card events là event log extension (Track D compatible), KHÔNG transient state. Client rehydrate dựa trên `serverTimestamp` + `remainingMs` + `targetPlayerIds` (clock drift safe, MUTATION/TEMPORARY split). AOE cap 2/round + immediate apply + ≤50ms `CARD_RESOLVED_BATCH` micro-batch. Banned: `Time Drain`, `Push Down`. Chi tiết: `memory-bank/spec/class-cards-phase.md`.

## Immediate Priority Queue

1. Commit the 2026-07-28 perf work (2 groups: cluster-boot/config fixes + consumer-loop fix) with `load-test/results/` artifacts.
2. Write the "Performance investigation" docs page (timeline → hypothesis → experiment → numbers) — this is the 5-minute system-design interview script.
3. Interview prep: rehearse the 3 stories + probe answers in `career-assessment.md` §2026-07-28 (Redis SPOF answer is mandatory).
4. Pending required Phase 2 evidence: **C3-owner-failover** chaos numbers on the new cluster (baseline; distinct from Phase 3 `C3-card-batch-failover`). Plan A 100-user baseline table remains a separate P2 deliverable.
5. Optional fixes (cheap, not urgent): Prisma `IN (NULL)` no-ops; `rooms.status` index; harness polling → WS-event wait (needed only to measure >3200).
6. Historical roadmap reference only: xem `progress.md` §Content Roadmap v1 nếu
   cần rationale cũ của roadmap 2026-07-28 đã bị supersede.
7. **Content Roadmap chốt 2026-07-30 — CURRENT** — Class + Card Hybrid (D): 2 classes
   random / 18 cards milestone / 20s overlay round / `CARD_RESOLVED_BATCH`
   - AOE cap 2 / clock-drift safe rehydrate. Phase 1 (Daily Challenge) ship
     trước → Phase 2 (Class+Card) → Phase 3 (Integration & Cosmetic Polish).
     Gauntlet scope-down (replaced bởi class+card); Territory defer vô thời
     hạn. Source of truth: `memory-bank/spec/class-cards-phase.md`. Timeline: 8
     tuần (Week 1-2 / Week 3-6 / Week 7-8).

## Open Product / Engineering Gaps

- Admin audit panel UI is optional because backend audit event support now exists.
- In-match AFK policy should follow locked product semantics: missing active round deadline means elimination in that round.
- Mass-spectator transport split is deferred until `k6` evidence exists.
- Moderation MVP is completed; deeper fingerprint/shadow-ban is post-MVP.
- **Class + Card Hybrid (Phase 1-3)**: spec locked 2026-07-30, chưa bắt đầu code. Phase 1 (Daily Challenge) ship Week 1-2. Phase 2 (Class+Card) ship Week 3-6, bắt đầu bằng `gitnexus_impact` upstream cho `MatchStateMachine.playCard` với blast-radius report và cảnh báo nếu risk HIGH/CRITICAL; phase này closes the **C3-owner-failover** gate. Phase 3 (Integration + VI i18n) ship Week 7-8 và closes the **C3-card-batch-failover** gate.

## Agent Read Policy

Default context files are only:

1. `memory-bank/productContext.md`
2. `memory-bank/systemPatterns.md`
3. `memory-bank/progress.md`
4. `memory-bank/activeContext.md`

Other memory-bank files are supplementary / legacy notes. Read them only when explicitly requested or when a core doc points to them.
