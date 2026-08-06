# Gauntlet — Thiết kế gameplay & hướng phát triển (DRAFT để đánh giá)

> Trạng thái: **bản nháp thảo luận, chưa phải scope-lock.** Mọi con số (điểm,
> target, perk) là minh họa để hiểu cơ chế — balance thật là việc của playtest.
> Đọc xong, câu cần trả lời là: _"đọc ví dụ run ở §4 xong có muốn chơi không?"_

---

## 1. "Roguelike" nghĩa là gì — giải thích từ số 0

Một game roguelike xoay quanh khái niệm **run**:

- **Run** = một lượt chơi trọn vẹn, dài 10-20 phút. Thua là mất hết, bắt đầu
  lại từ đầu. Không có save giữa chừng, không có "tiếp tục".
- Nghe có vẻ khắc nghiệt — nhưng chính vì mất hết nên **mỗi run là một câu
  chuyện mới**: game phát cho bạn những lá bài ngẫu nhiên khác nhau (ở đây là
  perk), và bạn xây một "cỗ máy" khác nhau mỗi lần từ những lá đó.
- Cái gây nghiện KHÔNG phải phần thưởng vĩnh viễn — mà là chu kỳ:
  **thử build mới → chết → "à, lẽ ra mình nên..." → chơi ngay run nữa.**
  Balatro, Slay the Spire, Hades đều sống bằng vòng lặp này.

Hai loại ngẫu nhiên — phân biệt này quyết định game công bằng hay ức chế:

|                                   | Ví dụ                                         | Cảm giác                                           |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| **Random tình huống** (được phép) | Câu hỏi nào rơi vào, 3 perk nào được mời chọn | "Bài được chia" — chơi giỏi vẫn quyết định kết quả |
| **Random kết quả** (cấm)          | Trả lời đúng nhưng "trượt" vì xui             | Máy xèng — người chơi quiz sẽ bỏ đi                |

Gauntlet chỉ dùng loại 1. Trả lời đúng **luôn luôn** được tính đúng.

---

## 2. Cấu trúc một run

```text
BẮT ĐẦU RUN (lives=3, runMultiplierMilli=1_000, floorScoreMilli=0, runScoreMilli=0)
  │
  ├─ FLOOR 1  ── 5 câu hỏi ── floorScoreMilli ≥ targetMilli? ──> REWARD: chọn 1 trong 3 perk
  │                                                            └─ floorScoreMilli reset về 0
  ├─ FLOOR 2  ── 5 câu (khó hơn, target cao hơn) ──> chọn perk
  ├─ FLOOR 3  ── ...
  ├─ ...
  └─ FLOOR 9  ── qua = THẮNG RUN

CHẾT khi:  (a) hết mạng (một câu sai không được Bảo Hiểm = -1 mạng)
           (b) hết floor mà floorScore < target
```

- `floorScoreMilli`: tổng điểm milli của đúng 5 câu trong floor hiện tại. Reset về `0` khi
  bắt đầu floor mới; chỉ field này được so với target của floor.
- `runScoreMilli`: tổng điểm milli của toàn bộ run. Mỗi điểm ghi vào `floorScoreMilli` cũng cộng
  ngay vào `runScoreMilli`; `runScoreMilli` **không** được carry vào target của floor sau và
  **không** reset khi qua floor.
- Target được evaluate đúng một lần sau khi resolve câu thứ năm của floor. Qua
  target mới được reward; không qua target kết thúc run, dù còn mạng.

Hai cách chết là cố ý: (a) trừng phạt đoán bừa, (b) trừng phạt việc chỉ biết
trả lời đúng mà không xây build. Người chơi giỏi phải làm được cả hai.

### Target leo thang — trái tim của thiết kế

All nine floors have a deterministic target so the pure `@arena/game-core`
state machine can always decide clear vs death. Targets ship in a versioned
balance config (e.g. `g1-targets-v1`) consumed by game-core. The **locked**
part is `targetMilli`; the raw-score column below is an **estimate for design
intuition only**, not a deterministic contract, until `questionPoolVersion`
freezes an ordered difficulty sequence for all five questions in every floor.

| Floor | Target (display pts) | `targetMilli` | Điểm thô ước tính nếu KHÔNG có perk\* |
| ----: | -------------------: | ------------: | ------------------------------------- |
|     1 |                   60 |        60_000 | ~100 ✅                               |
|     2 |                  150 |       150_000 | ~100 ❌                               |
|     3 |                  320 |       320_000 | ~130 ❌                               |
|     4 |                  580 |       580_000 | ~140 ❌                               |
|     5 |                1.200 |     1_200_000 | ~150 ❌                               |
|     6 |                2.600 |     2_600_000 | ~165 ❌                               |
|     7 |                4.000 |     4_000_000 | ~180 ❌                               |
|     8 |                7.000 |     7_000_000 | ~190 ❌                               |
|     9 |               12.000 |    12_000_000 | ~200 ❌                               |

_\*Ước tính minh họa theo 5 câu × base 10-40 điểm, Mult ×1; không dùng để replay hay validate._

Đọc bảng này là hiểu ngay vì sao nó là roguelike chứ không phải quiz: **từ
floor 2 trở đi, kiến thức thuần không đủ.** Target tăng theo cấp số nhân
(~×1.8/floor), điểm thô chỉ tăng tuyến tính → bắt buộc phải build Mult. Biết
đáp án là điều kiện cần; xây engine điểm là điều kiện đủ.

---

## 3. Cách tính điểm — từ đơn giản nhất

**Không perk:** mỗi câu đúng cộng `Base` điểm. Base theo độ khó: Easy 10 ·
Medium 20 · Hard 40. Sai luôn có `0` điểm; xử lý mạng và streak tuân theo hợp
đồng ở cuối mục này.

### Công thức resolve (pure, deterministic)

```text
questionMultiplierMilli = 1_000 + tocChienBonusMilli

scoreMilli = (Base + chipBonus) × categoryMultiplierMilli × runMultiplierMilli × questionMultiplierMilli / 1_000_000
             ──────────────────   ───────────────────────   ──────────────────────   ───────────────────────
             cộng chip trước       Chuyên Gia Sử ×3, Ưa Khó  persistent run state    per-question Tốc Chiến
             (Nền Tảng +10, ...)   Hard ×2, ...              only                     only
```

**Score unit contract (canonical):** `scoreMilli`, `floorScoreMilli`,
`runScoreMilli` are integer **milli-points**; multipliers are milli-scaled
(`×1 = 1_000`, `3.7 = 3_700`); `Base`/`chipBonus` are unscaled points.
`runMultiplierMilli` is the persistent run state; `questionMultiplierMilli`
is the per-question multiplier and defaults to `1_000`. The single
`/ 1_000_000` division at the end **truncates toward zero in integer
arithmetic** and yields milli-points. This is the only score unit used by
server, replay, persistence and leaderboard keys.

Thứ tự là cố định và là contract của game-core pure state machine:

1. Resolve `Base` từ difficulty (10 / 20 / 40).
2. Cộng tất cả `chipBonus` vào Base.
3. Nhân category/difficulty multiplier theo thứ tự ID perk ổn định.
4. Tính `runMultiplierMilli` từ state bền vững của run (Mult nền, Học Giả, Chuỗi Cháy, Toàn Bích, perk vĩnh viễn).
5. Tính `questionMultiplierMilli = 1_000 + tocChienBonusMilli`, trong đó **Tốc Chiến chỉ áp dụng cho câu hiện tại**.
6. Ghi `scoreMilli` vào `floorScoreMilli` và `runScoreMilli`; không mutating UI,
   clock hay I/O trong scorer.

**Single typed pure API (game-core does NOT mutate):**

- Canonical reducer: `reduceQuestionResolved(runState, resolvedQuestion, perks)
=> nextRunState`. (`Card/Perk scorer`.)
- `applyPerk(runState, perk) => nextRunState` is a separate **adapter helper**
  for applying a picked perk between floors; it does not replace the reducer
  and must not be described as an in-place `(ctx, perk) => ctx` mutator.
- Random draw, timer and persistence live outside game-core; the reducer only
  takes resolved inputs so unit-test/replay always agree.

**`resolvedQuestion` carries server-owned timing:**

```typescript
interface ResolvedQuestion {
  questionId: string;
  clientAnswer: string;
  correct: boolean; // derived server-side from the authoritative answer key
  answerElapsedMs: number; // derived from persisted server ordering / deadline metadata
  canonicalArrivalKey: string; // retry-stable owner/ingress ordering key chosen by server
  // ...
}
```

- Answer API accepts the client's answer payload only. Server loads the
  authoritative answer key, derives `correct`, and **must never deserialize
  `correct` from the client request**.
- `questionOpenedAtMono` may be used inside a single process while the question
  is live, but persisted state must also carry a server-issued `answerDeadline`
  plus explicit clock-origin metadata so failover/reconnect never compare raw
  monotonic timestamps across processes or hosts.
