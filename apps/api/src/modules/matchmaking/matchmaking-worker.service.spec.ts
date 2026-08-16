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
import { MATCHMAKING_CONFIG, ServerEvent } from "@arena/shared";

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
  let mockPrisma: {
    roomPlayer: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  let mockRedis: Mocked<
    Pick<
      RedisService,
      "sadd" | "srem" | "acquireLease" | "renewLease" | "releaseLease" | "incr"
    >
  >;
  let mockClusterService: Pick<ClusterService, "nodeId">;
  let socketEmitters: Map<string, { emit: ReturnType<typeof vi.fn> }>;
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
        findUnique: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    mockRedis = {
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      acquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      incr: vi.fn().mockResolvedValue(1),
    };

    mockClusterService = {
      nodeId: "node-1",
    };

    socketEmitters = new Map();
    mockServer = {
      to: vi.fn().mockImplementation((socketId: string) => {
        let emitter = socketEmitters.get(socketId);
        if (!emitter) {
          emitter = { emit: vi.fn() };
          socketEmitters.set(socketId, emitter);
        }
        return emitter;
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
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Failed to join matched room",
      }),
    );
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({
        roomId: "room_123",
      }),
    );
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

  it("proceeds with match notification and forceStartRoomMatch even if ensureBotUsers fails", async () => {
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
    mockBotService.ensureBotUsers.mockRejectedValueOnce(
      new Error("Bot creation failed"),
    );

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(mockRoomService.createRoom).toHaveBeenCalledTimes(1);
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({
        roomId: "room_123",
        roomCode: "ARENA1",
      }),
    );
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({
        roomId: "room_123",
        roomCode: "ARENA1",
      }),
    );
    expect(mockGameLoopService.forceStartRoomMatch).toHaveBeenCalledWith(
      "room_123",
      mockServer,
    );
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

  it("recovers player state and sends matched notification if RoomPlayer already exists", async () => {
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
    // Simulate roomPlayer.create failing (e.g. duplicate)
    mockPrisma.roomPlayer.create.mockRejectedValueOnce(
      new Error("Unique constraint"),
    );
    // But findUnique finds existing membership
    mockPrisma.roomPlayer.findUnique.mockResolvedValueOnce({
      id: "rp_2",
      roomId: "room_123",
      userId: "u2",
      joinedAt: new Date(),
    });

    await worker.tick();

    // Redis synchronized
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      expect.stringContaining("room_123"),
      "u2",
    );
    // Matched notification sent to both players
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({ roomId: "room_123" }),
    );
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({ roomId: "room_123" }),
    );
    expect(mockQueueStore.addTicket).not.toHaveBeenCalled();
  });

  it("re-enqueues ticket and emits ERROR event when RoomPlayer creation fails and membership does not exist", async () => {
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
    mockQueueStore.atomicPopTickets.mockResolvedValueOnce(tickets);
    // Simulate roomPlayer.create failing
    mockPrisma.roomPlayer.create.mockRejectedValueOnce(new Error("DB error"));
    // And membership does not exist
    mockPrisma.roomPlayer.findUnique.mockResolvedValueOnce(null);

    await worker.tick();

    // RoomPlayer cleanup in DB and Redis
    expect(mockPrisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
      where: {
        roomId: "room_123",
        userId: "u2",
      },
    });
    expect(mockRedis.srem).toHaveBeenCalledWith(
      expect.stringContaining("room_123"),
      "u2",
    );
    // Ticket re-enqueued for failed player
    expect(mockQueueStore.addTicket).toHaveBeenCalledWith(tickets[1]);
    // Error emitted to failed player's socket
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Failed to join matched room",
      }),
    );
    // Successful host still receives matched
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({ roomId: "room_123" }),
    );
  });

  it("re-enqueues ticket and emits ERROR event when roomPlayer.findUnique rejects during recovery", async () => {
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
    mockQueueStore.atomicPopTickets.mockResolvedValueOnce(tickets);
    // Simulate roomPlayer.create failing
    mockPrisma.roomPlayer.create.mockRejectedValueOnce(
      new Error("RoomPlayer create DB error"),
    );
    // And roomPlayer.findUnique also rejects (uncertain DB state)
    mockPrisma.roomPlayer.findUnique.mockRejectedValueOnce(
      new Error("RoomPlayer findUnique connection error"),
    );

    await worker.tick();

    // RoomPlayer cleanup in DB and Redis
    expect(mockPrisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
      where: {
        roomId: "room_123",
        userId: "u2",
      },
    });
    expect(mockRedis.srem).toHaveBeenCalledWith(
      expect.stringContaining("room_123"),
      "u2",
    );
    // Verify player is not lost from queue: ticket is re-enqueued
    expect(mockQueueStore.addTicket).toHaveBeenCalledWith(tickets[1]);
    // Error emitted to failed player's socket so client receives final outcome
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Failed to join matched room",
      }),
    );
    // Successful host still receives matched notification
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({ roomId: "room_123" }),
    );
  });

  it("skips re-enqueueing ticket when room player cleanup fails during recovery", async () => {
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
    mockQueueStore.atomicPopTickets.mockResolvedValueOnce(tickets);
    mockPrisma.roomPlayer.create.mockRejectedValueOnce(
      new Error("RoomPlayer create DB error"),
    );
    mockPrisma.roomPlayer.findUnique.mockResolvedValueOnce(null);
    mockPrisma.roomPlayer.deleteMany.mockRejectedValueOnce(
      new Error("Prisma deleteMany error"),
    );

    await worker.tick();

    // Re-enqueue skipped due to cleanup failure
    expect(mockQueueStore.addTicket).not.toHaveBeenCalled();
    // Error event still sent to client
    expect(mockServer.to).toHaveBeenCalledWith("s2");
    expect(socketEmitters.get("s2")?.emit).toHaveBeenCalledWith(
      ServerEvent.ERROR,
      expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Failed to join matched room",
      }),
    );
    // Successful host still receives matched notification
    expect(mockServer.to).toHaveBeenCalledWith("s1");
    expect(socketEmitters.get("s1")?.emit).toHaveBeenCalledWith(
      ServerEvent.MATCHMAKING_MATCHED,
      expect.objectContaining({ roomId: "room_123" }),
    );
  });
});
