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

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const restoredRound = restored.getCurrentRound();

    expect(restoredRound).not.toBeNull();
    expect(restoredRound!.roundNo).toBe(1);
    expect(restoredRound!.question.content).toBe("What is 1+1?");
    expect(restoredRound!.answers.get("p1")?.isCorrect).toBe(true);
    expect(restoredRound!.answers.get("p2")?.isCorrect).toBe(false);
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

    const restored = MatchStateMachine.deserialize(machine.serialize());
    const state = restored.getState();

    expect(state.survivingPlayerIds).toEqual(["p1"]);
    expect(state.eliminatedPlayerIds).toEqual(["p2"]);
    expect(state.players.get("p2")?.status).toBe(PlayerStatus.ELIMINATED);
  });
});
