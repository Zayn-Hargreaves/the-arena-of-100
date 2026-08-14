import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { UsersService } from "./users.service";
import { PrismaService } from "../prisma/prisma.service";

const FINISHED = "FINISHED";

// Phase 3 — pinned "now" so the dateKey boundary (UTC today /
// yesterday) is deterministic across test runs.
const NOW_MS = Date.UTC(2026, 7, 12, 12, 0, 0); // 2026-08-12T12:00:00Z
const TODAY_KEY = "2026-08-12";
const YESTERDAY_KEY = "2026-08-11";
const FIVE_DAYS_AGO_KEY = "2026-08-07";

describe("UsersService", () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: any; update: any };
    matchPlayer: { groupBy: any; findMany: any; aggregate: any };
    match: { count: any };
    dailyAttempt: { findFirst: any };
    $queryRaw: any;
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn(), update: vi.fn() },
      matchPlayer: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
        aggregate: vi.fn(),
      },
      match: { count: vi.fn() },
      dailyAttempt: { findFirst: vi.fn() },
      $queryRaw: vi.fn(),
    };
    service = new UsersService(prisma as unknown as PrismaService);
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
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

    it("uses fallback aggregate rows when raw queries return empty arrays", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

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
      const opaque = { valueOf: undefined, toString: () => "456" };
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

    it("returns 0 for primitive values outside number/string/bigint", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: true,
            accuracy: false,
            total_correct: 0,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: true }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(0);
      expect(result.stats.accuracy).toBe(0);
      expect(result.stats.survivalRate).toBe(0);
    });

    it("clamps BigInt below MIN_SAFE_INTEGER to MIN_SAFE_INTEGER", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: "0",
            accuracy: "0",
            total_correct: -9007199254740993n, // < Number.MIN_SAFE_INTEGER
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: "0" }]);

      const result = await service.getMyStats("u1");
      // Must round-trip without throwing; the negative BigInt clamps to MIN_SAFE_INTEGER.
      expect(typeof result.stats.totalCorrectAnswers).toBe("number");
      expect(result.stats.totalCorrectAnswers).toBe(Number.MIN_SAFE_INTEGER);
    });

    it("converts a BigInt inside the safe-integer range via Number()", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: "0",
            accuracy: "0",
            total_correct: 9007199254740992n, // exactly MAX_SAFE_INTEGER
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: "0" }]);

      const result = await service.getMyStats("u1");
      // Inside the safe-integer range → uses Number(value) (no clamp).
      expect(result.stats.totalCorrectAnswers).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("returns 0 for a plain object with no toNumber/valueOf/toString overrides", async () => {
      // A plain `{}` has no own toNumber/valueOf/toString. `Object.prototype.toString`
      // is the inherited toString — the fallback path must reject it and return 0.
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            avg_response_ms: {},
            accuracy: {},
            total_correct: 0,
          },
        ])
        .mockResolvedValueOnce([{ survival_rate: {} }]);

      const result = await service.getMyStats("u1");

      expect(result.stats.avgResponseMs).toBe(0);
      expect(result.stats.accuracy).toBe(0);
      expect(result.stats.survivalRate).toBe(0);
    });

    it("returns 0 when object fallback string is not numeric", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.matchPlayer.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      const opaque = { valueOf: undefined, toString: () => "not-a-number" };
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

      expect(result.stats.avgResponseMs).toBe(0);
      expect(result.stats.accuracy).toBe(0);
      expect(result.stats.survivalRate).toBe(0);
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

    it("marks abandoned matches, falls back playedAt to createdAt, and returns zero duration when endedAt is missing", async () => {
      const createdAt = new Date("2026-05-30T10:00:00.000Z");
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp1",
          userId: "u1",
          matchId: "m1",
          score: 450,
          match: {
            id: "m1",
            roomId: "r1",
            status: FINISHED,
            winnerId: null,
            startedAt: new Date("2026-05-30T09:55:00.000Z"),
            endedAt: null,
            createdAt,
            room: { category: "HISTORY" },
            _count: { players: 8 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { match_id: "m1", user_id: "u1", rank: 4 },
      ]);

      const result = await service.getMyHistory("u1", { limit: 20 });

      expect(result.items[0]).toMatchObject({
        matchId: "m1",
        playedAt: createdAt.toISOString(),
        roomCategory: "HISTORY",
        playerCount: 8,
        rank: 4,
        score: 450,
        status: "ABANDONED",
        durationSec: 0,
      });
    });

    it("returns zero duration when startedAt is missing", async () => {
      const endedAt = new Date("2026-05-30T10:00:00.000Z");
      vi.mocked(prisma.matchPlayer.findMany).mockResolvedValueOnce([
        {
          id: "mp1",
          userId: "u1",
          matchId: "m1",
          score: 900,
          match: {
            id: "m1",
            roomId: "r1",
            status: FINISHED,
            winnerId: "u1",
            startedAt: null,
            endedAt,
            createdAt: endedAt,
            room: { category: "ALL" },
            _count: { players: 25 },
          },
        },
      ]);
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { match_id: "m1", user_id: "u1", rank: 1 },
      ]);

      const result = await service.getMyHistory("u1", { limit: 20 });

      expect(result.items[0].durationSec).toBe(0);
      expect(result.items[0].playedAt).toBe(endedAt.toISOString());
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

  // class winrate + streak + cards played count
  describe("getClassStats", () => {
    const mockUser = { id: "u1" };

    it("throws NotFoundException when user does not exist", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      await expect(service.getClassStats("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns zeroed stats when user has no matches + no daily attempts", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: null },
      });

      const result = await service.getClassStats("u1");

      expect(result.stats.classWinrate).toEqual({});
      expect(result.stats.currentStreak).toBe(0);
      expect(result.stats.cardsPlayed).toBe(0);
    });

    it("aggregates per-class winrate + cards played from FINISHED matches", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { class_id: "ATTACK", plays: 10n, wins: 3n },
        { class_id: "DEFENSE", plays: 5n, wins: 2n },
      ]);
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue({
        streakAfter: 7,
        dateKey: TODAY_KEY,
      });
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: 28 },
      });

      const result = await service.getClassStats("u1");

      // Phase 3 — the cards played aggregate must be filtered by
      // match.status = FINISHED so the sum only includes finished
      // matches. This is the authoritative source-of-truth scope
      // (cardsPlayed is persisted at finishMatch, so pre-FINISHED
      // matches have no cardsPlayed row yet, but the filter is still
      // required for correctness after the match.status transition
      // is reverted).
      const aggregateCall = vi.mocked(prisma.matchPlayer.aggregate).mock
        .calls[0]?.[0];
      expect(aggregateCall?.where).toEqual({
        userId: "u1",
        match: { status: FINISHED },
      });
      expect(aggregateCall?._sum).toEqual({ cardsPlayed: true });

      // Phase 3 — the dailyAttempt query pins `dateKey` (UTC-today or
      // UTC-yesterday boundary) AND orders by `completedAt desc`. The
      // service uses both to gate `currentStreak` to active streaks.
      const findFirstCall = vi.mocked(prisma.dailyAttempt.findFirst).mock
        .calls[0]?.[0];
      expect(findFirstCall?.where).toEqual({ userId: "u1" });
      expect(findFirstCall?.orderBy).toEqual({ completedAt: "desc" });
      expect(findFirstCall?.select).toEqual({
        streakAfter: true,
        dateKey: true,
      });

      expect(result.stats.classWinrate.ATTACK).toEqual({
        plays: 10,
        wins: 3,
        winRate: 0.3,
      });
      expect(result.stats.classWinrate.DEFENSE).toEqual({
        plays: 5,
        wins: 2,
        winRate: 0.4,
      });
      expect(result.stats.currentStreak).toBe(7);
      expect(result.stats.cardsPlayed).toBe(28);
    });

    it("returns currentStreak from a daily attempt dated yesterday (boundary)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue({
        streakAfter: 4,
        dateKey: YESTERDAY_KEY,
      });
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: 0 },
      });

      const result = await service.getClassStats("u1");

      expect(result.stats.currentStreak).toBe(4);
    });

    it("returns currentStreak = 0 when the latest attempt is older than yesterday (stale streak)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
      // Most-recent attempt was 5 days ago — frozen streak should
      // NOT bleed through to the profile page (the user can re-start
      // tomorrow, the displayed streak reflects today only).
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue({
        streakAfter: 9,
        dateKey: FIVE_DAYS_AGO_KEY,
      });
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: 0 },
      });

      const result = await service.getClassStats("u1");

      expect(result.stats.currentStreak).toBe(0);
    });

    it("skips class rows whose class_id is not ATTACK or DEFENSE (defensive)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { class_id: "BOGUS", plays: 10n, wins: 5n },
      ]);
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: 0 },
      });

      const result = await service.getClassStats("u1");

      expect(result.stats.classWinrate).toEqual({});
    });

    it("treats zero plays as winRate = 0 (not NaN)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { class_id: "ATTACK", plays: 0n, wins: 0n },
      ]);
      vi.mocked(prisma.dailyAttempt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.matchPlayer.aggregate).mockResolvedValue({
        _sum: { cardsPlayed: 0 },
      });

      const result = await service.getClassStats("u1");

      expect(result.stats.classWinrate.ATTACK?.winRate).toBe(0);
      expect(
        Number.isFinite(result.stats.classWinrate.ATTACK?.winRate ?? NaN),
      ).toBe(true);
    });
  });
});
