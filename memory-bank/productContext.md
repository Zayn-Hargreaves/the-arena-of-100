# Product Context: Arena of 100

> **Core memory-bank file 1/4**
> Read order: `AGENTS.md` → `productContext.md` → `systemPatterns.md` → `progress.md` → `activeContext.md`
> Other docs in `memory-bank/` are supplementary only.

## Why This Product Exists

Arena of 100 là game quiz battle royale real-time: 100 người chơi cùng vào trận, trả lời sai hoặc không trả lời đúng hạn thì bị loại, người cuối cùng còn sống thắng.

Mục tiêu sản phẩm:

- tạo trải nghiệm quiz có căng thẳng và nhịp độ thật
- cho phép guest onboarding nhanh, không cần tạo tài khoản
- giữ eliminated players ở lại trận bằng spectator/watch-only UX
- chứng minh product-engineering quality: resilience, fairness, operations, test coverage

## Core User Journey

1. Người dùng vào landing page
2. Nhập nickname + avatar seed nhanh
3. Tạo phòng hoặc join bằng code/link
4. Public room auto-start; private room do host control
5. Match chạy server-authoritative với 15s/round
6. Sai hoặc không trả lời đúng hạn => bị loại
7. Player bị loại tiếp tục xem trận ở spectator UI
8. Match kết thúc, xem result/stats

## Product Decisions Locked

### 1. Onboarding

- **Guest-only** cho MVP
- nickname + avatar seed là identity bề mặt
- persistent guest identity / device fingerprint là follow-up sau MVP

### 2. Match semantics

- **Wrong answer OR no answer before round deadline = ELIMINATED ngay round đó**
- Sau khi bị loại, player vẫn nhận update và client render ở **spectator/watch-only UI**
- Đây là semantics thật của game-core; core docs không dùng lại rule cũ "2 missed rounds" nữa

### 3. Spectator semantics

- Người chơi bị loại => spectator UI trong cùng match
- Late join match `IN_GAME`/`FINISHED` => `JoinMode = "SPECTATOR"`
- Spectator không được submit answer

### 4. Moderation direction

- **MVP moderation chỉ làm vừa đủ**:
  - nickname profanity filtering + safe replacement
  - admin terminate message sanitize hoặc fallback message mặc định
- Các phần sau defer:
  - device fingerprint enforcement
  - violation counter
  - shadow ban
  - richer multilingual dictionaries

### 5. Scaling direction

- **Monolithic-first**
- Chưa ưu tiên spectator transport distributed/SSE riêng cho tới khi có load evidence
- `k6` là workstream riêng để tạo evidence trước

## UX Principles

- **Fairness**: toàn bộ timing/validation ở server
- **Clarity**: trạng thái active / eliminated / spectator / finished phải rõ
- **Low friction**: onboarding nhanh, không reject cứng trừ khi thật sự cần
- **Resilience**: reconnect, snapshot, graceful exit, admin kill-switch
- **Safety**: moderation ở mức MVP trước, deepen sau

## Near-Term Product Queue

1. `Room.maxPlayers` payload thật ở game UI
2. Optimistic answer rollback
3. AFK docs + UX hardening bám semantics hiện tại
4. Moderation MVP
5. Admin audit panel UI (optional closeout)
6. k6 load test 100 concurrent WS (separate PR)

## Deferred After MVP or After Evidence

- Mass-spectator SSE/distributed transport
- Full device fingerprint + shadow ban
- Full WCAG sweep
- Playwright browser E2E
- Post-match rematch + share

## Supplementary / Legacy Docs

Các file như `projectbrief.md`, `issue.md`, `career-assessment.md`, `frontend-enterprise-followups.md`, `techContext.md` vẫn được giữ lại, nhưng không còn là nguồn truth mặc định cho agent.
