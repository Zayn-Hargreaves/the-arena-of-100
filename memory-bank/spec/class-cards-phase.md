# Spec: Class + Card Hybrid — Arena of 100

> **Status:** LOCKED 2026-07-30
> **Owner:** product + shared + game-core + api + web
> **Timeline:** 8 tuần (Phase 1: Week 1-2 = 2 tuần / Phase 2: Week 3-6 = 4 tuần / Phase 3: Week 7-8 = 2 tuần)
> **Read order:** AGENTS.md → productContext.md → systemPatterns.md → progress.md → activeContext.md → **this file**

Spec này là source of truth cho 3 phase sắp tới. Bất kỳ thay đổi nào (scope card, architecture, timeline) đều phải:

1. Cập nhật file này trước
2. Reflect vào `activeContext.md` (decision log)
3. Reflect vào `progress.md` (timeline entry)

---

## 1. Mục tiêu & Vấn đề giải quyết

### Problem

Pure Q&A trivia đã bão hoà (Kahoot, QuizUp, HQ Trivia). Arena of 100 cần:

- **Acquisition**: hook viral để thu hút người mới (chưa từng chơi trivia PvP)
- **Retention**: cơ chế giữ chân sau khi đã vào lobby
- **Drama**: visual/social moments shareable được

### Solution (3 phases)

1. **Phase 1 — Daily Challenge (Week 1-2, 2 tuần)**: Wordle-style daily puzzle, shareable, streak counter, low acquisition cost
2. **Phase 2 — Class + Card Hybrid (Week 3-6, 4 tuần)**: 2 classes (Công / Thủ) random, 18 cards milestone, sabotage Công class + buff Thủ class
3. **Phase 3 — Integration & Polish (Week 7-8, 2 tuần)**: Daily streak → card variant cosmetic, profile stats, **C3-card-batch-failover**, VI i18n

### Out of scope (defer)

- Draft pre-match phase (orthogonal, ship sau)
- Elo + matchmaking queue (cần Daily + Card data thật)
- Territory mode (visual drama thêm, defer)
- Gauntlet roguelike standalone (replaced bởi class+card)
- Bot/demo system
- Full WCAG / Playwright

---

## 2. Decision Log (LOCKED)

| #   | Decision                  | Value                                                     | Rationale                                                                                         |
| --- | ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Class concept             | 2 classes (Công / Thủ)                                    | Đơn giản hoá từ 4 classes ban đầu; attack vs defense fantasy universal                            |
| 2   | Class assignment          | Random server-side mỗi match                              | Tránh meta pick, giảm selection bias / hỗ trợ fairness; noobs không cần hiểu class trước khi chơi |
| 3   | Card pool size            | 18 cards (10 Thủ + 8 Công)                                | Đã bỏ 2 toxic cards (Time Drain, Push Down)                                                       |
| 4   | Round duration            | 20s (giảm từ 30s plan cũ)                                 | Quiz cần pace nhanh; 30s quá chậm                                                                 |
| 5   | Card timing               | Overlay interrupt trong answer window                     | Card use không pause timer chung; target picker pause self 2s                                     |
| 6   | Effect encoding           | Discriminated union (13 variants)                         | TypeScript exhaustive switch compile-time check                                                   |
| 7   | Source of truth           | Event log extension (Track D compatible)                  | Reconnect re-derive từ event log, không transient state                                           |
| 8   | Clock drift               | Server sends `serverTimestamp` + `remainingMs`            | Client KHÔNG dùng `Date.now()` để so sánh với event timestamp                                     |
| 9   | Network                   | Immediate apply + ≤50ms `CARD_RESOLVED_BATCH` micro-batch | Effect apply ngay; WS batch chỉ tối ưu transport, không chờ endRound                              |
| 10  | AOE cap                   | 2 per lobby per round                                     | Server queue + informative error nếu slot full                                                    |
| 11  | Card `Time Drain`         | **BỎ**                                                    | Snowball debuff → quit pattern                                                                    |
| 12  | Card `Push Down`          | **BỎ**                                                    | Phá score determinism, gây frustration phi lý                                                     |
| 13  | Anti-grief                | Target cooldown 1/match + backfire 10% + visible anim     | Simpler than MARKED/Retaliate                                                                     |
| 14  | Marked + Retaliate system | **BỎ**                                                    | Thuộc Option D cũ, replaced bởi random class + reciprocity tự nhiên                               |
| 15  | Territory mode            | Defer vô thời hạn                                         | Class+card đã đủ drama                                                                            |
| 16  | Gauntlet standalone       | Scope-down (không làm riêng)                              | Class+card milestone cards = roguelike-lite                                                       |
| 17  | Timeline                  | 8 tuần total                                              | Phase 1: 2w, Phase 2: 4w, Phase 3: 2w                                                             |
| 18  | i18n                      | EN Phase 2, VI Phase 3                                    | EN trước để validate, VI sau khi có user demand                                                   |
| 19  | Card variant cosmetic     | Ship Phase 3                                              | Daily streak ≥ 7 unlock 1 card variant (border/glow, no effect change)                            |
| 20  | Ban/pick draft            | Defer (orthogonal)                                        | Có thể ship song song Phase 2 nếu có team                                                         |

