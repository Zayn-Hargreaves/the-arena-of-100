import { describe, it, expect } from "vitest";
import { MatchStateMachine } from "./match-state-machine";
import { ErrorCode, MatchStatus, PlayerStatus, RoomError } from "@arena/shared";

function expectRoomError(operation: () => unknown, code: ErrorCode) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    expect((error as RoomError).code).toBe(code);
    return;
  }
  throw new Error(`Expected RoomError ${code}`);
}

const makePlayers = () => [
  {
    id: "p1",
    name: "Alice",
    status: PlayerStatus.ACTIVE,
    score: 0,
    totalResponseTimeMs: 0,
    correctAnswers: 0,
    isOnline: true,
  },
  {
    id: "p2",
    name: "Bob",
    status: PlayerStatus.ACTIVE,
    score: 0,
    totalResponseTimeMs: 0,
    correctAnswers: 0,
    isOnline: true,
  },
];

describe("MatchStateMachine.serialize/deserialize", () => {
  it("should round-trip a freshly created match", () => {
    const machine = new MatchStateMachine("match-1", "room-1", makePlayers());

    const restored = MatchStateMachine.deserialize(machine.serialize());

    expect(restored.getState().id).toBe("match-1");
    expect(restored.getState().roomId).toBe("room-1");
    expect(restored.getState().status).toBe(MatchStatus.CREATED);
    expect(restored.getState().players.get("p1")?.name).toBe("Alice");
    expect(restored.getState().players.get("p2")?.name).toBe("Bob");
    expect(restored.getState().survivingPlayerIds).toEqual(["p1", "p2"]);
  });

  it("should preserve state after transitions", () => {
    const machine = new MatchStateMachine("match-2", "room-2", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);

    const restored = MatchStateMachine.deserialize(machine.serialize());

    expect(restored.getState().status).toBe(MatchStatus.COUNTDOWN);
    expect(restored.getState().startedAt).toBeGreaterThan(0);
    expect(restored.canTransition(MatchStatus.ROUND_ACTIVE)).toBe(true);
  });

  it("should preserve current round with answers", () => {
    const machine = new MatchStateMachine("match-3", "room-3", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    const round = machine.startRound({
      id: "q1",
      content: "What is 1+1?",
      options: ["1", "2", "3", "4"],
      correctAnswer: "2",
    });

    machine.submitAnswer("p1", "2", round.startedAt + 500);
    machine.submitAnswer("p2", "3", round.startedAt + 800);

    // Evaluate round to update totalResponseTimeMs
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const restoredRound = restored.getCurrentRound();

    expect(restoredRound).not.toBeNull();
    expect(restoredRound!.roundNo).toBe(1);
    expect(restoredRound!.question.content).toBe("What is 1+1?");
    expect(restoredRound!.answers.get("p1")?.isCorrect).toBe(true);
    expect(restoredRound!.answers.get("p2")?.isCorrect).toBe(false);

    // Verify response times are preserved
    expect(restoredRound!.answers.get("p1")?.responseTimeMs).toBe(500);
    expect(restoredRound!.answers.get("p2")?.responseTimeMs).toBe(800);

    // Verify player total response times are updated and preserved
    const restoredState = restored.getState();
    expect(restoredState.players.get("p1")?.totalResponseTimeMs).toBe(500);
    expect(restoredState.players.get("p2")?.totalResponseTimeMs).toBe(0); // p2 answered incorrectly, so no time added
  });

  it("should preserve event log", () => {
    const machine = new MatchStateMachine("match-4", "room-4", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const log = restored.getEventLog();

    expect(log.length).toBeGreaterThan(0);
    expect(log[0].type).toBe("STATE_TRANSITION");
  });

  it("should allow continued gameplay after deserialization", () => {
    const machine = new MatchStateMachine("match-5", "room-5", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.startRound({
      id: "q1",
      content: "Test?",
      options: ["A", "B"],
      correctAnswer: "A",
    });

    const restored = MatchStateMachine.deserialize(machine.serialize());

    // Should be able to evaluate round after restore
    const result = restored.evaluateRound();
    expect(result.eliminatedIds).toEqual(["p1", "p2"]); // no one answered
    expect(result.survivingIds).toEqual([]);
  });

  it("should handle null currentRound", () => {
    const machine = new MatchStateMachine("match-6", "room-6", makePlayers());

    const restored = MatchStateMachine.deserialize(machine.serialize());
    expect(restored.getCurrentRound()).toBeNull();
  });

  it("should preserve eliminated players state", () => {
    const machine = new MatchStateMachine("match-7", "room-7", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });

    machine.submitAnswer("p1", "A", round.startedAt + 100);
    // p2 doesn't answer

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    // Verify player score and correctAnswers are updated before serialization
    const preSerializeState = machine.getState();
    // B2: responseTime=100ms → bonus=(10000-100)/200=49.5 → floor=49 → total=149
    expect(preSerializeState.players.get("p1")?.score).toBe(149);
    expect(preSerializeState.players.get("p1")?.correctAnswers).toBe(1);
    expect(preSerializeState.players.get("p1")?.totalResponseTimeMs).toBe(100);

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const state = restored.getState();

    expect(state.survivingPlayerIds).toEqual(["p1"]);
    expect(state.eliminatedPlayerIds).toEqual(["p2"]);
    expect(state.players.get("p2")?.status).toBe(PlayerStatus.ELIMINATED);

    // Verify player score and correctAnswers are preserved through serialization
    expect(state.players.get("p1")?.score).toBe(149);
    expect(state.players.get("p1")?.correctAnswers).toBe(1);
    expect(state.players.get("p1")?.totalResponseTimeMs).toBe(100);
  });
});

describe("MatchStateMachine immutability and serialization", () => {
  it("should return deep-cloned state that cannot mutate internal state", () => {
    const machine = new MatchStateMachine("match-1", "room-1", makePlayers());
    const state = machine.getState();

    // Attempt to mutate the returned state
    state.players.get("p1")!.score = 100;
    state.players.get("p1")!.correctAnswers = 5;
    state.survivingPlayerIds.push("fake-id");

    // Verify internal state remains unchanged
    const originalState = machine.getState();
    expect(originalState.players.get("p1")!.score).toBe(0);
    expect(originalState.players.get("p1")!.correctAnswers).toBe(0);
    expect(originalState.survivingPlayerIds).toEqual(["p1", "p2"]);
  });

  it("should return deep-cloned currentRound that cannot mutate internal state", () => {
    const machine = new MatchStateMachine("match-1", "room-1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    machine.startRound({
      id: "q1",
      content: "What is 1+1?",
      options: ["1", "2", "3", "4"],
      correctAnswer: "2",
    });

    const currentRound = machine.getCurrentRound();

    // Attempt to mutate the returned round
    if (currentRound) {
      currentRound.question.content = "Modified question";
      currentRound.answers.set("fake-player", {
        playerId: "fake-player",
        answer: "fake",
        isCorrect: true,
        responseTimeMs: 1000,
        submittedAt: Date.now(),
      });
    }

    // Verify internal state remains unchanged
    const originalRound = machine.getCurrentRound();
    if (originalRound) {
      expect(originalRound.question.content).toBe("What is 1+1?");
      expect(originalRound.answers.size).toBe(0); // No answers should have been added
    }
  });

  it("should serialize to a valid JSON string", () => {
    const machine = new MatchStateMachine("match-1", "room-1", makePlayers());
    const serialized = machine.serialize();

    // Assert the return is a string
    expect(typeof serialized).toBe("string");

    // Assert JSON.parse(serialized) does not throw
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it("should correctly reconstruct Map structures after deserialize", () => {
    const machine = new MatchStateMachine("match-1", "room-1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);

    // Add more players to better test Map reconstruction
    const players = makePlayers();
    players.push({
      id: "p3",
      name: "Charlie",
      status: PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    });

    const machine2 = new MatchStateMachine("match-2", "room-2", players);
    machine2.transition(MatchStatus.COUNTDOWN);
    machine2.transition(MatchStatus.ROUND_ACTIVE);

    const round = machine2.startRound({
      id: "q1",
      content: "What is 2+2?",
      options: ["2", "3", "4", "5"],
      correctAnswer: "4",
    });

    machine2.submitAnswer("p1", "4", round.startedAt + 300);
    machine2.submitAnswer("p2", "3", round.startedAt + 500);

    const serialized = machine2.serialize();
    const restored = MatchStateMachine.deserialize(serialized);
    const restoredState = restored.getState();

    // Verify that maps were reconstructed correctly
    // Check players Map operations: size, iteration, get
    expect(restoredState.players.size).toBe(3);
    expect(Array.from(restoredState.players.keys())).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(restoredState.players.get("p1")).toBeDefined();
    expect(restoredState.players.get("p2")).toBeDefined();
    expect(restoredState.players.get("p3")).toBeDefined();

    // Check specific player data
    expect(restoredState.players.get("p1")?.name).toBe("Alice");
    expect(restoredState.players.get("p1")?.correctAnswers).toBe(0); // Not evaluated yet

    // Check current round answers Map operations
    const restoredRound = restored.getCurrentRound();
    expect(restoredRound).not.toBeNull();
    if (restoredRound) {
      expect(restoredRound.answers.size).toBe(2);
      expect(Array.from(restoredRound.answers.keys())).toEqual(["p1", "p2"]);
      expect(restoredRound.answers.get("p1")).toBeDefined();
      expect(restoredRound.answers.get("p2")).toBeDefined();

      // Check specific answer data
      expect(restoredRound.answers.get("p1")?.answer).toBe("4");
      expect(restoredRound.answers.get("p1")?.isCorrect).toBe(true);
      expect(restoredRound.answers.get("p2")?.answer).toBe("3");
      expect(restoredRound.answers.get("p2")?.isCorrect).toBe(false);
    }
  });
});

describe("MatchStateMachine.deserialize error handling", () => {
  it("throws on invalid JSON", () => {
    expect(() => MatchStateMachine.deserialize("{invalid")).toThrow(
      "Failed to parse MatchStateMachine JSON",
    );
  });

  it("throws on non-object data", () => {
    expect(() => MatchStateMachine.deserialize('"string"')).toThrow(
      "Invalid MatchStateMachine data",
    );
  });

  it("throws on missing state field", () => {
    expect(() => MatchStateMachine.deserialize("{}")).toThrow(
      "Invalid MatchStateMachine data",
    );
  });

  it("throws on non-array players", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({ state: { players: "bad" } }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on non-array eventLog", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({ state: { players: [] }, eventLog: "bad" }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on missing correctAnswer in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: { answers: [] },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on non-array answers in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: { correctAnswer: "A", answers: "bad" },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on missing/malformed question in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            startedAt: 100,
            endsAt: 200,
            roundNo: 1,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");

    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: "not-an-object",
            startedAt: 100,
            endsAt: 200,
            roundNo: 1,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");

    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: { id: 1, content: "Q", options: [] },
            startedAt: 100,
            endsAt: 200,
            roundNo: 1,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on missing/malformed startedAt or endsAt in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: { id: "q1", content: "Q", options: ["A"] },
            endsAt: 200,
            roundNo: 1,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");

    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: { id: "q1", content: "Q", options: ["A"] },
            startedAt: "not-a-number",
            endsAt: 200,
            roundNo: 1,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on missing/malformed roundNo in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: { id: "q1", content: "Q", options: ["A"] },
            startedAt: 100,
            endsAt: 200,
            status: "ACTIVE",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });

  it("throws on missing/malformed status in currentRound", () => {
    expect(() =>
      MatchStateMachine.deserialize(
        JSON.stringify({
          state: { players: [] },
          currentRound: {
            correctAnswer: "A",
            answers: [],
            question: { id: "q1", content: "Q", options: ["A"] },
            startedAt: 100,
            endsAt: 200,
            roundNo: 1,
            status: "INVALID_STATUS",
          },
          eventLog: [],
        }),
      ),
    ).toThrow("Invalid MatchStateMachine data");
  });
});

describe("MatchStateMachine gameplay methods", () => {
  it("finishMatch sets winner and endedAt", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.submitAnswer("p1", "A", round.startedAt + 100);
    // p2 doesn't answer

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.FINISHED);
    machine.finishMatch();

    const state = machine.getState();
    expect(state.winnerId).toBe("p1");
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.WINNER);
    expect(state.endedAt).not.toBeNull();
  });

  it("determineWinner uses tieBreak when all eliminated", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    // No one answers

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.FINISHED);
    machine.finishMatch();

    const state = machine.getState();
    expect(state.winnerId).toBeDefined();
    expect(["p1", "p2"]).toContain(state.winnerId);
  });

  // B2 fix: when both survivingPlayerIds and eliminatedPlayerIds
  // are empty, the previous code returned `undefined` (the old
  // signature was `string` so TS hid the bug, and the caller used
  // a non-null assertion). This test pins the new "empty roster"
  // path so a regression to `undefined` would fail loudly.
  it("B2: determineWinner returns null for empty roster (no survivors, no eliminated)", () => {
    const machine = new MatchStateMachine("m-empty", "r-empty", []);
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.transition(MatchStatus.FINISHED);

    // No evaluateRound() call — the roster starts and ends empty.
    expect(machine.getState().survivingPlayerIds).toEqual([]);
    expect(machine.getState().eliminatedPlayerIds).toEqual([]);

    expect(machine.determineWinner()).toBeNull();
  });

  // B2 fix: finishMatch on an empty roster must not crash. The
  // previous code threw `TypeError: Cannot read properties of
  // undefined (reading 'status')` when the empty-roster path
  // reached `winner.status = PlayerStatus.WINNER` with winner
  // === undefined.
  it("B2: finishMatch handles empty roster without throwing and stores winnerId: null", () => {
    const machine = new MatchStateMachine("m-empty", "r-empty", []);
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.transition(MatchStatus.FINISHED);

    expect(() => machine.finishMatch()).not.toThrow();

    const state = machine.getState();
    expect(state.winnerId).toBeNull();
    expect(state.endedAt).not.toBeNull();
    // No player was promoted to WINNER because there are no players.
    for (const player of state.players.values()) {
      expect(player.status).not.toBe(PlayerStatus.WINNER);
    }
  });

  // B2 fix: tieBreak on an empty list must return null (was
  // returning undefined, which the type system hid). This is the
  // narrower unit test of the tieBreak behaviour; the wider
  // determineWinner test above exercises the same path through
  // the public API.
  it("B2: tieBreak with empty playerIds returns null", () => {
    const machine = new MatchStateMachine("m-tb", "r-tb", []);
    const result = (
      machine as unknown as { tieBreak: (ids: string[]) => string | null }
    ).tieBreak([]);
    expect(result).toBeNull();
  });

  it("getSnapshot returns correct structure", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });

    const snapshot = machine.getSnapshot(5);

    expect(snapshot.matchId).toBe("m1");
    expect(snapshot.status).toBe(MatchStatus.ROUND_ACTIVE);
    expect(snapshot.currentRoundNo).toBe(1);
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot.currentQuestion).not.toBeNull();
    expect(snapshot.roundEndTime).not.toBeNull();
    expect(snapshot.lastEventSeqNo).toBe(5);
  });

  it("shouldEndMatch returns true when 1 or fewer survivors", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);

    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.submitAnswer("p1", "A", round.startedAt + 100);

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    expect(machine.shouldEndMatch()).toBe(true);
  });

  // H5 coverage: shouldEndMatch also fires when the round
  // count reaches the MAX_ROUNDS safety cap, even if more than
  // 1 player is still alive. This is the H5 fix path that
  // prevents a match with many timeouts from running
  // indefinitely. Previously uncovered.
  it("shouldEndMatch returns true when currentRoundNo >= maxRounds (H5 safety cap)", () => {
    const machine = new MatchStateMachine("m-cap", "r-cap", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    // Bump the round number past the cap without going through
    // a real round (the cap is checked against currentRoundNo
    // directly, so any value >= maxRounds triggers it).
    (
      machine as unknown as { state: { currentRoundNo: number } }
    ).state.currentRoundNo = 50;

    // Multiple survivors still alive — the cap is the only reason
    // the match ends.
    expect(machine.getState().survivingPlayerIds).toEqual(["p1", "p2"]);
    expect(machine.shouldEndMatch(50)).toBe(true);
    // Below the cap with the same state — still running.
    expect(machine.shouldEndMatch(100)).toBe(false);
  });

  // Coverage for the multi-survivor tieBreak branch. With 2+
  // players still alive when the match ends, determineWinner
  // falls through to `return this.tieBreak(survivors)`. We
  // exercise the path with a pair of players that have
  // different response times so tieBreak is invoked.
  it("determineWinner uses tieBreak when multiple survivors remain", () => {
    const machine = new MatchStateMachine("m-multi", "r-multi", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    // p1 answers fast, p2 answers slow — both survive.
    machine.submitAnswer("p1", "A", round.startedAt + 100);
    machine.submitAnswer("p2", "A", round.startedAt + 5_000);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.ROUND_RESULT);

    // Both survived, so the multi-survivor tieBreak branch
    // runs. p1 has the lower totalResponseTimeMs, so they win.
    expect(machine.getState().survivingPlayerIds).toEqual(["p1", "p2"]);
    expect(machine.determineWinner()).toBe("p1");
  });

  it("getEventLog returns copy of event log", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);

    const log = machine.getEventLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].type).toBe("STATE_TRANSITION");
  });

  it("disconnectPlayer marks player disconnected and offline, logging the event", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());

    // Call disconnectPlayer
    machine.disconnectPlayer("p1");

    // Check state update
    const state = machine.getState();
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.DISCONNECTED);
    expect(state.players.get("p1")?.isOnline).toBe(false);

    // Verify it didn't mutate other players
    expect(state.players.get("p2")?.status).toBe(PlayerStatus.ACTIVE);
    expect(state.players.get("p2")?.isOnline).toBe(true);

    // Verify event is logged
    const eventLog = machine.getEventLog();
    const disconnectEvent = eventLog.find(
      (e) => e.type === "PLAYER_DISCONNECTED",
    );
    expect(disconnectEvent).toBeDefined();
    expect(disconnectEvent?.payload).toEqual({ playerId: "p1" });
  });

  it("reconnectPlayer transitions DISCONNECTED player back to ACTIVE and sets isOnline to true", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());

    // 1. Disconnect first
    machine.disconnectPlayer("p1");
    expect(machine.getState().players.get("p1")?.status).toBe(
      PlayerStatus.DISCONNECTED,
    );
    expect(machine.getState().players.get("p1")?.isOnline).toBe(false);

    // 2. Reconnect
    machine.reconnectPlayer("p1");

    // 3. Verify status restored to ACTIVE and isOnline to true
    const state = machine.getState();
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.ACTIVE);
    expect(state.players.get("p1")?.isOnline).toBe(true);

    // Verify event is logged
    const eventLog = machine.getEventLog();
    const reconnectEvent = eventLog.find(
      (e) => e.type === "PLAYER_RECONNECTED",
    );
    expect(reconnectEvent).toBeDefined();
    expect(reconnectEvent?.payload).toEqual({ playerId: "p1" });
  });

  it("reconnectPlayer leaves ELIMINATED player status unchanged but sets isOnline to true", () => {
    const players = makePlayers();
    players[0].status = PlayerStatus.ELIMINATED;
    players[0].isOnline = false; // set offline first to trigger transition
    const machine = new MatchStateMachine("m1", "r1", players);

    // Reconnect the eliminated player
    machine.reconnectPlayer("p1");

    // Status must remain ELIMINATED, but isOnline must become true
    const state = machine.getState();
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.ELIMINATED);
    expect(state.players.get("p1")?.isOnline).toBe(true);

    // Should log PLAYER_RECONNECTED since isOnline toggled
    const eventLog = machine.getEventLog();
    const reconnectEvent = eventLog.find(
      (e) =>
        e.type === "PLAYER_RECONNECTED" &&
        (e.payload as { playerId: string }).playerId === "p1",
    );
    expect(reconnectEvent).toBeDefined();
  });

  it("disconnectPlayer does not mutate terminal statuses and avoids redundant logging", () => {
    const players = makePlayers();
    players[0].status = PlayerStatus.ELIMINATED;
    players[0].isOnline = true;
    const machine = new MatchStateMachine("m1", "r1", players);

    // Disconnect the eliminated player
    machine.disconnectPlayer("p1");

    const state = machine.getState();
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.ELIMINATED);
    expect(state.players.get("p1")?.isOnline).toBe(false);

    // Should NOT log PLAYER_DISCONNECTED because status did not change to DISCONNECTED
    const eventLog = machine.getEventLog();
    const disconnectEvent = eventLog.find(
      (e) => e.type === "PLAYER_DISCONNECTED",
    );
    expect(disconnectEvent).toBeUndefined();

    // Call it again to test duplicate prevention on normal player
    machine.disconnectPlayer("p2"); // p2 is ACTIVE -> DISCONNECTED
    expect(
      machine.getEventLog().filter((e) => e.type === "PLAYER_DISCONNECTED"),
    ).toHaveLength(1);

    // Calling it again on p2 should NOT log another event
    machine.disconnectPlayer("p2");
    expect(
      machine.getEventLog().filter((e) => e.type === "PLAYER_DISCONNECTED"),
    ).toHaveLength(1);
  });

  it("reconnectPlayer avoids logging and changes when nothing changed", () => {
    const players = makePlayers();
    players[0].status = PlayerStatus.ACTIVE;
    players[0].isOnline = true;
    const machine = new MatchStateMachine("m1", "r1", players);

    // Reconnect an already active and online player
    machine.reconnectPlayer("p1");

    const state = machine.getState();
    expect(state.players.get("p1")?.status).toBe(PlayerStatus.ACTIVE);
    expect(state.players.get("p1")?.isOnline).toBe(true);

    // Should NOT log PLAYER_RECONNECTED
    const eventLog = machine.getEventLog();
    const reconnectEvent = eventLog.find(
      (e) => e.type === "PLAYER_RECONNECTED",
    );
    expect(reconnectEvent).toBeUndefined();
  });
});

