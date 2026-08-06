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

**Kind column convention:** the kind column names the `CardEffectTemplate`
discriminator and the resolved `CardEffect` discriminator as
`TEMPLATE_KIND → RESOLVED_KIND`. A **single** name means the template and the
resolved shapes are identical (no server-side resolution step). Only variants
whose resolved payload differs from the template carry a `_TEMPLATE` suffix —
see §4.1 for the canonical unions.

### 3.1 Công (Offensive) — 8 cards

| #    | Card                 | Tier   | Template Kind → Resolved Kind          | Effect Param                                                                                                                                         | Backfire rate                      |
| ---- | -------------------- | ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| CB-1 | **Time Freeze**      | Common | `TIMER_MODIFY`                         | deltaMs=-5000, targetCount=1                                                                                                                         | 0.1: apply to all eligible targets |
| CB-2 | **Sabotage Q**       | Common | `DELAY_RENDER`                         | delayMs=3000, targetCount=1                                                                                                                          | 0.1: self delayed 3s               |
| CB-3 | **Burn Card**        | Common | `HAND_DESTROY_TEMPLATE → HAND_DESTROY` | template: `count=1, selectionPolicy="RANDOM_FROM_TARGET_HAND"` → server resolves concrete `destroyedCardIds` from target's hand (§3.3) before append | 0.1: destroy own card              |
| CB-4 | **Question Lock**    | Rare   | `OPTION_LOCK`                          | durationMs=2000                                                                                                                                      | 0.1: lock own options              |
| CB-5 | **Brain Fog**        | Rare   | `VISUAL_OVERLAY`                       | flag=BRAIN_FOG, durationMs=5000                                                                                                                      | 0.1: apply to self                 |
| CB-6 | **Fake Flag**        | Common | `OPTION_FAKE`                          | indexes=[1], durationMs=8000                                                                                                                         | 0.1: show fake flag to self        |
| CB-7 | **Question Flip**    | Common | `SEMANTIC_FLIP`                        | durationMs=10000                                                                                                                                     | 0.1: flip self question            |
| CB-8 | **Mass Distraction** | Epic   | `DELAY_RENDER`                         | delayMs=2000, targetCount=3                                                                                                                          | 0.1: self delayed 2s               |

### 3.2 Thủ (Defensive) — 10 cards

| #     | Card               | Tier   | Template Kind → Resolved Kind              | Effect Param                                                                                                                                                        | Backfire rate |
| ----- | ------------------ | ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| TN-1  | **50:50**          | Common | `OPTION_DISABLE_TEMPLATE → OPTION_DISABLE` | template: `count=2, selectionPolicy="RANDOM_WRONG_OPTIONS", durationMs=20000` → server resolves 2 random wrong answers into concrete `indexes` (clamp at round end) | 0.0           |
| TN-2  | **Double Points**  | Common | `SCORE_MULT`                               | factor=2                                                                                                                                                            | 0.0           |
| TN-3  | **Hint Reveal**    | Common | `HINT_REVEAL_TEMPLATE → HINT_REVEAL`       | template: `revealDescriptor="FIRST_N_CHARS", count=1` → server resolves `partial` from current question                                                             | 0.0           |
| TN-4  | **Shield**         | Rare   | `SHIELD_TEMPLATE → SHIELD`                 | template: `expiresAfterRoundOffset=1` → server resolves `expiresAtRound` from persisted `roundNo`                                                                   | 0.0           |
| TN-5  | **Time Bonus**     | Common | `QUESTION_REPLAY`                          | extraMs=5000 on the player's authoritative per-question deadline                                                                                                    | 0.0           |
| TN-6  | **Second Chance**  | Common | `SECOND_CHANCE`                            | allow re-submit before deadline                                                                                                                                     | 0.0           |
| TN-7  | **Deep Read**      | Rare   | `VISUAL_OVERLAY`                           | flag=DEEP_READ, durationMs=5000                                                                                                                                     | 0.0           |
| TN-8  | **Replay**         | Rare   | `QUESTION_REPLAY`                          | re-open current question for the same player using a derived authoritative deadline extension; persisted as explicit expiry metadata                                | 0.0           |
| TN-9  | **Brain Burst**    | Rare   | `SCORE_MULT`                               | factor=1.5 (streak 3)                                                                                                                                               | 0.0           |
| TN-10 | **Perfect Recall** | Epic   | `OPTION_DISABLE_TEMPLATE → OPTION_DISABLE` | template: `count=1, selectionPolicy="RANDOM_WRONG_OPTIONS", durationMs=20000` → server resolves 1 random wrong answer into concrete `indexes` (clamp at round end)  | 0.0           |

### 3.3 Tier Distribution

- **Common**: 60% drop rate (10 cards: CB-1, CB-2, CB-3, CB-6, CB-7, TN-1, TN-2, TN-3, TN-5, TN-6)
- **Rare**: 30% drop rate (6 cards: CB-4, CB-5, TN-4, TN-7, TN-8, TN-9)
- **Epic**: 10% drop rate (2 cards: CB-8, TN-10)

**Sampling algorithm (canonical — shared + game-core MUST reference the same):**
Offer each match selects 3 cards from the player's class pool using
**class-specific weighted sampling without replacement**. Tier weights apply
within the class pool: each draw picks a tier by global-pool 60/30/10 weights,
then selects a random card of that tier from the remaining class-pool cards.
On collision (tier exhausted in class pool), retry on the same substream
(deterministic, no new draw). If the class pool is exhausted, return fewer
than 3 cards — a defensive branch that is **unreachable in v1** (see
"Offer size invariant" below). The shared contract in `@arena/shared` defines the tier weights
and pool ordering; the pure sampling logic in `@arena/game-core` consumes an
explicit `seed`/`rng` input and implements the same algorithm — never ambient
`Math.random`.

**Canonical `CardId` order (`compareCardId`).** Every pool, hand, and tier list
in this spec is ordered by **prefix first** (`CB` before `TN`, ASCII), **then
numeric suffix ascending** — so `TN-2` precedes `TN-10`. "Ascending `CardId`"
alone is NOT a specification: `CardId` suffixes pass 9 (`TN-10`), so the obvious
implementations disagree.

- Canonical (`compareCardId`): `… TN-1, TN-2, TN-3, TN-5, TN-6, TN-10`
- Plain `.sort()` / `localeCompare`: `… TN-1, TN-10, TN-2, TN-3, TN-5, TN-6`

Because `idx = Math.floor(u2 * remainingTierCards)` indexes **into this list**,
the two orderings return **different cards for the same float** — a silent
divergence between API, `@arena/game-core`, and replay that byte-identical
replay cannot tolerate. Plain lexicographic `.sort()`, `String.localeCompare`,
and any locale-sensitive collation are therefore **forbidden** for `CardId`
ordering. `@arena/shared` exports the single `compareCardId` implementation and
every consumer (loader, sampling engine, API validator, replay harness) MUST
import it — no layer may re-implement it or re-sort with an ad-hoc comparator.

**Required test (`@arena/shared`):** a test MUST pin the full canonical 18-ID
order produced by `compareCardId` as an explicit expected array, so adding a
card with a two-digit suffix (e.g. `CB-10`) cannot silently reintroduce the
lexicographic split.

**Offer size invariant (v1):** the v1 class pools hold 8 cards (Công) and 10
cards (Thủ), and every tier is non-empty in both pools, so three unique cards
are always drawable. `CardOfferEvent.offeredCardIds` is therefore typed as a
fixed 3-tuple `[CardId, CardId, CardId]` (§5.2). The `< 3` branch above exists
only for forward compatibility: if a future pool change makes fewer than 3
unique cards reachable, the event schema MUST be widened to
`readonly CardId[]` in that **same** change — the 3-tuple and the pool sizes
are a single coupled contract, never allowed to drift.

**Byte-level RNG consumption (canonical, pinned per `prngVersion`):**
Every RNG consumption step MUST be specified exactly so API, game-core, and
replay produce byte-identical output. The contract mirrors the question-pool
byte-level algorithm in `docs/plans/gauntlet-design.md` §"Seed-derivation
contract" (mulberry32, `Math.floor(u * N)`, unsigned 32-bit arithmetic).