---

## 3. Card Pool — 18 cards

### 3.1 Công (Offensive) — 8 cards

| #    | Card                 | Tier   | Effect Kind      | Effect Param                           | Backfire rate                      |
| ---- | -------------------- | ------ | ---------------- | -------------------------------------- | ---------------------------------- |
| CB-1 | **Time Freeze**      | Common | `TIMER_MODIFY`   | deltaMs=-5000, targetCount=1           | 0.1: apply to all eligible targets |
| CB-2 | **Sabotage Q**       | Common | `DELAY_RENDER`   | delayMs=3000, targetCount=1            | 0.1: self delayed 3s               |
| CB-3 | **Burn Card**        | Common | `HAND_DESTROY`   | destroy 1 random card in target's hand | 0.1: destroy own card              |
| CB-4 | **Question Lock**    | Rare   | `OPTION_LOCK`    | durationMs=2000                        | 0.1: lock own options              |
| CB-5 | **Brain Fog**        | Rare   | `VISUAL_OVERLAY` | flag=BRAIN_FOG, durationMs=5000        | 0.1: apply to self                 |
| CB-6 | **Fake Flag**        | Common | `OPTION_FAKE`    | indexes=[1], durationMs=8000           | 0.1: show fake flag to self        |
| CB-7 | **Question Flip**    | Common | `SEMANTIC_FLIP`  | durationMs=10000                       | 0.1: flip self question            |
| CB-8 | **Mass Distraction** | Epic   | `DELAY_RENDER`   | delayMs=2000, targetCount=3            | 0.1: self delayed 2s               |

### 3.2 Thủ (Defensive) — 10 cards

| #     | Card               | Tier   | Effect Kind       | Effect Param                                                                                                                         | Backfire rate |
| ----- | ------------------ | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| TN-1  | **50:50**          | Common | `OPTION_DISABLE`  | resolve 2 random wrong answers server-side, then persist concrete `indexes`, durationMs=20000 (clamp at round end)                   | 0.0           |
| TN-2  | **Double Points**  | Common | `SCORE_MULT`      | factor=2                                                                                                                             | 0.0           |
| TN-3  | **Hint Reveal**    | Common | `HINT_REVEAL`     | partial=first 1 char                                                                                                                 | 0.0           |
| TN-4  | **Shield**         | Rare   | `SHIELD`          | expiresAtRound=current+1                                                                                                             | 0.0           |
| TN-5  | **Time Bonus**     | Common | `QUESTION_REPLAY` | extraMs=5000 on the player's authoritative per-question deadline                                                                     | 0.0           |
| TN-6  | **Second Chance**  | Common | `SECOND_CHANCE`   | allow re-submit before deadline                                                                                                      | 0.0           |
| TN-7  | **Deep Read**      | Rare   | `VISUAL_OVERLAY`  | flag=DEEP_READ, durationMs=5000                                                                                                      | 0.0           |
| TN-8  | **Replay**         | Rare   | `QUESTION_REPLAY` | re-open current question for the same player using a derived authoritative deadline extension; persisted as explicit expiry metadata | 0.0           |
| TN-9  | **Brain Burst**    | Rare   | `SCORE_MULT`      | factor=1.5 (streak 3)                                                                                                                | 0.0           |
| TN-10 | **Perfect Recall** | Epic   | `OPTION_DISABLE`  | indexes=1 wrong, durationMs=20000 (clamp at round end)                                                                               | 0.0           |

### 3.3 Tier Distribution

- **Common**: 60% drop rate (10 cards: CB-1, CB-2, CB-3, CB-6, CB-7, TN-1, TN-2, TN-3, TN-5, TN-6)
- **Rare**: 30% drop rate (6 cards: CB-4, CB-5, TN-4, TN-7, TN-8, TN-9)
- **Epic**: 10% drop rate (2 cards: CB-8, TN-10)

Drop rate áp dụng cho offer mỗi match (3 cards offered từ class pool).

### 3.4 Banned vĩnh viễn

| Card                                             | Lý do                            |
| ------------------------------------------------ | -------------------------------- |
| `Time Drain` (-3s mỗi câu sai cả match)          | Negative snowball → quit pattern |
| `Push Down` (swap rank với player rank thấp hơn) | Phá score determinism            |

---

## 4. Architecture Specifications

### 4.1 Card Effect Discriminated Union

