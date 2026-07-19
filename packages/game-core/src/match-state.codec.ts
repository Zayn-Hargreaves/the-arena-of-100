// ============================================================
// Match state (de)serialization codec — Game Đấu Trường 100
//
// Pure serialize/deserialize + validation extracted from
// MatchStateMachine so the Redis persistence format lives in one
// testable place. Behaviour is unchanged: `MatchStateMachine.serialize`
// and `MatchStateMachine.deserialize` are thin wrappers over these
// functions.
//
// L3 invariant: the in-flight `correctAnswer` is NEVER written to the
// serialized form (it is sensitive). The recovery path re-attaches it
// from the Question DB row via `attachCorrectAnswer`.
// ============================================================

import {
  GAME_CONFIG,
  MatchStatus,
  type MatchState,
  type RoundState,
  type AnswerState,
  type PlayerInfo,
} from "@arena/shared";
import { UNAVAILABLE, type RoundStartingPlayers } from "./round-elimination";

/** In-memory round shape — RoundState plus the sensitive answer key. */
type RoundWithAnswer = RoundState & {
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
};

// B1c: bumped 1 -> 2 when phaseEndsAt / roundResultStartedAt joined the wire
// format. Both 1 and 2 are readable; v1 blobs are backfilled on deserialize.
const SERIALIZED_STATE_VERSION = 2;
const SUPPORTED_STATE_VERSIONS = new Set([1, 2]);
const UNAVAILABLE_SENTINEL = "__UNAVAILABLE__";

/**
 * The version gate. A blob is readable iff `_stateVersion` is an integer in the
 * supported set. `Number.isInteger` rejects strings ("2"), booleans, objects,
 * null, NaN, Infinity, and floats (1.5) up front; the set rejects any integer
 * outside {1, 2} (e.g. a future 3). Note `2` and `2.0` are the same IEEE-754
 * number — JSON does not preserve lexical form — so both read as v2 (intended).
 */
function hasSupportedStateVersion(parsed: unknown): boolean {
  const version = (parsed as { _stateVersion?: unknown })?._stateVersion;
  return (
    Number.isInteger(version) && SUPPORTED_STATE_VERSIONS.has(version as number)
  );
}

/**
 * Validate a single timing field off the raw wire object and RETURN the
 * validated value (not a type predicate — we need "return the value or throw").
 * The unified rule: `undefined` → missing (returned as-is); `null` → returned
 * only when `allowNull`, else throw; a finite number → returned; anything else
 * (string, object, boolean, array, NaN, Infinity) → throw. Every timing field
 * that later reaches a `+`, a comparison, or `getRemainingMs` MUST pass through
 * here first, so a corrupted anchor can never feed a NaN deadline. The error
 * never echoes the payload (it can carry question/answer content).
 */
