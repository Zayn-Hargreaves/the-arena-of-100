import { describe, it, expect } from "vitest";
import { MatchStateMachine } from "./match-state-machine";
import {
  MatchStatus,
  PlayerStatus,
  ErrorCode,
  type PlayerInfo,
} from "@arena/shared";

function createTestPlayers(count = 5): PlayerInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    status: PlayerStatus.ACTIVE,
    score: 0,
    totalResponseTimeMs: 0,
    correctAnswers: 0,
    isOnline: true,
  }));
}

describe("MatchStateMachine — Topic Ban Voting", () => {
  it("initializes topic voting, sets state, and logs event", () => {
    const players = createTestPlayers(4);
    const sm = new MatchStateMachine("m1", "r1", players);

    expect(sm.getState().status).toBe(MatchStatus.CREATED);

    const candidates = sm.initTopicVoting(
      ["SCIENCE", "HISTORY", "GEOGRAPHY", "LOGIC"],
      8000,
    );
    expect(candidates).toEqual(["SCIENCE", "HISTORY", "GEOGRAPHY", "LOGIC"]);
    expect(sm.getState().status).toBe(MatchStatus.TOPIC_VOTING);
    expect(sm.getState().candidateTopics).toEqual(candidates);
    expect(sm.getState().topicVotes).toEqual({});

    const events = sm.getEventLog();
    const startEvent = events.find((e) => e.type === "TOPIC_VOTING_STARTED");
    expect(startEvent).toBeDefined();
    expect(startEvent?.payload).toMatchObject({
      matchId: "m1",
      candidateTopics: candidates,
      durationMs: 8000,
      endsAt: expect.any(Number),
    });
  });

  it("allows active players to vote for a valid candidate topic", () => {
    const players = createTestPlayers(3);
    const sm = new MatchStateMachine("m1", "r1", players);
    sm.initTopicVoting(["SCIENCE", "HISTORY", "LOGIC"]);

    expect(sm.voteBanTopic("p1", "SCIENCE")).toBe(true);
    expect(sm.voteBanTopic("p2", "HISTORY")).toBe(true);

    const state = sm.getState();
    expect(state.topicVotes).toEqual({
      p1: "SCIENCE",
      p2: "HISTORY",
    });

    const events = sm
      .getEventLog()
      .filter((e) => e.type === "TOPIC_VOTE_SUBMITTED");
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({
      matchId: "m1",
      playerId: "p1",
      topic: "SCIENCE",
    });
    expect(events[1]?.payload).toEqual({
      matchId: "m1",
      playerId: "p2",
      topic: "HISTORY",
    });
  });

  it("rejects vote when not in TOPIC_VOTING state", () => {
    const players = createTestPlayers(2);
    const sm = new MatchStateMachine("m1", "r1", players);

    expect(() => sm.voteBanTopic("p1", "SCIENCE")).toThrowError(
      expect.objectContaining({ code: ErrorCode.TOPIC_VOTING_CLOSED }),
    );
  });

  it("rejects vote for invalid topic", () => {
    const players = createTestPlayers(2);
    const sm = new MatchStateMachine("m1", "r1", players);
    sm.initTopicVoting(["SCIENCE", "HISTORY"]);

    expect(() => sm.voteBanTopic("p1", "INVALID_TOPIC")).toThrowError(
      expect.objectContaining({ code: ErrorCode.INVALID_TOPIC }),
    );
  });

  it("rejects vote from non-player or non-active player", () => {
    const players = createTestPlayers(2);
    players[1]!.status = PlayerStatus.ELIMINATED;
    const sm = new MatchStateMachine("m1", "r1", players);
    sm.initTopicVoting(["SCIENCE", "HISTORY"]);

    expect(() => sm.voteBanTopic("p999", "SCIENCE")).toThrowError(
      expect.objectContaining({ code: ErrorCode.PLAYER_NOT_IN_ROOM }),
    );
    expect(() => sm.voteBanTopic("p2", "SCIENCE")).toThrowError(
      expect.objectContaining({ code: ErrorCode.PLAYER_NOT_IN_ROOM }),
    );
  });

  it("resolves topic voting and sets bannedTopics and activeTopics", () => {
    const players = createTestPlayers(4);
    const sm = new MatchStateMachine("m1", "r1", players);
    sm.initTopicVoting(["SCIENCE", "HISTORY", "GEOGRAPHY", "LOGIC"]);

    sm.voteBanTopic("p1", "HISTORY");
    sm.voteBanTopic("p2", "HISTORY");
    sm.voteBanTopic("p3", "SCIENCE");
    sm.voteBanTopic("p4", "GEOGRAPHY");

    const result = sm.resolveTopicVoting(2);
    expect(result.bannedTopics).toHaveLength(2);
    expect(result.bannedTopics[0]).toBe("HISTORY");
    expect(result.activeTopics).toHaveLength(2);

    const state = sm.getState();
    expect(state.bannedTopics).toEqual(result.bannedTopics);
    expect(state.activeTopics).toEqual(result.activeTopics);

    const finishEvent = sm
      .getEventLog()
      .find((e) => e.type === "TOPIC_VOTING_FINISHED");
    expect(finishEvent).toBeDefined();
    expect(finishEvent?.payload).toEqual({
      matchId: "m1",
      bannedTopics: result.bannedTopics,
      activeTopics: result.activeTopics,
      voteCounts: result.voteCounts,
    });
  });

  it("preserves topic voting state across serialization and deserialization", () => {
    const players = createTestPlayers(3);
    const sm = new MatchStateMachine("m1", "r1", players);
    sm.initTopicVoting(["SCIENCE", "HISTORY", "LOGIC"]);
    sm.voteBanTopic("p1", "SCIENCE");
    sm.voteBanTopic("p2", "HISTORY");
    sm.resolveTopicVoting(1);

    const json = sm.serialize();
    const restored = MatchStateMachine.deserialize(json);

    expect(restored.getState().status).toBe(MatchStatus.TOPIC_VOTING);
    expect(restored.getState().candidateTopics).toEqual([
      "SCIENCE",
      "HISTORY",
      "LOGIC",
    ]);
    expect(restored.getState().topicVotes).toEqual({
      p1: "SCIENCE",
      p2: "HISTORY",
    });
    expect(restored.getState().bannedTopics).toEqual(
      sm.getState().bannedTopics,
    );
    expect(restored.getState().activeTopics).toEqual(
      sm.getState().activeTopics,
    );
    expect(restored.getEventLog()).toEqual(sm.getEventLog());
  });
});