```typescript
// packages/shared/src/cards.ts (NEW)
// Canonical ClassId lives in packages/shared/src/classes.ts; cards.ts imports or re-exports it.
import type { ClassId } from "./classes";

export type CardTier = "COMMON" | "RARE" | "EPIC";

/** Card pool v1 — exactly 18 IDs (8 Công + 10 Thủ). No other string is a valid CardId. */
export type CardId =
  | "CB-1"
  | "CB-2"
  | "CB-3"
  | "CB-4"
  | "CB-5"
  | "CB-6"
  | "CB-7"
  | "CB-8"
  | "TN-1"
  | "TN-2"
  | "TN-3"
  | "TN-4"
  | "TN-5"
  | "TN-6"
  | "TN-7"
  | "TN-8"
  | "TN-9"
  | "TN-10";

export interface CardDefinition {
  id: CardId;
  classId: ClassId;
  tier: CardTier;
  name: string;
  description: string;
  effectTemplate: CardEffectTemplate; // unresolved template, resolved server-side before append
  backfireRate: number; // runtime-validated ∈ [0.0, 0.1]
  cooldownPerMatch: 1; // v1 chỉ dùng 1 lần/match
}

// API boundary (Zod or equivalent): request accepts only `cardId` and target.
// Server loads the canonical CardDefinition.effectTemplate from the catalog,
// resolves template -> concrete CardEffect server-side, then validates the
// resolved effect against CardEffect schema plus variant-specific
// finite/range/uniqueness/index rules before append. Client input never carries
// arbitrary CardEffect payloads; if a legacy request still includes template-like
// fields (`extraMs`, `factor`, `indexes`, `durationMs`, ...), compare them to the
// canonical catalog definition and reject mismatches.

export type CardEffectTemplate =
  | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
  | {
      kind: "OPTION_DISABLE_TEMPLATE";
      count: number;
      selectionPolicy: "RANDOM_WRONG_OPTIONS";
      durationMs: number;
    }
  | { kind: "OPTION_FAKE"; indexes: number[]; durationMs: number }
  | { kind: "OPTION_LOCK"; durationMs: number }
  | { kind: "HINT_REVEAL"; partial: string }
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  | { kind: "SHIELD"; expiresAtRound: number }
  | { kind: "SCORE_MULT"; factor: number }
  | { kind: "HAND_DESTROY"; count: number }
  | { kind: "SECOND_CHANCE" };

export type CardEffect =
  | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
  | { kind: "OPTION_DISABLE"; indexes: number[]; durationMs: number }
  | { kind: "OPTION_FAKE"; indexes: number[]; durationMs: number }
  | { kind: "OPTION_LOCK"; durationMs: number }
  | { kind: "HINT_REVEAL"; partial: string }
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  | { kind: "SHIELD"; expiresAtRound: number }
  | { kind: "SCORE_MULT"; factor: number }
  | { kind: "HAND_DESTROY"; count: number }
  | { kind: "SECOND_CHANCE" };
```

**Canonical deadline contract.** v1 chooses **per-player authoritative
`answerDeadline`**. `QUESTION_REPLAY` may extend only the targeted player’s
deadline; timeout, reconnect, failover, snapshot and replay all use the same
persisted per-player deadline metadata. There is no hidden fallback to a
client-side timer or a mixed shared/per-player deadline model.

**Lưu ý exhaustive switch**: Mọi consumer (`card-engine.ts`, `match-state-machine.ts`, web reducer) PHẢI handle đầy đủ 13 variants. Compile-time check `satisfies never` để đảm bảo.

### 4.2 Event Log Schema (Track D Extension)

```typescript
// packages/shared/src/events.ts (NEW canonical owner; cards.ts may re-export types if needed)
// Append vào event log hiện tại (Track D shipped)

/** Exported so consumers of CardEffectEvent can import the resolution discriminator. */
export type CardEffectResolution = "MUTATION" | "TEMPORARY";

export type MutationEffect = {
  seqNo: number; // monotonic, persisted in Redis / event log
  type: "CARD_RESOLVED";
  roundNo: number;
  playedByPlayerId: string;
  targetPlayerIds: string[]; // concrete recipients, expanded server-side before append
  effect:
    | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
    | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
    | { kind: "HINT_REVEAL"; partial: string }
    | { kind: "QUESTION_REPLAY"; extraMs: number }
    | { kind: "SHIELD"; expiresAtRound: number }
    | { kind: "SCORE_MULT"; factor: number }
    | { kind: "HAND_DESTROY"; count: number }
    | { kind: "SECOND_CHANCE" };
  resolution: "MUTATION";
  serverTimestamp: number;
  expiresAtServer: null;
  remainingMs: null; // mutations never carry temporary countdown state
  rolledBack: boolean;
};

export type TemporaryEffect = {
  seqNo: number;
  type: "CARD_RESOLVED";
  roundNo: number;
  playedByPlayerId: string;
  targetPlayerIds: string[];
  effect:
    | { kind: "OPTION_DISABLE"; indexes: number[]; durationMs: number }
    | { kind: "OPTION_FAKE"; indexes: number[]; durationMs: number }
    | { kind: "OPTION_LOCK"; durationMs: number }
    | {
        kind: "VISUAL_OVERLAY";
        flag: "BRAIN_FOG" | "DEEP_READ";
        durationMs: number;
      }
    | { kind: "SEMANTIC_FLIP"; durationMs: number };
  resolution: "TEMPORARY";
  serverTimestamp: number;
  expiresAtServer: number;
  remainingMs: number; // temporary effects always carry remaining duration metadata
  rolledBack: boolean;
};

export type CardEffectEvent = MutationEffect | TemporaryEffect;

/**
 * Socket.IO transport optimization ONLY.
 * - NEVER appended to the event log.
 * - NEVER used as a replay cursor.
 * - Each inner CardEffectEvent keeps its own persisted seqNo; the batch's
 *   `seqNo` (last effect in the frame) is transport metadata only and does
 *   not participate in replay ordering.
 */
export interface CardResolvedBatchEvent {
  seqNo: number; // last effect seqNo in this WS frame (transport only)
  roundNo: number;
  effects: CardEffectEvent[]; // each effect already persisted individually as CARD_RESOLVED
  aoeCountInRound: number; // for client stats
}

export interface ActiveEffectSnapshot {
  sourceSeqNo: number;
  effect: TemporaryEffect["effect"];
  remainingMs: number; // remaining at snapshot.serverNow
  persistedDurationMs: number; // original duration cap for clamping during restore
  expiresAtServer: number; // canonical logical expiry used for reconnect/failover restore
}

export interface CardTurnSnapshot {
  snapshotSeqNo: number;
  serverNow: number;
  playerTurns: Record<string, PlayerTurnState>; // canonical mutations through snapshotSeqNo
  /** Temporary effects still active at snapshotSeqNo (created at or before that seq). */
  activeEffects: Record<string, ActiveEffectSnapshot[]>; // keyed by playerId
}
```

