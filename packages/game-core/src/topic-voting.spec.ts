import { describe, it, expect } from "vitest";
import {
  selectCandidateTopics,
  tallyTopicVotes,
  resolveBannedTopics,
} from "./topic-voting";

describe("topic-voting engine", () => {
  const seed = "test-match-seed-123";

  describe("selectCandidateTopics", () => {
    it("selects deterministic count of candidate topics from pool", () => {
      const candidates1 = selectCandidateTopics(seed, 4);
      const candidates2 = selectCandidateTopics(seed, 4);
      expect(candidates1).toHaveLength(4);
      expect(candidates1).toEqual(candidates2);
    });

    it("returns entire pool if pool length <= count", () => {
      const pool = ["SCIENCE", "HISTORY"];
      const candidates = selectCandidateTopics(seed, 5, pool);
      expect(candidates).toEqual(["SCIENCE", "HISTORY"]);
    });
  });

  describe("tallyTopicVotes", () => {
    it("tallies votes accurately for each candidate topic", () => {
      const candidates = ["SCIENCE", "HISTORY", "GEOGRAPHY"];
      const votes = {
        p1: "SCIENCE",
        p2: "SCIENCE",
        p3: "HISTORY",
        p4: "OTHER_INVALID", // ignored
      };
      const counts = tallyTopicVotes(votes, candidates);
      expect(counts).toEqual({
        SCIENCE: 2,
        HISTORY: 1,
        GEOGRAPHY: 0,
      });
    });
  });

  describe("resolveBannedTopics", () => {
    it("bans the top N topics with the most ban votes", () => {
      const candidates = ["SCIENCE", "HISTORY", "GEOGRAPHY", "LOGIC"];
      const votes = {
        p1: "HISTORY",
        p2: "HISTORY",
        p3: "LOGIC",
        p4: "SCIENCE",
      };
      // HISTORY: 2 votes, LOGIC: 1 vote, SCIENCE: 1 vote, GEOGRAPHY: 0 votes
      // top 2 banned -> HISTORY and (LOGIC or SCIENCE determined by tie-break)
      const result = resolveBannedTopics(candidates, votes, 2, seed);
      expect(result.bannedTopics).toHaveLength(2);
      expect(result.bannedTopics[0]).toBe("HISTORY");
      expect(result.activeTopics).toHaveLength(2);
      expect(result.bannedTopics.includes("GEOGRAPHY")).toBe(false);
      expect(result.activeTopics.includes("GEOGRAPHY")).toBe(true);
    });

    it("is completely deterministic with same seed on tie", () => {
      const candidates = ["SCIENCE", "HISTORY", "GEOGRAPHY", "LOGIC"];
      const votes = {
        p1: "SCIENCE",
        p2: "HISTORY",
      };
      const result1 = resolveBannedTopics(candidates, votes, 2, seed);
      const result2 = resolveBannedTopics(candidates, votes, 2, seed);
      expect(result1).toEqual(result2);
    });
  });
});
