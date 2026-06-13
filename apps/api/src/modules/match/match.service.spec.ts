import { MatchService } from "./match.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { NotFoundException } from "@nestjs/common";
import { MatchStatus, PlayerStatus, ErrorCode } from "@arena/shared";

describe("MatchService", () => {
  let service: MatchService;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeEach(() => {
    prisma = {
      room: { findUnique: vi.fn(), update: vi.fn() },
      match: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      matchPlayer: {
        createMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matchRound: { create: vi.fn() },
      answer: { create: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(async (ops) => {
        // Execute all operations sequentially for test fidelity
        if (Array.isArray(ops)) {
          return Promise.all(ops);
        }
        return ops(prisma);
      }),
    } as unknown as PrismaService;
    redis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    } as unknown as RedisService;
    service = new MatchService(prisma, redis);
  });

  describe("createMatch", () => {
    it("creates match with state machine", async () => {
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "Alice" } },
          { user: { id: "u2", username: "Bob" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);

      const result = await service.createMatch("r1");

      expect(result.id).toBe("m1");
      expect(prisma.matchPlayer.createMany).toHaveBeenCalled();
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { currentMatchId: "m1", status: "STARTING" },
      });
      expect(redis.set).toHaveBeenCalled(); // persistStateMachine
    });

    it("throws NotFoundException when room not found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.createMatch("r1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("succeeds even when Redis persist fails", async () => {
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "Alice" } },
          { user: { id: "u2", username: "Bob" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(redis.set).mockRejectedValue(new Error("Redis down"));

      const result = await service.createMatch("r1");

      expect(result.id).toBe("m1");
    });

    it("throws RoomError when less than 2 players", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        players: [{ user: { id: "u1", username: "Alice" } }],
      } as any);
      await expect(service.createMatch("r1")).rejects.toMatchObject({
        code: ErrorCode.NOT_ENOUGH_PLAYERS,
      });
    });
  });

  describe("getStateMachine", () => {
    it("returns cached state machine", async () => {
      // First create a match to populate the cache
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      const sm = await service.getStateMachine("m1");
      expect(sm).toBeDefined();
      expect(sm!.getState().id).toBe("m1");
    });

    it("restores from Redis when not in memory", async () => {
      // Manually craft a valid serialized state machine JSON
      const serialized = JSON.stringify({
        state: {
          id: "m2",
          roomId: "r2",
          status: MatchStatus.CREATED,
          currentRoundNo: 0,
          totalRounds: 0,
          players: [
            [
              "u1",
              {
                id: "u1",
                name: "A",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
            [
              "u2",
              {
                id: "u2",
                name: "B",
                status: PlayerStatus.ACTIVE,
                score: 0,
                totalResponseTimeMs: 0,
                correctAnswers: 0,
                isOnline: true,
              },
            ],
          ],
          survivingPlayerIds: ["u1", "u2"],
          eliminatedPlayerIds: [],
          winnerId: null,
          startedAt: 0,
          endedAt: null,
        },
        currentRound: null,
        eventLog: [],
      });
      vi.mocked(redis.get).mockResolvedValue(serialized);

      const sm = await service.getStateMachine("m2");
      expect(sm).toBeDefined();
      expect(sm!.getState().id).toBe("m2");
    });

    it("returns undefined when not in memory or Redis", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      const sm = await service.getStateMachine("nonexistent");
      expect(sm).toBeUndefined();
    });

    it("returns undefined and cleans up on corrupted Redis data", async () => {
      vi.mocked(redis.get).mockResolvedValue("invalid json{{{");
      const sm = await service.getStateMachine("bad");
      expect(sm).toBeUndefined();
      expect(redis.del).toHaveBeenCalledWith("match:state:bad");
    });
  });

  describe("persistStateMachine", () => {
    it("does nothing when machine not found", async () => {
      await service.persistStateMachine("nonexistent");
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe("getMatch", () => {
    it("returns match when found", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue({ id: "m1" } as any);
      const result = await service.getMatch("m1");
      expect(result.id).toBe("m1");
    });

    it("throws NotFoundException when not found", async () => {
      vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
      await expect(service.getMatch("m1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("finishMatch", () => {
    it("updates match, room, cleans up state machine and Redis", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      vi.mocked(prisma.match.update).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);

      await service.finishMatch("m1", "u1");

      expect(prisma.match.update).toHaveBeenCalledWith({
        where: { id: "m1" },
        data: {
          status: MatchStatus.FINISHED,
          winnerId: "u1",
          endedAt: expect.any(Date),
        },
      });
      expect(redis.del).toHaveBeenCalledWith("match:state:m1");
    });

    it("records null winner for admin termination and skips score persistence", async () => {
      // Create match first to populate stateMachines map
      const room = {
        id: "r1",
        players: [
          { user: { id: "u1", username: "A" } },
          { user: { id: "u2", username: "B" } },
        ],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      await service.createMatch("r1");

      vi.mocked(prisma.match.update).mockResolvedValue({
        id: "m1",
        roomId: "r1",
      } as any);

      // Admin termination path: winnerId === null
      await service.finishMatch("m1", null);

      // Match update records null winner
      expect(prisma.match.update).toHaveBeenCalledWith({
        where: { id: "m1" },
        data: {
          status: MatchStatus.FINISHED,
          winnerId: null,
          endedAt: expect.any(Date),
        },
      });
      // Room status still updated
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { status: "FINISHED" },
      });
      // Redis state cleaned
      expect(redis.del).toHaveBeenCalledWith("match:state:m1");
      // No score persistence ($transaction NOT called for null-winner path)
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.matchPlayer.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("saveRound", () => {
    it("creates match round record", async () => {
      vi.mocked(prisma.matchRound.create).mockResolvedValue({
        id: "round1",
      } as any);
      await service.saveRound("m1", 1, "q1");
      expect(prisma.matchRound.create).toHaveBeenCalledWith({
        data: { matchId: "m1", roundNo: 1, questionId: "q1" },
      });
    });
  });

  describe("saveAnswer", () => {
    it("creates answer record", async () => {
      vi.mocked(prisma.answer.create).mockResolvedValue({ id: "a1" } as any);
      await service.saveAnswer("m1", "round1", "u1", "A", true, 500);
      expect(prisma.answer.create).toHaveBeenCalledWith({
        data: {
          matchId: "m1",
          roundId: "round1",
          userId: "u1",
          answer: "A",
          isCorrect: true,
          responseTimeMs: 500,
        },
      });
    });
  });

  describe("saveAnswers", () => {
    it("creates multiple answer records in a batch", async () => {
      vi.mocked(prisma.answer.createMany).mockResolvedValue({
        count: 2,
      } as any);
      const answers = [
        {
          matchId: "m1",
          roundId: "round1",
          userId: "u1",
          answer: "A",
          isCorrect: true,
          responseTimeMs: 500,
        },
        {
          matchId: "m1",
          roundId: "round1",
          userId: "u2",
          answer: "B",
          isCorrect: false,
          responseTimeMs: 800,
        },
      ];
      const result = await service.saveAnswers(answers);
      expect(result.count).toBe(2);
      expect(prisma.answer.createMany).toHaveBeenCalledWith({
        data: answers,
      });
    });

    it("returns count 0 and does not call prisma when answers is empty", async () => {
      const result = await service.saveAnswers([]);
      expect(result.count).toBe(0);
      expect(prisma.answer.createMany).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // B2: finishMatch persists accumulated scores to DB
  // ============================================================
  describe("finishMatch (B2 — score persistence)", () => {
    /**
     * Run a round where each player answers with the given correctness and responseTime.
     * Uses the public state machine API to actually accumulate scores.
     * `roundIndex` 0 = first round (transitions CREATED → COUNTDOWN → ROUND_ACTIVE).
     * Subsequent rounds transition ROUND_RESULT → ROUND_ACTIVE.
     */
    const playRound = async (
      matchId: string,
      answers: Array<{
        playerId: string;
        answer: string;
        isCorrect: boolean;
        responseTimeMs: number;
      }>,
      roundIndex = 0,
    ) => {
      const sm = await service.getStateMachine(matchId);
      if (!sm) throw new Error("State machine not found");

      if (roundIndex === 0) {
        sm.transition(MatchStatus.COUNTDOWN);
      }
      sm.transition(MatchStatus.ROUND_ACTIVE);
      const round = sm.startRound({
        id: `q-${matchId}-${roundIndex}`,
        content: "?",
        options: ["A", "B"],
        correctAnswer: "A",
      });
      for (const a of answers) {
        try {
          sm.submitAnswer(
            a.playerId,
            a.answer,
            round.startedAt + a.responseTimeMs,
          );
        } catch {
          // ignore - might already be eliminated
        }
      }
      sm.transition(MatchStatus.ROUND_EVALUATING);
      sm.evaluateRound();
      sm.transition(MatchStatus.ROUND_RESULT);
    };

    const setupMatch = async (
      matchId: string,
      roomId: string,
      playerIds: string[],
    ) => {
      const room = {
        id: roomId,
        players: playerIds.map((id, i) => ({
          user: { id, username: `User${i + 1}` },
        })),
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);
      vi.mocked(prisma.match.create).mockResolvedValue({
        id: matchId,
        roomId,
      } as any);
      vi.mocked(prisma.matchPlayer.createMany).mockResolvedValue({
        count: playerIds.length,
      } as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(prisma.match.update).mockResolvedValue({
        id: matchId,
        roomId,
      } as any);

      await service.createMatch(roomId);
    };

    it("persists accumulated scores to match_players for all players", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct fast (200ms → 149pts), u2 correct slow (8000ms → 100pts)
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "A", isCorrect: true, responseTimeMs: 8000 },
      ]);

      await service.finishMatch("m1", "u1");

      // Verify $transaction was invoked with an array of 2 updateMany operations
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(2);

      // Inspect each updateMany call's args to verify scores
      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u1Call).toBeDefined();
      expect(u2Call).toBeDefined();
      // u1: rt=200 → (10000-200)/200 = 49 → total=149
      expect(u1Call![0].where.matchId).toBe("m1");
      expect(u1Call![0].data.score).toBe(149);
      // u2: rt=8000 → (10000-8000)/200 = 10 → total=110
      expect(u2Call![0].data.score).toBe(110);
    });

    it("skips score persistence when state machine is no longer in memory", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Manually evict state machine (simulating failure scenario)
      const internalMap = (service as any).stateMachines as Map<
        string,
        unknown
      >;
      expect(internalMap.has("m1")).toBe(true);
      internalMap.delete("m1");

      await service.finishMatch("m1", "u1");

      // Should NOT throw, should still update match+room
      expect(prisma.match.update).toHaveBeenCalled();
      // Should NOT have called $transaction for score persistence
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // updateMany should not have been called
      expect(prisma.matchPlayer.updateMany).not.toHaveBeenCalled();
    });

    it("persists score 0 for players who never answered correctly", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct, u2 wrong
      await playRound("m1", [
        { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
        { playerId: "u2", answer: "B", isCorrect: false, responseTimeMs: 500 },
      ]);

      await service.finishMatch("m1", "u1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      expect(u2Call).toBeDefined();
      expect(u2Call![0].data.score).toBe(0);
    });

    it("continues to update match and room status even if score persistence fails", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Make $transaction fail
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Error("DB transaction failed"),
      );

      // Should NOT throw — score persistence failure is logged but non-fatal
      await expect(service.finishMatch("m1", "u1")).resolves.toBeDefined();

      // Match and room updates should still have happened
      expect(prisma.match.update).toHaveBeenCalled();
    });

    it("accumulates score across multiple rounds correctly", async () => {
      await setupMatch("m1", "r1", ["u1", "u2"]);

      // Round 1: u1 correct fast (200ms → 149pts), u2 correct slow (4000ms → 130pts)
      await playRound(
        "m1",
        [
          { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
          {
            playerId: "u2",
            answer: "A",
            isCorrect: true,
            responseTimeMs: 4000,
          },
        ],
        0,
      );
      // Round 2: u1 correct fast again (200ms → 149pts), u2 wrong (eliminated)
      await playRound(
        "m1",
        [
          { playerId: "u1", answer: "A", isCorrect: true, responseTimeMs: 200 },
          // u2 already eliminated, can't submit
        ],
        1,
      );

      await service.finishMatch("m1", "u1");

      const updateManyCalls = vi.mocked(prisma.matchPlayer.updateMany).mock
        .calls as any[][];
      const u1Call = updateManyCalls.find((c) => c[0].where.userId === "u1");
      const u2Call = updateManyCalls.find((c) => c[0].where.userId === "u2");
      // u1: 149 + 149 = 298
      expect(u1Call![0].data.score).toBe(298);
      // u2: only round 1 correct = 130
      expect(u2Call![0].data.score).toBe(130);
    });
  });
});
