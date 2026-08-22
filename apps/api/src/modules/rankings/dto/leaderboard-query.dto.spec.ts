import {
  leaderboardPeriodSchema,
  leaderboardQuerySchema,
  LEADERBOARD_CACHE_TTL_SEC,
  LeaderboardQueryDto,
} from "./leaderboard-query.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("LeaderboardQueryDto & Schema", () => {
  describe("leaderboardPeriodSchema", () => {
    it("should accept 'weekly'", () => {
      expect(leaderboardPeriodSchema.parse("weekly")).toBe("weekly");
    });

    it("should accept 'all'", () => {
      expect(leaderboardPeriodSchema.parse("all")).toBe("all");
    });

    it("should reject unknown period values", () => {
      expect(() => leaderboardPeriodSchema.parse("monthly")).toThrow(ZodError);
      expect(() => leaderboardPeriodSchema.parse("")).toThrow(ZodError);
    });
  });

  describe("leaderboardQuerySchema", () => {
    it("should default period='weekly' and limit=50 when omitted", () => {
      const parsed = leaderboardQuerySchema.parse({});
      expect(parsed.period).toBe("weekly");
      expect(parsed.limit).toBe(50);
    });

    it("should accept explicit period and limit", () => {
      const input = { period: "all" as const, limit: 25 };
      expect(leaderboardQuerySchema.parse(input)).toEqual(input);
    });

    it("should coerce string limit to number", () => {
      const parsed = leaderboardQuerySchema.parse({ limit: "10" });
      expect(parsed.limit).toBe(10);
    });

    it("should throw if limit is not in allowed cache limits", () => {
      expect(() => leaderboardQuerySchema.parse({ limit: 0 })).toThrow(
        ZodError,
      );
      expect(() => leaderboardQuerySchema.parse({ limit: 1 })).toThrow(
        ZodError,
      );
      expect(() => leaderboardQuerySchema.parse({ limit: 42 })).toThrow(
        ZodError,
      );
      expect(() => leaderboardQuerySchema.parse({ limit: 101 })).toThrow(
        ZodError,
      );
    });

    it("should accept valid cache limits 10, 25, 50, and 100", () => {
      expect(leaderboardQuerySchema.parse({ limit: 10 }).limit).toBe(10);
      expect(leaderboardQuerySchema.parse({ limit: 25 }).limit).toBe(25);
      expect(leaderboardQuerySchema.parse({ limit: 50 }).limit).toBe(50);
      expect(leaderboardQuerySchema.parse({ limit: 100 }).limit).toBe(100);
    });

    it("should throw if period is not 'weekly' or 'all'", () => {
      expect(() => leaderboardQuerySchema.parse({ period: "monthly" })).toThrow(
        ZodError,
      );
    });

    it("should throw if limit is not coercible to a finite number", () => {
      expect(() => leaderboardQuerySchema.parse({ limit: "abc" })).toThrow(
        ZodError,
      );
    });
  });

  describe("LEADERBOARD_CACHE_TTL_SEC constant", () => {
    it("should be 60 (matches the 60-second cache-aside spec)", () => {
      expect(LEADERBOARD_CACHE_TTL_SEC).toBe(60);
    });
  });

  describe("LeaderboardQueryDto class", () => {
    it("should instantiate and preserve properties", () => {
      const dto = new LeaderboardQueryDto();
      dto.period = "all";
      dto.limit = 25;
      expect(dto.period).toBe("all");
      expect(dto.limit).toBe(25);
    });

    it("should allow period='weekly' assignment", () => {
      const dto = new LeaderboardQueryDto();
      dto.period = "weekly";
      expect(dto.period).toBe("weekly");
    });
  });
});
