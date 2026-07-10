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

import type {
  MatchState,
  RoundState,
  AnswerState,
  PlayerInfo,
} from "@arena/shared";

/** In-memory round shape — RoundState plus the sensitive answer key. */
type RoundWithAnswer = RoundState & { correctAnswer?: string };

/** One entry in the append-only event log. */
export interface EventLogEntry {
  type: string;
  payload?: unknown;
  timestamp: number;
}

/** Wire shape produced by JSON.parse before reconstruction into Maps. */
export interface DeserializedMatch {
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
    startedAt: number;
    endedAt: number | null;
  };
  currentRound:
    | (RoundState & {
        correctAnswer?: string;
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
          answers: Array.from(currentRound.answers.entries()),
        };
      })()
    : null;

  return JSON.stringify({
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
  if (
    !parsed ||
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

    if (
      !correctAnswerOk ||
      !Array.isArray(cr.answers) ||
      !isValidQuestion ||
      typeof cr.startedAt !== "number" ||
      typeof cr.endsAt !== "number" ||
      typeof cr.roundNo !== "number" ||
      !isValidStatus
    ) {
      throw new Error(
        `Invalid MatchStateMachine data (payload omitted; length=${json.length})`,
      );
    }
  }

  const state = {
    ...parsed.state,
    players: new Map(parsed.state.players),
  } as MatchState;

  let currentRound: RoundWithAnswer | null;
  if (parsed.currentRound) {
    const { answers, ...rest } = parsed.currentRound;
    currentRound = {
      ...rest,
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
    } as RoundWithAnswer;
  } else {
    currentRound = null;
  }

  return { state, currentRound, eventLog: parsed.eventLog };
}
