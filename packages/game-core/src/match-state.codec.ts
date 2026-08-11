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
  currentRound: SerializedRoundState | null;
  eventLog: EventLogEntry[];
}

type SerializedAnswerState = Omit<AnswerState, "submissionId"> & {
  submissionId?: string;
};

type SerializedRoundState = Omit<
  RoundState,
  "answers" | "startedAt" | "endsAt"
> & {
  startedAt?: unknown;
  endsAt?: unknown;
  correctAnswer?: string;
  startingPlayers?: unknown;
  answers: Array<[string, SerializedAnswerState]>;
};

/** Plain (Map-reconstructed) data ready to load into a MatchStateMachine. */
export interface DecodedMatchState {
  state: MatchState;
  currentRound: RoundWithAnswer | null;
  eventLog: EventLogEntry[];
}

type SupportedStateVersion = 1 | 2;

interface ValidatedTimingFields {
  startedAt: number | null | undefined;
  phaseEndsAt: number | null | undefined;
  roundResultStartedAt: number | null | undefined;
  currentRoundStartedAt: number | null | undefined;
  currentRoundEndsAt: number | null | undefined;
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
  const { parsed, version } = parseSerializedMatch(json);
  const timing = validateMatchTiming(parsed, version, json.length);
  const state = decodeMatchState(parsed, version, timing);
  const currentRound = decodeCurrentRound(
    parsed.currentRound,
    version,
    state,
    timing,
    json.length,
  );

  return {
    state,
    currentRound,
    eventLog: backfillEventSequence(parsed.eventLog),
  };
}

