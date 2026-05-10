# System Patterns: Arena of 100

## Architecture Overview
**Modular Monolith** with clear layer separation. All game logic runs on server; client is presentation-only. Architecture designed to support product-focused features like frictionless onboarding, spectator modes, and social engagement, while emphasizing operational excellence, resilience, and international standards compliance.

## Design Patterns Applied

### 1. State Pattern (GoF)
**Where**: `MatchStateMachine` in `packages/game-core`
- Encapsulates match state transitions (CREATED → COUNTDOWN → ROUND_ACTIVE → ROUND_EVALUATING → ROUND_RESULT → FINISHED)
- Each state defines valid transitions and behaviors
- Prevents invalid state changes (e.g., can't submit answer when match is FINISHED)
- Extended to support player role transitions (ACTIVE → ELIMINATED → SPECTATOR)
- Supports AFK player detection and conversion
- Manages lobby lifecycle states (WAITING → COUNTDOWN → IN_GAME → FINISHED)

### 2. Command Pattern (GoF)
**Where**: Socket event handlers
- Each client action (JoinRoom, SubmitAnswer, StartMatch) is a command
- Commands are validated, executed, and may produce events
- Decouples request from execution
- Host-only commands for match control
- Spectator-mode restricted commands
- Graceful exit commands for instant resource cleanup

### 3. Observer Pattern (GoF)
**Where**: Real-time event broadcasting
- Server emits events to subscribed channels (room:{id}, match:{id}, spectator:{id})
- Clients observe and react to state changes
- Supports multiple observers per event
- Separate channels for spectators to reduce bandwidth
- Optimized payloads for different observer types
- Batched events for micro-interactions (emotes, reactions)
- **Scalable infrastructure with SSE for mass spectators**

### 4. Strategy Pattern (GoF)
**Where**: Tie-break logic, bot behavior, content delivery, and error handling
- `tieBreak()` method uses strategy to determine winner
- Can swap tie-break algorithms without changing caller
- Current: total response time → correct answers count → random
- Bot response time and accuracy as configurable strategies
- Question delivery algorithms for anti-repetition
- **Error handling strategies for content failures**
- **Asset loading strategies with fallback mechanisms**

### 5. Factory Pattern (GoF)
**Where**: Event creation, bot player creation, avatar generation, and content moderation
- `createEvent()` factory produces correctly structured events
- Ensures consistent event format across codebase
- Simplifies event creation for callers
- `BotFactory` creates configurable bot players
- `AvatarFactory` generates unique visuals from nicknames
- `EmoteFactory` creates standardized emote events
- **`ContentModerationFactory` filters inappropriate content**

### 6. Template Method Pattern (GoF)
**Where**: NestJS module structure
- Each module follows same template: module → service → controller
- Provides consistency and predictability
- Simplifies adding new features
- Supports product feature extensions

## Anti-Patterns Avoided

### ✗ God Object
- Each service has single responsibility
- Game logic isolated in `game-core` package
- No massive "GameManager" class

### ✗ Spaghetti Code
- Clear layer boundaries: transport → application → domain → infrastructure
- Dependencies flow inward (transport depends on domain, not vice versa)
- Domain has zero external dependencies

### ✗ Race Conditions
- Server-authoritative timestamps (not client)
- Redis atomic operations (INCR, SADD)
- State machine prevents invalid transitions
- Player role transitions are atomic

### ✗ Poor User Experience
- No account creation barriers for Time-to-Fun optimization
- No rejection of late joiners
- No ghost players blocking game progression
- No repetitive content ruining replayability
- No instant feedback for critical actions
- No administrative oversight for emergencies

### ✗ Performance Bottlenecks
- No unbatched micro-interactions overwhelming event loop
- No blocking operations during critical gameplay
- No inefficient asset loading causing unfairness

### ✗ Security Vulnerabilities
- No unchecked user-generated content
- No rate limiting bypasses
- No inadequate access controls
- No device fingerprinting for persistent identity

### ✗ Accessibility Issues
- No color-only information传达
- No keyboard navigation barriers
- No screen reader incompatibilities

## Code Organization Principles

### Clean Architecture Layers
```
transport/     → HTTP/WebSocket endpoints
application/   → Use cases / command handlers
domain/        → Entities, rules, state machines
infrastructure/→ DB, Redis, external services
```

### Dependency Rule
- Inner layers know nothing about outer layers
- Domain logic is pure (no DB, no HTTP)
- Infrastructure implements interfaces defined in domain

## Concurrency Patterns

### Redis Atomic Operations
- `INCR` for sequence numbers
- `SADD/SREM` for player sets (thread-safe)
- `SET NX` for distributed locks (future)
- Atomic player role transitions
- Session management for frictionless onboarding

### Event Sourcing
- All state changes are events
- Events are append-only (no updates/deletes)
- Can replay events to reconstruct state
- Supports audit and debugging
- Spectator events optimized for minimal payload
- AFK detection through event pattern analysis

## Performance Optimization Patterns

### Event Batching and Throttling
**Where**: Micro-interactions (emotes, reactions)
- Batch similar events (emotes) before broadcasting
- Throttle high-frequency events to prevent overload
- Use Redis queues for event buffering
- Implement sliding window rate limiting
- Optimize WebSocket payload sizes
- **Separate channels for players and spectators**

### Asset Preloading
**Where**: Rich media content delivery
- Background fetching during round transitions
- Client-side caching with expiration
- Progressive loading for large assets
- Fallback mechanisms for failed loads
- Bandwidth-aware loading strategies
- **Graceful error handling for content issues**

### Connection Management
**Where**: Graceful exit and resource cleanup
- Immediate connection cleanup on disconnect
- Resource pooling for efficient reuse
- Timeout-based cleanup for orphaned resources
- Memory leak prevention patterns

## Error Handling

### Typed Errors
- Custom `ErrorCode` enum in shared package
- Each error has Vietnamese message
- Consistent error format across API
- Specific errors for spectator mode and host controls
- Graceful degradation for late joiners
- **Content moderation errors**

### Graceful Degradation
- Reconnect restores state from snapshot
- Missing events fetched and replayed
- Network issues don't crash game
- Spectators gracefully handle match state changes
- Late joiners smoothly transition to spectator mode
- **Question skipping for content errors**
- **Asset fallback for loading failures**

## Scalability Considerations

### Event Loop Protection
- Micro-interactions are batched and throttled
- High-frequency events use worker threads
- Non-blocking I/O for all operations
- Memory pressure monitoring and management

### Resource Management
- Connections cleaned up immediately on exit
- Assets cached and reused across sessions
- Memory leaks prevented through proper disposal
- Garbage collection optimized for real-time performance

### Mass-Spectator Handling
- **Separate communication channels for players (WebSocket) and spectators (SSE)**
- **Batched updates for spectators (1-second intervals)**
- **Reduced payload sizes for spectator events**
- **Horizontal scaling for spectator services**

## Security Patterns

### Content Moderation
**Where**: User-generated content filtering
- **Profanity filtering for nicknames and chat**
- **Shadow banning for repeat offenders**
- **Rate limiting for name changes**
- **Content validation at input boundaries**

### Anonymous Identity Tracking
**Where**: Device fingerprinting and persistent guest identity
- **Browser fingerprinting (Canvas, WebGL, User-Agent)**
- **IP address correlation for stronger identity binding**
- **Device ID generation and persistence**
- **Backend enforcement of device-level bans**
- **Shadow ban effectiveness across sessions**

### Access Control
**Where**: Room and match permissions
- Host-only controls for private rooms
- Spectator restrictions on gameplay actions
- Rate limiting for API endpoints
- Session validation for all requests

## Accessibility Patterns

### WCAG Compliance
**Where**: User interface and interaction design
- **ARIA labels for screen readers**
- **Keyboard navigation support**
- **Color-blind friendly design with icons**
- **Contrast ratios meeting WCAG standards**
- **Focus indicators for interactive elements**

### Inclusive Design
**Where**: All user interactions
- **Multiple input methods supported**
- **Text alternatives for visual content**
- **Customizable UI elements**
- **Internationalization support**

## Optimistic UI Patterns

### Instant Feedback
**Where**: Answer submission and user interactions
- **UI lock-in on user action for perceived performance**
- **Internal loading states without server dependency**
- **Visual feedback for all user interactions**
- **Graceful rollback for rejected submissions**

### Smart Recovery
**Where**: Network resilience and error handling
- **Automatic retry with idempotency keys**
- **Exponential backoff for failed requests**
- **Connection state monitoring**
- **Graceful degradation for offline scenarios**

## Game Operations Patterns

### Administrative Control
**Where**: Emergency interventions and maintenance
- **Force kill capabilities for rooms/matches**
- **Global broadcast messaging system**
- **Question voiding mechanism**
- **Emergency shutdown procedures**

### Observability
**Where**: System monitoring and debugging
- **Comprehensive logging for all operations**
- **Real-time metrics and dashboards**
- **Audit trails for administrative actions**
- **Health checks for all services**

## Resilience Patterns

### Circuit Breaker
**Where**: External service dependencies
- **Fallback mechanisms for CDN failures**
- **Graceful degradation for asset loading**
- **Automatic retry with exponential backoff**
- **Health checks for service dependencies**

### Fault Tolerance
**Where**: Critical game operations
- **Question skipping for content errors**
- **Snapshot-based recovery for connection issues**
- **Event replay for missed updates**
- **Graceful shutdown procedures**