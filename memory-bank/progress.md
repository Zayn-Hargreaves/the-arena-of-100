# Progress: Arena of 100

> **Core memory-bank file 3/4**
> Đây là timeline rút gọn + queue hiện tại. Chi tiết lịch sử sâu hơn được giữ trong git history và supplementary docs.

## Current Status

**Baseline hiện tại đã xong:** lobby lifecycle, heartbeat, graceful exit, admin kill-switch, drop-in spectating, race/correctness hardening, gateway/schema tightening, admin audit backend.

### Latest verified numbers

- API unit tests: **792/792**
- Game-core tests: **70/70**
- Web tests: **31/31**
- Shared tests: **3/3**
- E2E tests: **11/11**

## Completed Milestones

### 2026-06-06

- Profile + rankings real APIs
- CI/E2E hardening

### 2026-06-07 / 2026-06-08

- Lobby lifecycle baseline
- Heartbeat/presence sweep
- Graceful exit baseline

### 2026-06-14

- Design System Phase 5B closeout
- Admin kill-switch baseline
- Drop-in spectating baseline
- Match race + frontend correctness hardening (B1-B3, F1-F8)
- Post-merge recovery/idempotency hardening (B4-B7, L1)

### 2026-06-18

- Gateway + schema tightening + home gradient cleanup (L2, L3, PR 6)
- Admin audit backend:
  - `EventLog` schema expansion
  - `appendAudit()`
  - `GET /admin/audit-events`
  - full backend tests + coverage pass

## What Is Done vs Not Done

### Done

- Server-authoritative match loop
- Reconnect snapshot flow
- Late join spectator baseline
- Eliminated spectator UI
- Admin room termination
- Backend audit trail for admin actions

### Not done yet

- `Room.maxPlayers` realtime payload exposure
- Full optimistic answer rollback
- Moderation MVP boundary filtering
- k6 load evidence for 100 concurrent WS
- Spectator transport split for scale
- Full accessibility / Playwright / rematch work

## Priority Queue

### P0 — Docs + memory-bank consolidation

- Sync `plan.md`
- Shrink memory-bank into 4 core files
- Point `AGENTS.md` to those 4 files only

### P1 — Near-term implementation

1. `Room.maxPlayers` payload
2. Optimistic answer rollback
3. Moderation MVP
4. Optional admin audit panel UI

### P2 — Evidence / infra

1. `k6` load test PR riêng
2. Dựa trên số đo mới quyết định spectator SSE/distributed transport

### P3 — Post-MVP or broader UX/compliance

- WCAG sweep
- Playwright browser E2E
- Post-match rematch + share
- deeper device fingerprint / shadow-ban system

## Locked Decisions From This Reset

- AFK semantics bám game-core: **miss active round deadline => eliminated ngay round đó**
- Bị loại xong thì client render ở spectator UI
- Moderation chỉ làm **MVP vừa đủ**, deeper enforcement defer sau MVP
- Monolithic-first; chưa ưu tiên distributed spectator infra ngay
- `k6` là PR riêng

## Supplementary / Legacy Docs

Các doc cũ vẫn được giữ lại, nhưng không còn là nguồn truth mặc định cho agent.
