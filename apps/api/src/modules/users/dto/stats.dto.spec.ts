import {
  userSummarySchema,
  statsSchema,
  statsResponseSchema,
  UserSummaryDto,
  StatsDto,
  StatsResponseDto,
  classWinrateSchema,
  classStatsSchema,
  classStatsResponseSchema,
  ClassWinrateDto,
  ClassStatsDto,
  ClassStatsResponseDto,
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
        elo: 1200,
        rankTier: "SILVER" as const,
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
          elo: 1200,
          rankTier: "SILVER" as const,
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
          elo: 1200,
          rankTier: "SILVER" as const,
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
      dto.elo = 1200;
      dto.rankTier = "SILVER";
      dto.createdAt = "2026-08-01T00:00:00.000Z";
      expect(dto.id).toBe("u1");
      expect(dto.username).toBe("Alice");
      expect(dto.avatar).toBe("jellyfrog");
      expect(dto.role).toBe("GUEST");
      expect(dto.elo).toBe(1200);
      expect(dto.rankTier).toBe("SILVER");
      expect(dto.createdAt).toBe("2026-08-01T00:00:00.000Z");
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

  describe("classWinrateSchema", () => {
    const valid = { plays: 12, wins: 3, winRate: 0.25 };

    it("should validate a complete class winrate", () => {
      expect(classWinrateSchema.parse(valid)).toEqual(valid);
    });

    it("should accept zero plays with zero winRate", () => {
      expect(
        classWinrateSchema.parse({ plays: 0, wins: 0, winRate: 0 }),
      ).toEqual({
        plays: 0,
        wins: 0,
        winRate: 0,
      });
    });

    it("should throw when plays is 0 but winRate is nonzero", () => {
      // Cross-field invariant: a player who has never played a
      // match has no observed win rate, so winRate MUST be 0 (not
      // NaN, not 1). The schema enforces this via `.refine`.
      expect(() =>
        classWinrateSchema.parse({ plays: 0, wins: 0, winRate: 1 }),
      ).toThrow(ZodError);
    });

    it("should throw on negative plays", () => {
      expect(() =>
        classWinrateSchema.parse({ plays: -1, wins: 0, winRate: 0 }),
      ).toThrow(ZodError);
    });

    it("should throw on negative wins", () => {
      expect(() =>
        classWinrateSchema.parse({ plays: 1, wins: -1, winRate: 0 }),
      ).toThrow(ZodError);
    });

    it("should throw on winRate outside [0, 1]", () => {
      expect(() =>
        classWinrateSchema.parse({ plays: 1, wins: 0, winRate: -0.1 }),
      ).toThrow(ZodError);
      expect(() =>
        classWinrateSchema.parse({ plays: 1, wins: 0, winRate: 1.5 }),
      ).toThrow(ZodError);
    });

    it("should accept boundary values 0 and 1", () => {
      expect(
        classWinrateSchema.parse({ plays: 1, wins: 0, winRate: 0 }).winRate,
      ).toBe(0);
      expect(
        classWinrateSchema.parse({ plays: 1, wins: 1, winRate: 1 }).winRate,
      ).toBe(1);
    });
  });

  describe("classStatsSchema", () => {
    const valid = {
      classWinrate: {
        ATTACK: { plays: 12, wins: 3, winRate: 0.25 },
        DEFENSE: { plays: 9, wins: 2, winRate: 0.22 },
      },
      currentStreak: 7,
      cardsPlayed: 28,
    };

    it("should validate a complete class stats payload", () => {
      expect(classStatsSchema.parse(valid)).toEqual(valid);
    });

    it("should validate with empty classWinrate", () => {
      const input = { classWinrate: {}, currentStreak: 0, cardsPlayed: 0 };
      expect(classStatsSchema.parse(input)).toEqual(input);
    });

    it("should validate with only ATTACK class", () => {
      const input = {
        classWinrate: { ATTACK: { plays: 5, wins: 1, winRate: 0.2 } },
        currentStreak: 3,
        cardsPlayed: 10,
      };
      expect(classStatsSchema.parse(input)).toEqual(input);
    });

    it("should validate with only DEFENSE class", () => {
      const input = {
        classWinrate: { DEFENSE: { plays: 5, wins: 1, winRate: 0.2 } },
        currentStreak: 3,
        cardsPlayed: 10,
      };
      expect(classStatsSchema.parse(input)).toEqual(input);
    });

    it("should throw on negative currentStreak", () => {
      expect(() =>
        classStatsSchema.parse({ ...valid, currentStreak: -1 }),
      ).toThrow(ZodError);
    });

    it("should throw on negative cardsPlayed", () => {
      expect(() =>
        classStatsSchema.parse({ ...valid, cardsPlayed: -1 }),
      ).toThrow(ZodError);
    });
  });

  describe("classStatsResponseSchema", () => {
    it("should validate a complete response", () => {
      const input = {
        stats: {
          classWinrate: {
            ATTACK: { plays: 12, wins: 3, winRate: 0.25 },
          },
          currentStreak: 7,
          cardsPlayed: 28,
        },
      };
      expect(classStatsResponseSchema.parse(input)).toEqual(input);
    });

    it("should throw if stats is missing", () => {
      expect(() => classStatsResponseSchema.parse({})).toThrow(ZodError);
    });
  });

  describe("Class DTO classes", () => {
    it("ClassWinrateDto should instantiate and preserve properties", () => {
      const dto = new ClassWinrateDto();
      dto.plays = 12;
      dto.wins = 3;
      dto.winRate = 0.25;
      expect(dto.plays).toBe(12);
      expect(dto.wins).toBe(3);
      expect(dto.winRate).toBe(0.25);
    });

    it("ClassStatsDto should instantiate and preserve properties", () => {
      const dto = new ClassStatsDto();
      dto.classWinrate = {
        ATTACK: { plays: 12, wins: 3, winRate: 0.25 },
        DEFENSE: { plays: 9, wins: 2, winRate: 0.22 },
      };
      dto.currentStreak = 7;
      dto.cardsPlayed = 28;
      expect(dto.classWinrate.ATTACK?.plays).toBe(12);
      expect(dto.classWinrate.DEFENSE?.wins).toBe(2);
      expect(dto.currentStreak).toBe(7);
      expect(dto.cardsPlayed).toBe(28);
    });

    it("ClassStatsResponseDto should instantiate and nest ClassStatsDto", () => {
      const stats = new ClassStatsDto();
      stats.classWinrate = {};
      stats.currentStreak = 0;
      stats.cardsPlayed = 0;

      const response = new ClassStatsResponseDto();
      response.stats = stats;
      expect(response.stats).toBe(stats);
    });
  });
});
