import { describe, it, expect } from "vitest";
import { computeRoundScore, GAME_CONFIG } from "./index";

describe("computeRoundScore", () => {
  it("returns base + max bonus (50) when responseTime is 0", () => {
    const result = computeRoundScore(0);
    expect(result.base).toBe(100);
    expect(result.speedBonus).toBe(50);
    expect(result.total).toBe(150);
  });

  it("returns base + reduced bonus for moderate responseTime", () => {
    // responseTime=2000ms → bonus = (10000-2000)/200 = 40
    const result = computeRoundScore(2000);
    expect(result.base).toBe(100);
    expect(result.speedBonus).toBe(40);
    expect(result.total).toBe(140);
  });

  it("returns base + 0 bonus when responseTime reaches window (10000ms)", () => {
    const result = computeRoundScore(GAME_CONFIG.SCORE_SPEED_BONUS_WINDOW_MS);
    expect(result.base).toBe(100);
    expect(result.speedBonus).toBe(0);
    expect(result.total).toBe(100);
  });

  it("returns base + 0 bonus (clamped) when responseTime exceeds window", () => {
    const result = computeRoundScore(15000);
    expect(result.base).toBe(100);
    expect(result.speedBonus).toBe(0);
    expect(result.total).toBe(100);
  });

  it("clamps negative responseTime to 0 (defensive)", () => {
    const result = computeRoundScore(-100);
    // negative input is clamped to 0, so bonus = max(0, 10000-0)/200 = 50
    expect(result.base).toBe(100);
    expect(result.speedBonus).toBe(50);
    expect(result.total).toBe(150);
  });

  it("produces consistent totals across boundary values", () => {
    // 0ms   → 100 + 50    = 150
    // 200ms → 100 + 49    = 149 (10000-200)/200 = 49
    // 2000ms→ 100 + 40    = 140
    // 10000ms→ 100 + 0    = 100
    expect(computeRoundScore(0).total).toBe(150);
    expect(computeRoundScore(200).total).toBe(149);
    expect(computeRoundScore(2000).total).toBe(140);
    expect(computeRoundScore(10000).total).toBe(100);
  });
});