- Server MUST also persist one canonical arrival-order source for answer vs
  timeout resolution, e.g. an owner-issued ingress sequence or equivalent
  retry-stable ordering token (`canonicalArrivalKey`). Replay/reconnect reuse the
  persisted accept/timeout decision and this ordering metadata; they do not
  compare client-local correctness or cross-node monotonic clocks.
- `answerElapsedMs` is reconstructed from that authoritative open/deadline
  contract and clamped into `[0, answerWindowMs + allowedExtensions]`.
- Timeout = marked wrong at the authoritative server deadline with
  `answerElapsedMs = answerWindowMs + allowedExtensions`.
- If timeout and answer land at the same authoritative instant, ordering is
  deterministic via the persisted canonical arrival source: accept the answer iff
  the stored decision says the answer beat the deadline; otherwise resolve as
  timeout. Replay and reconnect must preserve the same `answerElapsedMs` and
  correctness outcome.
- **Tốc Chiến** applies iff `correct && answerElapsedMs <= 3_000`.
- Reconnect does NOT reset the elapsed counter; replay reconstructs the same
  authoritative `answerElapsedMs`, not a client-local approximation.

### Precision & rounding (deterministic)

- Không dùng decimal floating-point multipliers. Multipliers là fixed-point
  milli integers: `0.3 = 300`, `0.5 = 500`, `1.5 = 1_500`, `3.7 = 3_700`;
  `×1 = 1_000`. Lưu ý: `number` storage (IEEE-754 doubles) IS allowed for safe
  integer products — the prohibition is on decimal-floating-point
  _multipliers_ (e.g. `0.3`, `1.5` as runtime floats), not on the IEEE-754
  representation used for safe integer arithmetic. Live scoring và replay
  harness dùng cùng arithmetic-mode selection algorithm ở "Arithmetic mode
  selection" dưới đây, nên semantics là identical between live và replay.
- **Arithmetic type (G1):** `number` when the complete product is provably
  safe, otherwise `bigint` from the first multiplication — see "Arithmetic
  mode selection" below. The single final division normalizes the three
  milli-scaled multipliers — `categoryMultiplierMilli`, `runMultiplierMilli`,
  and `questionMultiplierMilli` (`1_000 × 1_000 × 1_000 = 1_000_000` effective
  unit) back to milli-points and uses integer division toward zero:
  ```ts
  // number path (provably safe product)
  scoreMilli = Math.trunc(
    ((Base + chipBonus) *
      categoryMultiplierMilli *
      runMultiplierMilli *
      questionMultiplierMilli) /
      1_000_000,
  );
  // bigint path (product may exceed MAX_SAFE_INTEGER)
  scoreMilli_big = numerator_big / 1_000_000n;
  ```
  Both paths use truncation toward zero — `Math.trunc` for `number`, bigint
  integer division for `bigint` (never call `Math.trunc` on a `bigint`).
  Serialize as JSON **integer** numbers (never float strings). No mid-question
  rounding; accumulate exact milli-points through the floor.
- **Upper bounds (balance config MUST enforce):** the frozen balance config
  (`balanceConfigVersion`) MUST pin explicit maxima. These maxima are inputs
  to "Arithmetic mode selection" below — use `number` only when the worst-case
  product is a safe integer, and require `bigint` otherwise. Valid
  configurations whose worst-case product exceeds `Number.MAX_SAFE_INTEGER`
  are accepted and select bigint:
  - `Base` ≤ `100` (unscaled points; Easy 10 / Medium 20 / Hard 40, cap allows
    future tuning).
  - `chipBonus` total per question ≤ `1_000` (sum of all active chip perks).
  - `categoryMultiplierMilli` ≤ `10_000` (i.e. ×10).
  - `runMultiplierMilli` ≤ `100_000` (i.e. ×100, well beyond any realistic build).
  - `questionMultiplierMilli` ≤ `10_000` (i.e. ×10).
  - Worst-case intermediate product:
    `(100 + 1_000) × 10_000 × 100_000 × 10_000 = 1.1 × 10^16` — this EXCEEDS
    `Number.MAX_SAFE_INTEGER` (≈ `9.007 × 10^15`), so G1 maxima select the
    bigint path. The "Arithmetic mode selection" below uses this worst-case
    product to choose bigint before the first multiplication.
- **Arithmetic mode selection (deterministic, single path):** the scorer, live
  reducer, replay harness, and leaderboard score path MUST all choose the
  arithmetic mode **before** the first multiplication — never ad hoc mid-flight.
  The algorithm is:
  1. Compute `worstCaseProduct = (Base_max + chipBonus_max) ×
categoryMultiplierMilli_max × runMultiplierMilli_max ×
questionMultiplierMilli_max` from the frozen balance config maxima.
  2. If `Number.isSafeInteger(worstCaseProduct)` is `true`, use `number`
     throughout: `scoreMilli = Math.trunc(numerator / 1_000_000)`.
  3. Otherwise, use `bigint` from the first multiplication: cast every factor
     to `bigint`, accumulate the product as `bigint`, and divide with bigint
     integer division toward zero: `scoreMilli_big = numerator_big /
1_000_000n`. Never call `Math.trunc` on a `bigint` (it throws `TypeError`).
  4. Convert to `number` (and serialize) only after asserting
     `Number.isSafeInteger(Number(scoreMilli_big))`. If the quotient is
     outside `[-(2^53-1), 2^53-1]`, throw `ScoreOverflowError` — no silent
     truncation, no float corruption.
     All four paths share this single milli-point contract. The guard runs in
     both the live reducer and the replay harness so a replay divergence is
     impossible by construction.
- Target check: exact integer `floorScoreMilli >= targetMilli` after Q5.
- Display / UI only: round-half-up
  `Math.floor(scoreMilli / 1000 + 0.5)`. Persisted replay and leaderboard keep
  exact milli-points. Server, replay, and leaderboard share one milli contract —
  UI is a projection.
- **Shared test vectors** (must pass identically in game-core unit tests and the
  replay harness):

  | Base | chips | catMilli | runMilli | questionMilli | scoreMilli | display |
  | ---: | ----: | -------: | -------: | ------------: | ---------: | ------: |
  |   20 |     0 |    1_000 |    1_000 |         1_000 |     20_000 |      20 |
  |   20 |    10 |    1_000 |    1_000 |         1_000 |     30_000 |      30 |
  |   20 |    10 |    1_000 |    2_500 |         1_000 |     75_000 |      75 |
  |   20 |    10 |    1_000 |    3_700 |         1_000 |    111_000 |     111 |
  |   20 |    10 |    3_000 |    3_700 |         1_000 |    333_000 |     333 |
  |   11 |     0 |    1_500 |    1_700 |         1_300 |     36_465 |      36 |
  |   20 |    10 |    1_000 |    3_700 |         2_000 |    222_000 |     222 |

  Also assert: after five questions, `floorScoreMilli >= targetMilli` is exact
  (no display rounding in the check).

Ví dụ leo thang để thấy engine "nổ":

1. Không perk, Medium: `(20 + 0) × 1 × 1 = 20 điểm`.
2. _Nền Tảng_ (+10 chips): `(20 + 10) × 1 × 1 = 30`.
3. _Học Giả_ đã tích run Mult ×2.5: `(20 + 10) × 1 × 2.5 = 75`.
4. _Chuỗi Cháy_ đang chuỗi 4 (+1.2) làm run Mult = ×3.7:
   `(20 + 10) × 1 × 3.7 = 111`.
5. Câu đó là Lịch sử với _Chuyên Gia Sử_ ×3:
   `(20 + 10) × 3 × 3.7 = 333`.

Cùng một câu hỏi Medium: người không build được 20 điểm, người build đúng được 333. **Đó là khoảng cách mà target floor 7 = 4.000 tồn tại để đo.** Công thức
hiện to trên màn hình và nhảy số từng bước resolve — nhìn thấy máy của mình
chạy là một nửa cái sướng của Balatro.

### Hợp đồng resolve câu sai, Bảo Hiểm và Double-or-Nothing

Precedence khi nhiều effect cùng active là deterministic (server resolution và
replay cho cùng state):

**Câu đúng:**

1. Score theo công thức với `persistentRunMultiplierMilli` **trước** khi tăng Chuỗi Cháy;
   sau đó tăng streak thêm `+0.3 Mult` cho câu kế tiếp.
2. Nếu **Double-or-Nothing** đã declare cho câu này: score dùng `×4` trên
   kết quả milli; mark DoN **consumed**; lives đứng yên.

**Câu sai** — score luôn `0`, không multiplier nào áp dụng:

1. Nếu DoN đã declare cho câu này: mark DoN **consumed**;
   `intendedLivesLoss = 2`, ngược lại `intendedLivesLoss = 1`. Trên câu
   đúng thì `intendedLivesLoss = null`.
2. Nếu **Bảo Hiểm** chưa dùng trong floor: **consume** Bảo Hiểm — Bảo Hiểm
   absorbe toàn bộ `intendedLivesLoss` (kể cả `2` của DoN), `livesDelta = 0`,
   **không reset streak**, run tiếp tục.