function parseSerializedMatch(json: string): {
  parsed: DeserializedMatch;
  version: SupportedStateVersion;
} {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Failed to parse MatchStateMachine JSON: ${error instanceof Error ? error.message : String(error)} (payload omitted; length=${json.length})`,
    );
  }

  const parsed = data as DeserializedMatch;
  if (!hasSupportedStateVersion(parsed)) {
    throw new Error(
      `Unsupported MatchStateMachine state version (payload omitted; length=${json.length})`,
    );
  }
  const version = (parsed as { _stateVersion: SupportedStateVersion })
    ._stateVersion;

  if (
    !parsed.state ||
    !Array.isArray(parsed.state.players) ||
    !Array.isArray(parsed.eventLog)
  ) {
    throw invalidMatchData(json.length);
  }
  if (parsed.currentRound) {
    validateCurrentRoundShape(parsed.currentRound, version, json.length);
  }

  return { parsed, version };
}

function validateCurrentRoundShape(
  round: NonNullable<DeserializedMatch["currentRound"]>,
  version: SupportedStateVersion,
  payloadLength: number,
): void {
  const question = round.question;
  const validQuestion =
    question &&
    typeof question === "object" &&
    typeof question.id === "string" &&
    typeof question.content === "string" &&
    Array.isArray(question.options);
  const validStatus =
    typeof round.status === "string" &&
    ["PENDING", "ACTIVE", "EVALUATING", "COMPLETED"].includes(round.status);
  const validCorrectAnswer =
    round.correctAnswer === undefined ||
    typeof round.correctAnswer === "string";
  const validAnswers =
    Array.isArray(round.answers) &&
    round.answers.every((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return false;
      const [playerId, answer] = entry;
      if (
        typeof playerId !== "string" ||
        answer == null ||
        typeof answer !== "object"
      ) {
        return false;
      }
      return (
        typeof answer.playerId === "string" &&
        typeof answer.answer === "string" &&
        typeof answer.isCorrect === "boolean" &&
        typeof answer.responseTimeMs === "number" &&
        Number.isFinite(answer.responseTimeMs) &&
        typeof answer.submittedAt === "number" &&
        Number.isFinite(answer.submittedAt) &&
        (typeof answer.submissionId === "string" ||
          (version === 1 && answer.submissionId === undefined))
      );
    });

  if (
    !validCorrectAnswer ||
    !validAnswers ||
    !validQuestion ||
    typeof round.roundNo !== "number" ||
    !validStatus
  ) {
    throw invalidMatchData(payloadLength);
  }
}

function validateMatchTiming(
  parsed: DeserializedMatch,
  version: SupportedStateVersion,
  payloadLength: number,
): ValidatedTimingFields {
  const timing: ValidatedTimingFields = {
    startedAt: validateTimingField(parsed.state.startedAt, { allowNull: true }),
    phaseEndsAt: validateTimingField(parsed.state.phaseEndsAt, {
      allowNull: true,
    }),
    roundResultStartedAt: validateTimingField(
      parsed.state.roundResultStartedAt,
      { allowNull: true },
    ),
    currentRoundStartedAt: undefined,
    currentRoundEndsAt: undefined,
  };

  if (parsed.currentRound) {
    timing.currentRoundStartedAt = validateTimingField(
      parsed.currentRound.startedAt,
      { allowNull: true },
    );
    timing.currentRoundEndsAt = validateTimingField(
      parsed.currentRound.endsAt,
      {
        allowNull: true,
      },
    );
  }
  if (version === 2 && timing.phaseEndsAt === undefined) {
    throw new Error(
      `Invalid MatchStateMachine data: v2 blob missing phaseEndsAt (payload omitted; length=${payloadLength})`,
    );
  }

  return timing;
}

function decodeMatchState(
  parsed: DeserializedMatch,
  version: SupportedStateVersion,
  timing: ValidatedTimingFields,
): MatchState {
  const status = parsed.state.status;
  const roundResultStartedAt =
    status === MatchStatus.ROUND_RESULT &&
    typeof timing.roundResultStartedAt === "number"
      ? timing.roundResultStartedAt
      : null;
  let phaseEndsAt =
    timing.phaseEndsAt !== undefined
      ? timing.phaseEndsAt
      : backfillPhaseEndsAt(
          status,
          timing.startedAt,
          timing.currentRoundEndsAt,
          timing.currentRoundStartedAt,
          roundResultStartedAt,
        );

  if (version === 2 && status === MatchStatus.ROUND_RESULT) {
    const expected =
      typeof roundResultStartedAt === "number"
        ? roundResultStartedAt + GAME_CONFIG.RESULT_DISPLAY_MS
        : null;
    phaseEndsAt =
      typeof expected === "number" && Number.isFinite(expected)
        ? expected
        : null;
  }

  return {
    ...parsed.state,
    startedAt: timing.startedAt === undefined ? null : timing.startedAt,
    phaseEndsAt,
    roundResultStartedAt,
    players: new Map(parsed.state.players),
  } as MatchState;
}

function decodeCurrentRound(
  round: DeserializedMatch["currentRound"],
  version: SupportedStateVersion,
  state: MatchState,
  timing: ValidatedTimingFields,
  payloadLength: number,
): RoundWithAnswer | null {
  if (!round) return null;

  let startedAt =
    typeof timing.currentRoundStartedAt === "number"
      ? timing.currentRoundStartedAt
      : null;
  let endsAt =
    typeof timing.currentRoundEndsAt === "number"
      ? timing.currentRoundEndsAt
      : null;

  if (endsAt === null && startedAt !== null) {
    const derived = startedAt + GAME_CONFIG.ROUND_DURATION_MS;
    endsAt = Number.isFinite(derived) ? derived : null;
  }
  if (
    endsAt === null &&
    state.status === MatchStatus.ROUND_ACTIVE &&
    typeof state.phaseEndsAt === "number"
  ) {
    endsAt = state.phaseEndsAt;
  }
  if (startedAt === null && endsAt !== null) {
    const derived = endsAt - GAME_CONFIG.ROUND_DURATION_MS;
    startedAt = Number.isFinite(derived) ? derived : null;
  }
  const resolvedTiming = validateRoundTiming(
    version,
    state,
    timing,
    startedAt,
    endsAt,
    payloadLength,
  );

  const { answers, correctAnswer: _omitCorrectAnswer, ...rest } = round;
  void _omitCorrectAnswer;
  const decoded: RoundWithAnswer = {
    ...rest,
    startedAt: resolvedTiming.startedAt,
    endsAt: resolvedTiming.endsAt,
    answers: new Map<string, AnswerState>(
      answers.map(([playerId, answer]) => {
        const decodedAnswer: AnswerState = answer.submissionId
          ? { ...answer, submissionId: answer.submissionId }
          : {
              ...answer,
              submissionId: `legacy-${playerId}-${answer.submittedAt}`,
            };
        return [playerId, decodedAnswer];
      }),
    ),
    startingPlayers: deserializeStartingPlayers(round.startingPlayers),
  };
  return decoded;
}

function validateRoundTiming(
  version: SupportedStateVersion,
  state: MatchState,
  timing: ValidatedTimingFields,
  startedAt: number | null,
  endsAt: number | null,
  payloadLength: number,
): { startedAt: number; endsAt: number } {
  if (startedAt === null || endsAt === null) {
    throw new Error(
      `Invalid MatchStateMachine data: currentRound has no reconstructable startedAt/endsAt (payload omitted; length=${payloadLength})`,
    );
  }
  if (endsAt < startedAt) {
    throw new Error(
      `Invalid MatchStateMachine data: currentRound endsAt precedes startedAt (payload omitted; length=${payloadLength})`,
    );
  }
  if (
    version === 2 &&
    state.status === MatchStatus.ROUND_ACTIVE &&
    timing.phaseEndsAt !== endsAt
  ) {
    throw new Error(
      `Invalid MatchStateMachine data: v2 ROUND_ACTIVE phaseEndsAt does not match currentRound.endsAt (payload omitted; length=${payloadLength})`,
    );
  }
  return { startedAt, endsAt };
}

function backfillEventSequence(eventLog: EventLogEntry[]): EventLogEntry[] {
  return eventLog.map((entry, index) =>
    typeof entry.seqNo === "number" ? entry : { ...entry, seqNo: index + 1 },
  );
}

function invalidMatchData(payloadLength: number): Error {
  return new Error(
    `Invalid MatchStateMachine data (payload omitted; length=${payloadLength})`,
  );
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
