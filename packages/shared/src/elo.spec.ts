import { describe, it, expect } from "vitest";
import {
  RANK_TIERS,
  getRankTier,
  getRankTierInfo,
  rankTierSchema,
} from "./elo";

describe("elo rank tiers and helpers", () => {
  it("defines GRANDMASTER as unbounded (maxElo = Infinity)", () => {
    const gm = RANK_TIERS.find((t) => t.tier === "GRANDMASTER");
    expect(gm).toBeDefined();
    expect(gm?.minElo).toBe(2200);
    expect(gm?.maxElo).toBe(Number.POSITIVE_INFINITY);
  });

  it("correctly maps ELO values to rank tiers across thresholds", () => {
    expect(getRankTier(-100)).toBe("BRONZE");
    expect(getRankTier(0)).toBe("BRONZE");
    expect(getRankTier(1199)).toBe("BRONZE");

    expect(getRankTier(1200)).toBe("SILVER");
    expect(getRankTier(1399)).toBe("SILVER");

    expect(getRankTier(1400)).toBe("GOLD");
    expect(getRankTier(1599)).toBe("GOLD");

    expect(getRankTier(1600)).toBe("PLATINUM");
    expect(getRankTier(1799)).toBe("PLATINUM");

    expect(getRankTier(1800)).toBe("DIAMOND");
    expect(getRankTier(1999)).toBe("DIAMOND");

    expect(getRankTier(2000)).toBe("MASTER");
    expect(getRankTier(2199)).toBe("MASTER");

    expect(getRankTier(2200)).toBe("GRANDMASTER");
    expect(getRankTier(3000)).toBe("GRANDMASTER");
    expect(getRankTier(9999)).toBe("GRANDMASTER");
    expect(getRankTier(50000)).toBe("GRANDMASTER");
  });

  it("handles non-finite and fractional numbers gracefully", () => {
    expect(getRankTier(NaN)).toBe("BRONZE");
    expect(getRankTier(Number.POSITIVE_INFINITY)).toBe("BRONZE");
    expect(getRankTier(1200.9)).toBe("SILVER");
    expect(getRankTier(2199.9)).toBe("MASTER");
    expect(getRankTier(2200.1)).toBe("GRANDMASTER");
  });

  it("retrieves RankTierInfo correctly", () => {
    const goldInfo = getRankTierInfo("GOLD");
    expect(goldInfo.tier).toBe("GOLD");
    expect(goldInfo.minElo).toBe(1400);
    expect(goldInfo.maxElo).toBe(1599);
    expect(goldInfo.badgeGlyph).toBe("🥇");

    const gmInfo = getRankTierInfo("GRANDMASTER");
    expect(gmInfo.tier).toBe("GRANDMASTER");
    expect(gmInfo.minElo).toBe(2200);
    expect(gmInfo.maxElo).toBe(Number.POSITIVE_INFINITY);
  });

  it("validates RankTier with zod schema", () => {
    expect(rankTierSchema.safeParse("GOLD").success).toBe(true);
    expect(rankTierSchema.safeParse("GRANDMASTER").success).toBe(true);
    expect(rankTierSchema.safeParse("INVALID").success).toBe(false);
  });
});