- **Draw count**: exactly 3 cards per offer (or fewer if the class pool is
  exhausted before 3 unique cards are drawn).
- **Tier selection (per draw)**: consume one float `u ∈ [0, 1)` from
  `mulberry32(s)`. Tier = `COMMON` if `u < 0.60`, `RARE` if
  `0.60 ≤ u < 0.90`, `EPIC` if `u ≥ 0.90`. (60/30/10 weights.)
- **Card-within-tier selection**: consumed **only when the selected tier has at
  least one remaining card**. Consume a second float `u2 ∈ [0, 1)`;
  `idx = Math.floor(u2 * remainingTierCards)`. The remaining class-pool cards
  of the selected tier are an ordered frozen list sorted by `compareCardId`
  (see "Canonical `CardId` order" above) — never plain lexicographic order.
- **Deterministic retry on exhausted tier**: if the selected tier has zero
  remaining cards in the class pool, the draw consumes **only the TIER float**
  — **no CARD float is consumed**, because there is no non-empty list to index
  into. Retry on the same substream by pulling the next float for tier
  selection — never a new draw, and never a "skipped" card float. Float
  accounting is therefore: a successful draw consumes exactly **2** floats
  (TIER + CARD); an exhausted-tier retry consumes exactly **1** (TIER only).
  API, `@arena/game-core`, and replay MUST agree on this count exactly —
  consuming a phantom card float on an exhausted tier desynchronizes the
  substream and every subsequent draw diverges. If the entire class pool is
  exhausted, stop and return fewer than 3 cards; do not consume further floats.
- **Every consumed float is recorded**: each float appears as exactly one
  `steps[]` entry. An exhausted-tier retry records `purpose: "TIER"`,
  `retry: true`, the resolved `tier`, and **no** `cardIndex` and **no**
  `drawnCardId` — there is no CARD step for that retry. Replaying `steps[]` in
  order MUST reproduce the substream consumption exactly.
- **count > remaining**: if `count` (3) exceeds the remaining unique cards in
  the class pool, return as many as are available; do not pad, do not wrap.
- **Without replacement**: a drawn `CardId` is removed from the class pool for
  the remainder of this offer; duplicate draws are impossible by construction.

**Random effect resolution (canonical, same `prngVersion` as sampling):** exactly
**three cards** consume RNG at effect-resolution time, via **two templates**.
Resolution happens **server-side in the resolver only**: the resolver draws the
floats, then appends **exactly one `CARD_RESOLVED` event per resolution** carrying
the concrete outcome. That event is the sole authoritative record. Every
downstream consumer — reducer, replay harness, snapshot restore, web client —
**applies that persisted outcome verbatim**: it MUST NOT re-run the RNG and MUST
NOT persist an outcome of its own. This list is **exhaustive** — no other card
draws a float at resolution:

| Card    | Template                  | Catalog     | Float consumption                   | Persisted outcome  |
| ------- | ------------------------- | ----------- | ----------------------------------- | ------------------ |
| `CB-3`  | `HAND_DESTROY_TEMPLATE`   | §3.1 (Công) | `count=1` → `effectiveCount` floats | `destroyedCardIds` |
| `TN-1`  | `OPTION_DISABLE_TEMPLATE` | §3.2 (Thủ)  | `count=2` → `effectiveCount` floats | `indexes`          |
| `TN-10` | `OPTION_DISABLE_TEMPLATE` | §3.2 (Thủ)  | `count=1` → `effectiveCount` floats | `indexes`          |

**`effectiveCount` (shared rule, both templates):**
`effectiveCount = Math.min(count, availableAtResolution)` — the number of
candidates actually selectable at resolve time. Float accounting follows it
exactly:

- Consume **exactly one float per selectable candidate** — `effectiveCount`
  floats total, drawn sequentially without replacement.
- **Stop consuming the moment candidates are exhausted.** Never draw a float for
  a pick that has no candidate to index into; a phantom float desynchronizes the
  substream and diverges every subsequent draw (same failure mode as the
  "Byte-level RNG consumption" rules above).
- **Partial exhaustion is the normal case, not an error.** TN-1 (`count=2`)
  against a question with only **one** wrong option remaining has
  `effectiveCount = 1`: it consumes **exactly 1 float**, not 2, and persists a
  single-element `indexes`. Replay therefore stays aligned on the same RNG
  substream position.
- **Total exhaustion** (`availableAtResolution === 0`) gives
  `effectiveCount = 0`: **zero floats**, resolved array `[]`. Still a valid
  committed effect — not an error and not a no-op to be skipped at replay.
- Persist the resolved `indexes` / `destroyedCardIds` **together with the
  canonical cardinality metadata** (`count` + `availableAtResolution`, see
  "Resolved cardinality" below). `effectiveCount` itself is **not** persisted —
  it is exactly `Math.min(count, availableAtResolution)` and is recomputed from
  the two persisted operands, so the validator can check the resolved length
  without consulting live state.

`backfireRate` (`CardDefinition.backfireRate`, §4.1) is **not** a runtime RNG
consumer in v1: no float is drawn for it, and no backfire outcome is resolved or
persisted. If a backfire roll is introduced later, it MUST first be added to the
table above with an explicit float-consumption position — an unspecified roll
would desynchronize the substream and diverge every subsequent draw.

**Resolved cardinality (shared rule for both templates):** `count` always means
the **requested** number of picks and is never rewritten. The resolved array
length is `Math.min(count, availableAtResolution)` — the effect degrades to the
available supply instead of failing. Never pad, never wrap, never re-sample to
reach `count`. `availableAtResolution` is captured at resolve time and persisted
with the event, so replay reproduces the same length without re-inspecting live
state.

- `OPTION_DISABLE_TEMPLATE` (TN-1, TN-10) — `selectionPolicy`
  `"RANDOM_WRONG_OPTIONS"`: the wrong-answer option indexes of the current
  question form an ordered frozen list (ascending index). For each of
  `effectiveCount` picks, consume one float `u`;
  `idx = Math.floor(u * remainingWrongCount)`;
  remove the picked index (without replacement). The resolved
  `OPTION_DISABLE.indexes` is persisted on the event alongside `count` and
  `availableAtResolution` (here: the wrong-option supply at resolve time), and
  `indexes.length === Math.min(count, availableAtResolution)`. If fewer
  wrong options remain than `count`, disable every one available and persist
  that shorter list.
- `HAND_DESTROY_TEMPLATE` (CB-3) — `selectionPolicy`
  `"RANDOM_FROM_TARGET_HAND"`: the target's hand is an ordered frozen list
  sorted by `compareCardId` (see "Canonical `CardId` order" in §3.3) — never
  plain lexicographic order. For each of `effectiveCount` picks, consume one
  float `u`; `idx = Math.floor(u * remainingHandSize)`; remove the picked card
  (without replacement). The resolved `HAND_DESTROY.destroyedCardIds` is
  persisted on the event alongside `count` and `availableAtResolution` (here:
  the target hand size at resolve time), and
  `destroyedCardIds.length === Math.min(count, availableAtResolution)`.
  If the target's hand holds fewer than `count` cards, destroy every card
  available and persist that shorter list. An **empty** target hand
  (`availableAtResolution === 0`) resolves to `destroyedCardIds: []`,
  consumes **zero** floats, and is still a valid committed effect — not an
  error and not a no-op to be skipped at replay.

**Cardinality coverage (validator, reducer, replay):** the boundary validator
MUST recompute `Math.min(count, availableAtResolution)` **from the persisted
payload alone** — never from live question or hand state — and accept only a
resolved array of exactly that length, rejecting any other length (including a
padded array of exactly `count`). `count` and `availableAtResolution` MUST both
be safe integers with `count >= 1` and `availableAtResolution >= 0`; a payload
violating either bound is rejected before the length check. The reducer and
replay harness MUST cover three cases per template — full supply
(`length === count`), partial supply (`0 < length < count`), and empty supply
(`length === 0`, zero floats consumed) — and each vector MUST assert the
persisted `count` and `availableAtResolution` values, not just the array length,
so a payload whose metadata disagrees with its array is caught.

