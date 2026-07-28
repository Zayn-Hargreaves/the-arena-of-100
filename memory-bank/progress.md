# Progress: Arena of 100

> **Core memory-bank file 3/4**
> Timeline rút gọn + queue hiện tại. Chi tiết lịch sử sâu hơn nằm trong git history và supplementary docs.

## Current Status

Baseline hiện tại đã xong:

- lobby lifecycle
- heartbeat / presence sweep
- graceful exit
- admin kill-switch baseline
- drop-in spectating baseline
- match race + frontend correctness hardening
- gateway/schema tightening + home gradient cleanup

Admin kill-switch append-only audit event **đã xong**.

## Latest Known Test Counts

- API unit tests: **1369/1369** passed (2026-07-28).
- Game-core tests: **70/70**
- Web tests: **31/31**
- Shared tests: **3/3**
- E2E tests: **11/11**

Run the relevant package tests before using these numbers in PR text.

## Completed Milestones

### 2026-06-06

- Profile + rankings real APIs.
- CI/E2E hardening.

### 2026-06-07 / 2026-06-08

- Lobby lifecycle baseline.
- Heartbeat/presence sweep.
- Graceful exit baseline.
- `PresenceService.sweep` covers lobby stale cleanup.

### 2026-06-14

- Design System Phase 5B closeout.
- Admin kill-switch baseline.
- Drop-in spectating baseline.
- Match race + frontend correctness hardening (B1-B3, F1-F8).
- Post-merge recovery/idempotency hardening (B4-B7, L1).

### 2026-06-18

- Gateway + schema tightening + home gradient cleanup (L2, L3, PR 6).
- Validation bounds tightened for client timestamps and `lastSeenSeqNo`.
- `game.gateway.ts` import dedupe and awaited disconnect handling.

### 2026-07-11

- **Track C — AFK docs + UX hardening.** Verified AFK/elimination semantics across state machine → round runner → UI; wrote `docs/afk-policy.md`.
- `MatchStateMachine` public API unchanged (CRITICAL blast radius snapshot at rev `7935cdc..4832e72`: 29 impactedCount / 18 processes / 3 modules — canonical, see `docs/afk-policy.md` §5; current HEAD `ba64ef5` re-run reports 3 / 16 / 2 because two follow-up commits `eba3d73`, `ba64ef5` post-date the snapshot — re-run `gitnexus_impact` if you need live numbers). BE elimination logic already correct — added regression tests only (AFK, disconnect, reconnect-in-round, late answer, eliminated stays eliminated).
- FE: elimination reason (`WRONG_ANSWER` / `TIMEOUT`) now shown in `eliminated-overlay`; `eliminationReason` added to socket store; reconnect snapshot hydrates `isEliminated` from roster so watch-only UI restores. New `EliminationReason` type in `@arena/shared`.
- Pre-edit impact analysis artifact (Plan §C1 §30-51): `docs/impact-analysis-C.md` — 10 symbol `gitnexus_impact` outputs verbatim, scope confirmation (no public API change, blast radius ≤ 11 file), revision binding `7935cdc..4832e72`. `§4` records a POLICY EXCEPTION (no independent reviewer); `§5` author-self-attestation timestamp `2026-07-13T07:55:28Z` — not an approval, no independent approval yet.
- **Track D — Replay contract (`lastSeenSeqNo` delta replay).** `getSnapshot` used to ignore its cursor and always full-hydrate. Now: monotonic `seqNo` on every event-log entry (persisted through Redis serialize/rehydrate, counter resumed from max to avoid collision); `getDelta`/`getHeadSeqNo`/`getFloorSeqNo` on `MatchStateMachine` (public `getSnapshot` signature unchanged). `MatchHandler.handleRequestSnapshot` emits an `EVENT_BATCH` delta when the client cursor is in `[floor, head]`, else a full `SNAPSHOT` (fallback: cursor 0 / older than retention / ahead of head). `ROUND_STARTED` event enriched with the client-safe question + `endsAt` (no `correctAnswer`) so a delta can rebuild the in-flight round. Client: `lastSeenSeqNo` tracked in socket store, `applyEventBatchState` folds events idempotently (mirrors live reducers → `delta == live-continuity`), `REQUEST_SNAPSHOT` sends the real cursor. Backward-compat: cursor 0 / old clients still get full `SNAPSHOT`. Reused the pre-provisioned `ServerEvent.EVENT_BATCH` + `EventBatchPayload` (added `matchId`). Cap on `lastSeenSeqNo` widened to `MAX_ROUNDS * MAX_PLAYERS * 2`.
- **Deferred (needs Track C coordination):** `auth.handler.syncReconnection` still pushes a full `SNAPSHOT` on reconnect; making the reconnect push itself delta-aware is a follow-up.