export function validateTimingField(
  value: unknown,
  opts: { allowNull: boolean },
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    if (opts.allowNull) return null;
    throw new Error(
      "Invalid MatchStateMachine timing field: null not permitted (payload omitted)",
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(
    "Invalid MatchStateMachine timing field: expected finite number or null (payload omitted)",
  );
}

/** One entry in the append-only event log. */
export interface EventLogEntry {
  type: string;
  payload?: unknown;
  timestamp: number;
  // Monotonic per-match sequence number (starts at 1). Assigned in
  // `MatchStateMachine.logEvent` and persisted so delta replay
  // (`getDelta`) can select events with `seqNo > lastSeenSeqNo`.
  // Legacy snapshots written before delta replay lack this field;
  // `deserializeMatch` backfills it from array position (the log is
  // append-only and never truncated, so position + 1 == the seqNo the
  // entry would have been assigned).
  seqNo: number;
}

/** Wire shape produced by JSON.parse before reconstruction into Maps. */
export interface DeserializedMatch {
  _stateVersion?: unknown;
  state: {
    id: string;
    roomId: string;
    status: MatchState["status"];
    currentRoundNo: number;
    totalRounds: number;
    players: [string, PlayerInfo][];
    survivingPlayerIds: string[];
    eliminatedPlayerIds: string[];
    winnerId: string | null;
    // Timing fields are `unknown` on the wire: the deserializer validates them
    // via validateTimingField before any are read (v1 blobs may omit the two
    // B1c fields entirely; v2 blobs must carry phaseEndsAt).
    startedAt?: unknown;
    phaseEndsAt?: unknown;
    roundResultStartedAt?: unknown;
    endedAt: number | null;
  };
  currentRound:
    | (RoundState & {
        correctAnswer?: string;
        startingPlayers?: unknown;
        answers: [string, AnswerState][];
      })
    | null;
  eventLog: EventLogEntry[];
}

/** Plain (Map-reconstructed) data ready to load into a MatchStateMachine. */
export interface DecodedMatchState {
  state: MatchState;
  currentRound: RoundWithAnswer | null;
  eventLog: EventLogEntry[];
}

/**
 * Serialize match state to a JSON string for Redis persistence.
 *
 * L3 fix: `correctAnswer` is intentionally OMITTED from the serialized
 * form. Exposing it via a Redis leak or log scrape would hand out the
 * answer key for every active match. The recovery path re-attaches it
 * from the Question DB row (stricter access controls, single source of
 * truth for answer keys).
 */
export function serializeMatch(
  state: MatchState,
  currentRound: RoundWithAnswer | null,
  eventLog: readonly EventLogEntry[],
): string {
  const roundData = currentRound
    ? (() => {
        // L3: destructure correctAnswer out so the spread does not
        // re-include it. The remaining fields are the safe round shape
        // (question, timing, status, answers).
        const { correctAnswer: _omitCorrectAnswer, ...rest } = currentRound;
        void _omitCorrectAnswer;
        return {
          ...rest,
          startingPlayers:
            currentRound.startingPlayers === UNAVAILABLE
              ? UNAVAILABLE_SENTINEL
              : Array.isArray(currentRound.startingPlayers)
                ? [...currentRound.startingPlayers]
                : UNAVAILABLE_SENTINEL,
          answers: Array.from(currentRound.answers.entries()),
        };
      })()
    : null;

  return JSON.stringify({
    _stateVersion: SERIALIZED_STATE_VERSION,
    state: {
      ...state,
      players: Array.from(state.players.entries()),
    },
    currentRound: roundData,
    eventLog,
  });
}

/**
 * Parse + validate a serialized match and reconstruct Maps. Returns
 * plain data; the caller builds the MatchStateMachine instance.
 *
 * Throws on malformed JSON or a shape that fails validation. Payloads
 * are omitted from error messages (only the length is logged) so a
 * corrupt blob never leaks question/answer content into logs.
 */
export function deserializeMatch(json: string): DecodedMatchState {
  let data: unknown;

  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Failed to parse MatchStateMachine JSON: ${error instanceof Error ? error.message : String(error)} (payload omitted; length=${json.length})`,
    );
  }

  const parsed = data as DeserializedMatch;

  // Version gate FIRST: an unsupported / malformed version throws before any
  // field is read or copied. After this, the blob is v1 or v2.
  if (!hasSupportedStateVersion(parsed)) {
    throw new Error(
      `Unsupported MatchStateMachine state version (payload omitted; length=${json.length})`,
    );
  }
  const version = (parsed as { _stateVersion: number })._stateVersion;

  if (
    !parsed.state ||
    !Array.isArray(parsed.state.players) ||
    !Array.isArray(parsed.eventLog)
  ) {
    throw new Error(
      `Invalid MatchStateMachine data (payload omitted; length=${json.length})`,
    );
  }

  if (parsed.currentRound) {
    const cr = parsed.currentRound;
    const isValidQuestion =
      cr.question &&
      typeof cr.question === "object" &&
      typeof cr.question.id === "string" &&
      typeof cr.question.content === "string" &&
      Array.isArray(cr.question.options);

    const isValidStatus =
      typeof cr.status === "string" &&
      ["PENDING", "ACTIVE", "EVALUATING", "COMPLETED"].includes(cr.status);

    // L3 fix: `correctAnswer` is optional in the serialized form. The
    // recovery path re-attaches it from the Question DB row before the
    // round is evaluated. Validate that, IF present, it is a string —
    // catching corruption while allowing the new "absent" form.
    const correctAnswerOk =
      cr.correctAnswer === undefined || typeof cr.correctAnswer === "string";

    // Note: cr.startedAt / cr.endsAt are validated by the Phase-1 timing
    // pass below (validateTimingField), which also permits null on the wire.
    if (
      !correctAnswerOk ||
      !Array.isArray(cr.answers) ||
      !isValidQuestion ||
      typeof cr.roundNo !== "number" ||
      !isValidStatus
    ) {
      throw new Error(
        `Invalid MatchStateMachine data (payload omitted; length=${json.length})`,
      );
    }
  }

  // ---- Phase 1: validate every timing field on the raw wire object ----
  // Throws immediately on any invalid type / non-finite value, before any
  // backfill or arithmetic. `undefined` = missing; `null` = allowed sentinel.
  const rawState = parsed.state;
  const startedAtRaw = validateTimingField(rawState.startedAt, {
    allowNull: true,
  });
  const phaseEndsAtRaw = validateTimingField(rawState.phaseEndsAt, {
    allowNull: true,
  });
  const roundResultStartedAtRaw = validateTimingField(
    rawState.roundResultStartedAt,
    { allowNull: true },
  );
  let crEndsAtRaw: number | null | undefined;
  let crStartedAtRaw: number | null | undefined;
  if (parsed.currentRound) {
    crEndsAtRaw = validateTimingField(parsed.currentRound.endsAt, {
      allowNull: true,
    });
    crStartedAtRaw = validateTimingField(parsed.currentRound.startedAt, {
      allowNull: true,
    });
  }

  // A v2 blob MUST carry phaseEndsAt (finite number or null). Only v1 blobs
  // may omit it (undefined) and be backfilled.
  if (version === 2 && phaseEndsAtRaw === undefined) {
    throw new Error(
      `Invalid MatchStateMachine data: v2 blob missing phaseEndsAt (payload omitted; length=${json.length})`,
    );
  }

  const status = rawState.status;

  // ---- Phase 2: normalize + v1 backfill (Date.now() is PROHIBITED here) ----
  // startedAt: preserve finite number; missing/null → null.
  const startedAt = startedAtRaw === undefined ? null : startedAtRaw;

  // roundResultStartedAt: only meaningful in ROUND_RESULT; forced null
  // everywhere else so a stale anchor never survives its phase.
  const roundResultStartedAt =
    status === MatchStatus.ROUND_RESULT &&
    typeof roundResultStartedAtRaw === "number"
      ? roundResultStartedAtRaw
      : null;

  // phaseEndsAt: pass through when present (v2, or a v1 blob that already had
  // it); otherwise deterministically backfill a v1 blob from persisted anchors,
  // failing closed to null (never Date.now()).
  let phaseEndsAt: number | null;
  if (phaseEndsAtRaw !== undefined) {
    phaseEndsAt = phaseEndsAtRaw; // finite number or null, preserved
  } else {
    phaseEndsAt = backfillPhaseEndsAt(
      status,
      startedAtRaw,
      crEndsAtRaw,
      crStartedAtRaw,
      roundResultStartedAt,
    );
  }

  // F18: enforce the ROUND_RESULT timing invariant the writer guarantees
  // (transition(ROUND_RESULT): phaseEndsAt === roundResultStartedAt +
  // RESULT_DISPLAY_MS). For a v2 ROUND_RESULT blob the wire phaseEndsAt is
  // NEVER trusted — it is derived from the result anchor. `roundResultStartedAt`
  // here is already either a finite number (valid anchor) or null (missing).
  // Fail closed to null when the anchor is missing OR the derived deadline is
  // non-finite; only retain the derived deadline when both are finite. v1
  // backfilling (above) and every other phase are unaffected.
  if (version === 2 && status === MatchStatus.ROUND_RESULT) {
    if (typeof roundResultStartedAt === "number") {
      const expected = roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS;
      phaseEndsAt = Number.isFinite(expected) ? expected : null;
    } else {
      phaseEndsAt = null;
    }
  }

  const state = {
    ...parsed.state,
    startedAt,
    phaseEndsAt,
    roundResultStartedAt,
    players: new Map(parsed.state.players),
  } as MatchState;

  let currentRound: RoundWithAnswer | null;
  if (parsed.currentRound) {
    const {
      answers,
      correctAnswer: _omitCorrectAnswer,
      ...rest
    } = parsed.currentRound;
    void _omitCorrectAnswer;

    // F16: normalize the round's own timing anchors so a corrupt/legacy blob
    // never leaves startedAt/endsAt null|undefined once spread into the
    // in-memory round. These feed the submitAnswer window gate
    // (serverTimestamp > endsAt), responseTimeMs (serverTimestamp -
    // startedAt), scoring, and tie-break — a null there yields NaN. Derive a
    // missing anchor from its sibling (or the reconstructed phaseEndsAt) using
    // the fixed round duration; never Date.now() (deterministic across
    // failover). crStartedAtRaw / crEndsAtRaw were Phase-1 validated to a
    // finite number, null, or undefined.
    let normStartedAt: number | null =
      typeof crStartedAtRaw === "number" ? crStartedAtRaw : null;
    let normEndsAt: number | null =
      typeof crEndsAtRaw === "number" ? crEndsAtRaw : null;
    if (normEndsAt === null && normStartedAt !== null) {
      const derived = normStartedAt + GAME_CONFIG.ROUND_DURATION_MS;
      normEndsAt = Number.isFinite(derived) ? derived : null;
    }
    // Borrow the reconstructed phase deadline for a missing round endsAt ONLY in
    // ROUND_ACTIVE, where phaseEndsAt IS this round's deadline. In COUNTDOWN /
    // ROUND_RESULT the phase deadline belongs to a different phase (countdown /
    // result display), so borrowing it as the gameplay round's endsAt would
    // corrupt the submit-answer window and responseTimeMs.
    if (
      normEndsAt === null &&
      status === MatchStatus.ROUND_ACTIVE &&
      typeof phaseEndsAt === "number"
    ) {
      normEndsAt = phaseEndsAt;
    }
    if (normStartedAt === null && normEndsAt !== null) {
      const derived = normEndsAt - GAME_CONFIG.ROUND_DURATION_MS;
      normStartedAt = Number.isFinite(derived) ? derived : null;
    }

    // Fail closed rather than assert: if neither anchor nor the reconstructed
    // phaseEndsAt could supply a finite startedAt AND endsAt, the round is
    // unusable (the submitAnswer gate / responseTimeMs / scoring would read
    // null → NaN). Throw instead of returning invalid state via an unsafe cast.
    if (normStartedAt === null || normEndsAt === null) {
      throw new Error(
        `Invalid MatchStateMachine data: currentRound has no reconstructable startedAt/endsAt (payload omitted; length=${json.length})`,
      );
    }

    // Cross-field invariant: a round can never end before it starts. A blob
    // (persisted or reconstructed) with endsAt < startedAt is corrupt — reject
    // it rather than feed a negative-length window into the submit gate / scoring.
    if (normEndsAt < normStartedAt) {
      throw new Error(
        `Invalid MatchStateMachine data: currentRound endsAt precedes startedAt (payload omitted; length=${json.length})`,
      );
    }

    // v2 writer invariant: in ROUND_ACTIVE, phaseEndsAt === currentRound.endsAt
    // (both are the live round's deadline). A v2 ROUND_ACTIVE blob whose two
    // anchors disagree is corrupt — reject rather than trust an ambiguous
    // deadline. (v1 blobs are exempt: their phaseEndsAt is reconstructed, not
    // persisted, so it is derived from currentRound.endsAt by construction.)
    if (
      version === 2 &&
      status === MatchStatus.ROUND_ACTIVE &&
      phaseEndsAtRaw !== crEndsAtRaw
    ) {
      throw new Error(
        `Invalid MatchStateMachine data: v2 ROUND_ACTIVE phaseEndsAt does not match currentRound.endsAt (payload omitted; length=${json.length})`,
      );
    }

    currentRound = {
      ...rest,
      startedAt: normStartedAt,
      endsAt: normEndsAt,
      // Backfill any missing `submissionId` on legacy answers
      // serialized before that field was required on AnswerState.
      // The replay check elsewhere (`existingAnswer.submissionId ===
      // payload.submissionId`) would otherwise collapse `undefined
      // === undefined` to true and treat the first accepted
      // submission as a replay. The format mirrors `submitAnswer` so
      // the two paths agree and old in-flight records keep working.
      answers: new Map(
        answers.map(([playerId, answer]) => [
          playerId,
          answer.submissionId
            ? answer
            : {
                ...answer,
                submissionId: `legacy-${playerId}-${answer.submittedAt ?? 0}`,
              },
        ]),
      ),
      // L3: correctAnswer is undefined after deserialize. The recovery
      // caller MUST invoke attachCorrectAnswer() before any
      // evaluateRound() / submitAnswer() that depends on it.
      // Version is guaranteed supported (the gate above threw otherwise),
      // so v1/v2 startingPlayers semantics are preserved identically.
      startingPlayers: deserializeStartingPlayers(
        parsed.currentRound.startingPlayers,
      ),
    } as RoundWithAnswer;
  } else {
    currentRound = null;
  }

  // Backfill `seqNo` on legacy entries (snapshots serialized before
  // delta replay existed). The log is append-only and never truncated,
  // so array position + 1 is exactly the seqNo the entry would have
  // been assigned. Entries that already carry a seqNo are left intact.
  const eventLog = parsed.eventLog.map((entry, index) =>
    typeof entry.seqNo === "number" ? entry : { ...entry, seqNo: index + 1 },
  );

  return { state, currentRound, eventLog };
}

