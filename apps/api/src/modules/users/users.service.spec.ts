import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { UsersService } from "./users.service";
import { PrismaService } from "../prisma/prisma.service";

const FINISHED = "FINISHED";

describe("UsersService", () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: any; update: any };
    matchPlayer: { groupBy: any; findMany: any };
    match: { count: any };
    $queryRaw: any;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn(), update: vi.fn() },
      matchPlayer: { groupBy: vi.fn(), findMany: vi.fn() },
      match: { count: vi.fn() },
      $queryRaw: vi.fn(),
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe("getMyStats", () => {
    const mockUser = {
      id: "u1",
      username: "Alice",
      avatar: "jellyfrog",
      role: Role.GUEST,
    };

    it("throws NotFoundException when user does not exist", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(service.getMyStats("u1")).rejects.toThrow(NotFoundException);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: { id: true, username: true, avatar: true, role: true },
      });
    });

    it("returns zeroed stats when user has no FINISHED matches", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { avg_response_ms: null, accuracy: null, total_correct: null },
        ])
        .mockResolvedValueOnce([{ survival_rate: null }]);

      const result = await service.getMyStats("u1");

      expect(result).toEqual({
        user: mockUser,
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
      });
    });

    it("aggregates matchesPlayed, wins and totalScore from FINISHED matches only", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([
        { matchId: "m1", _sum: { score: 149 } },
        { matchId: "m2", _sum: { score: 220 } },
        { matchId: "m3", _sum: { score: 50 } },
      ]);
      vi.mocked(prisma.match.count).mockResolvedValue(1);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { avg_response_ms: "1500.50", accuracy: "0.7500", total_correct: 15 },
        ])
        .mockResolvedValueOnce([{ survival_rate: "0.6667" }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.matchesPlayed).toBe(3);
      expect(result.stats.wins).toBe(1);
      expect(result.stats.totalScore).toBe(419);
      expect(result.stats.avgResponseMs).toBe(1500.5);
      expect(result.stats.accuracy).toBeCloseTo(0.75, 4);
      expect(result.stats.totalCorrectAnswers).toBe(15);
      expect(result.stats.winRate).toBeCloseTo(1 / 3, 4);
      expect(result.stats.survivalRate).toBeCloseTo(0.6667, 4);
    });

    it("queries MatchPlayer with FINISHED match filter", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { avg_response_ms: null, accuracy: null, total_correct: null },
        ])
        .mockResolvedValueOnce([{ survival_rate: null }]);

      await service.getMyStats("u1");

      const groupByCall = vi.mocked(prisma.matchPlayer.groupBy).mock
        .calls[0][0];
      expect(groupByCall.where).toEqual({
        userId: "u1",
        match: { status: FINISHED },
      });

      const countCall = vi.mocked(prisma.match.count).mock.calls[0][0];
      expect(countCall.where).toEqual({
        winnerId: "u1",
        status: FINISHED,
      });
    });

    it("converts BigInt total_correct to Number safely", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: "0",
            accuracy: "0",
            total_correct: 9007199254740993n, // > Number.MAX_SAFE_INTEGER
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: "0" }]);

      const result = await service.getMyStats("u1");

      // Number(9007199254740993n) loses precision, but conversion must not throw
      expect(typeof result.stats.totalCorrectAnswers).toBe("number");
    });

    it("treats non-finite numbers (Infinity, -Infinity, NaN) as 0", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: Number.POSITIVE_INFINITY,
            accuracy: Number.NaN,
            total_correct: 0,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: -0 }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(0);
      expect(result.stats.accuracy).toBe(0);
    });

    it("uses an object's toNumber() when present (Prisma Decimal-like)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      const decimalLike = { toNumber: () => 0.81 };
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: decimalLike,
            accuracy: decimalLike,
            total_correct: 7,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: decimalLike }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(0.81);
      expect(result.stats.accuracy).toBe(0.81);
      expect(result.stats.survivalRate).toBe(0.81);
    });

    it("uses an object's valueOf() when toNumber is absent", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      const valueOfOnly = { valueOf: () => 123 };
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: valueOfOnly,
            accuracy: valueOfOnly,
            total_correct: 0,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: valueOfOnly }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(123);
      expect(result.stats.accuracy).toBe(123);
      expect(result.stats.survivalRate).toBe(123);
    });

    it("falls back to Number(String(value)) for objects with neither toNumber nor valueOf", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      const opaque = { toString: () => "456" };
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: opaque,
            accuracy: opaque,
            total_correct: 0,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: opaque }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(456);
      expect(result.stats.accuracy).toBe(456);
      expect(result.stats.survivalRate).toBe(456);
    });
  });

  describe("getMyHistory", () => {
    it("returns empty result when user has no FINISHED matches", async () => {
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([]);

      const result = await service.getMyHistory("u1", { limit: 20 });

      expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
    });

    it("returns one page and sets hasMore=false when fewer rows than limit", async () => {
      const now = new Date("2026-05-30T10:00:00.000Z");
      const started = new Date("2026-05-30T09:55:00.000Z");
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp1",
          userId: "u1",
          matchId: "m1",
          score: 3200,
          match: {
            id: "m1",
            roomId: "r1",
            status: FINISHED,
            winnerId: "u1",
            startedAt: started,
            endedAt: now,
            createdAt: now,
            room: { category: "ALL" },
            _count: { players: 50 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { match_id: "m1", user_id: "u1", rank: 1 },
      ]);

      const result = await service.getMyHistory("u1", { limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toMatchObject({
        matchId: "m1",
        roomCategory: "ALL",
        playerCount: 50,
        rank: 1,
        score: 3200,
        status: "WON",
        durationSec: 300,
        playedAt: now.toISOString(),
      });
    });

    it("computes correct rank and status (ELIMINATED) when user is not the winner", async () => {
      const endedAt = new Date("2026-05-30T10:00:00.000Z");
      const startedAt = new Date("2026-05-30T09:55:00.000Z");
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp1",
          userId: "u1",
          matchId: "m1",
          score: 800,
          match: {
            id: "m1",
            roomId: "r1",
            status: FINISHED,
            winnerId: "u2",
            startedAt,
            endedAt,
            createdAt: endedAt,
            room: { category: "SCIENCE" },
            _count: { players: 3 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { match_id: "m1", user_id: "u1", rank: 3 },
      ]);

      const result = await service.getMyHistory("u1", { limit: 20 });

      expect(result.items[0].rank).toBe(3);
      expect(result.items[0].status).toBe("ELIMINATED");
      expect(result.items[0].roomCategory).toBe("SCIENCE");
    });

    it("supports cursor pagination: returns nextCursor and hasMore=true when more rows exist", async () => {
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp-last",
          userId: "u1",
          matchId: "m3",
          score: 100,
          match: {
            id: "m3",
            roomId: "r3",
            status: FINISHED,
            winnerId: null,
            startedAt: new Date("2026-05-28T10:00:00.000Z"),
            endedAt: new Date("2026-05-28T10:05:00.000Z"),
            createdAt: new Date("2026-05-28T10:00:00.000Z"),
            room: { category: "TECHNOLOGY" },
            _count: { players: 10 },
          },
        },
        {
          id: "mp-extra",
          userId: "u1",
          matchId: "m4",
          score: 200,
          match: {
            id: "m4",
            roomId: "r4",
            status: FINISHED,
            winnerId: "u1",
            startedAt: new Date("2026-05-27T10:00:00.000Z"),
            endedAt: new Date("2026-05-27T10:05:00.000Z"),
            createdAt: new Date("2026-05-27T10:00:00.000Z"),
            room: { category: "ALL" },
            _count: { players: 5 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { match_id: "m3", user_id: "u1", rank: 1 },
      ]);

      const result = await service.getMyHistory("u1", {
        limit: 1,
        cursor: "mp-prev",
      });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("mp-last");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].matchId).toBe("m3");
    });

    it("throws when rank lookup is unexpectedly missing", async () => {
      const endedAt = new Date("2026-05-30T10:00:00.000Z");
      const startedAt = new Date("2026-05-30T09:55:00.000Z");
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp1",
          userId: "u1",
          matchId: "m1",
          score: 800,
          match: {
            id: "m1",
            roomId: "r1",
            status: FINISHED,
            winnerId: "u2",
            startedAt,
            endedAt,
            createdAt: endedAt,
            room: { category: "SCIENCE" },
            _count: { players: 3 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

      await expect(service.getMyHistory("u1", { limit: 20 })).rejects.toThrow(
        /MATCH_HISTORY_RANK_MISSING:m1:u1/,
      );
    });

    it("applies cursor + skip 1 when cursor is provided", async () => {
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([]);

      await service.getMyHistory("u1", { limit: 10, cursor: "cklxxx" });

      const firstCall = vi.mocked(prisma.matchPlayer.findMany).mock.calls[0][0];
      expect(firstCall.take).toBe(11);
      expect(firstCall.cursor).toEqual({ id: "cklxxx" });
      expect(firstCall.skip).toBe(1);
    });
  });

  describe("updateMyAvatar", () => {
    it("updates user avatar and returns selected fields", async () => {
      const updated = {
        id: "u1",
        username: "Alice",
        avatar: "tux",
        role: Role.GUEST,
      };
      vi.mocked(prisma.user.update).mockResolvedValue(updated);

      const result = await service.updateMyAvatar("u1", "tux");

      expect(result).toEqual(updated);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { avatar: "tux" },
        select: { id: true, username: true, avatar: true, role: true },
      });
    });
  });
});
