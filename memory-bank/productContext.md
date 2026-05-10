# Product Context: Arena of 100

## Why This Project Exists
Arena of 100 solves the problem of engaging multiplayer quiz experiences by combining the thrill of battle royale games with knowledge-based competition. Traditional quiz games lack the tension and excitement of elimination-style gameplay.

The project also demonstrates product engineering skills valued by top tech companies - focusing on complete user journeys, thoughtful onboarding, social features, and retention mechanics rather than just technical patterns. It emphasizes operational excellence, resilience, and international standards compliance.

## User Experience Goals

### Primary User Journey
1. **Entry**: User opens app → sees landing page with clear CTAs
2. **Frictionless Onboarding**: Quick nickname entry with auto-generated avatar and content moderation
3. **Room Selection**: Create new room or join existing via code/link
4. **Lobby Management**: Auto-start countdown or host controls with heartbeat validation
5. **Gameplay**: Real-time question display, 15s timer, instant feedback with error handling
6. **Elimination**: Clear visual feedback when eliminated
7. **Spectator Mode**: Eliminated players become spectators with micro-interactions
8. **Victory**: Celebratory screen for winner with stats and rematch option
9. **Anonymous Identity Tracking**: Device fingerprinting for persistent guest identity
10. **Optimistic UI**: Instant feedback on answer submission with smart retry
11. **Game Operations**: Admin interventions for emergency situations

### Emotional Design
- **Tension**: Countdown timers, player elimination animations
- **Excitement**: Real-time updates, sound effects (future)
- **Clarity**: Clear UI states (active, eliminated, spectator, winner)
- **Engagement**: Spectator mode with emotes keeps eliminated players involved
- **Fairness**: Transparent rules, server-authoritative timing
- **Social Connection**: Unique player identities and sharing capabilities
- **Accessibility**: WCAG compliant design for all users
- **Reliability**: Graceful error handling and fallback mechanisms
- **Trust**: Persistent identity even as guest user
- **Confidence**: Instant feedback on actions with smart recovery
- **Safety**: Admin oversight for emergency interventions

## Key User Scenarios

### Scenario 1: Quick Match
- User wants to play immediately
- Clicks "Find Quick Match"
- System joins available public room
- Auto-start countdown begins when minimum players join with heartbeat validation
- Game starts automatically

### Scenario 2: Private Game
- User creates private room
- Shares 6-character code with friends
- Friends join via code
- Host starts match when ready or auto-start kicks in

### Scenario 3: Late Join Spectating
- User clicks shared link to ongoing match
- Automatically enters spectator mode via scalable infrastructure
- Watches current gameplay in real-time
- Gets notified when next match starts
- Can use emotes to react to gameplay

### Scenario 4: Reconnect
- Player loses internet briefly
- Reconnects automatically
- Game state restored via snapshot
- Continues from where they left off

### Scenario 5: Elimination and Spectating
- Player answers incorrectly and is eliminated
- Player automatically becomes spectator
- Continues watching remaining players compete
- Receives real-time updates on match progress
- Can use emotes to cheer/frown at gameplay

### Scenario 6: AFK Player Handling
- Player joins room but goes AFK
- System detects inactivity after 2 missed rounds
- Automatically moves player to spectator mode
- Frees slot for active players

### Scenario 7: Graceful Exit
- Player decides to leave game
- Clicks "Leave" button or closes tab
- Slot immediately freed for new players
- Proper disconnection handling

### Scenario 8: Asset Preloading
- Between rounds, system preloads media assets
- Next question loads instantly when displayed
- Fair experience maintained for all players
- Smooth gameplay on mobile devices

### Scenario 9: Content Error Handling
- Question asset fails to load (CDN down, encoding error)
- System automatically skips question with graceful error message
- Game continues without interruption
- Players notified of technical issue

### Scenario 10: Accessibility Support
- Color-blind user accesses game
- Sees color-blind mode with icons accompanying colors
- Navigates game entirely with keyboard
- Uses screen reader for question content

### Scenario 11: Content Moderation
- User attempts to enter inappropriate nickname
- System filters content and assigns random name
- User notified of content policy violation
- Shadow ban applied if violations continue

### Scenario 12: Match Completion
- Match concludes with winner determination
- All players see victory/defeat screen
- Statistics displayed for all participants
- Option to play again or return to lobby

### Scenario 13: Anonymous Identity Tracking
- User accesses game as guest on new device
- System generates device fingerprint (Canvas, WebGL, User-Agent)
- Correlates with IP address for stronger identity
- Assigns persistent deviceId for content moderation
- User attempts to evade ban by clearing cookies → System recognizes device fingerprint
- Shadow ban remains effective across sessions

### Scenario 14: Optimistic UI & Answer Lock-in
- Player clicks answer during critical gameplay moment
- UI instantly locks and shows loading state
- Player sees immediate feedback regardless of network latency
- If server accepts answer → UI proceeds normally
- If server rejects answer → UI gracefully rolls back with explanation
- If network failure → System automatically retries with idempotency key

### Scenario 15: Game Operations & Kill Switch
- Admin detects zombie room with stuck players
- Admin uses force kill command to terminate room
- System broadcasts maintenance message to all connected users
- During live match, erroneous question detected
- Admin voids question without disrupting match flow
- Critical security incident requires emergency shutdown
- Admin activates kill switch to safely shut down service

## Differentiators
- **100 players**: Massive multiplayer scale
- **Battle Royale**: Elimination creates tension
- **Real-time**: Instant feedback, no page refreshes
- **Tie-break**: Fair resolution when multiple eliminated
- **Reconnect**: Robust against network issues
- **Spectator Mode**: Keeps eliminated players engaged with emotes
- **Frictionless Onboarding**: No account creation barriers with content moderation
- **Late Join Support**: Drop-in spectating for ongoing matches with scalable infrastructure
- **Smart AFK Handling**: Automatic player management
- **Graceful Exit**: Instant resource cleanup
- **Asset Preloading**: Fair experience for all players
- **Error Resilience**: Graceful fallback for content issues
- **Accessibility**: WCAG compliant design
- **Content Safety**: Profanity filtering and moderation
- **Complete Journey**: From entry to victory with rematch capability
- **Advanced Security**: Device fingerprinting prevents ban evasion
- **Optimistic UI**: Instant feedback with smart recovery mechanisms
- **Operational Excellence**: Admin tools for emergency interventions