3. Ngược lại (không Bảo Hiểm): apply life loss —
   **`livesDelta = -intendedLivesLoss`** (i.e. `-1`, hoặc `-2` nếu DoN đã
   declare; câu đúng thì `livesDelta = 0`); **ALWAYS reset Chuỗi Cháy về
   Mult nền** khi sai không-Bảo-Hiểm (kể cả khi lives vẫn > 0); nếu lives ≤
   0 → run kết thúc.

`livesDelta` là **actual** delta = `livesAfter − livesBefore`. Bảo Hiểm
luôn yield `livesDelta = 0`; uninsured luôn yield `livesDelta = -1` (hoặc
`-2` nếu DoN đã declare). `intendedLivesLoss` chỉ mang tính audit/UI — nó
KHÔNG dùng để mutate `lives`. Readonly replay dùng `livesDelta` thực tế.

**Authoritative resolve output** (persisted on the resolve event / snapshot —
required for readonly replay that does not re-run current ruleset/config):

```typescript
interface QuestionResolvedEvent {
  // ── Identity (event identity = (runId, floorNo, questionIndex)) ──
  runId: string;
  floorNo: number;
  questionIndex: number;
  // ── Effect flags (single-effect cases unchanged) ──
  insuranceConsumed: boolean;
  doubleOrNothingConsumed: boolean;
  // livesDelta = livesAfter - livesBefore (actual, post-Insurance). This is
  // the SOLE field used to mutate `lives`. Insurance → 0; uninsured wrong →
  // -1; uninsured wrong under DoN → -2; correct → 0.
  livesDelta: -2 | -1 | 0;
  // intendedLivesLoss: pre-Insurance intended loss — audit/UI only. NEVER
  // used to mutate `lives`. `null` on correct answers (no loss intended);
  // `1` for plain wrong; `2` for wrong under DoN.
  intendedLivesLoss: 1 | 2 | null;
  streakReset: boolean;
  // ── maxLives (authoritative — KHAT_MAU stateful effect) ──
  // maxLivesAfter is the persistent ceiling on `lives` after this resolve.
  // KHAT_MAU reduces maxLives by 1 (minimum 1) when acquired via
  // PerkAcquiredEvent; livesAfter can never exceed maxLivesAfter. Replay
  // reconstructs maxLives from the full PerkAcquiredEvent sequence — never
  // from ambient config.
  maxLivesAfter: number;
  // ── Full reducer outputs ──
  scoreMilli: number;
  answerElapsedMs: number; // persisted clamped elapsed used by readonly replay
  floorScoreMilli: number;
  runScoreMilli: number;
  livesAfter: number;
  canonicalArrivalKey: string; // persisted server-owned answer/timeout ordering key
  acceptedBeforeDeadline: boolean; // persisted authoritative accept vs timeout decision
  questionMultiplierMilli: number; // `1_000 + tocChienBonusMilli`, current question only
  // streakAfter is the source of truth for Chuỗi Cháy count after this resolve.
  // runMultiplierMilliAfter is the persistent multiplier for the NEXT question:
  // baseMultMilli + streakAfter * 300 + persistent perk state; it excludes the
  // per-question Tốc Chiến bonus that was already materialized in scoreMilli.
  streakAfter: number;
  runMultiplierMilliAfter: number;
  // floorCleared: null until Q5 resolves, concrete boolean after.
  floorCleared: boolean | null; // null before Q5; true/false after Q5 resolves
  // ── Event-specific terminal contract ──
  //   `DailyRunHeader.rulesetVersion` MUST bind EXACTLY ONE completionEncoding
  //   discriminator for the whole run:
  //   - `completionEncoding: "INLINE_COMPLETED"`:
  //       runEndReason === null ⇔ runEnded === false (run continues)
  //       runEndReason === "COMPLETED" ⇔ runEnded === true  (floor 9 Q5 target hit)
  //       runEndReason === "NO_LIVES" ⇔ runEnded === true
  //       runEndReason === "MISSED_TARGET" ⇔ runEnded === true
  //       RunCompletedEvent MUST NOT appear.
  //   - `completionEncoding: "SEPARATE_RUN_COMPLETED"`:
  //       QuestionResolvedEvent MUST use runEnded === false and runEndReason === null
  //       for the terminal floor-9 Q5 success resolve.
  //       Completion is encoded only by RunCompletedEvent, and
  //       QuestionResolvedEvent + RunCompletedEvent MUST be appended atomically
  //       in one persistence transaction.
  //       BECAUSE that append is atomic, a COMMITTED log can NEVER contain the
  //       terminal QuestionResolvedEvent without its paired RunCompletedEvent.
  //       An orphan terminal QuestionResolvedEvent is therefore NOT an
  //       "interrupted partial sequence" to be resumed: it is an UNCOMMITTED
  //       (torn / partially-visible) write and MUST be REJECTED by replay and
  //       by the append path. Replay MUST NOT apply its floor/question outputs.
  //       Only non-terminal QuestionResolvedEvents (runEnded === false on a
  //       non-final resolve) legitimately appear without a RunCompletedEvent.
  //   Mixed sequences are invalid: reject any run that contains both inline
  //   completion (`runEndReason="COMPLETED"`) and RunCompletedEvent.
  // Precedence when multiple terminal conditions apply in the same resolve
  // (Q5 of the last floor with lives ≤ 0 AND floorScore < target):
  //   COMPLETED beats NO_LIVES beats MISSED_TARGET.
  // Wire format MUST honour the event-specific invariant and precedence —
  // serializer and replay agree.
  runEnded: boolean;
  runEndReason: "NO_LIVES" | "MISSED_TARGET" | "COMPLETED" | null;
}

/**
 * Terminal run event for the `SEPARATE_RUN_COMPLETED` pattern. Identity = (runId).
 * Field order below is the canonical payload order — serializers and replay MUST
 * preserve it byte-for-byte. When this event exists, QuestionResolvedEvent for the
 * terminal floor-9 Q5 success MUST keep runEnded=false / runEndReason=null.
 */
interface RunCompletedEvent {
  runId: string;
  completionEncoding: "SEPARATE_RUN_COMPLETED";
  runEnded: true;
  runEndReason: "COMPLETED";
  floorNo: number;
  questionIndex: number;
  livesAfter: number;
  floorScoreMilli: number;
  runScoreMilli: number;
  runMultiplierMilliAfter: number;
  streakAfter: number;
}
```

**Runtime validation for persisted JSON.** Before an event is accepted into the
event log or replayed, the deserializer MUST validate the JSON shape against
the schema above and reject invalid event shapes. Specifically:

- `livesDelta` MUST be one of `-2`, `-1`, `0` — any other value is rejected.
- `intendedLivesLoss` MUST be `1`, `2`, or `null`.
- Terminal-state combinations MUST satisfy the `completionEncoding` invariant
  above. Invalid combinations (e.g. `runEnded=true` with `runEndReason=null`,
  or `runEndReason="COMPLETED"` with `runEnded=false`) are rejected.
- If `completionEncoding === "INLINE_COMPLETED"`, a `RunCompletedEvent` in the
  same run is rejected. If `completionEncoding === "SEPARATE_RUN_COMPLETED"`,
  any `QuestionResolvedEvent` with `runEndReason="COMPLETED"` is rejected, and a
  terminal floor-9 Q5 success `QuestionResolvedEvent` without its atomically
  paired `RunCompletedEvent` is rejected as an uncommitted/torn write — never
  accepted as a resumable partial sequence.
- `maxLivesAfter` MUST be a safe integer ≥ `1` and ≥ `livesAfter`.
- **Life-state domain validation (before any clamp arithmetic).** On
  `PerkAcquiredEvent` for KHAT_MAU, each of `maxLivesBefore`, `livesBefore`,
  `livesAfter`, and `maxLivesAfter` MUST independently satisfy
  `Number.isSafeInteger(v) && v >= 0`. This check runs **before** any
  `Math.max` / `Math.min` clamp is computed or verified. Invalid pre-state or
  post-state values are **rejected outright** — never normalized, clamped, or
  coerced into range. Clamping a malformed input would silently manufacture a
  self-consistent triple (e.g. `livesBefore = -3` with `livesAfter = -3` and
  `clampedLivesLoss = 0` satisfies the consistency rule below while encoding
  impossible state), so normalization is forbidden at this boundary.
- On `PerkAcquiredEvent` for KHAT_MAU, `maxLivesAfter`, `livesAfter`, and
  `clampedLivesLoss` MUST be mutually consistent — checked only after the
  domain validation above passes:
  `livesAfter === Math.min(livesBefore, maxLivesAfter)` and
  `clampedLivesLoss === livesBefore - livesAfter` with `clampedLivesLoss ∈ {0, 1}`.
  Inconsistent triples are rejected.
- Identity fields (`runId`, `floorNo`, `questionIndex`) MUST be present and
  type-correct; missing or malformed identity is rejected before the event
  enters the dedup/replay pipeline.

