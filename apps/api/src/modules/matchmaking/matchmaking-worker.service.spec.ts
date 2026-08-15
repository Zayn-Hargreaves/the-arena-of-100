import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
} from "vitest";
import type { Server } from "socket.io";
import { MatchmakingWorkerService } from "./matchmaking-worker.service";
import type {
  MatchmakingQueueStore,
  MatchmakingTicket,
} from "./matchmaking-queue.store";
import type { BotService } from "./bot.service";
import type { RoomService } from "../room/room.service";
import type { GameLoopService } from "../match/game-loop.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RedisService } from "../redis/redis.service";
import type { ClusterService } from "../cluster/cluster.service";
import { MATCHMAKING_CONFIG } from "@arena/shared";

describe("MatchmakingWorkerService", () => {
  let worker: MatchmakingWorkerService;
  let mockQueueStore: Mocked<
    Pick<
      MatchmakingQueueStore,
      "getAllTickets" | "atomicPopTickets" | "addTicket"
    >
  >;
  let mockBotService: Mocked<Pick<BotService, "ensureBotUsers">>;
  let mockRoomService: Mocked<Pick<RoomService, "createRoom">>;
  let mockGameLoopService: Mocked<Pick<GameLoopService, "forceStartRoomMatch">>;
  let mockPrisma: { roomPlayer: { create: ReturnType<typeof vi.fn> } };
  let mockRedis: Mocked<
    Pick<
      RedisService,
      "sadd" | "acquireLease" | "renewLease" | "releaseLease" | "incr"
    >
  >;
  let mockClusterService: Pick<ClusterService, "nodeId">;
  let mockEmit: ReturnType<typeof vi.fn>;
  let mockServer: Pick<Server, "to">;

  beforeEach(() => {
    mockQueueStore = {
      getAllTickets: vi.fn().mockResolvedValue([]),
      atomicPopTickets: vi.fn().mockImplementation((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({
            userId: id,
            username: `User_${id}`,
            elo: 1200,
            socketId: id === "u1" ? "s1" : id === "u2" ? "s2" : `socket_${id}`,
            joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000), // timed out
          })),
        ),
      ),
      addTicket: vi.fn().mockResolvedValue(true),
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
      acquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      incr: vi.fn().mockResolvedValue(1),
    };

    mockClusterService = {
      nodeId: "node-1",
    };

    mockEmit = vi.fn();
    mockServer = {
      to: vi.fn().mockReturnValue({
        emit: mockEmit,
      }),
    };

    worker = new MatchmakingWorkerService(
      mockQueueStore as unknown as MatchmakingQueueStore,
      mockBotService as unknown as BotService,
      mockRoomService as unknown as RoomService,
      mockGameLoopService as unknown as GameLoopService,
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as RedisService,
      mockClusterService as unknown as ClusterService,
    );

    worker.setServer(mockServer as unknown as Server);
  });

  afterEach(async () => {
    await worker.onModuleDestroy();
  });

  it("does nothing if queue is empty", async () => {
    mockQueueStore.getAllTickets.mockResolvedValueOnce([]);
    await worker.tick();
    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it("skips tick if leadership lease cannot be acquired", async () => {
    mockRedis.acquireLease.mockResolvedValueOnce(false);
    mockRedis.renewLease.mockResolvedValueOnce(false);

    await worker.tick();

    expect(mockQueueStore.getAllTickets).not.toHaveBeenCalled();
    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it("matches players after timeout and auto-fills bots", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000), // timeout > 60s
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 2000),
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

  it("matches single player after 1 minute timeout and auto-fills bots", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);

    await worker.tick();

    expect(mockQueueStore.atomicPopTickets).toHaveBeenCalledWith(["u1"]);
    expect(mockRoomService.createRoom).toHaveBeenCalledWith(
      "u1",
      "PUBLIC",
      100,
      15,
      "ALL",
    );
    expect(mockBotService.ensureBotUsers).toHaveBeenCalled();
    expect(mockServer.to).toHaveBeenCalledWith("s1");
  });

  it("restores tickets when atomicPopTickets returns fewer than MIN_PLAYERS_TO_MATCH", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);
    mockQueueStore.atomicPopTickets.mockResolvedValue([]);

    await worker.tick();

    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it("tracks successfully added human players when prisma.roomPlayer.create fails for second player", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 2000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);
    mockPrisma.roomPlayer.create.mockRejectedValueOnce(
      new Error("Foreign key violation"),
    );

    await worker.tick();

    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(mockServer.to).not.toHaveBeenCalledWith("s2");
    expect(mockGameLoopService.forceStartRoomMatch).toHaveBeenCalledWith(
      "room_123",
      mockServer,
    );
  });

  it("handles createRoom throwing without propagating from tick", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 2000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);
    mockRoomService.createRoom.mockRejectedValueOnce(new Error("DB error"));

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(mockQueueStore.addTicket).toHaveBeenCalledTimes(2);
  });

  it("does not re-enqueue tickets into queueStore if forceStartRoomMatch fails after room creation", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 2000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);
    mockGameLoopService.forceStartRoomMatch.mockRejectedValueOnce(
      new Error("Failed to start loop"),
    );

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(mockRoomService.createRoom).toHaveBeenCalledTimes(1);
    expect(mockQueueStore.addTicket).not.toHaveBeenCalled();
  });

  it("halts queue processing if leadership lease is lost before forming match", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 5000),
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt: Date.now() - (MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS + 2000),
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);
    // First call (initial tick acquire): succeeds
    mockRedis.acquireLease.mockResolvedValueOnce(true);
    // Second call (inside processQueue before match formation): fails to renew and fails to acquire
    mockRedis.renewLease.mockResolvedValueOnce(false);
    mockRedis.acquireLease.mockResolvedValueOnce(false);

    await worker.tick();

    expect(mockQueueStore.atomicPopTickets).not.toHaveBeenCalled();
    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });

  it("does not match tickets with different categories", async () => {
    const tickets: MatchmakingTicket[] = [
      {
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt:
          Date.now() - Math.floor(MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS / 12), // not timed out
        category: "SCIENCE",
      },
      {
        userId: "u2",
        username: "Bob",
        elo: 1250,
        socketId: "s2",
        joinedAt:
          Date.now() - Math.floor(MATCHMAKING_CONFIG.MAX_WAIT_TIME_MS / 15), // not timed out
        category: "HISTORY",
      },
    ];

    mockQueueStore.getAllTickets.mockResolvedValueOnce(tickets);

    await worker.tick();

    expect(mockRoomService.createRoom).not.toHaveBeenCalled();
  });
});