`LOBBY` is only an input target selector. Before the server appends a `CARD_RESOLVED`
event, it expands that selector to the concrete eligible recipients in
`targetPlayerIds`. AOE replay therefore never depends on rebuilding a lobby from a
later snapshot.

### 4.3 Round Flow (20s Overlay Pattern)

```
T+0s    ┌─ Round starts ──────────────────────────────────────┐
        │ Question + Timer visible (20s)                       │
        │ IF milestone round (Q5, 12, 20):                    │
        │   OFFER overlay shown (3 cards, 3s auto-dismiss)    │
        │ Player may click "Use Card" anytime in 0-20s         │
        │   → Target picker overlay (2s, pauses SELF timer)    │
        │   → Server validates, applies, appends event now     │
        │   → ≤50ms micro-batch broadcast applies target UI    │
        └──────────────────────────────────────────────────────┘
T+20s   Flush any pending micro-batch, then evaluate
```

**Invariants:**

- Answer window LUÔN 20s ở baseline, nhưng server may persist **per-player
  authoritative `answerDeadline`** when `QUESTION_REPLAY` extends a targeted
  player. Timeout/AFK, reconnect, snapshot, failover and replay all use the same
  persisted per-player deadline contract.
- Target picker là **UI-only self-pause ≤2s**: client vẽ overlay ẩn câu hỏi tối đa 2s,
  nhưng `answerDeadline` của server chỉ đổi nếu một card explicitly persists a
  per-player extension. Trả lời sau deadline = miss + eliminate.
- Milestone offer auto-dismiss 3s, không pause timer
- Player có thể answer bất cứ lúc nào trong 0-20s (tới `answerDeadline`)
- Card effect được authoritatively apply + append vào event log ngay khi play hợp lệ;
  WS micro-batch chỉ tối ưu transport, không trì hoãn effect đến `endRound`.

### 4.4 Reconnect Strategy (Clock Drift Safe)

```typescript
function rehydrateCardTurn(
  playerId: string,
  snapshot: CardTurnSnapshot,
  persistedEvents: CardEffectEvent[], // authoritative persisted CARD_RESOLVED events after snapshotSeqNo
  replayServerNow: number, // TRUSTED current server time; not snapshot.serverNow
): { mutations: CardEffectEvent[]; activeEffects: ActiveEffect[] } {
  const mutations: CardEffectEvent[] = [];
  const activeEffects: ActiveEffect[] = [];
  const restoredSeqNos = new Set<number>();
  const seenSeqNos = new Map<number, string>();

  // 1) Restore effects that were still live AT the snapshot.
  for (const saved of snapshot.activeEffects[playerId] ?? []) {
    const rawRemainingMs = saved.expiresAtServer - replayServerNow;
    const remainingMs = Math.min(
      saved.persistedDurationMs,
      Math.max(0, rawRemainingMs),
    );
    if (remainingMs > 0) {
      activeEffects.push({
        effect: saved.effect,
        remainingMs,
        sourceSeqNo: saved.sourceSeqNo,
      });
      restoredSeqNos.add(saved.sourceSeqNo);
    }
  }

  // 2) Replay events strictly after snapshotSeqNo.
  for (const event of persistedEvents.sort((a, b) => a.seqNo - b.seqNo)) {
    const encoded = JSON.stringify(event);
    const prior = seenSeqNos.get(event.seqNo);
    if (prior !== undefined) {
      if (prior !== encoded) {
        throw new Error(
          `conflicting duplicate CARD_RESOLVED seqNo=${event.seqNo}`,
        );
      }
      continue;
    }
    seenSeqNos.set(event.seqNo, encoded);

    if (event.seqNo <= snapshot.snapshotSeqNo) continue;
    if (!event.targetPlayerIds.includes(playerId)) continue;

    if (event.resolution === "MUTATION") {
      // Replayed exactly once after snapshotSeqNo. This covers TIMER_MODIFY,
      // SCORE_MULT, HINT_REVEAL, SHIELD, SECOND_CHANCE and HAND_DESTROY.
      mutations.push(event);
      continue;
    }

    // TEMPORARY after snapshot: dedupe against snapshot-restored effects.
    if (restoredSeqNos.has(event.seqNo)) continue;
    const remainingMs = Math.max(0, event.expiresAtServer - replayServerNow);
    if (remainingMs > 0) {
      activeEffects.push({
        effect: event.effect,
        remainingMs,
        sourceSeqNo: event.seqNo,
      });
    }
  }

  return { mutations, activeEffects };
}
```

