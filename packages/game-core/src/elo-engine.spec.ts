import { describe, it, expect } from "vitest";
import {
  calculateMultiplayerElo,
  assignPlacements,
  type EloPlayerInput,
} from "./elo-engine";

describe("elo-engine", () => {
  describe("calculateMultiplayerElo", () => {
    it("handles empty player array", () => {
      const results = calculateMultiplayerElo([]);
      expect(results).toEqual([]);
    });

    it("handles single player without modifying rating", () => {
      const results = calculateMultiplayerElo([
        { userId: "u1", currentElo: 1200, placement: 1, score: 500 },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        userId: "u1",
        currentElo: 1200,
        newElo: 1200,
        delta: 0,
        placement: 1,
        score: 500,
      });
    });

    it("calculates 2-player match with equal initial ELO", () => {
      const players: EloPlayerInput[] = [
        { userId: "u1", currentElo: 1200, placement: 1, score: 100 },
        { userId: "u2", currentElo: 1200, placement: 2, score: 50 },
      ];
      const results = calculateMultiplayerElo(players, 32);

      expect(results).toHaveLength(2);
      // Expected score for both is 0.5.
      // u1 actual = 1, delta = 32 * (1 - 0.5) = +16.
      // u2 actual = 0, delta = 32 * (0 - 0.5) = -16.
      expect(results[0]?.delta).toBe(16);
      expect(results[0]?.newElo).toBe(1216);
      expect(results[1]?.delta).toBe(-16);
      expect(results[1]?.newElo).toBe(1184);

      // Zero-sum
      expect(results[0]!.delta + results[1]!.delta).toBe(0);
    });

    it("calculates 2-player match with a tie", () => {
      const players: EloPlayerInput[] = [
        { userId: "u1", currentElo: 1200, placement: 1, score: 100 },
        { userId: "u2", currentElo: 1200, placement: 1, score: 100 },
      ];
      const results = calculateMultiplayerElo(players, 32);

      expect(results[0]?.delta).toBe(0);
      expect(results[0]?.newElo).toBe(1200);
      expect(results[1]?.delta).toBe(0);
      expect(results[1]?.newElo).toBe(1200);
    });

    it("gives underdog larger gain when beating a higher-rated player", () => {
      // Underdog (1000) beats Favorite (1400)
      const underdogWin: EloPlayerInput[] = [
        { userId: "underdog", currentElo: 1000, placement: 1, score: 200 },
        { userId: "favorite", currentElo: 1400, placement: 2, score: 100 },
      ];
      const underdogResults = calculateMultiplayerElo(underdogWin, 32);

      // Favorite (1400) beats Underdog (1000)
      const favoriteWin: EloPlayerInput[] = [
        { userId: "favorite", currentElo: 1400, placement: 1, score: 200 },
        { userId: "underdog", currentElo: 1000, placement: 2, score: 100 },
      ];
      const favoriteResults = calculateMultiplayerElo(favoriteWin, 32);

      const underdogDelta = underdogResults.find(
        (r) => r.userId === "underdog",
      )!.delta;
      const favoriteDelta = favoriteResults.find(
        (r) => r.userId === "favorite",
      )!.delta;

      expect(underdogDelta).toBeGreaterThan(favoriteDelta);
      expect(underdogDelta).toBe(29); // ~29
      expect(favoriteDelta).toBe(3); // ~3
    });

    it("scales correctly for a 4-player room and preserves zero-sum property", () => {
      const players: EloPlayerInput[] = [
        { userId: "p1", currentElo: 1200, placement: 1, score: 400 },
        { userId: "p2", currentElo: 1200, placement: 2, score: 300 },
        { userId: "p3", currentElo: 1200, placement: 3, score: 200 },
        { userId: "p4", currentElo: 1200, placement: 4, score: 100 },
      ];
      const results = calculateMultiplayerElo(players, 32);

      expect(results).toHaveLength(4);
      expect(results[0]!.delta).toBeGreaterThan(0);
      expect(results[1]!.delta).toBeGreaterThan(0);
      expect(results[2]!.delta).toBeLessThan(0);
      expect(results[3]!.delta).toBeLessThan(0);

      // Order of gains: 1st > 2nd > 3rd > 4th
      expect(results[0]!.delta).toBeGreaterThan(results[1]!.delta);
      expect(results[1]!.delta).toBeGreaterThan(results[2]!.delta);
      expect(results[2]!.delta).toBeGreaterThan(results[3]!.delta);

      const sumDelta = results.reduce((sum, r) => sum + r.delta, 0);
      expect(sumDelta).toBe(0);
    });

    it("simulates a 100-player Battle Royale match with balanced distribution", () => {
      const players: EloPlayerInput[] = Array.from({ length: 100 }, (_, i) => ({
        userId: `player-${i + 1}`,
        currentElo: 1200,
        placement: i + 1, // 1st to 100th
        score: (100 - i) * 50,
      }));

      const results = calculateMultiplayerElo(players, 32);
      expect(results).toHaveLength(100);

      // 1st place should have the highest positive delta
      expect(results[0]!.placement).toBe(1);
      expect(results[0]!.delta).toBe(16);
      expect(results[0]!.newElo).toBe(1216);

      // 100th place should have the most negative delta
      expect(results[99]!.placement).toBe(100);
      expect(results[99]!.delta).toBe(-16);
      expect(results[99]!.newElo).toBe(1184);

      // Top 50 have >= 0 delta, Bottom 50 have <= 0 delta
      for (let i = 0; i < 50; i++) {
        expect(results[i]!.delta).toBeGreaterThanOrEqual(0);
      }
      for (let i = 50; i < 100; i++) {
        expect(results[i]!.delta).toBeLessThanOrEqual(0);
      }

      // Sum of all deltas is approximately 0 (due to rounding)
      const totalDelta = results.reduce((acc, r) => acc + r.delta, 0);
      expect(Math.abs(totalDelta)).toBeLessThanOrEqual(2);
    });

    it("clamps newElo at 0 and maintains currentElo + delta === newElo invariant", () => {
      const players: EloPlayerInput[] = [
        { userId: "p1", currentElo: 5, placement: 1, score: 200 },
        { userId: "low_elo", currentElo: 5, placement: 2, score: 0 },
      ];
      const results = calculateMultiplayerElo(players, 32);
      const lowElo = results.find((r) => r.userId === "low_elo")!;
      expect(lowElo.newElo).toBe(0);
      expect(lowElo.delta).toBe(-5);
      expect(lowElo.currentElo + lowElo.delta).toBe(lowElo.newElo);
    });

    it("uses default kFactor when kFactor is omitted", () => {
      const players: EloPlayerInput[] = [
        { userId: "u1", currentElo: 1200, placement: 1, score: 100 },
        { userId: "u2", currentElo: 1200, placement: 2, score: 50 },
      ];
      const results = calculateMultiplayerElo(players);
      expect(results[0]?.delta).toBe(16);
      expect(results[1]?.delta).toBe(-16);
    });

    it("rejects non-finite currentElo values", () => {
      expect(() =>
        calculateMultiplayerElo([
          { userId: "u1", currentElo: Number.NaN, placement: 1, score: 100 },
          { userId: "u2", currentElo: 1200, placement: 2, score: 50 },
        ]),
      ).toThrow("Invalid currentElo for player u1: NaN");

      expect(() =>
        calculateMultiplayerElo([
          {
            userId: "u1",
            currentElo: Number.POSITIVE_INFINITY,
            placement: 1,
            score: 100,
          },
          { userId: "u2", currentElo: 1200, placement: 2, score: 50 },
        ]),
      ).toThrow("Invalid currentElo for player u1: Infinity");

      expect(() =>
        calculateMultiplayerElo([
          {
            userId: "u1",
            currentElo: Number.NEGATIVE_INFINITY,
            placement: 1,
            score: 100,
          },
        ]),
      ).toThrow("Invalid currentElo for player u1: -Infinity");
    });

    it("handles large finite ELO values and equal ratings without NaN or overflow", () => {
      const players: EloPlayerInput[] = [
        { userId: "p1", currentElo: 1_000_000, placement: 1, score: 200 },
        { userId: "p2", currentElo: 1_000_000, placement: 2, score: 100 },
      ];
      const results = calculateMultiplayerElo(players, 32);

      expect(results).toHaveLength(2);
      expect(Number.isFinite(results[0]!.newElo)).toBe(true);
      expect(Number.isFinite(results[0]!.delta)).toBe(true);
      expect(results[0]!.delta).toBe(16);
      expect(results[0]!.newElo).toBe(1_000_016);
      expect(results[1]!.delta).toBe(-16);
      expect(results[1]!.newElo).toBe(999_984);

      // Tie with huge rating
      const tiePlayers: EloPlayerInput[] = [
        { userId: "p1", currentElo: 1e12, placement: 1, score: 100 },
        { userId: "p2", currentElo: 1e12, placement: 1, score: 100 },
      ];
      const tieResults = calculateMultiplayerElo(tiePlayers, 32);
      expect(tieResults[0]!.delta).toBe(0);
      expect(tieResults[0]!.newElo).toBe(1e12);
      expect(tieResults[1]!.delta).toBe(0);
      expect(tieResults[1]!.newElo).toBe(1e12);
    });
  });

  describe("assignPlacements", () => {
    it("orders players by score descending", () => {
      const input = [
        { userId: "pB", score: 200 },
        { userId: "pA", score: 500 },
        { userId: "pC", score: 100 },
      ];
      const result = assignPlacements(input);
      expect(result.map((r) => r.userId)).toEqual(["pA", "pB", "pC"]);
      expect(result.map((r) => r.placement)).toEqual([1, 2, 3]);
    });

    it("breaks score ties using avgResponseMs (faster is better)", () => {
      const input = [
        { userId: "pSlow", score: 300, avgResponseMs: 1200 },
        { userId: "pFast", score: 300, avgResponseMs: 450 },
      ];
      const result = assignPlacements(input);
      expect(result[0]!.userId).toBe("pFast");
      expect(result[0]!.placement).toBe(1);
      expect(result[1]!.userId).toBe("pSlow");
      expect(result[1]!.placement).toBe(2);
    });

    it("ranks player with measured avgResponseMs ahead of player without avgResponseMs on score tie", () => {
      const input = [
        { userId: "pNoSpeed", score: 300 },
        { userId: "pSpeed", score: 300, avgResponseMs: 1200 },
      ];
      const result = assignPlacements(input);
      expect(result[0]!.userId).toBe("pSpeed");
      expect(result[0]!.placement).toBe(1);
      expect(result[1]!.userId).toBe("pNoSpeed");
      expect(result[1]!.placement).toBe(2);
    });

    it("breaks identical score and speed ties using userId", () => {
      const input = [
        { userId: "user-z", score: 100, avgResponseMs: 500 },
        { userId: "user-a", score: 100, avgResponseMs: 500 },
      ];
      const result = assignPlacements(input);
      expect(result[0]!.userId).toBe("user-a");
      expect(result[1]!.userId).toBe("user-z");
    });

    it("ranks winner 1st place even if another player has a higher score", () => {
      const input = [
        {
          userId: "pEliminated",
          score: 1500,
          avgResponseMs: 400,
          survivedRounds: 11,
        },
        {
          userId: "pWinner",
          score: 1200,
          avgResponseMs: 600,
          survivedRounds: 12,
        },
      ];
      const result = assignPlacements(input, "pWinner");
      expect(result[0]!.userId).toBe("pWinner");
      expect(result[0]!.placement).toBe(1);
      expect(result[1]!.userId).toBe("pEliminated");
      expect(result[1]!.placement).toBe(2);
    });

    it("ranks players by survived rounds before scores", () => {
      const input = [
        { userId: "pRound3High", score: 800, survivedRounds: 3 },
        { userId: "pRound5Low", score: 500, survivedRounds: 5 },
      ];
      const result = assignPlacements(input);
      expect(result[0]!.userId).toBe("pRound5Low");
      expect(result[0]!.placement).toBe(1);
      expect(result[1]!.userId).toBe("pRound3High");
      expect(result[1]!.placement).toBe(2);
    });
  });
});