**Replay MUST NOT re-randomize:** the reducer reads the persisted
`indexes` / `destroyedCardIds` verbatim. Re-deriving them at replay time would
diverge from the audit log and break rehydration, so no replay path may call
the RNG for effect resolution.

**Seeded replayable test vectors:** for each class (Công, Thủ), pin a test
vector with a known `seed` and assert the exact 3 `offeredCardIds` produced.
The vector MUST pass identically in `@arena/game-core` unit tests and the
replay harness. Each vector MUST also assert the per-consumption RNG
progression (the exact sequence of floats consumed and the tier + card index
derived at each step) so any divergence between API, game-core, and replay is
detected at the byte level, not just at the final `offeredCardIds`.

**Vector location & shape:** vectors live in
`packages/shared/src/cards.sampling-vectors.ts` (co-located, importable by
all consumers) as a single shared source. Each vector has this shape:

```typescript
export interface SamplingVector {
  readonly classId: ClassId; // "CONG" | "THU"
  readonly seed: string; // known seed passed to deriveSubstream
  readonly prngVersion: string; // MUST equal PRNG_CONTRACT_VERSION ("mulberry32-substream-v1"), the card-sampling RNG contract owned by @arena/shared. Identifies the ENTIRE deterministic card RNG contract: seed derivation, Mulberry32 algorithm, RNG-consumption order (TIER/CARD float accounting), and sampling rules. DISTINCT from DailyRunHeader.prngVersion ("sha256-v1") in gauntlet-design.md, which versions header seed-derivation only — same field name, different namespace, versioned independently. This vector reuses the mulberry32 ALGORITHM described in gauntlet-design.md §"Seed-derivation contract" but not that constant's value.
  readonly pool: readonly CardId[]; // frozen class-pool snapshot at vector creation
  readonly steps: ReadonlyArray<{
    readonly float: number; // exact mulberry32 float consumed (u or u2)
    readonly purpose: "TIER" | "CARD"; // which selection step consumed this float
    readonly tier?: CardTier; // resolved tier (TIER steps only)
    readonly cardIndex?: number; // resolved index into remaining tier cards (CARD steps only)
    readonly retry: boolean; // true if this step was a retry (tier exhausted)
    readonly drawnCardId?: CardId; // card drawn this step (CARD steps only; undefined on exhausted-tier retry)
  }>;
  readonly offeredCardIds: readonly CardId[]; // final offered cards (≤3)
}
```

**Immutability note:** `readonly` in TypeScript is a compile-time contract only and is shallow. If runtime-loaded vectors are exposed beyond validation (e.g. handed to the engine or replay harness by reference), the vector loader MUST return a deeply frozen (`Object.freeze` recursive) value — or an immutable copy that is **itself** made mutation-safe by the same recursive freeze (or an equivalent mechanism such as a read-only `Proxy`) — rather than relying on `readonly` alone, so a buggy consumer cannot mutate `pool`, `steps`, or `offeredCardIds` and corrupt subsequent replays. A bare `structuredClone` is **not** sufficient: the clone is fully mutable, so it protects only the source object, not the canonical vector the caller then replays against.

**Runtime immutability test (required in `@arena/shared`):** a test
(`packages/shared/src/cards.sampling-vectors.spec.ts`) MUST verify the
deep-freeze / immutable-copy mechanism at runtime — `readonly` alone is not
sufficient because the consumer may bypass the compiler via `as unknown as
{...}` casts. Required assertions:

- After the vector loader returns a vector, cast through `unknown` to bypass
  `readonly` and attempt mutations on every mutable field:
  - `vector.pool[0] = ...`; `vector.pool.push(...)`.
  - `vector.steps[0] = ...`; `vector.steps[0].float = 999`; `vector.steps.length = 0`.
  - `vector.offeredCardIds[0] = ...`; `vector.offeredCardIds.push(...)`.
- Each mutation MUST be either rejected (`TypeError` in strict mode for
  `Object.freeze` paths) OR silently ignored AND the returned vector MUST be
  unchanged. **Primary assertion — full-vector canonical bytes:** canonically
  serialize the **entire returned vector** (`canonicalSerialize`, the same
  helper the replay coverage validator uses) immediately BEFORE and AFTER
  every attempted mutation and assert the serialized bytes are identical.
  This covers every field by construction — including `pool`, `steps`, all
  nested step fields, and `offeredCardIds` — so a mutation to a field that
  replay does not happen to consume still fails the test.
- **Additional assertion:** ALSO re-run the replay against the returned
  reference before AND after each attempted mutation and assert
  byte-identical replay output (retains the end-to-end determinism check).
- Coverage MUST include both protection paths the loader may take:
  1. the direct recursive `Object.freeze` path, and
  2. the "immutable copy" path (e.g. `structuredClone`-based deep copy the
     loader may swap in when freezing the shared source is too costly) —
     which MUST apply the same recursive deep-freeze (or an equivalent
     mutation-safe wrapper) to the clone **before returning it**.
     Both paths MUST satisfy the identical assertion set above — full-vector
     canonical-byte identity plus replay-output byte identity — across
     `pool`, `steps`, every nested step field (`float`, `purpose`, `tier`,
     `cardIndex`, `retry`, `drawnCardId`), and `offeredCardIds`.
- The test MUST exercise the loader's actual exported entry point so a
  regression that drops the freeze/copy silently fails CI.

**prngVersion validation (canonical RNG-contract version):** `prngVersion`
canonically identifies the **entire deterministic RNG contract** — seed
derivation (SHA-256 per gauntlet-design.md §"Seed-derivation contract" §1-2),
the `deriveSubstream` substream-seeding rule (§4), the **Mulberry32**
algorithm (32-bit unsigned wraparound, first-4-bytes little-endian uint32
seed), the **RNG-consumption order** (one float per draw, retry on same
substream), and the **sampling rules** (frozen ordered pool, no-replacement,
`idx = Math.floor(u * N)`, deterministic retry until pool exhausted). It is
NOT only a SHA-256 derivation tag; any change to any of those facets bumps the
version.

The canonical version constant is defined **once** in `@arena/shared` alongside
the shared types/constants (e.g. `packages/shared/src/cards.ts`):

```typescript
export const PRNG_CONTRACT_VERSION = "mulberry32-substream-v1";
```

The vector loader (`@arena/shared`), the sampling engine (`@arena/game-core`),
the boundary validator (`@arena/api`), and the replay harness MUST all import
`PRNG_CONTRACT_VERSION` from `@arena/shared` and validate the vector's
`prngVersion === PRNG_CONTRACT_VERSION` **before** replay. Any vector whose
`prngVersion` differs is rejected before running. This ensures vectors
authored for one RNG contract are never replayed against an incompatible
engine, and that a contract bump invalidates every stale vector in lockstep
across all consumers.

**Minimum vector coverage:**

- At least one vector per class (Công, Thủ) with a happy path (3 cards, no retry).
- At least one vector across both classes that exercises retry-when-tier-exhausted
  (a tier selection picks a tier with zero remaining cards → retry on same
  substream).
- At least one vector where `count` (3) exceeds remaining unique cards →
  `offeredCardIds.length < 3`. This case is **not reachable with a v1 class
  pool** (see "Offer size invariant"), so the vector MUST declare a synthetic
  reduced `pool` (fewer than 3 cards) to exercise the defensive branch. Such a
  vector is exempt from the `CardOfferEvent` 3-tuple type: it asserts the
  sampling function's return value directly and is never fed through the event
  schema.

**Cross-package execution:** the same test MUST execute identically in
`@arena/shared` (vector loader), `@arena/game-core` (sampling engine),
`@arena/api` (boundary), and the replay harness. A divergence in any consumer
is a spec violation.