/**
 * Deterministically reconstruct `phaseEndsAt` for a v1 blob that predates the
 * field, from already-Phase-1-validated persisted anchors (each is `undefined`,
 * `null`, or a finite number here). NEVER calls Date.now() — a fresh window is
 * reserved for genuinely new phases armed by `transition`, and for the B3b
 * owner materialization path. Fails closed to `null` ("deadline unknown") when
 * no stable anchor exists; the owner's canonical `endRound` (not a timeout)
 * then drives the phase.
 */
function backfillPhaseEndsAt(
  status: MatchState["status"],
  startedAt: number | null | undefined,
  currentRoundEndsAt: number | null | undefined,
  currentRoundStartedAt: number | null | undefined,
  roundResultStartedAt: number | null,
): number | null {
  // Every anchor-plus-duration result must be a finite deadline. Even though
  // each anchor is already finite (validateTimingField rejected NaN/Infinity),
  // an anchor near Number.MAX_VALUE could overflow to Infinity when a duration
  // is added; fail closed to null rather than emit a non-finite deadline.
  const finiteOrNull = (n: number): number | null =>
    Number.isFinite(n) ? n : null;

  switch (status) {
    case MatchStatus.ROUND_ACTIVE:
      if (typeof currentRoundEndsAt === "number") {
        return finiteOrNull(currentRoundEndsAt);
      }
      if (typeof currentRoundStartedAt === "number") {
        return finiteOrNull(
          currentRoundStartedAt + GAME_CONFIG.ROUND_DURATION_MS,
        );
      }
      return null;
    case MatchStatus.COUNTDOWN:
      // Only anchor to a persisted startedAt; a null/undefined startedAt must
      // NOT be granted a fresh full countdown window across failover.
      if (typeof startedAt === "number") {
        return finiteOrNull(startedAt + GAME_CONFIG.COUNTDOWN_DURATION_MS);
      }
      return null;
    case MatchStatus.ROUND_RESULT:
      // Reuse ONLY the dedicated persisted result anchor, never
      // currentRound.endsAt (that belongs to the completed gameplay round).
      if (typeof roundResultStartedAt === "number") {
        return finiteOrNull(
          roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS,
        );
      }
      return null;
    default:
      return null;
  }
}

function deserializeStartingPlayers(
  rawStartingPlayers: unknown,
): RoundStartingPlayers {
  if (rawStartingPlayers === UNAVAILABLE_SENTINEL) {
    return UNAVAILABLE;
  }

  if (
    Array.isArray(rawStartingPlayers) &&
    rawStartingPlayers.every((playerId) => typeof playerId === "string")
  ) {
    if (new Set(rawStartingPlayers).size !== rawStartingPlayers.length) {
      return UNAVAILABLE;
    }
    return [...rawStartingPlayers];
  }

  return UNAVAILABLE;
}