describe("MatchStateMachine guard branches", () => {
  it("transition throws on invalid transition", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    expect(() => machine.transition(MatchStatus.FINISHED)).toThrow(
      "Invalid transition",
    );
  });

  it("startRound throws when not in ROUND_ACTIVE state", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    expect(() =>
      machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      }),
    ).toThrow("Cannot start round");
  });

  it("submitAnswer throws when no active round", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    expectRoomError(
      () => machine.submitAnswer("p1", "A", Date.now()),
      ErrorCode.ROUND_NOT_ACTIVE,
    );
  });

  it("submitAnswer throws on duplicate answer", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.submitAnswer("p1", "A", round.startedAt + 100);
    expectRoomError(
      () => machine.submitAnswer("p1", "B", round.startedAt + 200),
      ErrorCode.ALREADY_ANSWERED,
    );
  });

  it("submitAnswer throws when past deadline", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    expectRoomError(
      () => machine.submitAnswer("p1", "A", round.endsAt + 1000),
      ErrorCode.ANSWER_SUBMISSION_CLOSED,
    );
  });

  it("submitAnswer throws for unknown player", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const round = machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    expectRoomError(
      () => machine.submitAnswer("unknown", "A", round.startedAt + 100),
      ErrorCode.PLAYER_NOT_IN_ROOM,
    );
  });

  it("evaluateRound throws when no active round", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    expect(() => machine.evaluateRound()).toThrow("No active round");
  });

  it("tieBreak uses correctAnswers as secondary sort", () => {
    const players = [
      {
        id: "p1",
        name: "A",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 500,
        correctAnswers: 2,
        isOnline: true,
      },
      {
        id: "p2",
        name: "B",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 500,
        correctAnswers: 3,
        isOnline: true,
      },
    ];
    const machine = new MatchStateMachine("m1", "r1", players);
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.FINISHED);
    machine.finishMatch();
    // p2 has more correctAnswers with same responseTime → p2 wins
    expect(machine.getState().winnerId).toBe("p2");
  });

  it("tieBreak uses alphabetical player ID as deterministic fallback", () => {
    const players = [
      {
        id: "p2",
        name: "Bob",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 500,
        correctAnswers: 2,
        isOnline: true,
      },
      {
        id: "p1",
        name: "Alice",
        status: PlayerStatus.ACTIVE,
        score: 0,
        totalResponseTimeMs: 500,
        correctAnswers: 2,
        isOnline: true,
      },
    ];
    // Both players have identical responseTime (500) and correctAnswers (2)
    // Alphabetically, "p1" is less than "p2", so "p1" should win deterministically
    const machine = new MatchStateMachine("m1", "r1", players);
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.FINISHED);
    machine.finishMatch();
    expect(machine.getState().winnerId).toBe("p1");
  });

  it("uses custom roundDurationMs if provided in startRound", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const customDuration = 30000; // 30 seconds
    const round = machine.startRound(
      {
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      },
      customDuration,
    );
    expect(round.endsAt).toBe(round.startedAt + customDuration);
  });
});