### 2026-07-28

- **Multi-node k6 THẬT — cluster `docker:multi` lần đầu boot & đo được.** 3 blocker
  phải sửa để cluster sống: `class-transformer` thiếu trong prod deps (cả 3 node
  exit 1 — bug thật của prod image), throttler hardcode 100 req/60s/IP (→
  env-tunable `THROTTLE_LIMIT`/`THROTTLE_TTL_MS`, default prod giữ nguyên), CSRF
  cookie `Secure` dưới `NODE_ENV=production` mà k6 không replay qua http (→ harness
  tự replay cookie, không hạ cookie policy).
- **Nghẽn #1 tìm-sửa-verify: consumer command-stream timer-bound.**
  `setInterval(250ms)` + `BATCH=16` → answer p95 1126ms @800 VU trong khi CPU 10%
  (max 1217ms ≈ `ceil(69/16)×250ms`). Fix trong `MatchCommandService`: BATCH=128,
  vòng đọc tự re-arm (setInterval chỉ còn là safety net), XAUTOCLAIM tách sang
  cadence 5s. **p95 1126→201ms (−82%), CPU không đổi.** 1369/1369 unit tests.
- **Nghẽn #2: pg pool default 10/node (không ai set).** Trần cứng 30 connection
  cạn ở 1600 VU (backends 31/31 all-active) trong khi Postgres còn 3× dư. →
  `DB_POOL_MAX` env (default 10 giữ nguyên), compose multi set 20/node +
  `PG_MAX_CONNECTIONS` sweepable. Pool sweep + interleaved repeats: trần cứng là
  thật, chênh latency giữa 20/32 là nhiễu (variance 146→1011ms cùng setting).
- **Capacity envelope:** answer p95 **201@800 → 357@1600 → 669@3200** — tuyến
  tính, 0 connect error mọi scale, socket chia đều 3 node, Redis adapter peak 59%.
  Run 3200 "nén" fail p95 2.12s là **rig** (k6 chung máy + harness REST polling
  qua nginx peak 529% làm cạn 12 core), không phải app — cùng 3200 giãn nhịp
  storm → 669ms, không đổi code. Chi tiết + số cần thuộc: `career-assessment.md`
  §2026-07-28; artifacts: `load-test/results/multi-*` + 2 sweep TSV.
- Nghẽn đã định vị chưa sửa: 26% query là no-op `IN (NULL)` (Prisma nested read
  trên set rỗng); `rooms.status` seq scan (sweep 6 lần/30s cả idle).
- Chưa commit tại thời điểm ghi — 9 file (consumer fix + spec, package.json,
  app.module, prisma.service, compose multi, load-test auth).

## What Is Done

- Server-authoritative match loop.
- Match state persistence / rehydrate path with Redis snapshots.
- Reconnect snapshot flow.
- Late join spectator baseline via `JoinMode = "SPECTATOR"`.
- Eliminated player spectator UI.
- Admin room termination baseline.
- Admin kill-switch append-only audit event + paginated audit query.
- Profile/rankings real APIs.
- CSRF, throttling, and Zod validation baseline.
- Socket handlers split into `AuthHandler`, `RoomHandler`, `MatchHandler`.
- Moderation MVP boundary filtering / sanitizer (NFKD Unicode normalization, diacritic stripping, and post-masking re-validation).
- `Room.maxPlayers` realtime payload exposure.
- Optimistic answer rollback + server-side idempotency replay keyed by `submissionId`.
- Reconnect/event replay contract behind `lastSeenSeqNo` (delta `EVENT_BATCH` vs full `SNAPSHOT`, client-driven cursor). Reconnect auto-push still full — see deferred item under 2026-07-11.

## What Is Not Done Yet

- Single-room Plan A baseline: the 100-user table + P2 (spectator transport
  split) conclusion in `load-test/README.md` are still unfilled. This is the
  only k6 evidence still missing — multi-node k6 at 800→3200 VU ran for real
  on 2026-07-28 (see that milestone + `load-test/results/`). The Plan A
  harness itself (scenarios, readiness barrier, `sample-monitoring.mjs`,
  `validate-results.mjs`, `% of 1 core` CPU convention) has been ready
  end-to-end since before that run.
