# Project Brief: Arena of 100 - Game Đấu Trường 100

## Overview
Arena of 100 is a real-time multiplayer quiz battle royale game where 100 players compete by answering questions. Players who answer incorrectly are eliminated, and the last player standing wins.

The project demonstrates product engineering skills valued by top tech companies - focusing on complete user journeys, thoughtful onboarding, social features, and retention mechanics rather than just technical patterns. It emphasizes operational excellence, resilience, and international standards compliance.

## Core Requirements

### MVP Features
1. **Frictionless Onboarding**: Guest access with nickname/avatar system and content moderation
2. **Lobby Lifecycle Management**: Auto-start countdown, host controls, and heartbeat validation
3. **Room Management**: Create/join public/private rooms with unique codes
4. **Core Game Loop**: 100 players answer questions, wrong = eliminated, last one wins
5. **Spectator Mode**: Eliminated players become spectators with micro-interactions
6. **Drop-in Spectating**: Late joiners can watch ongoing matches with scalable infrastructure
7. **AFK Sweeping**: Automatic handling of inactive players
8. **Graceful Exit**: Instant surrender/leave mechanism
9. **Asset Preloading**: Background asset fetching for rich media
10. **Runtime Question Fallback**: Graceful error handling for content issues
11. **Content Management**: Question pool with anti-repetition system
12. **Tie-break**: If multiple players eliminated simultaneously, winner determined by response time
13. **Sudden Death**: Exciting tie-break for final contestants
14. **Reconnect**: Auto-sync state when players reconnect (snapshot + missing events)
15. **Post-Match Flow**: Victory/defeat screen with statistics and rematch capability
16. **Analytics**: Basic leaderboard and question accuracy stats
17. **Accessibility**: WCAG compliant design with screen reader support
18. **Mass-Spectator Isolation**: Scalable infrastructure for large audiences
19. **Anonymous Identity Tracking**: Device fingerprinting for persistent guest identity
20. **Optimistic UI & Answer Lock-in**: Instant feedback with smart recovery
21. **Game Operations & Kill Switch**: Admin tools for emergency interventions

### Technical Requirements
- **Frontend**: Next.js + Zustand + Socket.io-client
- **Backend**: NestJS + Fastify + Socket.io + Prisma + PostgreSQL + Redis
- **Architecture**: Modular Monolith with Event-Driven patterns
- **State Management**: Server-authoritative state machine (anti-cheat)
- **Real-time**: WebSocket for players, Server-Sent Events for spectators
- **Performance**: Event batching and throttling for micro-interactions
- **Resilience**: Graceful error handling and fallback mechanisms
- **Security**: Content moderation and rate limiting

## Success Criteria
- [ ] Players can create/join rooms with frictionless onboarding and content moderation
- [ ] Game loop works: start → round → answer → eliminate → spectator → winner
- [ ] Lobby lifecycle management with auto-start/host controls and heartbeat validation
- [ ] Drop-in spectating for late joiners with scalable infrastructure
- [ ] AFK sweeping for inactive players
- [ ] Graceful exit with instant resource cleanup
- [ ] Asset preloading for fair media delivery with fallback handling
- [ ] Runtime question fallback for content errors
- [ ] Reconnect restores game state
- [ ] Tie-break and sudden death logic work correctly
- [ ] Spectator mode functions properly with emotes and scalable infrastructure
- [ ] Post-match summary displays correctly with rematch capability
- [ ] Content delivery system prevents question repetition
- [ ] Accessibility features work correctly (screen reader, keyboard nav, color-blind mode)
- [ ] Mass-spectator isolation prevents server overload
- [ ] Basic UI is functional and responsive
- [ ] Anonymous identity tracking prevents ban evasion
- [ ] Optimistic UI provides instant feedback with smart recovery
- [ ] Game operations tools enable emergency interventions

## Scope Boundaries
### In Scope (MVP)
- Frictionless guest onboarding with persistent identity and content moderation
- Lobby lifecycle management (auto-start, host controls, heartbeat validation)
- Basic question pool with difficulty categorization
- Simple leaderboard
- Core game mechanics
- Spectator mode with micro-interactions and scalable infrastructure
- AFK player handling
- Graceful exit mechanism
- Asset preloading system with fallback
- Runtime question fallback
- Accessibility support (WCAG compliance)
- Mass-spectator isolation
- Post-match flow with rematch
- Anonymous identity tracking with device fingerprinting
- Optimistic UI with smart recovery mechanisms
- Game operations tools for emergency interventions

### Out of Scope (Post-MVP)
- Social features (friends, chat)
- Advanced analytics
- Tournament mode
- Bot injection system
- Monetization