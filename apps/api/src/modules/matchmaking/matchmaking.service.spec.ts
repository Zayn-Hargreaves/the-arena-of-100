import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchmakingService } from "./matchmaking.service";
import type { MatchmakingQueueStore } from "./matchmaking-queue.store";
import type { PrismaService } from "../prisma/prisma.service";
import { MATCHMAKING_CONFIG } from "@arena/shared";

describe("MatchmakingService", () => {
  let service: MatchmakingService;
  let mockQueueStore: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockQueueStore = {
      addTicket: vi.fn().mockResolvedValue(undefined),
      removeTicket: vi.fn().mockResolvedValue(true),
      getTicket: vi.fn().mockResolvedValue(null),
      getQueueCount: vi.fn().mockResolvedValue(3),
    };

    mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ elo: 1400 }),
      },
    };

    service = new MatchmakingService(
      mockQueueStore as unknown as MatchmakingQueueStore,
      mockPrisma as unknown as PrismaService,
    );
  });

  it("joins queue with provided ELO", async () => {
    mockQueueStore.getTicket.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: "u1",
      username: "Alice",
      elo: 1500,
      socketId: "s1",
      joinedAt: Date.now(),
    });

    const status = await service.joinQueue(
      { id: "u1", username: "Alice", elo: 1500 },
      "s1",
      "SCIENCE",
    );

    expect(mockQueueStore.addTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        username: "Alice",
        elo: 1500,
        category: "SCIENCE",
      }),
    );
    expect(status.isQueued).toBe(true);
  });

  it("joins queue and looks up ELO from DB when missing", async () => {
    mockQueueStore.getTicket.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: "u1",
      username: "Alice",
      elo: 1400,
      socketId: "s1",
      joinedAt: Date.now(),
    });

    await service.joinQueue({ id: "u1", username: "Alice" }, "s1");

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { elo: true },
    });
    expect(mockQueueStore.addTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        elo: 1400,
      }),
    );
  });

  it("leaves queue successfully", async () => {
    const result = await service.leaveQueue("u1");
    expect(mockQueueStore.removeTicket).toHaveBeenCalledWith("u1", undefined);
    expect(result).toBe(true);
  });

  it("leaves queue with socketId verification", async () => {
    const result = await service.leaveQueue("u1", "s1");
    expect(mockQueueStore.removeTicket).toHaveBeenCalledWith("u1", "s1");
    expect(result).toBe(true);
  });

  it("returns unqueued status when ticket does not exist", async () => {
    mockQueueStore.getTicket.mockResolvedValue(null);
    mockQueueStore.getQueueCount.mockResolvedValue(5);

    const status = await service.getQueueStatus("u1");
    expect(status.isQueued).toBe(false);
    expect(status.queuedAt).toBeNull();
    expect(status.playersInQueue).toBe(5);
    expect(status.estimatedWaitSeconds).toBe(
      Math.floor(MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS / 1000),
    );
  });
});
