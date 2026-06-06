import {
  userSummarySchema,
  statsSchema,
  statsResponseSchema,
  UserSummaryDto,
  StatsDto,
  StatsResponseDto,
} from "./stats.dto";
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";

describe("StatsDto & Schema", () => {
  describe("userSummarySchema", () => {
    it("should validate a complete user summary", () => {
      const input = {
        id: "ckl5g2x1y0000abcd1234efgh",
        username: "Zero_Cool",
        avatar: "jellyfrog",
        role: "GUEST",
      };
      expect(userSummarySchema.parse(input)).toEqual(input);
    });

    it("should accept the ADMIN role", () => {
      const input = {
        id: "u1",
        username: "root",
        avatar: "tux",
        role: "ADMIN",
      };
      expect(userSummarySchema.parse(input).role).toBe("ADMIN");
    });

    it("should throw if role is not GUEST or ADMIN", () => {
      expect(() =>
        userSummarySchema.parse({
          id: "u1",
          username: "x",
          avatar: "y",
          role: "MODERATOR",
        }),
      ).toThrow(ZodError);
    });

    it("should throw if any field is missing", () => {
      expect(() => userSummarySchema.parse({ id: "u1" })).toThrow(ZodError);
      expect(() =>
        userSummarySchema.parse({
          id: "u1",
          username: "x",
          avatar: "y",
        }),
      ).toThrow(ZodError);
    });
  });

  describe("statsSchema", () => {
    const validStats = {
      matchesPlayed: 42,
      wins: 8,
      totalScore: 12450,
      avgResponseMs: 580.5,
      accuracy: 0.74,
      winRate: 0.19,
      survivalRate: 0.62,
      totalCorrectAnswers: 235,
    };

    it("should validate a complete stats payload", () => {
      expect(statsSchema.parse(validStats)).toEqual(validStats);
    });

    it("should throw if any integer counter is negative", () => {
      expect(() =>
        statsSchema.parse({ ...validStats, matchesPlayed: -1 }),
      ).toThrow(ZodError);
      expect(() => statsSchema.parse({ ...validStats, wins: -1 })).toThrow(
        ZodError,
      );
      expect(() =>
        statsSchema.parse({ ...validStats, totalCorrectAnswers: -1 }),
      ).toThrow(ZodError);
    });

    it("should throw if accuracy is outside [0, 1]", () => {
      expect(() =>
        statsSchema.parse({ ...validStats, accuracy: -0.01 }),
      ).toThrow(ZodError);
      expect(() =>
        statsSchema.parse({ ...validStats, accuracy: 1.01 }),
      ).toThrow(ZodError);
    });

    it("should throw if winRate or survivalRate is outside [0, 1]", () => {
      expect(() => statsSchema.parse({ ...validStats, winRate: -0.1 })).toThrow(
        ZodError,
      );
      expect(() => statsSchema.parse({ ...validStats, winRate: 1.5 })).toThrow(
        ZodError,
      );
      expect(() =>
        statsSchema.parse({ ...validStats, survivalRate: -0.1 }),
      ).toThrow(ZodError);
      expect(() =>
        statsSchema.parse({ ...validStats, survivalRate: 2 }),
      ).toThrow(ZodError);
    });

    it("should throw if avgResponseMs is negative", () => {
      expect(() =>
        statsSchema.parse({ ...validStats, avgResponseMs: -1 }),
      ).toThrow(ZodError);
    });

    it("should accept boundary values 0 and 1 for rates", () => {
      expect(statsSchema.parse({ ...validStats, accuracy: 0 }).accuracy).toBe(
        0,
      );
      expect(statsSchema.parse({ ...validStats, accuracy: 1 }).accuracy).toBe(
        1,
      );
      expect(statsSchema.parse({ ...validStats, winRate: 0 }).winRate).toBe(0);
      expect(statsSchema.parse({ ...validStats, winRate: 1 }).winRate).toBe(1);
    });
  });

  describe("statsResponseSchema", () => {
    it("should validate a nested user + stats response", () => {
      const input = {
        user: {
          id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          role: "GUEST",
        },
        stats: {
          matchesPlayed: 0,
          wins: 0,
          totalScore: 0,
          avgResponseMs: 0,
          accuracy: 0,
          winRate: 0,
          survivalRate: 0,
          totalCorrectAnswers: 0,
        },
      };
      expect(statsResponseSchema.parse(input)).toEqual(input);
    });

    it("should throw if the nested user is invalid", () => {
      const input = {
        user: { id: "u1" },
        stats: {
          matchesPlayed: 0,
          wins: 0,
          totalScore: 0,
          avgResponseMs: 0,
          accuracy: 0,
          winRate: 0,
          survivalRate: 0,
          totalCorrectAnswers: 0,
        },
      };
      expect(() => statsResponseSchema.parse(input)).toThrow(ZodError);
    });

    it("should throw if the nested stats is invalid", () => {
      const input = {
        user: {
          id: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          role: "GUEST",
        },
        stats: { matchesPlayed: -1 },
      };
      expect(() => statsResponseSchema.parse(input)).toThrow(ZodError);
    });
  });

  describe("DTO classes", () => {
    it("UserSummaryDto should instantiate and preserve properties", () => {
      const dto = new UserSummaryDto();
      dto.id = "u1";
      dto.username = "Alice";
      dto.avatar = "jellyfrog";
      dto.role = "GUEST";
      expect(dto.id).toBe("u1");
      expect(dto.username).toBe("Alice");
      expect(dto.avatar).toBe("jellyfrog");
      expect(dto.role).toBe("GUEST");
    });

    it("StatsDto should instantiate and preserve properties", () => {
      const dto = new StatsDto();
      dto.matchesPlayed = 42;
      dto.wins = 8;
      dto.totalScore = 12450;
      dto.avgResponseMs = 580.5;
      dto.accuracy = 0.74;
      dto.winRate = 0.19;
      dto.survivalRate = 0.62;
      dto.totalCorrectAnswers = 235;
      expect(dto.matchesPlayed).toBe(42);
      expect(dto.wins).toBe(8);
      expect(dto.totalScore).toBe(12450);
      expect(dto.avgResponseMs).toBe(580.5);
      expect(dto.accuracy).toBe(0.74);
      expect(dto.winRate).toBe(0.19);
      expect(dto.survivalRate).toBe(0.62);
      expect(dto.totalCorrectAnswers).toBe(235);
    });

    it("StatsResponseDto should instantiate and preserve nested DTOs", () => {
      const user = new UserSummaryDto();
      user.id = "u1";
      user.username = "Alice";
      user.avatar = "jellyfrog";
      user.role = "GUEST";

      const stats = new StatsDto();
      stats.matchesPlayed = 1;
      stats.wins = 1;
      stats.totalScore = 100;
      stats.avgResponseMs = 500;
      stats.accuracy = 1;
      stats.winRate = 1;
      stats.survivalRate = 1;
      stats.totalCorrectAnswers = 1;

      const dto = new StatsResponseDto();
      dto.user = user;
      dto.stats = stats;
      expect(dto.user).toBe(user);
      expect(dto.stats).toBe(stats);
    });
  });
});