**Replay-required effect state.** Các effect còn lại trong floor (Bảo Hiểm
remaining, DoN remaining-uses, perk modifier inventory, and `maxLives`) được
persist bởi `FloorStartedEvent` / `PerkAcquiredEvent` / `FloorEndedEvent` —
không phải standalone `QuestionResolvedEvent` records. Readonly replay phối hợp
full event sequence này theo `seqNo`; `streakAfter` + `runMultiplierMilliAfter`
trên `QuestionResolvedEvent` là output cuối cùng dùng để rebuild persistent
`runMultiplierMilli` của câu kế tiếp, còn `questionMultiplierMilli` captures the
current-question Tốc Chiến application.

**KHAT_MAU `maxLives` effect (authoritative stateful perk).** KHAT_MAU reduces
`maxLives` by 1 (minimum 1) in exchange for +1.5 permanent base Mult. This is
a **stateful** effect, not a transient flag:

- `PerkAcquiredEvent` for KHAT_MAU MUST persist the resulting `maxLivesAfter`
  value in its payload so replay can reconstruct the ceiling without re-running
  perk resolution logic.
- **Ceiling clamp on acquisition (authoritative).** **Precondition (checked
  first):** `livesBefore >= 1` and `maxLivesBefore >= 1`. A run at `0` lives has
  already terminated with `runEndReason="NO_LIVES"`, so no perk offer can be
  presented and no acquisition can occur. A `PerkAcquiredEvent` carrying
  `livesBefore === 0` is an **invariant violation** and MUST be rejected — it is
  not a clamp case. Once the precondition holds, acquiring KHAT_MAU resolves in
  a fixed order inside the same `PerkAcquiredEvent`:
  1. `maxLivesAfter = Math.max(1, maxLivesBefore - 1)`
  2. `livesAfter = Math.min(livesBefore, maxLivesAfter)`
  3. `clampedLivesLoss = livesBefore - livesAfter` (`0` or `1`)

  Because `maxLivesAfter >= 1` and `livesBefore >= 1`, the clamp always yields
  `livesAfter >= 1`: **KHAT_MAU can never by itself reduce a run to `0` lives.**
  It narrows the ceiling and may cost one life, but the run always survives the
  acquisition — death comes later, from a wrong answer against the tighter
  ceiling. This is exactly the floor-5/floor-6 narrative in §4.

  Acquisition is **never rejected because of the ceiling**: when the player is
  at the old life ceiling (`livesBefore === maxLivesBefore`), the reduction
  **costs a real life immediately** — this is the perk's stated trade ("-1 mạng
  tối đa, đổi +1.5 Mult nền vĩnh viễn **ngay**"). The only rejection is the
  impossible pre-state in step 0. `PerkAcquiredEvent` MUST persist
  `maxLivesAfter`, `livesAfter`, and `clampedLivesLoss` so replay applies the
  clamp from stored values and never recomputes it from ambient config or the
  current ruleset.

- **Clamp is not a `livesDelta`.** `clampedLivesLoss` belongs to
  `PerkAcquiredEvent`, not to `QuestionResolvedEvent`. It MUST NOT be folded
  into any `QuestionResolvedEvent.livesDelta` (whose domain stays `-2 | -1 | 0`
  and whose sole cause is answer resolution), and it never resets Chuỗi Cháy.
- `QuestionResolvedEvent.maxLivesAfter` echoes the current `maxLives` ceiling
  after each resolve; `livesAfter` can never exceed `maxLivesAfter`.
- Snapshots MUST persist `maxLives` as part of the canonical run state.
- Replay comparison output MUST include `maxLives` as an exact-match field
  alongside the other authoritative fields (see the comparison table below).
- Replay reconstructs `maxLives` from the complete `PerkAcquiredEvent` sequence
  (not from ambient config) and MUST produce the same value as the live reducer.
- **Required test vector — acquisition at the old life ceiling.** The replay
  harness MUST cover KHAT_MAU acquired while `livesBefore === maxLivesBefore`
  (e.g. `3/3 → 2/2`, `clampedLivesLoss = 1`) **and** acquired below the ceiling
  (e.g. `2/3 → 2/2`, `clampedLivesLoss = 0`). Both vectors assert that the live
  reducer and readonly replay produce byte-identical `maxLivesAfter`,
  `livesAfter`, and `clampedLivesLoss`. A third vector MUST cover the
  `maxLives` floor (`maxLivesBefore === 1`, `livesBefore === 1` →
  `maxLivesAfter === 1`, `livesAfter === 1`, `clampedLivesLoss = 0`: no further
  reduction and no life lost). A fourth vector MUST cover **rejection** of a
  malformed `PerkAcquiredEvent` with `livesBefore === 0` (impossible pre-state
  per step 0 — the run already ended with `NO_LIVES`), asserting the event is
  rejected rather than clamped. There is deliberately **no** clamp-to-zero
  vector: the clamp cannot produce `livesAfter === 0` from a valid pre-state.

**Replay test vector bắt buộc.** Test vector của replay harness phải bao
gồm **full authoritative combined event sequence**, không chỉ một event
đơn lẻ. Tối thiểu phải cover:

- `DailyRunHeader` + `FloorStartedEvent` (floor 1..N, mỗi floor set
  `floorScoreMilli=0`, reset **floor-scoped flags only** như Insurance / per-floor
  DoN usage / floor-local reward markers, nhưng **preserve run-scoped state**:
  `lives`, persistent `runMultiplierMilli`, `streak`, base multiplier changes,
  permanent perks, và active run inventory).
- `PerkAcquiredEvent` chèn giữa các floor — bao gồm **Bảo Hiểm** (giữa
  floor) và **Chuỗi Cháy** / **Học Giả** / **Nền Tảng** / **Chuyên Gia Sử**
  để phủ inventory effect.
- `DRAW_RESOLVED` events cho question + perk offer.
- `QuestionResolvedEvent` × N phải phủ **Q5 clear path** (floor target hit,
  `floorCleared=true`, `runEnded=false` nếu chưa floor 9) và **Q5 miss
  path** (`floorCleared=false`, `runEndReason="MISSED_TARGET"` hoặc
  `"NO_LIVES"`). Phải có nhánh có **Bảo Hiểm** (một câu sai
  `livesDelta=0`, `streakReset=false`) và nhánh có **Double-or-Nothing**
  sai (`livesDelta=-2` hoặc `0` dưới Bảo Hiểm). Phủ cả câu đúng với
  `intendedLivesLoss=null`.
- `FloorEndedEvent` (chứa `floorCleared` chính thức và reward drawIds).
- Nếu chọn pattern "COMPLETED via RunCompletedEvent": một event
  `RunCompletedEvent` riêng (terminal thay vì nhồi vào
  `QuestionResolvedEvent`). Trong pattern này, `QuestionResolvedEvent`
  của floor 9 / Q5 success MUST keep `runEnded=false` và
  `runEndReason=null`, sau đó `RunCompletedEvent` mới encode completion;
  append của cặp này MUST là atomic. Vì atomic, một committed log KHÔNG
  BAO GIỜ chứa orphan terminal `QuestionResolvedEvent` — test vector phải
  cover **rejection case**: feed một log có terminal `QuestionResolvedEvent`
  nhưng thiếu `RunCompletedEvent`, assert replay **reject** log đó
  (uncommitted/torn write) và KHÔNG apply floor/question outputs, KHÔNG
  chờ, KHÔNG bù event thiếu.
  Replay cũng phải assert duplicate `RunCompletedEvent` cùng canonical payload
  là idempotent, còn payload xung đột cho cùng identity thì reject. Nếu không, một
  `QuestionResolvedEvent` `runEndReason="COMPLETED"` và `runEnded=true`.

**Authoritative replay payload contract.** Trước khi implement replay harness,
shared contract phải pin rõ các payload sau. **Uniform idempotency rule:** for
every retryable event below, a duplicate with the same `(eventType, eventIdentity)`
AND identical canonical payload bytes is idempotent (silently ignored, no second
effect). A duplicate with the same identity but different canonical payload bytes
is a hard conflict and MUST be rejected. Events marked "no idempotent retry" do
not support redelivery and MUST NOT be replayed as duplicates.

- `DailyRunHeader`: immutable run identity/header only; never mutated after run start. `completionEncoding` is the explicit completion-pattern discriminator bound by `rulesetVersion`; validation rejects any event sequence that violates the chosen pattern. Identity = `(runId)`. Idempotent: identical header is a no-op; conflicting header is rejected.
- `FloorStartedEvent`: identity = `(runId, floorNo)`; identifies `targetMilli`, question-set identity for the floor, and the exact floor-scoped resets applied at transition. Idempotent on identical payload; conflicting payload rejected.
- `PerkAcquiredEvent`: identity = the existing idempotency key inside the run; identifies acquired perk/effect, whether it is run-scoped or floor-scoped, and inventory mutation semantics (including `maxLivesAfter`, `livesAfter`, and `clampedLivesLoss` for KHAT_MAU). Idempotent on identical payload; conflicting payload rejected.
- `DRAW_RESOLVED`: identity = `(runId, drawId)`; payload includes `count` and `resultIds`. Idempotent on identical `count` + `resultIds`; mismatched `count` or `resultIds` rejected. Identity does NOT include `count` — `(runId, drawId)` remains the canonical key.
- `QuestionResolvedEvent`: identity = `(runId, floorNo, questionIndex)`; authoritative per-question reducer outputs only, including persisted `answerElapsedMs`, `canonicalArrivalKey`, and `acceptedBeforeDeadline`; no hidden dependency on ambient state. Idempotent on identical payload; conflicting payload rejected.
- `FloorEndedEvent`: identity = `(runId, floorNo)`; authoritative floor terminal decision (`floorCleared`) plus reward draw references emitted for the next step. Idempotent on identical payload; conflicting payload rejected.
- `RunCompletedEvent` if used: identity = `(runId)`; terminal run event with precedence over embedding `"COMPLETED"` inside `QuestionResolvedEvent`. Canonical payload field order is fixed as `runId`, `completionEncoding`, `runEnded`, `runEndReason`, `floorNo`, `questionIndex`, `livesAfter`, `floorScoreMilli`, `runScoreMilli`, `runMultiplierMilliAfter`, `streakAfter` — matching the `RunCompletedEvent` interface declared in the authoritative schema above. Idempotent on identical payload; conflicting payload rejected.

