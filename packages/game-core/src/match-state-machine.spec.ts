import { describe, it, expect } from "vitest";
import { MatchStateMachine } from "./match-state-machine";
import { MatchStatus, PlayerStatus } from "@arena/shared";

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
    expect(preSerializeState.players.get("p1")?.score).toBe(0); // Score not implemented yet
    expect(preSerializeState.players.get("p1")?.correctAnswers).toBe(1);
    expect(preSerializeState.players.get("p1")?.totalResponseTimeMs).toBe(100);

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const state = restored.getState();

    expect(state.survivingPlayerIds).toEqual(["p1"]);
    expect(state.eliminatedPlayerIds).toEqual(["p2"]);
    expect(state.players.get("p2")?.status).toBe(PlayerStatus.ELIMINATED);
    
    // Verify player score and correctAnswers are preserved through serialization
    expect(state.players.get("p1")?.score).toBe(0); // Score not implemented yet
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
    expect(Array.from(restoredState.players.keys())).toEqual(["p1", "p2", "p3"]);
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
