import { describe, it, expect, vi, beforeEach } from "vitest";
import { BotService } from "./bot.service";
import type { PrismaService } from "../prisma/prisma.service";

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
        upsert: vi.fn().mockImplementation(({ create }) => ({
          id: `bot_${Math.random()}`,
          ...create,
        })),
      },
    };

    service = new BotService(mockPrisma as unknown as PrismaService);
  });

  it("fetches existing bots and creates new ones if needed", async () => {
    const bots = await service.ensureBotUsers(3, 1300);
    expect(bots.length).toBe(3);
    expect(mockPrisma.user.findMany).toHaveBeenCalled();
    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(2);
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
      expect(ans.responseTimeMs).toBeGreaterThanOrEqual(2000);
      expect(ans.responseTimeMs).toBeLessThanOrEqual(12000);
      expect(ans.submissionId).toMatch(/^bot_sub_/);
    }
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