**Canonical payload serializer for duplicate detection.** `QuestionResolvedEvent`,
`DRAW_RESOLVED`, and `RunCompletedEvent` MUST use a dedicated payload serializer,
separate from the §2 header serializer. This serializer is the source of truth
for idempotent payload equality and conflicting-duplicate detection.

- Scope: payload bytes only; never reuse header/envelope serialization.
- Metadata excluded from serialization: `seqNo` (including `QuestionResolvedEvent.seqNo`, `DrawTraceEntry.seqNo`, and `CardResolvedBatchEvent.seqNo`), transport timestamp/envelope timestamp, append metadata, trace/request ids, and any other non-payload envelope fields. Payload projection is defined independently of header serialization.
- `QuestionResolvedEvent` field order is fixed exactly as declared in the
  authoritative schema above. `DRAW_RESOLVED` (`DrawTraceEntry`) field order is
  fixed exactly as declared in its shared schema: `type`, `runId`, `drawId`,
  `count`, `resultIds` (envelope `seqNo` excluded). `RunCompletedEvent` field
  order is fixed by its interface declared in the authoritative schema above
  and MUST start with `runId`, then the completion discriminator / terminal
  reason fields, then the final authoritative run totals. No producer may
  reorder keys.
- Arrays serialize in schema order and preserve element order exactly;
  duplicate handling does not sort arrays. For `DRAW_RESOLVED.resultIds`,
  emitted order is authoritative.
- Canonicalization algorithm is UTF-8 encoded canonical JSON with no BOM and no
  insignificant whitespace. Objects are `{` members `}` with `,` between
  members and `:` between key/value. Keys are double-quoted JSON strings in the
  fixed schema order above.
