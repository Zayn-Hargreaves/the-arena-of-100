import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatchmakingWorkerService } from "./matchmaking-worker.service";
import type { MatchmakingQueueStore } from "./matchmaking-queue.store";
import type { BotService } from "./bot.service";
import type { RoomService } from "../room/room.service";
import type { GameLoopService } from "../match/game-loop.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RedisService } from "../redis/redis.service";

describe("MatchmakingWorkerService", () => {
  let worker: MatchmakingWorkerService;
  let mockQueueStore: any;
  let mockBotService: any;
  let mockRoomService: any;
  let mockGameLoopService: any;
  let mockPrisma: any;
  let mockRedis: any;
  let mockServer: any;

  beforeEach(() => {
    mockQueueStore = {
      getAllTickets: vi.fn().mockResolvedValue([]),
      atomicPopTickets: vi.fn().mockImplementation((ids: string[]) =>
        ids.map((id) => ({
          userId: id,
          username: `User_${id}`,
          elo: 1200,
          socketId: id === "u1" ? "s1" : id === "u2" ? "s2" : `socket_${id}`,
          joinedAt: Date.now() - 35000, // 35s ago -> timed out
        })),
      ),
    };

    mockBotService = {
      ensureBotUsers: vi.fn().mockResolvedValue([
        { id: "bot_1", username: "Bot_1" },
        { id: "bot_2", username: "Bot_2" },
      ]),
    };

    mockRoomService = {
      createRoom: vi.fn().mockResolvedValue({
        id: "room_123",
        code: "ARENA1",
      }),
    };

    mockGameLoopService = {
      forceStartRoomMatch: vi.fn().mockResolvedValue({ id: "match_123" }),
    };

    mockPrisma = {
      roomPlayer: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockRedis = {
      sadd: vi.fn().mockResolvedValue(1),
    };

    mockServer = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
    };

    worker = new MatchmakingWorkerService(
      mockQueueStore as unknown as MatchmakingQueueStore,
      mockBotService as unknown as BotService,
      mockRoomService as unknown as RoomService,
      mockGameLoopService as unknown as GameLoopService,
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
    );

    worker.setServer(mockServer as any);
  });

  afterEach(() => {
    worker.onModuleDestroy();
  });

  it("does nothing if queue is empty", async () => {
    mockQueueStore.getAllTickets.mockResolvedValueOnce([]);
    await worker.tick();
    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it("matches players after timeout and auto-fills bots", async () => {
    const tickets = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - 32000, // 32s ago
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - 31000, // 31s ago
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);

    await worker.tick();

    expect(mockQueueStore.atomicPopTickets).toHaveBeenCalledWith(["u1", "u2"]);
    expect(mockRoomService.createRoom).toHaveBeenCalledWith(
      "u1",
      "PUBLIC",
      100,
      15,
      "ALL",
    );
    expect(mockBotService.ensureBotUsers).toHaveBeenCalled();
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(mockGameLoopService.forceStartRoomMatch).toHaveBeenCalledWith(
      "room_123",
      mockServer,
    );
  });
});