**Replay contract:**

1. Full snapshot includes materialized `PlayerTurnState` AND the still-active
   temporary effects through `snapshotSeqNo`, so effects created before the
   snapshot are never lost even if `PlayerTurnState` has not materialized them.
2. Reducer replays every later `MUTATION` once, regardless of countdown.
3. Reducer restores `TEMPORARY` effects only while their persisted
   `expiresAtServer` is still in the future relative to trusted `replayServerNow`.
   `snapshot.serverNow` is not the canonical source for restore after failover.
   Post-snapshot events can only shorten (expire) effects, never extend them.
4. `targetPlayerIds` is the sole recipient check for both single-target and AOE events.
5. Restore is deduped by `sourceSeqNo` so an effect present in both the snapshot's
   `activeEffects` and a post-snapshot event is applied exactly once. Coverage must
   include events arriving after the snapshot and failover between nodes.

**Clock invariants:**

- Server sends `serverNow` in snapshots, `replayServerNow` at restore, and `serverTimestamp` + `remainingMs` in events.
- Client derives all countdowns from those server values; it never compares event time to client `Date.now()`.
- Effect expiry is idempotent: an expired temporary event cannot reapply an already-expired UI overlay, and elapsed time is always computed against the trusted restore time — post-snapshot events cannot extend an effect's remaining duration.

### 4.5 Network Layer (AOE Cap + Immediate Micro-batching)

```typescript
// apps/api/src/gateways/handlers/match.handler.ts (NEW methods)
// NOTE: pendingEffects / flush state are per-match (this handler instance = one match).

const AOE_CAP_PER_ROUND = 2;
/** Append→emit SLO. Budget split so the timer reserves headroom for the event loop + Socket.IO. */
const BATCH_SLO_MS = 50;
const BATCH_EMIT_HEADROOM_MS = 15;

class MatchHandler {
  // AOE counter is persisted, scoped (matchId, roundNo). On init/failover it is derived
  // from persisted CARD_RESOLVED events (or canonical state) for the CURRENT persisted round.
  // NEVER trust an in-memory counter across a failover. Reset happens only when the
  // persisted roundNo advances in endRound().
  // private aoeUsedThisRound = 0; // REPLACED by persisted per-(matchId, roundNo) counter
  private pendingEffects: CardEffectEvent[] = []; // this match only
  private flushDeadline: number | null = null; // monotonic timestamp of required emit
  private flushScheduled = false;
  private flushPromise: Promise<void> | null = null;
  private commandMutex = new Mutex(); // one serialized command boundary per match
  private isRecoveringFromApplyFailure = false;

  async handleCardPlay(playerId: string, cardId: string, targetId?: string) {
    return this.commandMutex.runExclusive(async () => {
      if (this.isRecoveringFromApplyFailure) {
        throw new Error(
          "match handler recovering from append/apply divergence",
        );
      }

      // Validate hand, target, cooldown and current answer-window deadline.
      // resolveCardEffect expands an AOE selector to concrete targetPlayerIds.
      const resolved = this.resolveCardEffect(playerId, cardId, targetId);

      const persistedRound = await this.eventLog.currentRoundNo(this.matchId);

      await this.eventLog.reserveAoeAndAppendIfAllowed({
        matchId: this.matchId,
        roundNo: persistedRound,
        event: resolved,
        aoeCapPerRound: AOE_CAP_PER_ROUND,
      });
      const appendedAtMono = this.clock.monotonicNow();
      try {
        this.matchStateMachine.applyCardEffect(resolved);
      } catch {
        this.isRecoveringFromApplyFailure = true;
        try {
          const recovery = await this.rebuildCanonicalStateFromEventLog({
            triggerEventSeqNo: resolved.seqNo,
            mode: "committed",
          });
          // Post-append contract is COMMITTED: if in-memory apply fails after
          // persistence, rebuild to the canonical committed state, then either
          // enqueue the canonical event for the next CARD_RESOLVED_BATCH flush
          // or emit a state resync/snapshot when the handler cannot safely
          // reconstruct the in-memory transport queue.
          if (recovery.transportEvent) {
            await this.transportOutbox.enqueue(recovery.transportEvent);
            this.pendingEffects.push(recovery.transportEvent);
            this.scheduleMicroBatchFlush(appendedAtMono);
          } else {
            await this.recoveryTaskStore.append({
              matchId: this.matchId,
              seqNo: resolved.seqNo,
              kind: "EMIT_STATE_RESYNC",
              source: "applyCardEffect",
            });
            return {
              status: "COMMITTED_PENDING_RECOVERY",
              seqNo: resolved.seqNo,
            };
          }
          return { status: "COMMITTED_REBUILT", seqNo: resolved.seqNo };
        } catch {
          await this.recoveryTaskStore.append({
            matchId: this.matchId,
            seqNo: resolved.seqNo,
            kind: "REBUILD_AND_RESYNC",
            source: "applyCardEffect",
          });
          return {
            status: "COMMITTED_PENDING_RECOVERY",
            seqNo: resolved.seqNo,
          };
        } finally {
          this.isRecoveringFromApplyFailure = false;
        }
      }
      await this.transportOutbox.enqueue(resolved);
      this.pendingEffects.push(resolved);
      this.scheduleMicroBatchFlush(appendedAtMono);
      return { status: "COMMITTED_APPLIED", seqNo: resolved.seqNo };
    });
  }

  async endRound() {
    await this.commandMutex.runExclusive(async () => {
      await this.flushPendingEffects(); // only flushes transport still pending
      // Advancing persisted roundNo implicitly resets the AOE counter for the next round.
    });
  }

  private scheduleMicroBatchFlush(appendedAtMono: number) {
    // Deadline = append time + SLO budget, minus headroom for loop/transport.
    if (this.pendingEffects.length === 1 || this.flushDeadline === null) {
      this.flushDeadline =
        appendedAtMono + BATCH_SLO_MS - BATCH_EMIT_HEADROOM_MS;
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(
      () => {
        if (this.clock.monotonicNow() >= (this.flushDeadline ?? 0)) {
          void this.flushPendingEffects().catch(() => undefined);
        } else {
          this.flushScheduled = false;
          this.scheduleMicroBatchFlush(this.clock.monotonicNow());
        }
      },
      Math.max(
        0,
        (this.flushDeadline ?? appendedAtMono) - this.clock.monotonicNow(),
      ),
    );
  }

  private async flushPendingEffects() {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = (async () => {
      if (this.pendingEffects.length === 0) return;
      const effects = [...this.pendingEffects];
      try {
        const aoeCountInRound = await this.eventLog.countAoeResolved(
          this.matchId,
          effects[0].roundNo,
        );
        this.emit("CARD_RESOLVED_BATCH", {
          seqNo: effects.at(-1)!.seqNo, // transport metadata only; NOT a replay cursor
          roundNo: effects[0].roundNo,
          effects,
          aoeCountInRound,
        });
        // Fire-and-forget emit is not sufficient to drop committed items.
        // Pending transport stays durable in the outbox and is removed only
        // after ack/resync advancement proves delivery or safe supersession.
        await this.transportOutbox.markDispatched(
          effects.map((event) => event.seqNo),
        );
        // Keep pendingEffects as the in-memory view of the durable outbox until
        // ack/resync advancement confirms delivery or safe supersession.
        this.pendingEffects = await this.transportOutbox.loadPending(
          this.matchId,
        );
        this.flushScheduled = false;
        this.flushDeadline = null;
        if (this.pendingEffects.length > 0) {
          this.scheduleMicroBatchFlush(this.clock.monotonicNow());
        }
      } catch {
        this.flushScheduled = false;
        this.flushDeadline = null;
        setTimeout(
          () => void this.flushPendingEffects().catch(() => undefined),
          50,
        );
      }
    })();

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }
}
```