- **Distributed match runtime (Stage B + C harness) — implemented, tested,
  and measured multi-node (k6, 2026-07-28); C3 chaos/failover RUN still
  pending.** Stage B shipped horizontal scale +
  failover: Redis Socket.IO adapter (cross-node fan-out), fenced owner-lease
  (`match:owner:<id>` = `nodeId:fence`, 15s TTL + 5s heartbeat), boot/orphan
  takeover with `resumeMatchLoop` rebuilding timers from persisted
  `phaseEndsAt`, owner-single-writer answers via a Redis command stream, and
  presence leader election — all with unit/integration specs (api suite
  1369/1369). Stage C measurement harness is complete: C1 distribution poller
  (`load-test/scripts/poll-distribution.mjs`), C2 generation-token reconnect
  wrapper (`load-test/lib/reconnect.js`, 5 vitest cases), C3 chaos
  orchestrator + pure PASS/FAIL/INCONCLUSIVE verdict
  (`load-test/scripts/chaos-failover.mjs`, `load-test/lib/failover-verdict.mjs`,
  16 vitest cases). Architecture narrative + evidence plan:
  [`docs/architecture-distributed.md`](../docs/architecture-distributed.md).
  **2026-07-28: the multi-node k6 RUN is done** (800→3200 VU, see the
  2026-07-28 milestone above + `load-test/results/`); still outstanding: the
  C3 chaos/failover RUN (failover timeline numbers) and the single-room
  100-user Plan A baseline table + P2 conclusion in `load-test/README.md`.
- Server-side delta push on auth reconnect still full SNAPSHOT (`auth.handler.syncReconnection`). Client-driven delta after re-auth is shipped: socket store calls `REQUEST_SNAPSHOT(matchId, lastSeenSeqNo)` on `AUTHENTICATED` when match context survives disconnect.
- Spectator transport split for scale.
- Full WCAG / Playwright / rematch work.

## Content Roadmap (chốt 2026-07-28)

> Thứ tự theo **dependency + rủi ro scope + động lực**, không theo độ hoành tráng.
> Cả 3 content đều đụng `MatchStateMachine`/match flow → mỗi phase bắt đầu bằng
> `gitnexus_impact` (symbol CRITICAL) như quy trình repo.

1. **Ban/pick draft phase** (~1-2 tuần) — làm ĐẦU TIÊN: scope tự khoanh vùng nhất
   (N ban, M pick, lượt xen kẽ, timeout auto-pick), nâng cấp mọi trận hiện có
   ngay (đánh vào gameplay "một màu"), và dạy cách thêm phase vào state machine
   mà Gauntlet cần lại. Phase mới phải đi qua đúng bộ máy distributed: timer
   rebuild từ `phaseEndsAt` khi failover, reconnect giữa draft hydrate qua
   `lastSeenSeqNo`, pick cross-node qua command stream. **DoD bắt buộc:** chaos
   test kill node giữa lượt ban → draft resume đúng lượt, đúng đồng hồ (harness
   C3 có sẵn) — đây là câu chuyện phỏng vấn mới.
2. **Elo + ranking — tách hai nửa:**
   - **2a. Rating engine** (~vài ngày): tính/update Elo trong `finishMatch`
     transaction, persist, hiện leaderboard + profile (rankings module có sẵn).
     Không cần queue. Quick-win chen được bất kỳ lúc nào; cho trận đấu stakes.
   - **2b. Matchmaking queue** (~1-2 tuần, SAU 2a): bài khó thật là atomic
     pairing cross-node (chống double-match — dùng toolkit single-writer/lease
     sẵn có). Queue không người = feature chết trong demo → cần rating tồn tại
     trước cho flow "ranked queue → draft → match" có nghĩa; cân nhắc bot
     backfill cho demo.
3. **Roguelike "Gauntlet"** (~2-4 tuần, SAU CÙNG) — không phải vì kém hay mà vì
   rủi ro scope cao nhất + nặng frontend nhất. **Điều kiện bắt đầu: scope-lock
   một trang TRƯỚC dòng code đầu tiên** — một mode duy nhất (run theo party,
   mỗi round một modifier, thua là hết run), 6-8 modifier chốt cứng, không
   meta-progression ở v1. Ràng buộc kỹ thuật từ ngày đầu: modifier roll =
   **seeded RNG server-side nằm TRONG event log**, không thì replay/reconnect
   contract vỡ với mode mới.

