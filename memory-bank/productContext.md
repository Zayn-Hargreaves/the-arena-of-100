# Product Context: Arena of 100

> **Core memory-bank file 1/4**  
> Read order: `AGENTS.md` -> `productContext.md` -> `systemPatterns.md` -> `progress.md` -> `activeContext.md`  
> Recruiter & System Design overview: see `recruiter-summary.md`

## Product Overview

**Arena of 100** is a real-time multiplayer quiz battle royale game where 100 players enter the arena simultaneously, answering timed trivia questions under high-stakes pressure (15s per round). An incorrect or missed answer results in immediate elimination. The last player standing wins the match.

### Core Value Propositions:

- **High-Stakes Thrill**: Fast-paced battle royale tension with instant elimination.
- **Zero-Friction Onboarding**: Instant guest onboarding (nickname + avatar seed) with zero password or signup friction.
- **Engaging Spectator Mode**: Eliminated players transition smoothly into a real-time watch-only spectator view with live reactions.
- **Deep Tactical Gameplay**: A dual-class system (Offense / Defense) paired with 18 tactical cards brings strategic depth to traditional trivia games.
- **Fair Play & Competitive Ranking**: Precise Elo rating engine, strict server-authoritative anti-cheat validation, and Daily Challenge streaks.

---

## Core User Journey

1. **Landing & Onboarding**: Player visits the web app, inputs a nickname, and selects a generated avatar.
2. **Matchmaking & Room Discovery**:
   - Queue up for ranked matchmaking via Elo rating (Redis ZSET queue with intelligent bot backfill).
   - Or create/join custom private and public rooms via 6-character room codes or direct links.
3. **Class & Tactical Card Allocation**: Players are randomly assigned to Offense or Defense classes and receive tactical cards.
4. **Real-time Match Loop**:
   - 15s round window: synchronized trivia question delivery across all connected clients.
   - Play tactical cards (Shields, Double Points, Freeze opponents, Reveal hints).
   - Submit answers with instant optimistic client UI backed by server-side validation.
5. **Instant Elimination & Spectating**: Wrong or expired answers eliminate players immediately; eliminated players continue watching in real-time spectator mode.
6. **Tie-Break & Victory Screen**: Determines the winner based on response timestamp precision and accuracy, awards Elo points, and provides shareable match statistics.

---

## Locked Product Decisions

### 1. Onboarding & Identity

- **Guest-First**: Instant passwordless authentication; sessions tracked via stateless JWT tokens with Redis session state.
- **Sanitized Identity**: Automatic profanity filtering and sanitization on player nicknames prior to room entry.

### 2. Match & Elimination Semantics

- **Strict Elimination Rule**: Wrong answer OR missed round deadline = **ELIMINATED IN THAT ROUND**.
- **Spectator UI**: Sockets remain connected to receive match state updates in watch-only mode; spectators cannot submit answers.

### 3. Tactical Depth: Class & Cards Hybrid

- **Two Classes**: Offense and Defense classes allocated randomly server-side.
- **18 Tactical Cards**: Card effects are batch-resolved immediately (`CARD_RESOLVED_BATCH` <= 50ms) to ensure fairness and clock-drift resilience.
- **Cosmetics & Progression**: Daily Challenge streaks (>= 7 days) unlock Neon and Gold cosmetic card variants.

### 4. Competitive Integrity

- **Server-Authoritative Anti-Cheat**: Clients send _intent_ only; all countdown timers, answer validations, and scoring are computed server-side.
- **Monotonic Replay Hydration**: Reconnecting players automatically catch up missing events through the Delta Replay contract (`EVENT_BATCH`) without match disruption.

---

## Completed Feature Matrix

| Feature Area                 | Status     | Key Characteristics                                                        |
| :--------------------------- | :--------- | :------------------------------------------------------------------------- |
| **100-Player Battle Royale** | Production | 15s round loop, instant elimination, sudden-death tiebreak                 |
| **Class + Card System**      | Production | 2 classes, 18 cards, batch resolution, streak variants                     |
| **Elo & Matchmaking**        | Production | Dynamic K-factor, Redis ZSET queue, bot auto-backfill                      |
| **Daily Challenge Mode**     | Production | Daily curated sets, streak tracking, unlockable cosmetics                  |
| **Spectator Experience**     | Production | Drop-in watch mode, real-time match state observation                      |
| **Resilience & Reconnect**   | Production | Monotonic `seqNo` delta replay, Redis Sentinel automatic failover          |
| **Anti-Cheat & Security**    | Production | Server authority, idempotent submissions (`submissionId`), profanity guard |