**Micro-batching benefit:**

- Effects apply immediately in the authoritative state machine; target timers, locks and UI update during the answer window.
- `appendedAtMono` is captured only **after** `reserveAoeAndAppendIfAllowed` succeeds, so the append→emit SLO measures from successful persistence to emit, not from pre-append waiting time.
- If persistence succeeds but `applyCardEffect` fails deterministically, the command stays **committed**: rebuild from the canonical event log in `mode: "committed"` without re-entering the failing apply path. If rebuild or resync cannot complete inline, persist a durable recovery task first and return `COMMITTED_PENDING_RECOVERY` with the committed `seqNo` instead of rethrowing.
- `handleCardPlay` MUST return the `commandMutex.runExclusive(...)` promise so callers receive `COMMITTED_APPLIED`, `COMMITTED_REBUILT`, or `COMMITTED_PENDING_RECOVERY` plus the committed `seqNo`.
- `pendingEffects`, transport broadcast, and recovery must converge on the same committed outcome; a recovered event must not be left out of `pendingEffects`, duplicated indefinitely, or replayed into the same deterministic failure loop.
- Committed effects are not deleted merely because a Socket.IO emit was attempted. They stay in a durable transport outbox keyed by `seqNo`, and are removed only after ack/resync advancement proves delivery or safe supersession. Reconnect/failover reloads unsatisfied outbox rows and deduplicates by `seqNo`.
- Coverage MUST include connection drop before batch delivery, then reconnect/resync/failover recovery, proving no committed event is lost and duplicate retransmit by `seqNo` is harmless.
- `endRound` is a flush/reset boundary, not the resolution boundary.
- Track D replay contract remains preserved because each `CARD_RESOLVED` has its own monotonic `seqNo` in the event log; `CARD_RESOLVED_BATCH` is never appended.
- Load tests must assert append→emit latency under load still meets the SLO.

---

## 5. Phase Plan (8 tuần)

### 5.1 Phase 1 — Daily Challenge (Week 1-2, 2 tuần)

**Goal: Validate acquisition, blast radius = 0 cho game-core**

