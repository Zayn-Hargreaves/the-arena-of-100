import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotService } from "./bot.service";
import type { PrismaService } from "../prisma/prisma.service";
import { MATCHMAKING_CONFIG } from "@arena/shared";

describe("BotService", () => {
  let service: BotService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "b1", username: "Bot_1", guestId: "bot_1", elo: 1200 },
          ]),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: `bot_${Math.random()}`,
          ...data,
        })),
      },
    };

    service = new BotService(mockPrisma as unknown as PrismaService);
  });

  it("fetches existing bots and creates new ones if needed", async () => {
    const bots = await service.ensureBotUsers(3, 1300);
    expect(bots.length).toBe(3);
    expect(mockPrisma.user.findMany).toHaveBeenCalled();
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);
  });

  it("uses guestId as create key and excludes non-bot users", async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: "b1", username: "Bot_1", guestId: "bot_123", elo: 1200 },
    ]);

    const bots = await service.ensureBotUsers(2);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { guestId: { startsWith: "bot_" } },
      take: 2,
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guestId: expect.stringMatching(/^bot_/),
        }),
      }),
    );
    expect(bots.every((b) => b.guestId?.startsWith("bot_"))).toBe(true);
  });

  it("handles username collision by retrying with a different username", async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    const p2002UsernameErr = Object.assign(
      new Error("Unique constraint failed on the fields: (`username`)"),
      {
        code: "P2002",
        meta: { target: ["username"] },
      },
    );

    mockPrisma.user.create
      .mockRejectedValueOnce(p2002UsernameErr)
      .mockResolvedValueOnce({
        id: "bot_new",
        username: "Bot_Retry_999",
        guestId: "bot_unique_123",
        elo: 1200,
      });

    const bots = await service.ensureBotUsers(1);
    expect(bots).toHaveLength(1);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(2);

    const firstCallUsername =
      mockPrisma.user.create.mock.calls[0][0].data.username;
    const secondCallUsername =
      mockPrisma.user.create.mock.calls[1][0].data.username;
    expect(firstCallUsername).not.toBe(secondCallUsername);
  });

  it("immediately rethrows non-username collision errors without retrying", async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    const p2002OtherErr = Object.assign(
      new Error("Unique constraint failed on guestId"),
      {
        code: "P2002",
        meta: { target: ["guestId"] },
      },
    );
    mockPrisma.user.create.mockRejectedValueOnce(p2002OtherErr);

    await expect(service.ensureBotUsers(1)).rejects.toThrow(p2002OtherErr);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("falls back and returns created bots so far when attempts limit is reached", async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    const p2002UsernameErr = Object.assign(
      new Error("Unique constraint failed on username"),
      {
        code: "P2002",
        meta: { target: ["username"] },
      },
    );
    mockPrisma.user.create.mockRejectedValue(p2002UsernameErr);

    const bots = await service.ensureBotUsers(1);
    expect(bots).toEqual([]);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(3);
  });

  it("returns early when count is 0 or negative", async () => {
    const bots = await service.ensureBotUsers(0);
    expect(bots).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("simulates bot answers with realistic timings", () => {
    const question = {
      id: "q1",
      answer: "Paris",
      options: ["London", "Paris", "Berlin", "Rome"],
      difficulty: "EASY",
    };

    const botUserIds = ["b1", "b2", "b3", "b4", "b5"];
    const answers = service.simulateBotAnswers(question, botUserIds);

    expect(answers).toHaveLength(5);
    for (const ans of answers) {
      expect(question.options).toContain(ans.answer);
      expect(ans.responseTimeMs).toBeGreaterThanOrEqual(
        MATCHMAKING_CONFIG.MIN_BOT_ANSWER_DELAY_MS,
      );
      expect(ans.responseTimeMs).toBeLessThanOrEqual(
        MATCHMAKING_CONFIG.MAX_BOT_ANSWER_DELAY_MS,
      );
      expect(ans.submissionId).toMatch(/^bot_sub_/);
    }
  });

  it("throws when simulateBotAnswers receives a question missing both answer and correctAnswer", () => {
    const invalidQuestion = {
      id: "q_invalid",
      options: ["A", "B", "C", "D"],
    } as any;

    expect(() =>
      service.simulateBotAnswers(invalidQuestion, ["b1", "b2"]),
    ).toThrow(/simulateBotAnswers requires question to have a non-empty/);
  });

  describe("isBotName", () => {
    it("correctly identifies bot names using Set prefix check", async () => {
      const { isBotName } = await import("./bot.service");
      expect(isBotName("Bot_Pro_123")).toBe(true);
      expect(isBotName("AI_Master_999")).toBe(true);
      expect(isBotName("Thánh_Vip_456")).toBe(true);
      expect(isBotName("CaoThủ_King_789")).toBe(true);
      expect(isBotName("PhùThủy_Genius_101")).toBe(true);
      expect(isBotName("RealPlayer_99")).toBe(false);
      expect(isBotName("")).toBe(false);
      expect(isBotName(null)).toBe(false);
      expect(isBotName(undefined)).toBe(false);
    });
  });
});