> **Implementation note**: no `@arena/game-core` card/class code exists yet.
> The `steps[].float` values MUST be derived from the actual mulberry32
> implementation when Sub-task B (§5.2) lands — do NOT fabricate floats.
> Vectors are authored alongside the engine and frozen at first green test.

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
  | {
      kind: "HINT_REVEAL_TEMPLATE";
      revealDescriptor: "FIRST_N_CHARS";
      count: number; // relative: server resolves to concrete `partial` from current question
    }
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  | {
      kind: "SHIELD_TEMPLATE";
      expiresAfterRoundOffset: number; // relative: server resolves to absolute `expiresAtRound` from persisted roundNo
    }
  | { kind: "SCORE_MULT"; factor: number }
  | {
      kind: "HAND_DESTROY_TEMPLATE";
      count: number;
      selectionPolicy: "RANDOM_FROM_TARGET_HAND"; // server resolves concrete `destroyedCardIds` (§3.3)
    }
  | { kind: "SECOND_CHANCE" };

export type CardEffect =
  | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
  // resolved: concrete wrong-option indexes chosen server-side before append.
  // `count` is the REQUESTED number and is never rewritten;
  // `availableAtResolution` is the wrong-option supply captured at resolve time.
  // `indexes.length === Math.min(count, availableAtResolution)` (§3.3
  // "Resolved cardinality"), so the validator checks cardinality from the
  // payload alone — never from live question state. Replay reads these indexes
  // verbatim and MUST NOT re-run the RNG (§3.3 "Replay MUST NOT re-randomize").
  | {
      kind: "OPTION_DISABLE";
      indexes: number[];
      count: number;
      availableAtResolution: number;
      durationMs: number;
    }
  | { kind: "OPTION_FAKE"; indexes: number[]; durationMs: number }
  | { kind: "OPTION_LOCK"; durationMs: number }
  | { kind: "HINT_REVEAL"; partial: string } // resolved: concrete string derived from current question
  | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
  | {
      kind: "VISUAL_OVERLAY";
      flag: "BRAIN_FOG" | "DEEP_READ";
      durationMs: number;
    }
  | { kind: "SEMANTIC_FLIP"; durationMs: number }
  | { kind: "QUESTION_REPLAY"; extraMs: number }
  | { kind: "SHIELD"; expiresAtRound: number } // resolved: absolute round number derived from persisted roundNo
  | { kind: "SCORE_MULT"; factor: number }
  // resolved: concrete cards chosen server-side before append.
  // `count` is the REQUESTED number and is never rewritten;
  // `availableAtResolution` is the target hand size captured at resolve time.
  // `destroyedCardIds.length === Math.min(count, availableAtResolution)`
  // (§3.3 "Resolved cardinality"), so a short or empty target hand yields a
  // shorter array — never padded, never wrapped. Replay reads these IDs
  // verbatim and MUST NOT re-run the RNG (§3.3 "Replay MUST NOT re-randomize").
  | {
      kind: "HAND_DESTROY";
      count: number;
      availableAtResolution: number;
      destroyedCardIds: CardId[];
    }
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
import type { CardId } from "./cards";

/** Exported so consumers of CardEffectEvent can import the resolution discriminator. */
export type CardEffectResolution = "MUTATION" | "TEMPORARY";

export type MutationEffect = {
  seqNo: number; // monotonic, persisted in Redis / event log
  type: "CARD_RESOLVED";
  roundNo: number;
  cardId: CardId; // immutable: identifies the consumed card for audit/replay correlation
  offerSeqNo: number; // immutable: points back to CARD_OFFER.seqNo for selection correlation
  playedByPlayerId: string;
  targetPlayerIds: string[]; // concrete recipients, expanded server-side before append
  effect:
    | { kind: "TIMER_MODIFY"; deltaMs: number; targetCount: number }
    | { kind: "DELAY_RENDER"; delayMs: number; targetCount: number }
    | { kind: "HINT_REVEAL"; partial: string }
    | { kind: "QUESTION_REPLAY"; extraMs: number }
    | { kind: "SHIELD"; expiresAtRound: number }
    | { kind: "SCORE_MULT"; factor: number }
    // `destroyedCardIds` persists the concrete cards destroyed so replay and
    // the audit log agree; never re-derived from the RNG at replay time.
    // `count` + `availableAtResolution` carry the canonical cardinality so the
    // validator checks `length === Math.min(count, availableAtResolution)`
    // from the payload alone (§3.3 "Cardinality coverage").
    | {
        kind: "HAND_DESTROY";
        count: number;
        availableAtResolution: number;
        destroyedCardIds: CardId[];
      }
    | { kind: "SECOND_CHANCE" };
  resolution: "MUTATION";
  serverTimestamp: number;
  expiresAtServer: null;
  remainingMs: null; // mutations never carry temporary countdown state
};

export type TemporaryEffect = {
  seqNo: number;
  type: "CARD_RESOLVED";
  roundNo: number;
  cardId: CardId; // immutable: identifies the consumed card for audit/replay correlation
  offerSeqNo: number; // immutable: points back to CARD_OFFER.seqNo for selection correlation
  playedByPlayerId: string;
  targetPlayerIds: string[];
  effect: // `count` + `availableAtResolution` carry the canonical cardinality so the
    // validator checks `indexes.length === Math.min(count, availableAtResolution)`
    // from the payload alone (§3.3 "Cardinality coverage").
    | {
        kind: "OPTION_DISABLE";
        indexes: number[];
        count: number;
        availableAtResolution: number;
        durationMs: number;
      }
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
};

export type CardEffectEvent = MutationEffect | TemporaryEffect;

/**
 * `cardId` + `offerSeqNo` correlation: both fields are immutable and MUST be
 * validated before appending a CARD_RESOLVED event. The server checks that
 * `offerSeqNo` points to a valid `CARD_OFFER` event whose `offeredCardIds`
 * contains `cardId`, and that the player picked that card via a `CARD_PICKED`
 * event. This correlation is part of the audit/replay contract — `@arena/shared`
 * owns the event schema; the API boundary enforces the validation.
 *
 * `rolledBack` field removed for v1: replay cannot use it to reverse
 * already-materialized state. No replay-time skipping based on a rollback flag.
 * If rollback support is required later, model it as an explicit compensating
 * event with reducer semantics — not a boolean on the original event.
 */

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

