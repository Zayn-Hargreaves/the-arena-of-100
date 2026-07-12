import { describe, it, expect } from "vitest";
import { serializeMatch, deserializeMatch } from "./match-state.codec";
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

    it("returns UNAVAILABLE when _stateVersion is a future (non-1) integer", () => {
      // Branch: `!hasSupportedStateVersion` short-circuits before any
      // array checks. A future schema version is treated as if we
      // don't know how to interpret the startingPlayers payload.
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const json = serializeMatch(state, round, []);
      const parsed = JSON.parse(json);
      parsed._stateVersion = 2;
      const decoded = deserializeMatch(JSON.stringify(parsed));
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });

    it("returns UNAVAILABLE when _stateVersion is a non-integer number", () => {
      // Branch: `Number.isInteger(parsed._stateVersion) === false`.
      // Even when the version is numerically close to 1 (e.g. 1.5),
      // we MUST treat the payload as unsupported rather than trusting
      // the startingPlayers field. This guards against a future
      // floating-point version accidentally being parsed as
      // "supported".
      const state = buildState();
      const round = buildRound({ startingPlayers: ["p1", "p2"] });
      const json = serializeMatch(state, round, []);
      const parsed = JSON.parse(json);
      parsed._stateVersion = 1.5;
      const decoded = deserializeMatch(JSON.stringify(parsed));
      expect(
        (decoded.currentRound as { startingPlayers: unknown }).startingPlayers,
      ).toBe(UNAVAILABLE);
    });
  });
});
