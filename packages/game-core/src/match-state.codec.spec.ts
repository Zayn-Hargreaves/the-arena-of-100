import { describe, it, expect } from "vitest";
import {
  serializeMatch,
  deserializeMatch,
  validateTimingField,
} from "./match-state.codec";
import type { MatchState, RoundState, AnswerState } from "@arena/shared";
import { UNAVAILABLE, type RoundStartingPlayers } from "./round-elimination";

function buildState(): MatchState {
  return {
    id: "match-1",
    roomId: "room-1",
    status: "COUNTDOWN" as MatchState["status"],
    currentRoundNo: 1,
    totalRounds: 1,
    players: new Map([
      [
        "p1",
        {
          id: "p1",
          name: "Alice",
          status: "ACTIVE" as MatchState["players"] extends Map<string, infer V>
            ? V extends { status: infer S }
              ? S
              : never
            : never,
          score: 0,
          totalResponseTimeMs: 0,
          correctAnswers: 0,
          isOnline: true,
        },
      ],
    ]),
    survivingPlayerIds: ["p1"],
    eliminatedPlayerIds: [],
    winnerId: null,
    startedAt: 100,
    endedAt: null,
    phaseEndsAt: null,
    roundResultStartedAt: null,
  };
}

function buildRound(
  overrides: Partial<
    RoundState & { startingPlayers?: RoundStartingPlayers }
  > = {},
): RoundState & {
  correctAnswer?: string;
  startingPlayers?: RoundStartingPlayers;
} {
  return {
    matchId: "match-1",
    roundNo: 1,
    question: {
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      difficulty: "MEDIUM",
    },
    startedAt: 100,
    endsAt: 1000,
    answers: new Map<string, AnswerState>(),
    status: "ACTIVE",
    correctAnswer: "A",
    startingPlayers: ["p1"],
    ...overrides,
  };
}

describe("match-state.codec", () => {
  describe("serializeMatch / deserializeMatch round-trip", () => {
    it("preserves UNAVAILABLE startingPlayers on a fresh serialize+deserialize", () => {
      const state = buildState();
      const round = buildRound({ startingPlayers: UNAVAILABLE });
      const json = serializeMatch(state, round, []);
      const decoded = deserializeMatch(json);
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });

    it("preserves a string[] startingPlayers on a fresh serialize+deserialize", () => {
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const json = serializeMatch(state, round, []);
      const decoded = deserializeMatch(json);
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toEqual(["p1", "p2"]);
    });
  });

  describe("deserializeStartingPlayers fallback branches", () => {
    it("returns UNAVAILABLE when startingPlayers array contains a non-string element", () => {
      // Branch: array.every(playerId => typeof playerId === "string") fails
      // and we fall through to the `return UNAVAILABLE` at the end of
      // deserializeStartingPlayers. The L3 v1 envelope is otherwise
      // structurally valid so we reach the array branch.
      const state = buildState();
      const round = buildRound({
        startingPlayers: [123, "p1"] as unknown as RoundStartingPlayers,
      });
      const json = serializeMatch(state, round, []);
      const decoded = deserializeMatch(json);
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });

    it("returns UNAVAILABLE when startingPlayers contains a duplicate player ID", () => {
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p1"] });
      const json = serializeMatch(state, round, []);
      const decoded = deserializeMatch(json);
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });

    it("returns UNAVAILABLE when startingPlayers is missing entirely on a v1 payload", () => {
      // Branch: the `else return UNAVAILABLE` fallback when the array
      // branch never matches. We splice a payload whose currentRound
      // has no `startingPlayers` key at all (simulates a partial
      // write or a manual edit) and keep _stateVersion=1 so the
      // version gate passes.
      const state = buildState();
      const round = buildRound();
      const json = serializeMatch(state, round, []);
      const parsed = JSON.parse(json);
      delete parsed.currentRound.startingPlayers;
      const decoded = deserializeMatch(JSON.stringify(parsed));
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });

    it("throws when _stateVersion is a future (unsupported) integer", () => {
      // B1c: the version gate now THROWS on any integer outside {1, 2},
      // before any field is read (previously it fell back to UNAVAILABLE).
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const json = serializeMatch(state, round, []);
      const parsed = JSON.parse(json);
      parsed._stateVersion = 3;
      expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
    });

    it("throws when _stateVersion is a non-integer number", () => {
      // Number.isInteger(1.5) === false → unsupported → throw (was UNAVAILABLE).
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const json = serializeMatch(state, round, []);
      const parsed = JSON.parse(json);
      parsed._stateVersion = 1.5;
      expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
    });

    it("preserves startingPlayers on a supported v2 blob", () => {
      // The counterpart to the throw tests: v2 is supported, so the array
      // semantics are preserved (not flipped to UNAVAILABLE).
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const decoded = deserializeMatch(serializeMatch(state, round, []));
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toEqual(["p1", "p2"]);
    });
  });
});

