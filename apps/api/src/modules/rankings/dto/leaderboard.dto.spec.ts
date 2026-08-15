import {
  leaderboardItemSchema,
  leaderboardResponseSchema,
  LeaderboardItemDto,
  LeaderboardResponseDto,
} from "./leaderboard.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("LeaderboardDto & Schema", () => {
  describe("leaderboardItemSchema", () => {
    const validItem = {
      rank: 1,
      userId: "ckl5g2x1y0000abcd1234efgh",
      username: "Zero_Cool",
      avatar: "jellyfrog",
      elo: 1350,
      rankTier: "SILVER" as const,
      wins: 8,
      matchesPlayed: 42,
      accuracy: 0.74,
      avgResponseMs: 580.5,
      totalScore: 12450,
    };

    it("should validate a complete leaderboard item", () => {
      expect(leaderboardItemSchema.parse(validItem)).toEqual(validItem);
    });

    it("should throw if rank is not a positive integer", () => {
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, rank: 0 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, rank: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, rank: 1.5 }),
      ).toThrow(ZodError);
    });

    it("should throw if wins or matchesPlayed is negative or non-integer", () => {
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, wins: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, matchesPlayed: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, wins: 1.5 }),
      ).toThrow(ZodError);
    });

    it("should throw if accuracy is outside [0, 1]", () => {
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, accuracy: -0.01 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, accuracy: 1.01 }),
      ).toThrow(ZodError);
    });

    it("should throw if totalScore is negative or non-integer", () => {
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, totalScore: -1 }),
      ).toThrow(ZodError);
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, totalScore: 1.5 }),
      ).toThrow(ZodError);
    });

    it("should throw if avgResponseMs is negative", () => {
      expect(() =>
        leaderboardItemSchema.parse({ ...validItem, avgResponseMs: -1 }),
      ).toThrow(ZodError);
    });

    it("should accept boundary values 0 and 1 for accuracy", () => {
      expect(
        leaderboardItemSchema.parse({ ...validItem, accuracy: 0 }).accuracy,
      ).toBe(0);
      expect(
        leaderboardItemSchema.parse({ ...validItem, accuracy: 1 }).accuracy,
      ).toBe(1);
    });
  });

  describe("leaderboardResponseSchema", () => {
    const validItem = {
      rank: 1,
      userId: "u1",
      username: "Alice",
      avatar: "jellyfrog",
      elo: 1200,
      rankTier: "SILVER" as const,
      wins: 5,
      matchesPlayed: 10,
      accuracy: 0.8,
      avgResponseMs: 500,
      totalScore: 1000,
    };

    it("should validate a response with items, period, generatedAt, and cached", () => {
      const input = {
        period: "weekly" as const,
        generatedAt: "2026-06-06T18:24:00.000Z",
        cached: false,
        items: [validItem],
      };
      expect(leaderboardResponseSchema.parse(input)).toEqual(input);
    });

    it("should accept an empty items array", () => {
      const input = {
        period: "all" as const,
        generatedAt: "2026-06-06T18:24:00.000Z",
        cached: true,
        items: [],
      };
      expect(leaderboardResponseSchema.parse(input)).toEqual(input);
    });

    it("should throw if period is not 'weekly' or 'all'", () => {
      expect(() =>
        leaderboardResponseSchema.parse({
          period: "monthly",
          generatedAt: "2026-06-06T18:24:00.000Z",
          cached: false,
          items: [],
        }),
      ).toThrow(ZodError);
    });

    it("should throw if cached is not boolean", () => {
      expect(() =>
        leaderboardResponseSchema.parse({
          period: "weekly",
          generatedAt: "2026-06-06T18:24:00.000Z",
          cached: "yes",
          items: [],
        }),
      ).toThrow(ZodError);
    });

    it("should throw if generatedAt is missing", () => {
      expect(() =>
        leaderboardResponseSchema.parse({
          period: "weekly",
          cached: false,
          items: [],
        }),
      ).toThrow(ZodError);
    });

    it("should throw if any item is invalid", () => {
      expect(() =>
        leaderboardResponseSchema.parse({
          period: "weekly",
          generatedAt: "2026-06-06T18:24:00.000Z",
          cached: false,
          items: [{ ...validItem, rank: 0 }],
        }),
      ).toThrow(ZodError);
    });
  });

  describe("DTO classes", () => {
    it("LeaderboardItemDto should instantiate and preserve properties", () => {
      const dto = new LeaderboardItemDto();
      dto.rank = 1;
      dto.userId = "u1";
      dto.username = "Alice";
      dto.avatar = "jellyfrog";
      dto.elo = 1350;
      dto.rankTier = "SILVER";
      dto.wins = 8;
      dto.matchesPlayed = 42;
      dto.accuracy = 0.74;
      dto.avgResponseMs = 580.5;
      dto.totalScore = 12450;
      expect(dto.rank).toBe(1);
      expect(dto.userId).toBe("u1");
      expect(dto.username).toBe("Alice");
      expect(dto.avatar).toBe("jellyfrog");
      expect(dto.elo).toBe(1350);
      expect(dto.rankTier).toBe("SILVER");
      expect(dto.wins).toBe(8);
      expect(dto.matchesPlayed).toBe(42);
      expect(dto.accuracy).toBe(0.74);
      expect(dto.avgResponseMs).toBe(580.5);
      expect(dto.totalScore).toBe(12450);
    });

    it("LeaderboardResponseDto should instantiate and preserve properties", () => {
      const dto = new LeaderboardResponseDto();
      dto.period = "weekly";
      dto.generatedAt = "2026-06-06T18:24:00.000Z";
      dto.cached = false;
      dto.items = [];
      expect(dto.period).toBe("weekly");
      expect(dto.generatedAt).toBe("2026-06-06T18:24:00.000Z");
      expect(dto.cached).toBe(false);
      expect(dto.items).toEqual([]);

      dto.cached = true;
      dto.period = "all";
      expect(dto.cached).toBe(true);
      expect(dto.period).toBe("all");
    });
  });
});