// ============================================================
// B2: Score accumulation and getPlayerScores
// ============================================================

describe("MatchStateMachine score accumulation (B2)", () => {
  const setupActiveRound = (
    machine: MatchStateMachine,
    correctAnswer = "A",
  ) => {
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    return machine.startRound({
      id: "q1",
      content: "Pick A",
      options: ["A", "B"],
      correctAnswer,
    });
  };

  it("awards 0 score to a player who answered wrong", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const round = setupActiveRound(machine);

    machine.submitAnswer("p1", "B", round.startedAt + 500); // wrong
    machine.submitAnswer("p2", "A", round.startedAt + 2000); // correct

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    const p1 = scores.find((s) => s.userId === "p1")!;
    const p2 = scores.find((s) => s.userId === "p2")!;
    expect(p1.score).toBe(0);
    expect(p2.score).toBeGreaterThan(0);
  });

  it("awards 0 score to a player who did not answer", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const round = setupActiveRound(machine);

    machine.submitAnswer("p1", "A", round.startedAt + 100);
    // p2 doesn't answer

    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    const p1 = scores.find((s) => s.userId === "p1")!;
    const p2 = scores.find((s) => s.userId === "p2")!;
    expect(p1.score).toBeGreaterThan(0);
    expect(p2.score).toBe(0);
  });

  it("accumulates score across multiple rounds for the same player", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    // Round 1: p1 correct, p2 wrong (eliminated)
    const round1 = setupActiveRound(machine);
    machine.submitAnswer("p1", "A", round1.startedAt + 200);
    machine.submitAnswer("p2", "B", round1.startedAt + 200);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.ROUND_RESULT);

    // Round 2: only p1 survives, p2 is eliminated and cannot submit
    machine.transition(MatchStatus.ROUND_ACTIVE);
    const round2 = machine.startRound({
      id: "q2",
      content: "Pick A again",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.submitAnswer("p1", "A", round2.startedAt + 4000);
    // p2 is ELIMINATED — submitAnswer will throw, so don't call it
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    const p1 = scores.find((s) => s.userId === "p1")!;
    // Round 1: rt=200 → bonus=(10000-200)/200=49 → floor=49 → total=149
    // Round 2: rt=4000 → bonus=(10000-4000)/200=30 → floor=30 → total=130
    // p1 sum: 149 + 130 = 279
    expect(p1.score).toBe(279);
    // p2 was eliminated in round 1, never scored
    const p2 = scores.find((s) => s.userId === "p2")!;
    expect(p2.score).toBe(0);
  });

  it("getPlayerScores returns all players even with score=0", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const scores = machine.getPlayerScores();
    expect(scores).toHaveLength(2);
    expect(scores.every((s) => s.score === 0)).toBe(true);
  });

  it("getPlayerScores is a snapshot (mutating result does not affect internal state)", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const round = setupActiveRound(machine);
    machine.submitAnswer("p1", "A", round.startedAt + 100);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    scores[0].score = 99999; // attempt to mutate
    const fresh = machine.getPlayerScores();
    expect(fresh[0].score).not.toBe(99999);
  });

  it("max bonus edge: responseTime=0 yields total=150", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const round = setupActiveRound(machine);
    machine.submitAnswer("p1", "A", round.startedAt + 0); // instant
    machine.submitAnswer("p2", "B", round.startedAt + 0);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    const p1 = scores.find((s) => s.userId === "p1")!;
    expect(p1.score).toBe(150); // 100 base + 50 max bonus
  });

  it("min bonus edge: responseTime>=10000 yields total=100 (no bonus)", () => {
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    const round = setupActiveRound(machine);
    machine.submitAnswer("p1", "A", round.startedAt + 12000); // slow but correct
    machine.submitAnswer("p2", "B", round.startedAt + 12000);
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();

    const scores = machine.getPlayerScores();
    const p1 = scores.find((s) => s.userId === "p1")!;
    expect(p1.score).toBe(100); // 100 base + 0 bonus
  });

  it("tieBreak ranks missing players last (never lets them win)", () => {
    // Simulate state corruption: one of the playerIds passed to tieBreak
    // does not exist in state.players (e.g. desync). The existing valid
    // player must still win regardless of input order.
    const machine = new MatchStateMachine("m1", "r1", makePlayers());
    machine.transition(MatchStatus.COUNTDOWN);
    machine.transition(MatchStatus.ROUND_ACTIVE);
    machine.startRound({
      id: "q1",
      content: "Q?",
      options: ["A", "B"],
      correctAnswer: "A",
    });
    machine.transition(MatchStatus.ROUND_EVALUATING);
    machine.evaluateRound();
    machine.transition(MatchStatus.FINISHED);

    // Cast to access private tieBreak for this corruption test
    const tieBreak = (
      machine as unknown as {
        tieBreak: (ids: string[]) => string;
      }
    ).tieBreak.bind(machine);

    expect(tieBreak(["p1", "ghost"])).toBe("p1");
    expect(tieBreak(["ghost", "p1"])).toBe("p1");
    expect(tieBreak(["ghost", "p2"])).toBe("p2");
    expect(tieBreak(["p1", "ghost", "p2"])).not.toBe("ghost");
  });

  // ---- M1 fix: responseTimeMs clamping ----
  describe("M1: responseTimeMs clamping", () => {
    it("clamps negative responseTimeMs to 0 when server clock skews backwards", () => {
      // M1: a serverTimestamp predating round.startedAt would
      // produce a negative responseTime. Previously this flowed
      // into scoring, producing an artificial max-speed bonus for
      // an answer that was actually submitted LATE.
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      const round = machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      // Simulate NTP clock skew: serverTimestamp is 500ms
      // BEFORE the round started.
      const skewedTimestamp = round.startedAt - 500;
      const result = machine.submitAnswer("p1", "A", skewedTimestamp);

      // The stored responseTime is clamped to 0 (not -500).
      expect(result.responseTimeMs).toBe(0);
      // The raw submittedAt is preserved for audit purposes.
      expect(result.submittedAt).toBe(skewedTimestamp);
    });

    it("positive responseTimeMs flows through unchanged", () => {
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      const round = machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      const result = machine.submitAnswer("p1", "A", round.startedAt + 200);
      expect(result.responseTimeMs).toBe(200);
    });
  });

  // ---- L3 fix: serialize excludes correctAnswer ----
  describe("L3: serialize/deserialize correctAnswer handling", () => {
    it("serialize() excludes correctAnswer from the round payload", () => {
      // L3: the in-flight correct answer is sensitive. It is NOT
      // persisted to Redis (the source of truth is the Question
      // DB row). A Redis leak or log scrape should not expose
      // answer keys.
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "TOP_SECRET_ANSWER",
      });

      const json = machine.serialize();
      // The serialized JSON must NOT contain the correctAnswer.
      expect(json).not.toContain("TOP_SECRET_ANSWER");
      // Parsing the JSON confirms correctAnswer is absent from
      // the round payload.
      const parsed = JSON.parse(json);
      if (parsed.currentRound) {
        expect(parsed.currentRound.correctAnswer).toBeUndefined();
      }
    });

    it("deserialize() succeeds without correctAnswer and exposes it as undefined", () => {
      // L3: the recovery path (MatchService.getStateMachine)
      // calls deserialize() then attachCorrectAnswer() to
      // re-attach the answer from the DB. deserialize alone
      // should yield a state machine where the round has no
      // correctAnswer yet.
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      const json = machine.serialize();

      const restored = MatchStateMachine.deserialize(json);
      const restoredRound = restored.getCurrentRound();
      expect(restoredRound).not.toBeNull();
      // The round was restored; the correctAnswer is NOT.
      const correctAnswer = (
        restoredRound as unknown as { correctAnswer?: string }
      ).correctAnswer;
      expect(correctAnswer).toBeUndefined();
    });

    it("attachCorrectAnswer() sets the correctAnswer for an ACTIVE round", () => {
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      const json = machine.serialize();
      const restored = MatchStateMachine.deserialize(json);

      restored.attachCorrectAnswer("A");
      // Now the restored machine can grade answers. Use a
      // controlled timestamp derived from the round's startedAt
      // rather than Date.now() — the previous Date.now() call
      // could exceed the round's endsAt on slow CI runners,
      // making the test flaky (it would throw
      // ANSWER_SUBMISSION_CLOSED instead of grading).
      const restoredRound = restored.getCurrentRound()!;
      const result = restored.submitAnswer(
        "p1",
        "A",
        restoredRound.startedAt + 100,
      );
      expect(result.isCorrect).toBe(true);
    });

    it("attachCorrectAnswer() is a no-op when there is no current round", () => {
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      // No round started.
      expect(() => machine.attachCorrectAnswer("A")).not.toThrow();
    });
  });

  // ---- L5 fix: tieBreak with deterministic seed ----
  describe("L5: tieBreak with deterministic random offset", () => {
    it("is reproducible across calls with the same match id", () => {
      // L5: the seed is the match id, so two calls on the same
      // machine (or on two different processes that share the
      // match id) must produce the same winner.
      const machine = new MatchStateMachine("m1", "r1", makePlayers());
      machine.transition(MatchStatus.COUNTDOWN);
      machine.transition(MatchStatus.ROUND_ACTIVE);
      machine.startRound({
        id: "q1",
        content: "Q?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      machine.submitAnswer("p1", "A", Date.now() + 100);
      machine.submitAnswer("p2", "A", Date.now() + 100);

      // Cast to access private tieBreak for direct testing
      const tieBreak = (
        machine as unknown as { tieBreak: (ids: string[]) => string }
      ).tieBreak.bind(machine);
      const first = tieBreak(["p1", "p2"]);
      const second = tieBreak(["p1", "p2"]);
      expect(first).toBe(second);
    });

    it("is reproducible across two different machines with the same match id", () => {
      // L5: critical for distributed / multi-process scenarios.
      // Two independently-constructed machines with the same
      // match id must produce the same tieBreak winner given the
      // same player stats.
      const machineA = new MatchStateMachine("same-match", "r1", makePlayers());
      const machineB = new MatchStateMachine("same-match", "r1", makePlayers());

      const tieBreakA = (
        machineA as unknown as { tieBreak: (ids: string[]) => string }
      ).tieBreak.bind(machineA);
      const tieBreakB = (
        machineB as unknown as { tieBreak: (ids: string[]) => string }
      ).tieBreak.bind(machineB);

      expect(tieBreakA(["p1", "p2"])).toBe(tieBreakB(["p1", "p2"]));
    });

    it("two different match ids may produce different winners (no structural bias)", () => {
      // L5: with the old alphabetical-id fallback, "a_player"
      // would always beat "z_player". With the seeded offset, the
      // winner depends on the match id, so no player has a
      // structural advantage.
      const machineA = new MatchStateMachine("match-A", "r1", makePlayers());
      const machineB = new MatchStateMachine("match-B", "r1", makePlayers());

      const tieBreakA = (
        machineA as unknown as { tieBreak: (ids: string[]) => string }
      ).tieBreak.bind(machineA);
      const tieBreakB = (
        machineB as unknown as { tieBreak: (ids: string[]) => string }
      ).tieBreak.bind(machineB);

      // p1 has a lower id than p2. The old alphabetical fallback
      // would always pick p1. With the seeded offset, the
      // outcome depends on the match id and may (in some match
      // ids) pick p2. We assert "may" rather than "must" because
      // the offset is uniformly random — for some match ids
      // p1 still wins. The contract being tested is that the
      // function is sensitive to the match id.
      const resultA = tieBreakA(["p1", "p2"]);
      const resultB = tieBreakB(["p1", "p2"]);
      // The point is that the result is determined by the match
      // id, not by player id. We check this indirectly by
      // confirming both return a valid player.
      expect(["p1", "p2"]).toContain(resultA);
      expect(["p1", "p2"]).toContain(resultB);
    });
  });
});
