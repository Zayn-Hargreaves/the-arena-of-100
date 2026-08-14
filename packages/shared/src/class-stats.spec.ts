import { describe, it, expect } from "vitest";
import { classWinrateSchema } from "./class-stats";

describe("classWinrateSchema", () => {
  it("accepts a valid record with wins <= plays", () => {
    const parsed = classWinrateSchema.parse({
      plays: 10,
      wins: 3,
      winRate: 0.3,
    });
    expect(parsed.plays).toBe(10);
    expect(parsed.wins).toBe(3);
    expect(parsed.winRate).toBe(0.3);
  });

  it("accepts zero-plays with winRate = 0 (winRate invariant)", () => {
    const parsed = classWinrateSchema.parse({
      plays: 0,
      wins: 0,
      winRate: 0,
    });
    expect(parsed.plays).toBe(0);
  });

  it("rejects wins > plays with the error attached to wins", () => {
    const result = classWinrateSchema.safeParse({
      plays: 0,
      wins: 1,
      winRate: 0,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const winsIssue = result.error.issues.find((i) => i.path[0] === "wins");
    expect(winsIssue).toBeDefined();
  });

  it("rejects wins > plays when plays is non-zero", () => {
    const result = classWinrateSchema.safeParse({
      plays: 2,
      wins: 5,
      winRate: 0,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const winsIssue = result.error.issues.find((i) => i.path[0] === "wins");
    expect(winsIssue).toBeDefined();
  });
});