```text
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
  // ALL authoritative persisted events after snapshotSeqNo — NOT only
  // CARD_RESOLVED. `seqNo` is a single per-match stream (BaseEvent.seqNo), so
  // the contiguity check below spans every event type. Filtering to card
  // events BEFORE validation would make every non-card event look like a gap
  // and force a spurious full resync.
  persistedEvents: MatchEvent[],
  replayServerNow: number, // TRUSTED current server time; not snapshot.serverNow
  validatedHighWaterMark: number, // TRUSTED event-log high-water mark for the GLOBAL
  // per-match stream; supplied by the event-log layer, NEVER derived from
  // persistedEvents (a derived bound cannot detect a truncated tail — see
  // replay contract item 6). It is deliberately NOT card-scoped: seqNo is not
  // partitioned per event type, so a card-scoped mark cannot exist.
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
  //    Sort a shallow copy so the caller-provided array is never mutated.
  const sorted = [...persistedEvents].sort((a, b) => a.seqNo - b.seqNo);

  // 2a) Reject a snapshot that claims coverage beyond the authoritative log.
  //     Checked BEFORE any dedup/coverage work: such a snapshot is from a
  //     different epoch or corrupt, so its seqNo is not a usable cursor.
  if (snapshot.snapshotSeqNo > validatedHighWaterMark) {
    throw new Error(
      `snapshot beyond high-water mark: snapshotSeqNo=${snapshot.snapshotSeqNo}` +
        ` > validatedHighWaterMark=${validatedHighWaterMark}`,
    );
  }

  // 2b) Deduplicate by seqNo BEFORE checking coverage. Equivalent duplicate
  //     payloads (same seqNo, same canonical bytes) are idempotent and
  //     allowed. Conflicting payloads for the same seqNo are a hard error.
  //     Events above the trusted mark are not covered by this replay.
  for (const event of sorted) {
    // Reject malformed sequence numbers before they reach any range logic. A
    // non-integer / NaN / unsafe seqNo would poison both the dedup map and the
    // presence check below (NaN !== NaN makes a Set entry unmatchable).
    if (!Number.isSafeInteger(event.seqNo)) {
      throw new Error(`invalid seqNo: ${event.seqNo}`);
    }
    if (event.seqNo <= snapshot.snapshotSeqNo) continue;
    if (event.seqNo > validatedHighWaterMark) {
      throw new Error(
        `event above high-water mark: seqNo=${event.seqNo}` +
          ` > validatedHighWaterMark=${validatedHighWaterMark}`,
      );
    }
    const encoded = canonicalSerialize(event);
    const prior = seenSeqNos.get(event.seqNo);
    if (prior !== undefined) {
      if (prior !== encoded) {
        throw new Error(
          `conflicting duplicate CARD_RESOLVED seqNo=${event.seqNo}`,
        );
      }
      continue; // equivalent duplicate — idempotent
    }
    seenSeqNos.set(event.seqNo, encoded);
  }

  // 2c) Validate complete, contiguous coverage over the half-open interval
  //     (snapshotSeqNo, validatedHighWaterMark]. The bound is the TRUSTED
  //     mark, never max(received seqNo): a derived bound silently accepts a
  //     truncated tail (drop the highest seqNo and the range just shrinks to
  //     match). snapshotSeqNo === validatedHighWaterMark means zero events to
  //     replay, which is valid; snapshotSeqNo = 0 with the first event at
  //     seqNo = 1 is also valid (the interval is open at the low end).
  //     A gap or truncated tail means events are missing — fail closed by
  //     requesting a full resync rather than returning partial state.
  //     Verify PRESENCE of every expected value, not just the count: a count
  //     check is satisfiable by the wrong set (e.g. an out-of-range or
  //     duplicate-shaped payload that slipped past dedup), and it cannot name
  //     which seqNos are missing. Reporting the concrete missing range is what
  //     lets the caller request a precise resync.
  const missingSeqNos: number[] = [];
  for (
    let expected = snapshot.snapshotSeqNo + 1;
    expected <= validatedHighWaterMark;
    expected++
  ) {
    if (!seenSeqNos.has(expected)) missingSeqNos.push(expected);
  }
  if (missingSeqNos.length > 0) {
    // A gap, or a tail truncated below the mark.
    throw new Error(
      `seqNo coverage gap in (${snapshot.snapshotSeqNo}, ${validatedHighWaterMark}]:` +
        ` missing ${missingSeqNos.join(", ")}`,
    );
  }

  const replayedSeqNos = new Set<number>();
  for (const event of sorted) {
    // Dedup already validated above; skip events at or below the snapshot.
    if (event.seqNo <= snapshot.snapshotSeqNo) continue;
    // Coverage is validated over the GLOBAL stream; only card effects are
    // rehydrated here. Filtering happens AFTER the contiguity check so that
    // non-card events count toward coverage instead of registering as gaps.
    if (!isCardEffectEvent(event)) continue;
    // Skip equivalent duplicates already replayed in this loop.
    if (replayedSeqNos.has(event.seqNo)) continue;
    replayedSeqNos.add(event.seqNo);
    if (!event.targetPlayerIds.includes(playerId)) continue;

    if (event.resolution === "MUTATION") {
      // Replayed exactly once after snapshotSeqNo. This covers TIMER_MODIFY,
      // SCORE_MULT, HINT_REVEAL, SHIELD, SECOND_CHANCE and HAND_DESTROY.
      // Effects are replayed from their persisted resolved payloads only —
      // HAND_DESTROY applies `effect.destroyedCardIds` as recorded and never
      // re-samples the target's hand.
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
6. **seqNo dedup before coverage**: the reducer first deduplicates events by
   `seqNo` using `canonicalSerialize` to detect equivalent vs conflicting
   payloads, rejecting any `seqNo` that is not a safe integer. The coverage
   bound is `validatedHighWaterMark` — an **externally validated** mark supplied
   by the event-log layer. It MUST NOT
   be derived from the received events (e.g. `max(event.seqNo)`): a derived
   bound cannot detect a truncated tail, because dropping the highest `seqNo`
   also shrinks the expected range, so the check passes vacuously.
   **Scope: the mark and the coverage check are GLOBAL, not card-scoped.**
   `seqNo` is one per-match sequence shared by all event types
   (`BaseEvent.seqNo`), so a card-only high-water mark cannot exist. The input
   `persistedEvents` therefore carries **every** event type after
   `snapshotSeqNo`; card events are filtered out only **after** coverage
   validation. Passing a card-filtered array would make each interleaved
   non-card event appear as a gap and trigger a spurious full resync.
   The reducer
   first rejects any snapshot with `snapshotSeqNo > validatedHighWaterMark`
   (wrong epoch / corrupt), then requires the unique `seqNo`s to form a
   complete contiguous range over the **half-open interval**
   `(snapshot.snapshotSeqNo, validatedHighWaterMark]`, verifying the
   **presence of each expected value** rather than comparing a count — a count
   check cannot name the missing range and can be satisfied by the wrong set.
   Open at the low end, so
   `snapshotSeqNo = 0` with the first event at `seqNo = 1` is valid;
   `snapshotSeqNo === validatedHighWaterMark` (nothing to replay) is valid too.
   A truncated tail or gap means events are missing — the reducer fails closed
   by throwing — the caller MUST request the existing full-resync path rather
   than returning partially restored state. Equivalent duplicate payloads
   (same `seqNo`, same canonical bytes) are treated as idempotent; conflicting
   payloads for the same `seqNo` still throw. **Caller split (same contract,
   two behaviors):** the _replay_ path fails closed (throw → full resync),
   while the _reconciliation_ path clamps its cursor to the last contiguous
   `seqNo` and enqueues nothing past the gap (see
   `memory-bank/progress.md` §"Scan-cursor invariants"); both report the
   missing range. Coverage MUST include equivalent events deserialized with
   different key orders to verify they are treated as idempotent, not
   conflicts, and MUST include a truncated-tail case (missing highest `seqNo`,
   detectable only via the external mark) that is rejected. Coverage MUST also
   include: an interval containing **interleaved non-card events** (asserting
   they satisfy coverage and are then filtered out, with no spurious gap); an
   **interior gap** (asserting the error names the specific missing `seqNo`s);
   and a **malformed `seqNo`** (`NaN`, fractional, or beyond
   `Number.MAX_SAFE_INTEGER`) that is rejected before range logic runs.

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

  // `commandId` is the REQUIRED command-level idempotency key, supplied by the
  // client per play attempt (same role as `submissionId` on submitAnswer). It is
  // distinct from `seqNo`, which is the event-level key assigned only DURING
  // append: a client retry that arrives before the first append completes has no
  // `seqNo` yet, so `seqNo` dedup alone cannot stop duplicate command
  // processing. The API boundary rejects a missing/malformed `commandId`.
  async handleCardPlay(
    playerId: string,
    cardId: string,
    commandId: string,
    targetId?: string,
  ) {
    return this.commandMutex.runExclusive(async () => {
      if (this.isRecoveringFromApplyFailure) {
        throw new Error(
          "match handler recovering from append/apply divergence",
        );
      }

      // Resolve the authoritative round ONCE per request, BEFORE the
      // idempotency lookup. Both the fingerprint comparison below and the
      // append below MUST canonicalize `roundNo` from this same value, so
      // retry-time and append-time fingerprints are computed identically.
      const persistedRound = await this.eventLog.currentRoundNo(this.matchId);

      // Command-level idempotency: look up (matchId, commandId) BEFORE doing any
      // work. The stored row carries BOTH a canonical request fingerprint and
      // the COMPLETE original outcome — never just the seqNo. Reconstructing a
      // result from seqNo alone is insufficient: seqNo cannot distinguish
      // COMMITTED_APPLIED from COMMITTED_REBUILT or COMMITTED_PENDING_RECOVERY,
      // so a retry could report a different status than the original call.
      const prior = await this.commandStore.findOutcome(
        this.matchId,
        commandId,
      );
      if (prior !== null) {
        // Same commandId MUST mean the same command. A mismatch is a client
        // bug or a replay probe — reject instead of silently returning an
        // unrelated result. Mirrors submitAnswer's ALREADY_ANSWERED behavior
        // when submissionId matches but the answer differs.
        //
        // `roundNo` comes from the CURRENT request (`persistedRound`), never
        // from `prior.roundNo`: sourcing it from the stored row would compare
        // that field against itself, making it vacuous. A commandId replayed in
        // a LATER round must yield COMMAND_ID_CONFLICT rather than a stale
        // outcome — otherwise the replay bypasses the current round's
        // (matchId, roundNo)-scoped AOE accounting.
        const fingerprint = canonicalCommandFingerprint({
          playerId,
          cardId,
          targetId,
          roundNo: persistedRound,
        });
        if (prior.fingerprint !== fingerprint) {
          throw new RoomError(ErrorCode.COMMAND_ID_CONFLICT);
        }
        // Fingerprint matches — return the stored outcome verbatim.
        return { status: prior.status, seqNo: prior.seqNo };
      }

      // Validate hand, target, cooldown and current answer-window deadline.
      // resolveCardEffect expands an AOE selector to concrete targetPlayerIds.
      const resolved = this.resolveCardEffect(playerId, cardId, targetId);

      // The (matchId, commandId) row — fingerprint + final outcome + seqNo —
      // MUST be persisted in the SAME transaction as the CARD_RESOLVED append.
      // A separate write would leave a crash window where the event is
      // committed but the command is replayable. The outcome column is updated
      // to the terminal status (APPLIED / REBUILT / PENDING_RECOVERY) before
      // the handler returns, so a later retry replays that exact status.
      await this.eventLog.reserveAoeAndAppendIfAllowed({
        matchId: this.matchId,
        roundNo: persistedRound,
        event: resolved,
        aoeCapPerRound: AOE_CAP_PER_ROUND,
        commandId, // persisted atomically with the event
        commandFingerprint: canonicalCommandFingerprint({
          playerId,
          cardId,
          targetId,
          roundNo: persistedRound,
        }),
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
            try {
              await this.recoveryTaskStore.append({
                matchId: this.matchId,
                seqNo: resolved.seqNo,
                kind: "EMIT_STATE_RESYNC",
                source: "applyCardEffect",
              });
            } catch {
              // Recovery task store unavailable — reconciliation backstop.
            }
            return {
              status: "COMMITTED_PENDING_RECOVERY",
              seqNo: resolved.seqNo,
            };
          }
          return { status: "COMMITTED_REBUILT", seqNo: resolved.seqNo };
        } catch {
          try {
            await this.recoveryTaskStore.append({
              matchId: this.matchId,
              seqNo: resolved.seqNo,
              kind: "REBUILD_AND_RESYNC",
              source: "applyCardEffect",
            });
          } catch {
            // Recovery task store unavailable — reconciliation backstop.
          }
          return {
            status: "COMMITTED_PENDING_RECOVERY",
            seqNo: resolved.seqNo,
          };
        } finally {
          this.isRecoveringFromApplyFailure = false;
        }
      }
      // Post-apply enqueue: the event is already persisted and applied
      // (COMMITTED). A catch-only recovery task is NOT sufficient — if
      // recoveryTaskStore.append also fails or the process crashes, COMMITTED
      // must still be preserved by a durable, idempotent backstop. Two distinct
      // idempotency keys apply: (1) `commandId` guards COMMAND retries at the
      // boundary via the (matchId, commandId) -> seqNo mapping persisted with
      // the append; (2) the persisted `seqNo` guards EVENT-level duplicate
      // delivery and transport dedup. A retried command short-circuits on the
      // commandId lookup above and replays that command's stored outcome
      // verbatim. A periodic
      // reconciliation job scans the event log for CARD_RESOLVED rows whose
      // outbox state is unsatisfied and rebuilds the outbox from the log.
      try {
        await this.transportOutbox.enqueue(resolved);
      } catch {
        // Best-effort recovery task; even if this throws, reconciliation from
        // the event log is the durable backstop that preserves COMMITTED.
        try {
          await this.recoveryTaskStore.append({
            matchId: this.matchId,
            seqNo: resolved.seqNo,
            kind: "REBUILD_OUTBOX_FROM_LOG",
            source: "transportOutbox.enqueue_post_apply",
          });
        } catch {
          // Recovery task store unavailable — rely on periodic reconciliation.
        }
        return { status: "COMMITTED_PENDING_RECOVERY", seqNo: resolved.seqNo };
      }
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

  private flushRetryCount = 0;
  private flushExhausted = false; // live-process flag; NOT crash-safe — see restart contract below
  private static readonly FLUSH_RETRY_BASE_MS = 100;
  private static readonly FLUSH_RETRY_MAX_MS = 10_000;
  private static readonly FLUSH_RETRY_MAX_ATTEMPTS = 20;

  private async flushPendingEffects() {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = (async () => {
      if (this.pendingEffects.length === 0) return;

      // Partition pending effects by roundNo so each batch belongs to exactly
      // one round. Sort each partition by ascending seqNo before emit.
      const byRound = new Map<number, CardEffectEvent[]>();
      for (const eff of this.pendingEffects) {
        const bucket = byRound.get(eff.roundNo) ?? [];
        bucket.push(eff);
        byRound.set(eff.roundNo, bucket);
      }

      for (const [roundNo, roundEffects] of byRound) {
        const sorted = roundEffects.sort((a, b) => a.seqNo - b.seqNo);
        try {
          const aoeCountInRound = await this.eventLog.countAoeResolved(
            this.matchId,
            roundNo,
          );
          this.emit("CARD_RESOLVED_BATCH", {
            seqNo: sorted.at(-1)!.seqNo, // transport metadata only; NOT a replay cursor
            roundNo: sorted[0].roundNo, // first (== roundNo) after sort
            effects: sorted,
            aoeCountInRound,
          });
          // Emitting is NOT proof of delivery. Move the emitted batch's rows to
          // `sent_unacknowledged` — do NOT mark them dispatched/removed here.
          // Rows leave the outbox only via the ack path or resync advancement
          // (see "Committed effects are not deleted merely because a Socket.IO
          // emit was attempted" below). Re-emitting a `sent_unacknowledged` row
          // after reconnect/failover is harmless: consumers dedup by `seqNo`.
          await this.transportOutbox.markSentUnacknowledged(
            sorted.map((event) => event.seqNo),
          );
          this.flushRetryCount = 0; // reset on success
        } catch {
          // Exponential backoff with jitter + limit to avoid hot loop.
          this.flushRetryCount++;
          if (this.flushRetryCount >= MatchHandler.FLUSH_RETRY_MAX_ATTEMPTS) {
            // Terminal state for this process. The in-memory `flushExhausted`
            // flag is a live-process optimization — it is NOT crash-safe. On
            // restart, the handler re-derives exhaustion by checking for a
            // persisted FLUSH_RETRY_EXHAUSTED recovery task (or via the
            // periodic reconciliation job).
            //
            // CRASH-SAFETY ORDER (append-first): the idempotent recovery task
            // MUST be appended BEFORE the in-memory flag and metric are
            // updated. Only set `flushExhausted` and record the metric AFTER a
            // successful append. If the append fails, leave `flushExhausted`
            // false and rely on the periodic reconciliation job to detect and
            // recover the exhausted match. This ordering guarantees that
            // whenever the flag is set, a durable restart signal already
            // exists; a crash before append leaves no flag AND no recovery
            // task, so reconciliation is the only backstop (correct — we
            // cannot pretend to be exhausted without a durable record).
            // Idempotent key = (matchId, seqNo, kind) — repeated calls cannot
            // create duplicate recovery tasks.
            let appendOk = false;
            let appendErr: unknown = undefined;
            try {
              await this.recoveryTaskStore.append({
                matchId: this.matchId,
                seqNo: sorted[0].seqNo,
                kind: "FLUSH_RETRY_EXHAUSTED",
                source: "flushPendingEffects",
              });
              appendOk = true;
            } catch (err) {
              appendErr = err;
              // Recovery task store unavailable — DO NOT set flag/metric;
              // reconciliation will detect the exhausted match and recover.
              // Observability: surface the failure via a structured error log
              // AND a dedicated append-failure metric so ops can distinguish
              // "no exhaustion reached" from "exhaustion reached but durable
              // record write failed". `card.flush_exhausted` is intentionally
              // NOT incremented here — that metric is reserved for the
              // post-append-success telemetry path (see below) so dashboards
              // only flag true exhausted matches, not transient store blips.
              this.logger.error(
                {
                  matchId: this.matchId,
                  seqNo: sorted[0].seqNo,
                  kind: "FLUSH_RETRY_EXHAUSTED",
                  source: "flushPendingEffects",
                  retryCount: this.flushRetryCount,
                  err,
                },
                "flush_recovery_task_append_failed",
              );
              this.metrics.increment("card.flush_exhausted_append_failed", {
                matchId: this.matchId,
                seqNo: sorted[0].seqNo,
              });
            }
            if (appendOk) {
              this.flushExhausted = true;
              this.flushScheduled = false;
              // Record metric/log for ops visibility — only after durable
              // signal exists.
              this.metrics.increment("card.flush_exhausted", {
                matchId: this.matchId,
                seqNo: sorted[0].seqNo,
              });
            }
            return; // terminal — no further retry scheduling, no propagation
          }
          // Before the next retry, reload pending effects so that any effects
          // already acknowledged (or superseded by resync advancement) are
          // removed — acknowledged partitions must not be emitted again. Rows
          // still in `sent_unacknowledged` remain pending and MAY be re-emitted.
          this.pendingEffects = await this.transportOutbox.loadPending(
            this.matchId,
          );
          const base = Math.min(
            MatchHandler.FLUSH_RETRY_BASE_MS * 2 ** this.flushRetryCount,
            MatchHandler.FLUSH_RETRY_MAX_MS,
          );
          const jitter = Math.floor(Math.random() * (base * 0.25));
          const delay = base + jitter;
          // Keep events in the outbox; maintain pending state across retries.
          // Only reset flush scheduling for the next retry cadence.
          this.flushScheduled = false;
          this.flushDeadline = this.clock.monotonicNow() + delay;
          // Expose pending age for ops monitoring (metric/alert hook).
          // If pending effects persist beyond a threshold, an alert fires.
          setTimeout(
            () => void this.flushPendingEffects().catch(() => undefined),
            delay,
          );
          return; // stop processing further rounds this pass
        }
      }

      // Reload pending after all batches were emitted and marked
      // sent_unacknowledged; acknowledged/superseded rows drop out here.
      this.pendingEffects = await this.transportOutbox.loadPending(
        this.matchId,
      );
      this.flushScheduled = false;
      this.flushDeadline = null;
      if (this.pendingEffects.length > 0) {
        this.scheduleMicroBatchFlush(this.clock.monotonicNow());
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
- **Command-level idempotency (`commandId`, REQUIRED)**: `handleCardPlay` MUST take a client-supplied `commandId` and enforce idempotency across **command retries**, not only event `seqNo` processing. `seqNo` is assigned _during_ append, so a retry that arrives before the first append completes carries no `seqNo` and would otherwise be processed twice (double card spend, double AOE reservation). The boundary rejects a missing/malformed `commandId` (same validation shape as `submissionId` on `submitAnswer`: required, non-empty, ≤64 chars). The `(matchId, commandId)` row MUST persist **three** things in the **same transaction** as the `CARD_RESOLVED` append: the `seqNo`, a **canonical request fingerprint** over (`playerId`, `cardId`, `targetId`, `roundNo`), and the **complete final outcome** (terminal `status` + `seqNo`). A separate write leaves a crash window where the event is committed but the command is still replayable.
  - **On retry, compare the fingerprint first.** If `playerId`, `cardId`, `targetId`, or any other fingerprinted field differs from the stored row, the request is **rejected** (`COMMAND_ID_CONFLICT`) — a reused `commandId` carrying a different command is a client bug or a replay probe, and silently returning an unrelated result would mask it. This mirrors `submitAnswer`, which throws `ALREADY_ANSWERED` when `submissionId` matches but the answer differs.
  - **Fingerprint inputs come from the CURRENT request, never from the stored row.** `roundNo` in particular MUST be the round resolved for this request (one `currentRoundNo` lookup, hoisted above the idempotency check and reused for the append), not `prior.roundNo`. Sourcing it from the stored row compares that field against itself, making the `roundNo` component vacuous and letting a `commandId` replayed in a **later round** return a stale outcome — which would also bypass the new round's `(matchId, roundNo)`-scoped AOE accounting. The same value MUST feed both the retry-time fingerprint and the append-time fingerprint so the two are provably identical.
  - **On fingerprint match, return the stored outcome verbatim** — do NOT reconstruct it from `seqNo`. `seqNo` alone cannot distinguish `COMMITTED_APPLIED` from `COMMITTED_REBUILT` or `COMMITTED_PENDING_RECOVERY`, so a reconstructed reply could report a status the original call never returned. Never re-resolve, re-append, re-apply, or re-enqueue; behavior for new commands is unchanged.
  - The same fingerprint-then-replay rule applies to **every** command-idempotency path in this spec (`handleCardPick` and any future card command), not just `handleCardPlay`.
  - Coverage MUST include: same `commandId` sent twice concurrently (serialized by `commandMutex`, exactly one append, one AOE slot consumed); same `commandId` retried after commit (returns the stored status **and** `seqNo`, no second effect); same `commandId` with a **different** `cardId`/`targetId`/`playerId` (rejected as a conflict, no state change); same `commandId` replayed in a **different (later) round** (rejected as a conflict, not a stale replay, and the new round's AOE counter is untouched); a retry of a command whose original outcome was `COMMITTED_PENDING_RECOVERY` (returns that same status, not `COMMITTED_APPLIED`); and distinct `commandId`s from the same player (both processed).
- **Post-apply durability**: after the event is persisted and applied (COMMITTED), a transport-outbox enqueue failure or a recovery-task-store failure MUST NOT lose the committed result. Two idempotency keys cooperate: `commandId` (command level, boundary retries) and the persisted `seqNo` (event level, duplicate delivery / transport dedup). A periodic reconciliation job rebuilds the outbox from the event log as the durable backstop when both `transportOutbox.enqueue` and `recoveryTaskStore.append` fail.
- `handleCardPlay` MUST return the `commandMutex.runExclusive(...)` promise so callers receive `COMMITTED_APPLIED`, `COMMITTED_REBUILT`, or `COMMITTED_PENDING_RECOVERY` plus the committed `seqNo`. A retried `commandId` replays the stored terminal status verbatim — there is no separate duplicate status, because the caller must not be able to distinguish a retry from the original call.
- `pendingEffects`, transport broadcast, and recovery must converge on the same committed outcome; a recovered event must not be left out of `pendingEffects`, duplicated indefinitely, or replayed into the same deterministic failure loop.
- Committed effects are not deleted merely because a Socket.IO emit was attempted. They stay in a durable transport outbox keyed by `seqNo`, and are removed only after ack/resync advancement proves delivery or safe supersession. Reconnect/failover reloads unsatisfied outbox rows and deduplicates by `seqNo`.
- Coverage MUST include connection drop before batch delivery, then reconnect/resync/failover recovery, proving no committed event is lost and duplicate retransmit by `seqNo` is harmless.
- `endRound` is a flush/reset boundary, not the resolution boundary.
- **Flush retry exhaustion (terminal, per-process)**: when `flushRetryCount` reaches `FLUSH_RETRY_MAX_ATTEMPTS`, the handler appends the idempotent `FLUSH_RETRY_EXHAUSTED` recovery task FIRST, and only AFTER a successful append sets `flushExhausted = true` (in-memory, live-process flag) and records the metric/log. The recovery task key is idempotent — `(matchId, seqNo, kind)` — so repeated calls cannot create duplicates. If the append fails, `flushExhausted` is left `false` and the metric is NOT recorded; the periodic event-log reconciliation job is the durable backstop that detects and recovers the exhausted match. The handler returns immediately either way: no further retry scheduling, no propagation of rejection, no further recovery tasks for the same exhaustion. **Append-failure observability (telemetry distinct from exhaustion signal):** when the recovery-task append throws, the catch branch MUST emit a structured error log (`flush_recovery_task_append_failed` with `matchId`, `seqNo`, `kind`, `retryCount`, `err`) AND increment the dedicated failure metric `card.flush_exhausted_append_failed`. The success-side telemetry `card.flush_exhausted` is intentionally NEVER recorded on append failure so dashboards distinguish true exhausted matches from transient store blips. Coverage MUST assert: (i) append failure increments `card.flush_exhausted_append_failed` (and the structured log fires); (ii) `card.flush_exhausted` is NOT incremented on append failure; (iii) once reconciliation recovers and the append eventually succeeds, `card.flush_exhausted` IS recorded (no silent telemetry loss after durable recovery). **Crash-safety / restart contract (append-first)**: the in-memory `flushExhausted` flag is NOT crash-safe — it is lost on process restart. The ordering guarantee is: whenever the flag is set, a durable `FLUSH_RETRY_EXHAUSTED` recovery task already exists. On startup, the handler re-derives exhaustion state by querying for a persisted `FLUSH_RETRY_EXHAUSTED` recovery task for the match (or via reconciliation). Coverage MUST include three crash points: (i) crash **before** append completes — no flag, no recovery task; reconciliation recovers and the handler does not silently claim exhaustion; (ii) crash **after** append succeeds but before the flag/metric update — restart finds the durable recovery task and does not resume retrying; (iii) restart recovery — kill the process after exhaustion is fully reached, restart the handler, and verify it does NOT resume retrying — the persisted recovery task (or reconciliation) provides the durable signal.
- **Startup recovery gate (retries blocked while exhaustion state is unknown)**: the durable `FLUSH_RETRY_EXHAUSTED` lookup / reconciliation on startup is **asynchronous**, so `flushExhausted === false` after restart means "unknown", NOT "not exhausted". The handler MUST start in an explicit `recoveryPending` state and block **flush** scheduling — `scheduleMicroBatchFlush` and every flush retry timer — while that recovery is in flight. Scheduling resumes only after recovery completes AND confirms no durable `FLUSH_RETRY_EXHAUSTED` task exists for the match; if recovery confirms exhaustion, the handler sets `flushExhausted = true` and stays terminal. **Two independent retry mechanisms — do not conflate:** (1) the _flush_ retry timer, gated by `recoveryPending`; (2) a **dedicated backoff-based reconciliation retry** for the durable lookup itself, which is explicitly **NOT** gated by `recoveryPending` — gating it would deadlock the gate forever, since the only thing that can clear `recoveryPending` is a completed lookup. If the lookup fails, flush scheduling stays fail-closed (blocked) while the reconciliation mechanism retries the lookup on its own backoff schedule; never fall through to flush scheduling on an inconclusive result. **The blocking condition is `recoveryPending === true`, NOT the value of `flushExhausted`** — the flag is never a sufficient gate because "unknown" and "not exhausted" are indistinguishable through it. Coverage MUST assert: (iv) with the recovery lookup held pending (unresolved promise) after restart, an incoming flush trigger schedules **no** flush and starts **no** retry timer while `recoveryPending === true` — asserted for **both** `flushExhausted === undefined` (never set in a fresh process) AND `flushExhausted === false` (explicitly unset), since both mean "unknown" during the recovery window; resolving the lookup as "not exhausted" then allows **exactly one** scheduled flush (assert the scheduler fired once — not zero, not twice); resolving it as "exhausted" keeps scheduling blocked (zero flushes, zero timers, handler stays terminal). (v) **Lookup failure then successful recovery**: first lookup attempt rejects, the backoff reconciliation retry fires and the second attempt resolves "not exhausted". Assert **zero** flushes and **zero** flush retry timers across the ENTIRE pending window (spanning the failed attempt, the backoff interval, and the retry in flight), that the reconciliation retry itself was NOT blocked by `recoveryPending`, and that **exactly one** flush is scheduled only after the successful attempt clears the gate.
- **Partial-success flush**: after any partial-success flush (some rounds emitted + `markSentUnacknowledged`, then a later round fails), the handler MUST reload `pendingEffects` via `transportOutbox.loadPending` before the next retry, so effects already acknowledged (or superseded by resync advancement) are removed and never re-emitted. Emission alone never removes a row: `markSentUnacknowledged` is a state transition, not a deletion, so a row stays pending until the ack/resync path retires it.
- **Apply-failure recovery appends (NOT flush exhaustion)**: the `EMIT_STATE_RESYNC` and `REBUILD_AND_RESYNC` recovery-task appends in the `applyCardEffect` path are guarded (try/catch) so an append failure is swallowed to preserve COMMITTED status — but they do NOT set `flushExhausted`, do NOT record `card.flush_exhausted`, and do NOT stop flush retries. Only the flush-retry exhaustion path (above) is terminal. Reconciliation handles the remaining recovery work for apply-failure appends consistently across event-sourcing layers.
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
  // exact 3 cards offered — fixed tuple is valid because the v1 class pools
  // (8 Công / 10 Thủ, every tier non-empty) always yield 3 unique cards.
  // See §3.3 "Offer size invariant": shrinking a pool below 3 reachable cards
  // MUST widen this to `readonly CardId[]` in the same change.
  offeredCardIds: [CardId, CardId, CardId];
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

- `gitnexus_impact` **riêng cho từng symbol** sắp sửa — mỗi symbol một call, với
  chính symbol đó làm `target`:
  - `gitnexus_impact({target: "MatchStateMachine.playCard", direction: "upstream"})`
  - `gitnexus_impact({target: "pickOffer", direction: "upstream"})`
  - `gitnexus_impact({target: "classAssignment", direction: "upstream"})`

  Artifact ghi direct callers / affected processes / risk level cho **mỗi**
  symbol; **dừng và warn** nếu risk HIGH hoặc CRITICAL trước khi sửa.

- **Stale-index recovery:** nếu `gitnexus_impact` hoặc `gitnexus_detect_changes()`
  báo index stale, **dừng quy trình ngay** — không dùng kết quả đó làm risk
  level. Chạy `npx gitnexus analyze`, đợi hoàn tất, rồi **chạy lại
  `gitnexus_impact` riêng cho từng symbol** (đúng danh sách trên, mỗi symbol một
  call) trước khi tiếp tục sửa.
- `gitnexus_detect_changes()` MUST chạy trước mỗi commit, và kết quả MUST được
  **verify**: chỉ các symbol và execution flow dự kiến thay đổi. Bất kỳ symbol
  hoặc flow ngoài dự kiến nào xuất hiện → dừng và điều tra trước khi commit.
- `playCard()`, `pickOffer()`, `classAssignment` methods
- Card events qua event log (Track D compatible)
- Strategy Pattern cho card resolution
- Tests machine (regression)

**Sub-task D — API Layer (Week 5, Days 13-16)**

- `gitnexus_impact` **riêng cho từng symbol** sắp sửa — mỗi symbol một call, với
  chính symbol đó làm `target`:
  - `gitnexus_impact({target: "MatchHandler.handleCardPick", direction: "upstream"})`
  - `gitnexus_impact({target: "MatchHandler.handleCardPlay", direction: "upstream"})`
  - `gitnexus_impact({target: "MatchHandler.handleEndRound", direction: "upstream"})`
  - mỗi function/method trong `card-validator.ts` — một call riêng cho từng
    symbol, không gộp theo file

  Artifact ghi direct callers / affected processes / risk level cho **mỗi**
  symbol; **dừng và warn** nếu risk HIGH hoặc CRITICAL trước khi sửa.

- **Stale-index recovery:** nếu `gitnexus_impact` hoặc `gitnexus_detect_changes()`
  báo index stale, **dừng quy trình ngay** — không dùng kết quả đó làm risk
  level. Chạy `npx gitnexus analyze`, đợi hoàn tất, rồi chạy lại
  `gitnexus_impact` riêng cho từng symbol trước khi tiếp tục sửa.
- `gitnexus_detect_changes()` MUST chạy trước mỗi commit, và kết quả MUST được
  **verify**: chỉ các symbol và execution flow dự kiến thay đổi. Bất kỳ symbol
  hoặc flow ngoài dự kiến nào xuất hiện → dừng và điều tra trước khi commit.
- `MatchHandler` thêm `handleCardPick`, `handleCardPlay` (immediate broadcast, required `commandId` idempotency key), `handleEndRound` (counter reset)
- `card-validator.ts` (hand state, target validity, cooldown, AOE cap, required `commandId` shape)
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