| Day  | Deliverable                                                             |
| ---- | ----------------------------------------------------------------------- |
| 1-2  | Prisma schema `DailyQuestion`, `DailyAttempt`                           |
| 3-4  | REST `GET /daily/today`, `POST /daily/submit`, `GET /daily/leaderboard` |
| 5-7  | `app/daily/page.tsx` + share PNG generator                              |
| 8    | Streak counter UI + countdown next reset                                |
| 9-10 | Tests API (≥90% coverage), Web (≥80%)                                   |
| 11   | DoD gate: 5 câu/ngày rotate, streak bonus, share PNG                    |

**Touch files (LOW blast radius):** chỉ `apps/api`, `apps/web`, Prisma. **0 blast radius** cho game-core.

### 5.2 Phase 2 — Class + Card Hybrid (Week 3-6, 4 tuần)

**Sub-task A — Shared Schema (Week 3, Days 1-2)**

- `packages/shared/src/cards.ts` (NEW) — card contracts only: `CardId`, `CardTier`, `CardDefinition`, `CardEffectTemplate`, `CardEffect`
- `packages/shared/src/classes.ts` (NEW) — canonical `ClassId`, assignment
- `packages/shared/src/events.ts` — canonical shared event schemas: `CARD_OFFER`, `CARD_PICKED`, `CARD_RESOLVED`, `CARD_RESOLVED_BATCH` (transport), `CLASS_ASSIGNED`
- Deterministic event payload interfaces (persisted unless noted):

```typescript
export interface ClassAssignedEvent {
  seqNo: number;
  type: "CLASS_ASSIGNED";
  matchId: string;
  assignments: Array<{ playerId: string; classId: ClassId }>; // full map for the match
  seedUsed: string; // explicit seed that produced this assignment (replay)
}

export interface CardOfferEvent {
  seqNo: number;
  type: "CARD_OFFER";
  roundNo: number; // milestone Q5/12/20
  playerId: string;
  offeredCardIds: [CardId, CardId, CardId]; // exact 3 cards offered
  seedUsed: string;
}

export interface CardPickedEvent {
  seqNo: number;
  type: "CARD_PICKED";
  roundNo: number;
  playerId: string;
  selectedCardId: CardId; // one of the offeredCardIds
  offerSeqNo: number; // points back to CARD_OFFER.seqNo
}
```

- Replay semantics: `CLASS_ASSIGNED` / `CARD_OFFER` / `CARD_PICKED` / `CARD_RESOLVED` are append-only event-log entries. `CARD_RESOLVED_BATCH` is Socket.IO only and is never replayed from the log.
- Tests shared (≥95%)

**Sub-task B — Pure Engines (Week 3-4, Days 3-7)**

- `packages/game-core/src/card-engine.ts` (NEW) — pure resolve, exhaustive switch; accepts explicit `seed` or `rng` input — **never** ambient `Math.random`
- `packages/game-core/src/class-engine.ts` (NEW) — pure assign; accepts explicit `seed` or `rng` input — **never** ambient `Math.random`
- `packages/game-core/src/marked-system.ts` — **KHÔNG TẠO** (đã bỏ)
- `@arena/game-core` stays independent of infrastructure (no Redis/Nest/Socket)
- Tests card-engine / class-engine (≥95% coverage)

**Sub-task C — MatchStateMachine integration (Week 4, Days 8-12) ⚠️ CRITICAL**

- `gitnexus_impact` upstream cho `MatchStateMachine.playCard` document blast radius
- `playCard()`, `pickOffer()`, `classAssignment` methods
- Card events qua event log (Track D compatible)
- Strategy Pattern cho card resolution
- Tests machine (regression)

**Sub-task D — API Layer (Week 5, Days 13-16)**

- `MatchHandler` thêm `handleCardPick`, `handleCardPlay` (immediate broadcast), `handleEndRound` (counter reset)
- `card-validator.ts` (hand state, target validity, cooldown, AOE cap)
- Class assignment khi match start
- Milestone trigger (Q5/12/20)
- Tests API (regression + chaos)

**Sub-task E — Web UI (Week 5-6, Days 17-20)**

- `card-hand.tsx`, `card-target-picker.tsx`, `card-animation.tsx`
- `class-badge.tsx`, hook `useCardActions.ts`
- Socket store integration (hand, playedCards)
- Snapshot replay hydrate hand correctly
- EN i18n card names
- Tests web

**Sub-task F — AOE Cap + Chaos Prep (Week 6, Days 21-22)**

- AOE queue with cap 2, scoped by `(matchId, roundNo)`, derived from persisted `CARD_RESOLVED`
- **C3-owner-failover** harness readiness (baseline owner-lease failover; distinct from card-batch)
- Tests chaos prep

**Buffer & Integration testing (Week 6, Days 23-24)**

- Phase 2 / Phase 3 transition
- Final regression suite

**DoD Phase 2:**

- 18 cards designed, balanced, tested
- `MatchStateMachine.playCard` blast radius documented
- **C3-owner-failover** gate: 100-player match survives baseline owner-lease failover (existing harness path; not card-batch)
- All existing tests pass (1369 API + 70 core + 31 web + 11 E2E)
- Card engine + class engine ≥ 95% unit coverage
- EN i18n card names
- Snapshot replay hydrate active effects correctly (clock drift test)
- **Do NOT credit card-batch failover tests to this gate**