**Điểm dừng an toàn nếu có phỏng vấn trong ~1 tháng: sau 2a** — repo khi đó có
failover numbers + draft phase + ranked stakes; queue/Gauntlet kể ở dạng design
đang làm. Không ghi Phase 0 (nợ 2026-07-28) — đang được commit.

**KHÔNG làm cho mục đích wow** (đã cân nhắc và loại 2026-07-28): CRDT (mâu thuẫn
server-authoritative by design), physics/lockstep (sai thể loại game), hash-ring
sharding (ownership per-match đã là shard theo match; thêm hash ring ở 32
match/3 node là over-engineering). Nếu muốn thêm một bài systems-hard nữa thì đó
là **Redis HA (Sentinel)** — biến câu probe "Redis chết thì sao?" thành running
code — chứ không phải 3 món trên.

## Priority Queue

### P0 — Docs + Memory-Bank Consolidation

- Keep only 4 default core docs for agent context.
- Keep supplementary memory-bank docs as historical references.
- Keep `systemPatterns.md` truth-based: implemented vs planned patterns must be explicit.

### P1 — Near-Term Implementation

1. **k6 Load Test & Failover Verification**
   - Multi-node k6 load test (800→3200 VU) completed. Pending: C3 chaos/failover RUN and Plan A single-room 100-user baseline.
2. **AFK Docs + UX Hardening** — ✅ done (Track C, 2026-07-11)
   - Semantics verified across all 3 layers (state machine → round runner → UI); documented in `docs/afk-policy.md`.
   - No `MatchStateMachine` change (public API unchanged); FE now surfaces elimination reason (wrong / timeout) + reconnect snapshot hydrates spectator state.
3. **Admin Audit Panel UI** — ✅ done
   - Backend audit baseline exists; UI/filter/pagination closeout shipped.
   - FE consumes `GET /admin/audit-events` via `lib/api/audit.ts` +
     `hooks/use-audit-events.ts` (offset pagination, DTO-matched filters:
     eventType/roomId/adminUserId — no date filter, backend DTO has none).
   - Route `admin/audit/page.tsx` (role-guarded) with `components/admin/`
     `audit-table.tsx` + `audit-filters.tsx`; skeleton/empty/error states;
     i18n keys under `admin.audit` (en/vi); vitest specs green.
4. **Replay Contract** — ✅ done (Track D, 2026-07-11)
   - `submissionId` idempotency + `lastSeenSeqNo` delta replay both shipped. Reconnect: server still full SNAPSHOT; client re-requests with cursor on AUTHENTICATED.

### P2 — Evidence / Scale

1. Plan A single-room 100-user WebSocket load test baseline (points to the pending P1 #1 deliverable; next phase evaluation for spectator transport decisions).
2. Decide spectator SSE / transport split based on measured load, not speculation.

### P3 — Post-MVP / UX Closeout

- WCAG sweep.
- Playwright browser E2E.
- Post-match rematch + share.
- Bot/demo system.
- Deeper device fingerprint / shadow-ban system.

## Locked Decisions

- Wrong answer or no answer before active round deadline => eliminated in that round.
- Eliminated player remains connected as spectator/watch-only UI.
- Drop-in late joiner for `IN_GAME` / `FINISHED` joins as `SPECTATOR`.
- Monolith-first for product features; the **distributed match runtime is now
  implemented** (Redis adapter + fenced owner-lease + failover, Stage B) and its
  scale/failover is demonstrable via the Stage C harness — distribution is no
  longer merely deferred, only the multi-node measurement run is outstanding.
  Spectator SSE/transport split stays deferred until that run gives load evidence.
- Command Pattern is not needed for current socket use cases.
- Factory Pattern is currently only `createEvent()`; other factories are future seams.
- Tie-break is deterministic but not Strategy Pattern yet.

## Pattern / Architecture Notes

- `MatchStateMachine` is real and central. Broad class-level refactors are high risk because many execution flows depend on it.
- `tieBreak` may be a good future Strategy refactor because its direct blast radius is low.
- Socket event handlers are handler/dispatcher style, not Command Pattern.
- Socket.io broadcast is observer-like transport behavior, not explicit Observer Pattern.

## Supplementary / Legacy Docs

Files such as `issue.md`, `projectbrief.md`, `techContext.md`, `career-assessment.md`, `frontend-enterprise-followups.md`, `coverage-cleanup.md`, `errorHandlingPattern.md`, and `processTechDebt.md` remain available for historical context, but they are not default agent context.