- Strings use NFC-normalized Unicode scalar values before JSON escaping. Escape
  only `"` `\` and control chars U+0000..U+001F using lowercase JSON escapes;
  do not escape `/`; non-control non-ASCII code points are emitted as UTF-8, not
  `\uXXXX`, except when required to encode a control character. The exact
  per-codepoint mapping is pinned (no encoder may choose between named and
  `\u00xx` for the same codepoint):
  - **Short 2-byte escapes** (the only named escapes used): `"` → `\"`, `\` → `\\`,
    newline `U+000A` → `\n`, `U+0009` → `\t`, `U+000D` → `\r`, `U+0008` → `\b`,
    `U+000C` → `\f`.
  - **All other control chars** in `U+0000`..`U+001F` — i.e. every codepoint
    NOT listed as a named escape above (including `U+0000` and any not covered
    by the short 2-byte set) — MUST use the lowercase 6-byte `\u00xx` form
    (e.g. `U+0001` → `\u0001`, `U+001A` → `\u001a`). Hex digits are lowercase.
    The 7 named escapes (`"`, `\`, `U+000A`, `U+0009`, `U+000D`, `U+0008`,
    `U+000C`) are the ONLY codepoints allowed to use the short 2-byte form;
    no encoder may emit `\u00xx` for those 7, and no encoder may emit a named
    escape for any other codepoint. This removes all per-codepoint ambiguity.
  - This matches the escape table in the §"Seed-derivation contract" and the
    byte-level test vectors below.
- Scalar encoding is fixed: booleans as lowercase `true`/`false`, `null` as
  lowercase `null`, and integers as base-10 ASCII with optional leading `-`
  only for values < 0. `-0` is invalid and MUST be rejected. Only safe integers
  in `[-(2^53-1), 2^53-1]` are allowed; overflow, NaN, Infinity, fractional
  numbers, or values outside the schema domain are invalid and MUST be rejected
  before serialization.
- Invalid Unicode (including lone surrogates), non-finite numbers, duplicate
  object keys, or values not representable by the schema are invalid and MUST
  be rejected before canonical bytes are produced.
- Duplicate with same `(eventType, eventIdentity)` is ignored only when these
  canonical payload bytes are identical. Different bytes for the same identity
  are a hard conflict and MUST be surfaced consistently by all layers.

**Byte-level test vectors.** Shared tests must pin byte-for-byte vectors for at
least:

- one `QuestionResolvedEvent` payload with `runEnded=false`, `runEndReason=null`
- one terminal `QuestionResolvedEvent` payload with `runEnded=true`,
  `runEndReason="COMPLETED"` for the inline-completion pattern
- one terminal `QuestionResolvedEvent` payload with `runEnded=true`,
  `runEndReason="NO_LIVES"` or `"MISSED_TARGET"`
- one `RunCompletedEvent` payload vector for the separate-completion pattern
- one `DRAW_RESOLVED` payload containing an ordered array
- cross-language vectors for numeric boundaries (`0`, `-1`, `2^53-1`,
  `-(2^53-1)`), Unicode NFC normalization, escaping of quotes/backslashes/control
  chars, and invalid/overflow values that MUST reject before serialization
- one duplicate/conflict pair proving same-identity same-bytes is idempotent,
  while same-identity different-bytes is invalid

Ordering/idempotency rules are append-only by `seqNo`, but uniqueness is defined
inside each run by `(eventType, eventIdentity)` independently of `seqNo`.
`seqNo` is envelope metadata and is excluded from idempotent payload equality.
Duplicate delivery of the same identity is ignored only when canonical payload
serialization matches byte-for-byte after stripping envelope metadata such as
`seqNo`; conflicting payloads for the same identity are invalid. The combined
sequence above must rebuild state end-to-end exactly and idempotently without
depending on standalone `QuestionResolvedEvent` records alone.

So sánh replay output với game-core results cho **mọi** field authoritative,
không chỉ multiplier. Bảng dưới đây phải phủ **toàn bộ** authoritative reducer
output của `QuestionResolvedEvent` — mọi persisted authoritative field so sánh
**exact**. Không field authoritative nào được phép vắng mặt khỏi test-vector
check; field nào là _derived_ thì phải được validate qua reconstruction rule
định nghĩa của nó (ghi rõ ở cột "So sánh"), chứ không được bỏ qua.

| Field                                                                     | So sánh                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `livesAfter`                                                              | exact                                                                    |
| `maxLivesAfter`                                                           | exact                                                                    |
| `livesDelta`                                                              | exact                                                                    |
| `intendedLivesLoss`                                                       | exact (audit/UI only — never mutates `lives`)                            |
| `streakReset`                                                             | exact                                                                    |
| `insuranceConsumed`                                                       | exact                                                                    |
| `doubleOrNothingConsumed`                                                 | exact                                                                    |
| `scoreMilli`                                                              | exact                                                                    |
| `floorScoreMilli`                                                         | exact                                                                    |
| `runScoreMilli`                                                           | exact                                                                    |
| `questionMultiplierMilli`                                                 | exact                                                                    |
| `runMultiplierMilliAfter`                                                 | exact                                                                    |
| `streakAfter`                                                             | exact                                                                    |
| `answerElapsedMs`                                                         | exact (persisted clamped value — never recomputed from timestamps)       |
| `canonicalArrivalKey`                                                     | exact (byte-for-byte string compare)                                     |
| `acceptedBeforeDeadline`                                                  | exact                                                                    |
| `floorCleared`                                                            | exact (incl. `null` before Q5)                                           |
| `runEnded`                                                                | exact                                                                    |
| `runEndReason` (incl. COMPLETED)                                          | exact                                                                    |
| Effect inventory (Insurance remaining, DoN remaining-uses, perks active)  | exact                                                                    |
| KHAT_MAU clamp triple (`maxLivesAfter`, `livesAfter`, `clampedLivesLoss`) | exact on `PerkAcquiredEvent`                                             |
| Derived display values (e.g. non-milli score rendering)                   | validated via documented reconstruction rule from the exact fields above |

Test phải phát hiện bất kỳ divergence nào (escape difference, field-order
drift, drawId normalization, mulberry32 seed width) trước khi code merge.

Readonly replay rebuilds state **from these stored outputs**, not by re-executing
the current engine/config. When only one effect is active, per-effect behaviour
is unchanged.

---

## 4. Một run mẫu, kể bằng số (đọc phần này để "hiểu" roguelike)

Người chơi: Minh, mạnh Lịch sử, yếu Thể thao. 3 mạng, Mult ×1.

**FLOOR 1** — target 60. Năm câu Easy/Medium, Minh đúng 4/5 (sai 1 câu Thể
thao, còn 2 mạng): `10+20+20+10 = 60`. Vừa khít. Reward mời 3 lá:

> ① _Nền Tảng_ (+10 base mọi câu) ② _Chuỗi Cháy_ (mỗi câu đúng liên tiếp +0.3
> Mult; sai không-được-Bảo-Hiểm thì reset) ③ _50/50_ (3 lần/run, loại 2 đáp án sai)

Minh vừa mất mạng vì đoán bừa → khôn ngoan là ③. Nhưng Minh tham, lấy ②.
_Quyết định này sẽ định hình cả run — đó chính là "build"._

**FLOOR 2** — target 150. Cả 5 câu đều Medium; Chuỗi Cháy bắt đầu từ ×1 vì
câu cuối floor 1 là sai. Điểm được tính **trước** khi câu đúng tăng chuỗi:
`20×1 + 20×1.3 + 20×1.6 + 20×1.9 + 20×2.2 = 20+26+32+38+44 = 160` ✅.
Câu đúng thứ năm nâng Mult cho câu kế tiếp lên ×2.5. Reward: Minh bốc _Chuyên
Gia Sử_ (category multiplier ×3). Build lộ hình: **chuỗi + chuyên ngành.**

**FLOOR 3** — target 320. Chuỗi ×2.5 carry qua floor. Câu 1 Medium được
`20×2.5 = 50`, nên câu 2 Lịch sử Medium nhận ×2.8: `(20+0)×3×2.8 = 168` —
một câu đã hơn cả floor 1. Câu 3 Hard được `40×3.1 = 124`. Nhưng câu 4 Thể
thao, Minh sai: mất mạng thứ hai và Chuỗi Cháy reset về Mult nền ×1. Câu 5 chỉ
được `20×1 = 20`. `floorScore = 50+168+124+0+20 = 362` ✅, đồng thời
`runScore` cộng thêm 362. Reward có _Bảo Hiểm_ (lần sai đầu mỗi floor không mất
mạng, 0 điểm, không reset chuỗi) — lần này Minh không tham nữa, lấy ngay.

**FLOOR 4-5** — máy chạy đẹp: ở floor 4 Bảo Hiểm đỡ một câu Thể thao, nên câu
đó ghi 0 điểm, không mất mạng và **không reset Chuỗi Cháy**. Chuỗi tiếp tục qua
floor 5: hai câu Lịch sử Medium lần lượt có Mult ×2.8 và ×3.4, ghi
`20×3×2.8 = 168` và `20×3×3.4 = 204` điểm. Qua cả hai floor. Reward floor 5
xuất hiện _Khát Máu_: **-1 mạng tối đa, đổi +1.5 Mult nền vĩnh viễn ngay.** Minh
còn đúng 1 mạng — lấy là chơi dao. Minh lấy. Giờ Mult nền là ×2.5, nhưng sai
một câu không-được-Bảo-Hiểm là hết run.

**FLOOR 6** — target 2.600. Câu 3, Lịch sử, Minh chắc chắn 90%... và đề ra
nhân vật Minh nhầm niên đại. **Sai. Bảo Hiểm đã dùng ở câu 1. Hết mạng. RUN
OVER ở floor 6/9, runScore 4.120 điểm.**

Màn hình tổng kết: _"Chết bởi: Nhà Trần không phải Nhà Lý · Build: Chuỗi-Sử ·
Kỷ lục cá nhân: floor 6"_. Và Minh bấm **"Run mới"** ngay lập tức — vì lần này
sẽ lấy 50/50 ở floor 1, vì biết đâu lần này ra perk _Ưa Khó_, vì hôm nay chưa
thử build Tốc Chiến...

**Đó là roguelike.** Không phải 19 câu hỏi — mà là cái máy trạng thái trong
đầu người chơi về build lần sau.

---

## 5. Pool perk v1 (15 lá — minh họa, balance sau)

`balanceConfigVersion` must freeze the canonical ordered perk pool for v1. The
configuration owns both perk IDs and category IDs so API, game-core, replay and
design docs sample from the same ordered list. **Invariant: pool-v1 contains
exactly 15 distinct perks in deterministic order.**

**Nhân (Mult):**
| Perk | Hiệu ứng |
|---|---|
| Học Giả | +0.5 Mult vĩnh viễn mỗi khi qua một floor |
| Chuỗi Cháy | +0.3 Mult mỗi câu đúng liên tiếp; sai **không được Bảo Hiểm** thì reset về nền |
| Tốc Chiến | Đúng trong 3s đầu → +1 Mult cho riêng câu đó |
| Toàn Bích | Qua floor không sai câu nào → +1 Mult vĩnh viễn |

**Cộng (Base):**
| Nền Tảng | +10 base mọi câu |
| Chuyên Gia Sử | Câu thuộc category `HISTORY`: category multiplier ×3 |
| Chuyên Gia Địa | Câu thuộc category `GEOGRAPHY`: category multiplier ×3 |
| Chuyên Gia Khoa | Câu thuộc category `SCIENCE`: category multiplier ×3 |
| Chuyên Gia Giải Trí | Câu thuộc category `ENTERTAINMENT`: category multiplier ×3 |
| Ưa Khó | Câu Hard: category multiplier ×2 |

**Rủi ro (variance tự chọn — chất Balatro đậm nhất):**
| Double-or-Nothing | Tuyên bố trước 1 câu: đúng ×4 điểm, sai -2 mạng |
| Khát Máu | -1 mạng tối đa, đổi +1.5 Mult vĩnh viễn ngay |
| Mạo Hiểm | Floor kế toàn câu Hard, target giữ nguyên |

**Tiện ích (van an toàn, v1):**
| 50/50 | 3 lần/run: loại 2 đáp án sai |
| Bảo Hiểm | Lần sai đầu mỗi floor: 0 điểm, không mất mạng, **không reset Chuỗi Cháy** |

**Canonical v1 pool order (15 IDs):**
`HOC_GIA`, `CHUOI_CHAY`, `TOC_CHIEN`, `TOAN_BICH`, `NEN_TANG`,
`CHUYEN_GIA_HISTORY`, `CHUYEN_GIA_GEOGRAPHY`, `CHUYEN_GIA_SCIENCE`,
`CHUYEN_GIA_ENTERTAINMENT`, `UA_KHO`, `DOUBLE_OR_NOTHING`, `KHAT_MAU`,
`MAO_HIEM`, `FIFTY_FIFTY`, `BAO_HIEM`.

Config assertion: `perkPoolV1` MUST equal exactly this ordered 15-ID tuple, not
just length `15`; missing, duplicate, or reordered perks are invalid.

**Post-v1 / deferred perks (không thuộc v1 pool):**
`THÊM_GIỜ`, `HỒI_SINH`, `TIÊN_TRI`.

Ba archetype được thiết kế chủ đích: **Speed** (Tốc Chiến),
**Streak** (Chuỗi Cháy + Toàn Bích + Bảo Hiểm), **Chuyên ngành** (Chuyên Gia +
Ưa Khó + Mạo Hiểm). Synergy v1 là _được thiết kế trước_, không phải
emergent — 15 lá đủ cho ~3 build rõ nét, không đủ cho chaos.

**Nguyên tắc bất di bất dịch:** không perk nào tác động lên người chơi khác
(v1 là solo), và không perk nào biến câu sai thành đúng.

---

## 6. Vì sao tin là nó giữ người chơi (cơ chế, không phải hy vọng)

1. **Chơi được với đúng 1 người online** — giải bài cold-start mà battle
   royale 100 người không bao giờ tự giải được.
2. **"One more run"**: run ngắn (10-20 phút), chết luôn có nguyên nhân đọc
   được ("tại mình lấy Khát Máu lúc còn 1 mạng"), và perk offer ngẫu nhiên
   nghĩa là run sau _chắc chắn_ khác run trước.
3. **Daily seed** (v1.1): cả thế giới chung một ván — cùng câu hỏi, cùng perk
   offer — so điểm trên leaderboard ngày. Root entropy là `DailyRunHeader.prngSeed`
   bất biến; mỗi draw dùng `deriveSubstream(prngSeed, drawId)` (không mutable
   global stream / `seedState`), nên lựa chọn của một player không làm lệch
   draw của người khác. Header + `DRAW_RESOLVED` events persisted cùng match
   state/event log → leaderboard bất biến dù pool, ruleset, balance hay PRNG
   đổi sau đó. Lý do quay lại _hằng ngày_ + share ("hôm nay bạn tới floor mấy?").
4. **Skill thật vẫn là trần**: kiến thức quyết định bạn _được phép_ chơi
   engine; engine quyết định bạn đi xa đến đâu. Không ai thắng chỉ nhờ may.

---

## 7. Hướng phát triển theo phase

### G0 — Question pipeline (SONG SONG, không phải sau)

Rủi ro số 1 của cả hướng đi: **câu hỏi là tài nguyên tiêu hao** (Balatro có 52
lá bài dùng mãi; quiz đốt 30-50 câu/run). Ngân hàng hiện tại: **19 câu** trong
dev seed. Việc: import nguồn mở (OpenTDB...) + tool nhập/duyệt tối thiểu
(moderation pipeline đã có sẵn trong repo) + chống lặp trong N run gần nhất.
**Ngưỡng mở daily: ~500 câu; ngưỡng chơi thử: ~150.**

### G1 — Minimal Viable Gauntlet (2-3 tuần)

- Solo run: floor → 5 câu →
  `(Base + chips) × categoryMult × runMult × questionMult / 1_000_000` →
  reward 1-trong-3 → `floorScoreMilli ≥ targetMilli` → floor kế
- 15 perk trên, engine = **single pure reducer** `reduceQuestionResolved(runState,
resolvedQuestion, perks) => nextRunState`. `applyPerk(runState, perk) => nextRunState`
  là helper adapter riêng giữa các floor — không replace reducer, không mutation.
  Thứ tự resolve chốt trong data: **cộng chip trước → category Mult → run Mult →
  `questionMultiplierMilli`**, rồi chia fixed-point `/ 1_000_000` (milli-scaled
  multipliers, `Math.trunc` toward zero). Live reducer và replay MUST dùng cùng
  công thức này — xem §3 "Công thức resolve" cho contract đầy đủ.
- **Seeded PRNG server-side ngay từ dòng đầu**: immutable root `prngSeed` in
  `DailyRunHeader` + `deriveSubstream(prngSeed, drawId)` per draw; draws append
  as `DRAW_RESOLVED` events. No mutable `seedState` stream. Daily _feature_ để
  sau nhưng _plumbing_ không được để sau — retrofit đắt gấp nhiều lần
- Chạy trên hạ tầng sẵn có: run = match, owner lease, failover, replay
  `lastSeenSeqNo` — Gauntlet chỉ thêm phase + event type mới
- FE: màn floor, công thức điểm nhảy số, 3-card pick, run summary
- CHƯA có: Class, Boss, Meta-progression, modifier, shop tiền tệ, party

### G1.1 — Daily seed (vài ngày)

Daily không chỉ là `hash(ngày)`. Mỗi run daily persist một **immutable header**
trong match state/snapshot **và** các draw như append-only events trong event
log; snapshot/replay dùng header của run, không dùng config hiện tại:

```typescript
/** Immutable header — persisted in snapshot + initial event ONLY. Never mutated. */
interface DailyRunHeader {
  readonly dailyDateUtc: string; // "2026-08-01", boundary do server quyết định
  readonly rulesetVersion: string; // scoring/perk contract version, ví dụ "1.0.0"
  readonly completionEncoding: "INLINE_COMPLETED" | "SEPARATE_RUN_COMPLETED";
  readonly questionPoolVersion: string; // frozen ordered question-pool version
  readonly balanceConfigVersion: string; // frozen targets+perk config (g1-targets-v1, ...)
  readonly prngVersion: string; // PRNG algorithm/serialization version (vd. "sha256-v1")
  // prngSeed = sha256-hex(canonicalHeader); see §"Seed-derivation contract" below.
  // Field order, encoding, hash algorithm locked — API, game-core, replay MUST agree byte-for-byte.
  readonly prngSeed: string;
}

/**
 * Append-only event-log entry — NOT stored inside snapshot meta.
 * Unique key: (runId, drawId). At most one successful draw per key.
 * `count` is persisted so retries can verify the requested count matches;
 * identity remains (runId, drawId) — `count` is NOT part of the identity key.
 */
export interface DrawTraceEntry {
  readonly seqNo: number;
  readonly type: "DRAW_RESOLVED";
  readonly runId: string;
  readonly drawId: string; // "floor-3-perk-offer", "floor-2-question-4"
  readonly count: number; // requested draw count validated by Number.isSafeInteger && >= 0
  readonly resultIds: readonly string[]; // authoritative server-derived question/perk IDs drawn
}
```

- Toàn bộ header được frozen lúc run bắt đầu. Snapshot chỉ giữ header, không
  giữ drawTrace. Type-level: every header field is `readonly`.
- **PRNG model (single contract):** immutable root `prngSeed` +
  `deriveSubstream(prngSeed, drawId)` for each draw. No mutable global stream /
  `seedState`. Optional branches and one player's path do not shift later draws.
- **DRAW command / DRAW_RESOLVED append / idempotency:** caller supplies only
  `drawId` and `count`. Server derives `resultIds` from immutable
  `prngSeed + drawId`, appends `DRAW_RESOLVED` atomically, and owns all event
  creation.
  - Command boundary validates `count` with `Number.isSafeInteger(count) && count >= 0`
    before any PRNG draw; invalid fractional/negative counts are rejected.
  - First append wins.
  - Persistence MUST enforce a unique constraint on `(runId, drawId)` and use a
    transaction around insert + conflict handling.
  - Retry re-derives `resultIds` server-side and compares **both `count` and
    `resultIds`** with the stored event. Identical `count` AND identical derived
    IDs → idempotent success (no second event).
  - Retry whose `count` or derived IDs differ from the stored event → **reject**.
  - Replay never materializes two draws for the same `drawId`.
- **Leaderboard identity (before any write):**
  1. Validate `prngSeed === sha256-hex(canonicalSerialize({ balanceConfigVersion,
dailyDateUtc, prngVersion, questionPoolVersion, rulesetVersion }))`; mismatch → reject write.
  2. Leaderboard key = `sha256-hex(canonicalSerialize({
dailyDateUtc, rulesetVersion, questionPoolVersion, balanceConfigVersion,
prngVersion, prngSeed
}))`.
     Do not merge runs across different keys. Targets/perks live under
     `balanceConfigVersion`.
- **Replay (one deterministic path):** load recorded `DailyRunHeader` → apply
  append-only events (including `DRAW_RESOLVED` and question resolves) by
  `seqNo`. Readonly mode **ALWAYS** reconstructs state from the stored
  authoritative outputs of every recorded event — `DRAW_RESOLVED.resultIds`
  and the full `QuestionResolvedEvent` reducer outputs (`streakAfter`,
  `runMultiplierMilliAfter`, `livesAfter`, ...) — regardless of whether the
  live engine still supports the recorded `rulesetVersion` / `prngVersion`.
  The **live engine is restricted to validation or interactive execution** —
  it is NOT used by readonly replay to re-run the ruleset. Replay never
  re-randomizes and never re-runs the current ruleset; it applies recorded
  event outputs by `seqNo`, matching the contract in §3.

### Seed-derivation contract (byte-deterministic across API / game-core / replay)

Contract này là **single source of truth** cho mọi nơi tính hoặc verify
`prngSeed` lẫn `resultIds`. API, game-core và replay implementation **PHẢI**
sinh ra giá trị byte-identical; bất kỳ deviation nào phá vỡ leaderboard
identity, replay, và audit.

1. **Hash algorithm & version.**
   - `prngVersion = "sha256-v1"`: SHA-256 theo FIPS 180-4, output **hex
     lowercase**, 64 ký tự, không có prefix `0x`.
   - Mọi thay đổi algorithm, encoding, hoặc normalization bump
     `prngVersion` (e.g. `"sha256-v2"`). Bump `prngVersion` invalidates
     leaderboard identity key — runs cũ vẫn replay được vì header mang
     `prngVersion` đã ghi.

2. **Canonical encoding của header (input cho `prngSeed`).**
   - Chuỗi hóa UTF-8 NFC.
   - JSON với **keys sorted alphabetically**, không whitespace,
     không trailing newline.
   - **String escape** (single byte-level representation — cố định, mọi
     implementation PHẢI khớp byte-for-byte):
     - Quote `"` = source byte `22`, serialized bytes `5c 22`.
     - Backslash `\` = source byte `5c`, serialized bytes `5c 5c`.
     - Newline `U+000A` = source byte `0a`, serialized bytes `5c 6e`.
     - `U+0001` = source byte `01`, serialized bytes `5c 75 30 30 30 31`.
     - Mọi ký tự control còn lại trong `U+0000`..`U+001F` PHẢI encode
       thành lowercase 6-byte payload `\u00xx`.
     - All other chars: giữ nguyên byte UTF-8 (bao gồm `U+0020` trở lên
       và non-ASCII). Không tự ý escape forward slash hay ký tự không
       phải control.
   - **Quy tắc cố định (bắt buộc để byte-identical giữa API, game-core,
     replay):**
     - Escape spelling: luôn 2-byte payload cho named escapes, luôn
       **6-byte `\u00xx` payload** cho control còn
       lại (không `\\u001F`, không `\\u1F`, không `[control]`).
     - Hex case: **lowercase** cho cả digits và chữ (`a`..`f`), không
       uppercase.
     - Per-character mapping: **một mapping duy nhất** cho mỗi codepoint
       — JSON encoder không được tự ý chọn named vs `\\u` cho cùng
       codepoint giữa các lần chạy.
   - Numbers là JSON integers — không leading zeros, không `+`, `-0` → `0`.
   - Không nested arrays/objects: mọi field là string validated theo shape
     dưới đây. `dailyDateUtc` PHẢI match `^\d{4}-\d{2}-\d{2}$`.
   - **Field order cố định** (alphabetical, dùng để disambiguate khi
     debugging — JSON sort đã đảm bảo):
     `balanceConfigVersion, dailyDateUtc, prngVersion, questionPoolVersion, rulesetVersion`.
   - `prngSeed = sha256-hex(canonicalSerialize(header_fields))`.

3. **`drawId` normalization.**
   - Lowercase ASCII; trim leading/trailing whitespace; collapse internal
     whitespace runs thành một `-`.
   - Validate `^[a-z0-9][a-z0-9._:-]{0,63}$` — reject nếu không match.
     Client/server phải agree trước khi persist; persisted `drawId` là
     canonical.

4. **`deriveSubstream` contract.**
   - Inputs: `prngSeed` (sha256-hex string), `drawId` (normalized).
   - `subSeed = sha256-hex(canonicalSerialize({ prngVersion, prngSeed, drawId }))`
     — same canonical encoding rules as §2 (sorted keys, no whitespace).
   - PRNG: **mulberry32** keyed off exactly the **first 4 bytes** of
     `subSeed` (i.e. the first **8 hex characters** of `subSeed`),
     decoded as a **little-endian unsigned uint32** to seed the state `s`.
     Mulberry32 updates use **unsigned 32-bit wraparound** (`>>> 0`,
     `Math.imul`, plus mod `2^32`) — never signed arithmetic.
   - Each draw pulls the next `count` floats from `mulberry32(s)` starting
     at the public API boundary.
   - Same `(prngVersion, prngSeed, drawId, count)` → byte-identical
     `resultIds` (and any other PRNG output) ở API, game-core, replay.

   **Mapping output to `resultIds` (single contract, shared contract):**
   API, game-core, và replay PHẢI cùng một mapping — không được có
   layer-specific implementation. Mapping này pinned cho mọi
   `prngVersion` đang active; thay đổi mapping = bump `prngVersion`.
   - **Shared input validation before sampling:** API, game-core, and replay all
     reject pools with duplicate IDs and reject `count` unless
     `Number.isSafeInteger(count) && count >= 0` before consuming any PRNG draw.
   - **Pool ordering:** pool là một **frozen, ordered list** (sắp theo ID,
     stable qua mọi consumer) — không shuffle lại trước khi sample. Pool
     thuộc `questionPoolVersion` / `balanceConfigVersion` và đã frozen
     trong snapshot; replay dùng pool của recorded version, không pool
     hiện tại. Kích thước pool `N`.
   - **Sampling algorithm (one pass, no replacement):** collision state được
     track bằng **`selectedIdx: Set<number>`** — một set các **numeric pool
     index** đã chấp nhận, KHÔNG phải `resultIds` (chứa pool IDs, khác type).
     So sánh `idx` với `resultIds` là spec violation. Khởi tạo
     `selectedIdx = new Set<number>()` trước loop; invariant
     `selectedIdx.size === resultIds.length` luôn giữ. Cho mỗi vị trí
     `i ∈ [0, count)` của `resultIds`:
     1. Nếu `resultIds.length === pool.length`, return ngay result hiện có
        trước khi consume thêm float nào.
     2. Lấy float `u ∈ [0, 1)` từ `mulberry32(s)` tiếp theo.
     3. `idx = Math.floor(u * pool.length)` — `pool.length = N`, không
        modulo với pool còn lại (no Fisher-Yates trong pool). Integer
        arithmetic, `Math.trunc` toward zero.
     4. Nếu `!selectedIdx.has(idx)` (chỉ số **chưa dùng**): `selectedIdx.add(idx)`
        **trước**, rồi append `pool[idx]` vào `resultIds`. Hai bước này là một
        đơn vị không tách rời — không được append mà bỏ `add`.
     5. Nếu `selectedIdx.has(idx)` (collision), trước mỗi retry phải check
        `resultIds.length === pool.length`; nếu pool đã cạn thì return ngay
        result hiện có. Nếu chưa cạn, pull float tiếp theo và
        thử lại bước 2. Lặp đến khi tìm được chỉ số chưa dùng.
        (Deterministic retry — count retries không bounded bởi fixed
        budget mà bởi pool cạn kiệt; nếu cạn → trả về shorter
        `resultIds` và KHÔNG sinh thêm draw.)
     6. Tiếp tục cho đến khi đủ `count` phần tử unique **hoặc** pool
        cạn.
   - Empty pool với `count > 0` return `[]` ngay; không access `pool[0]`,
     không generate thêm draw, không retry loop.
   - **Duplicate-handling rule:** `resultIds` chỉ chứa IDs phân biệt;
     sample **without replacement**. Một ID không xuất hiện hai lần
     trong cùng `resultIds`. Collision trong một draw dẫn đến retry
     trên cùng substream — không tạo draw mới. Uniqueness được enforce qua
     `selectedIdx` (numeric index set), không qua string-ID comparison.
   - **Float-to-index conversion:** `idx = Math.floor(u * N)` với
     `u ∈ [0, 1)`. Lưu ý deterministic: `u === 1.0` không xảy ra trong
     `mulberry32` output (period 2^32, `u < 1`), nên không cần clamp
     trên. Tuyệt đối KHÔNG dùng `(u * N) | 0` (signed 32-bit wrap)
     — luôn dùng `Math.floor`.
   - Same `(prngVersion, prngSeed, drawId, count)` → byte-identical
     `resultIds` ở API, game-core, replay (byte-for-byte). Bất kỳ
     layer cố gắng tự sample khác đi là spec violation.

5. **Versioning rule.**
   - Bất kỳ change nào tới algorithm, encoding, drawId normalization, hoặc
     PRNG core (`mulberry32`) đều bump `prngVersion`.
   - Leaderboard key thay đổi theo; old replays vẫn resolve vì
     `prngVersion` được persist trong header.

**Required byte-level test vectors for canonical serialization:**

| Input char | Source bytes | Serialized bytes (hex) |
| ---------- | ------------ | ---------------------- |
| `"`        | `22`         | `5c 22`                |
| `\`        | `5c`         | `5c 5c`                |
| `U+0000`   | `00`         | `5c 75 30 30 30 30`    |
| `U+0001`   | `01`         | `5c 75 30 30 30 31`    |
| `U+001A`   | `1a`         | `5c 75 30 30 31 61`    |
| `U+000D`   | `0d`         | `5c 72`                |
| newline    | `0a`         | `5c 6e`                |

Điều kiện mở daily: G0 đạt ~500 câu.

### G2 — Chiều sâu run (1-2 tuần)

Modifier mỗi floor (Tốc độ ×2, Ẩn đề sau 3s, Sudden death...), party co-op
(mạng riêng, chết thì spectate — máy móc spectator có sẵn), thêm ~10 perk.

### G3 — Bản sắc & chiều rộng

Class khởi đầu (Survivor/Gambler/Speedster — chỉ buff bản thân), Boss floor,
unlock **ngang** (mở perk/class mới vào pool — thêm cách chơi, không thêm sức
mạnh), challenge ("thắng daily không dùng 50/50").

### G4+ — Khi có player base

BR 100 người thành **event mode có lịch** + knowledge storm (vòng thu hẹp theo
layer kiến thức) + kill-loot; sau đó ghost economy, cược, saboteur (tầng 3 đã
chốt trong roadmap).

---

## 8. Rủi ro & tiêu chí dừng

| Rủi ro                                               | Mức              | Đối phó                                                                                         |
| ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| **Trivia fatigue** — hết câu hỏi mới                 | ★★★ cao nhất     | G0 song song; đo "số câu lặp/run" như một metric                                                |
| Balance perk (build trội tuyệt đối / target quá gắt) | ★★               | Số nằm trong data config, không trong code → chỉnh không cần deploy engine; playtest 5-10 người |
| Scope nở ("thêm tí class thôi...")                   | ★★               | Tài liệu này là hàng rào — thứ không có trong G1 là không làm trong G1                          |
| Xây xong không ai thấy vui                           | ★ nhưng chí mạng | Tiêu chí đánh giá bên dưới, đo sớm ở cuối G1                                                    |

**Tiêu chí đánh giá tiềm năng (đo cuối G1, trước khi đầu tư G2):** cho 5-10
người chơi thử không hướng dẫn. Câu hỏi duy nhất: **có ai TỰ NGUYỆN bấm "run
mới" từ lần thứ 3 trở lên không?** Có → hướng đi đúng, đầu tư tiếp. Không →
dừng ở G1, giữ lại engine (nó vẫn là material phỏng vấn tốt), quay về BR event
mode. Quyết định bằng hành vi người chơi, không bằng cảm tính người làm.

---

_Tài liệu này là DRAFT thảo luận. Khi được duyệt, phần G1 sẽ được trích thành
scope-lock chính thức và §Content Roadmap trong memory-bank sẽ được cập nhật
theo (Gauntlet-first, question pipeline song song, trivia fatigue vào rủi ro)._