### 5.3 Phase 3 — Integration & Polish (Week 7-8, 2 tuần)

| Day                | Deliverable                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Week 7, Days 25-26 | Daily streak ≥ 7 → unlock card variant (cosmetic only)                                        |
| Week 7, Day 27     | Daily leaderboard cross-show "Most cards played this week"                                    |
| Week 7, Days 28-29 | Profile page: class winrate + streak + sabotage count                                         |
| Week 8, Days 30-31 | Shareable card unlock notification (viral hook)                                               |
| Week 8, Days 32-33 | **C3-card-batch-failover** (failover mid-`CARD_RESOLVED` / pending micro-batch) + final fixes |
| Week 8, Day 34     | VI i18n card names                                                                            |
| Week 8, Day 35-36  | Final integration tests + ship prep                                                           |

---

## 6. Risk Register

| Risk                                                              | Severity | Mitigation                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MatchStateMachine.playCard` blast radius CRITICAL                | High     | `gitnexus_impact` upstream symbol TRƯỚC khi code; báo blast radius và warn nếu HIGH/CRITICAL; Strategy Pattern cho card resolution                                                                                                                         |
| Chaos test khi failover mid-`CARD_RESOLVED` / pending micro-batch | High     | **C3-card-batch-failover** bắt buộc ở Phase 3 (không credit cho Phase 2)                                                                                                                                                                                   |
| Clock drift trên mobile client                                    | Medium   | Server send `serverTimestamp` + `remainingMs`, client countdown local                                                                                                                                                                                      |
| AOE spam 100 player                                               | Medium   | Cap 2 per round, server queue                                                                                                                                                                                                                              |
| WS bandwidth 50 cards/round                                       | Medium   | Batch `CARD_RESOLVED_BATCH` (transport only)                                                                                                                                                                                                               |
| Saboteur class imbalance                                          | Low      | Random 50/50 is **bias reduction only**, not a balance guarantee. Acceptable soft threshold: `\|off − def\| / n ≤ 0.15` monitored post-match; if hard balance is required later, switch to quota-based assignment (not claimed auto-balanced by pool size) |
| UI overlay 100 effects render                                     | Medium   | Batch render, SVG count ≤ 8 per player                                                                                                                                                                                                                     |
| Snapshot replay test exhaustiveness                               | High     | Test reconnect mid-OFFER, mid-CARD_RESOLVED, mid-effect-expiry                                                                                                                                                                                             |
| i18n VI scope creep                                               | Low      | Phase 1-2 chỉ EN, VI Phase 3                                                                                                                                                                                                                               |

---

## 7. Definition of Done (toàn bộ plan)

- [ ] Daily Challenge MVP live với 5 câu/ngày + streak + share PNG
- [ ] 18 cards designed (10 Thủ + 8 Công) với tier + effect + backfire documented
- [ ] 2 classes random assignment hoạt động
- [ ] Milestone trigger tại Q5/12/20 đúng
- [ ] 20s round flow với overlay pattern
- [ ] AOE cap 2 + immediate apply + ≤50ms `CARD_RESOLVED_BATCH` micro-batch ship
- [ ] Clock drift safe rehydrate (`targetPlayerIds` + MUTATION/TEMPORARY split + serverTimestamp + remainingMs)
- [ ] `gitnexus_impact` upstream document cho `MatchStateMachine.playCard` blast radius
- [ ] All existing tests pass (không regress: 1369 API + 70 core + 31 web + 11 E2E)
- [ ] **C3-owner-failover** (Phase 2) and **C3-card-batch-failover** (Phase 3) both pass — do not conflate
- [ ] Card engine + class engine ≥ 95% unit coverage
- [ ] EN i18n (Phase 2) + VI i18n (Phase 3) card names
- [ ] Daily streak → card variant unlock integration ship
- [ ] Profile page show class winrate + streak + sabotage count
- [ ] **Card `Time Drain` và `Push Down` KHÔNG tồn tại trong code**

---

## 8. Open Questions (theo dõi)

| Question                              | Status      | Resolution                        |
| ------------------------------------- | ----------- | --------------------------------- |
| Card variant cosmetic có nên ship v1? | ✅ Resolved | Yes, ship Phase 3                 |
| VI i18n thiết yếu cho MVP?            | ✅ Resolved | Không, EN-first                   |
| Ban/pick draft song song được không?  | Open        | Schedule sau Phase 3              |
| Elo + matchmaking queue timing        | Open        | Sau khi có Daily + Card data thật |
| Territory mode                        | Open        | Defer vô thời hạn                 |

---

## 9. Supplementary / Active Spec Docs

`spec/class-cards-phase.md` là source of truth cho Class + Card hybrid. **Agents MUST read this file when any of the four core docs (productContext, systemPatterns, progress, activeContext) or `AGENTS.md` point to it** — it is not optional legacy.

Nếu conflict với core docs:

1. Cập nhật trong spec trước
2. Reflect vào core docs trong commit kế tiếp

Đừng duplicate logic across files. Spec này chỉ chứa thông tin **specific** cho Class + Card, không chứa general product context.