describe("match-state.codec v2 + back-compat (B1c)", () => {
  // A minimal v1 wire blob (no phaseEndsAt / roundResultStartedAt), built by
  // hand so we exercise the real v1 → v2 read path.
  function v1Blob(
    overrides: {
      status?: string;
      startedAt?: unknown;
      roundResultStartedAt?: unknown;
      currentRound?: Record<string, unknown> | null;
    } = {},
  ): string {
    const state: Record<string, unknown> = {
      id: "m1",
      roomId: "r1",
      status: overrides.status ?? "ROUND_ACTIVE",
      currentRoundNo: 1,
      totalRounds: 1,
      players: [
        [
          "p1",
          {
            id: "p1",
            name: "Alice",
            status: "ACTIVE",
            score: 0,
            totalResponseTimeMs: 0,
            correctAnswers: 0,
            isOnline: true,
          },
        ],
      ],
      survivingPlayerIds: ["p1"],
      eliminatedPlayerIds: [],
      winnerId: null,
      startedAt: "startedAt" in overrides ? overrides.startedAt : 1000,
      endedAt: null,
    };
    if ("roundResultStartedAt" in overrides) {
      state.roundResultStartedAt = overrides.roundResultStartedAt;
    }
    const currentRound =
      overrides.currentRound === undefined
        ? {
            matchId: "m1",
            roundNo: 1,
            question: { id: "q1", content: "Q?", options: ["A", "B"] },
            startedAt: 1000,
            endsAt: 16000,
            answers: [],
            status: "ACTIVE",
            startingPlayers: ["p1"],
          }
        : overrides.currentRound;
    return JSON.stringify({
      _stateVersion: 1,
      state,
      currentRound,
      eventLog: [],
    });
  }

  it("round-trips a v2 blob preserving a finite phaseEndsAt", () => {
    const state = buildState();
    state.phaseEndsAt = 123456;
    const decoded = deserializeMatch(serializeMatch(state, buildRound(), []));
    expect(decoded.state.phaseEndsAt).toBe(123456);
  });

  it("backfills phaseEndsAt from currentRound.endsAt on a v1 ROUND_ACTIVE blob", () => {
    const decoded = deserializeMatch(v1Blob());
    expect(decoded.state.phaseEndsAt).toBe(16000);
    // startingPlayers must survive the version bump (the B1c trap).
    expect(
      (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
    ).toEqual(["p1"]);
  });

  it("anchors ROUND_ACTIVE backfill to startedAt + ROUND_DURATION_MS when endsAt is missing", () => {
    const decoded = deserializeMatch(
      v1Blob({
        currentRound: {
          matchId: "m1",
          roundNo: 1,
          question: { id: "q1", content: "Q?", options: ["A", "B"] },
          startedAt: 1000,
          // endsAt omitted
          answers: [],
          status: "ACTIVE",
          startingPlayers: ["p1"],
        },
      }),
    );
    // 1000 + 15000; deterministic, never Date.now().
    expect(decoded.state.phaseEndsAt).toBe(16000);
  });

  it("fails closed (null) when a ROUND_ACTIVE blob has no reconstructable deadline", () => {
    const decoded = deserializeMatch(
      v1Blob({ status: "ROUND_ACTIVE", currentRound: null }),
    );
    expect(decoded.state.phaseEndsAt).toBeNull();
  });

  it("backfills COUNTDOWN from startedAt + COUNTDOWN_DURATION_MS", () => {
    const decoded = deserializeMatch(
      v1Blob({ status: "COUNTDOWN", startedAt: 1000, currentRound: null }),
    );
    expect(decoded.state.phaseEndsAt).toBe(6000); // 1000 + 5000
  });

  it("fails closed (null) for COUNTDOWN when startedAt is missing", () => {
    const decoded = deserializeMatch(
      v1Blob({ status: "COUNTDOWN", startedAt: null, currentRound: null }),
    );
    expect(decoded.state.phaseEndsAt).toBeNull();
    expect(decoded.state.startedAt).toBeNull();
  });

  it("reuses roundResultStartedAt (not currentRound.endsAt) for a v1 ROUND_RESULT blob", () => {
    const decoded = deserializeMatch(
      v1Blob({
        status: "ROUND_RESULT",
        roundResultStartedAt: 12345,
        currentRound: {
          matchId: "m1",
          roundNo: 1,
          question: { id: "q1", content: "Q?", options: ["A", "B"] },
          startedAt: 1000,
          endsAt: 99999, // deliberately different; must NOT be used
          answers: [],
          status: "COMPLETED",
          startingPlayers: ["p1"],
        },
      }),
    );
    expect(decoded.state.phaseEndsAt).toBe(12345 + 3000);
  });

  it("leaves phaseEndsAt null for a v1 ROUND_RESULT blob with no anchor", () => {
    const decoded = deserializeMatch(
      v1Blob({ status: "ROUND_RESULT", currentRound: null }),
    );
    expect(decoded.state.phaseEndsAt).toBeNull();
  });

  it("forces roundResultStartedAt to null outside ROUND_RESULT even if present on the wire", () => {
    const decoded = deserializeMatch(
      v1Blob({ status: "ROUND_ACTIVE", roundResultStartedAt: 55555 }),
    );
    expect(decoded.state.roundResultStartedAt).toBeNull();
  });

  it("rejects a v2 blob that is missing phaseEndsAt entirely", () => {
    const state = buildState();
    const json = serializeMatch(state, buildRound(), []);
    const parsed = JSON.parse(json);
    delete parsed.state.phaseEndsAt; // v2 blob MUST carry it
    expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
  });

  it("preserves null phaseEndsAt and roundResultStartedAt on a v2 blob", () => {
    const state = buildState(); // status COUNTDOWN, both null
    const decoded = deserializeMatch(serializeMatch(state, buildRound(), []));
    // COUNTDOWN + phaseEndsAt null present on wire → preserved (not backfilled).
    expect(decoded.state.phaseEndsAt).toBeNull();
    expect(decoded.state.roundResultStartedAt).toBeNull();
  });

  describe("timing-field validation (fail-closed)", () => {
    for (const bad of [
      { label: "string", value: "soon" },
      { label: "object", value: { value: 12345 } },
      { label: "boolean", value: true },
      { label: "array", value: ["a", "b"] },
    ]) {
      it(`rejects a v2 phaseEndsAt that is a ${bad.label}`, () => {
        const state = buildState();
        const json = serializeMatch(state, buildRound(), []);
        const parsed = JSON.parse(json);
        parsed.state.phaseEndsAt = bad.value;
        expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
      });

      it(`rejects a roundResultStartedAt that is a ${bad.label}`, () => {
        const parsed = JSON.parse(v1Blob({ roundResultStartedAt: bad.value }));
        expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
      });

      it(`rejects a currentRound.endsAt that is a ${bad.label}`, () => {
        const parsed = JSON.parse(v1Blob());
        parsed.currentRound.endsAt = bad.value;
        expect(() => deserializeMatch(JSON.stringify(parsed))).toThrow();
      });
    }

    it("rejects NaN / Infinity via the parsed-object path (JSON collapses them to null)", () => {
      const parsed = JSON.parse(v1Blob());
      parsed.state.phaseEndsAt = NaN;
      // Re-inject through the internal validator by calling deserializeMatch on
      // a re-stringified blob would lose NaN; instead assert the helper directly.
      expect(() => validateTimingField(NaN, { allowNull: true })).toThrow();
      expect(() =>
        validateTimingField(Infinity, { allowNull: true }),
      ).toThrow();
      void parsed;
    });

    it("validateTimingField returns finite numbers, null (when allowed), and undefined", () => {
      expect(validateTimingField(42, { allowNull: true })).toBe(42);
      expect(validateTimingField(null, { allowNull: true })).toBeNull();
      expect(
        validateTimingField(undefined, { allowNull: true }),
      ).toBeUndefined();
      expect(() => validateTimingField(null, { allowNull: false })).toThrow();
    });

    it("does not echo the payload in the error message", () => {
      const parsed = JSON.parse(v1Blob());
      parsed.state.phaseEndsAt = "secret-answer-key";
      // Capture the deserialize error separately from the assertion. A prior
      // version caught its own "expected to throw" sentinel here, so the test
      // passed even when the payload was wrongly accepted. `toThrow` fails the
      // test if deserializeMatch does NOT throw, and we assert on the captured
      // error only.
      let captured: unknown;
      expect(() => {
        try {
          deserializeMatch(JSON.stringify(parsed));
        } catch (err) {
          captured = err;
          throw err;
        }
      }).toThrow();
      expect((captured as Error).message).not.toContain("secret-answer-key");
    });
  });
});
