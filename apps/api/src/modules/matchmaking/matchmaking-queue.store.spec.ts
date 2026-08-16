import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MatchmakingQueueStore,
  MATCHMAKING_QUEUE_ZSET,
  MATCHMAKING_TICKET_PREFIX,
  type MatchmakingTicket,
} from "./matchmaking-queue.store";
import type { RedisService } from "../redis/redis.service";

describe("MatchmakingQueueStore", () => {
  let store: MatchmakingQueueStore;
  let mockPipeline: any;
  let mockClient: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPipeline = {
      set: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, "OK"],
        [null, 1],
      ]),
    };

    mockClient = {
      pipeline: vi.fn().mockReturnValue(mockPipeline),
      zcard: vi.fn().mockResolvedValue(5),
      zrange: vi.fn().mockResolvedValue(["u1", "u2"]),
      mget: vi.fn().mockResolvedValue([
        JSON.stringify({
          userId: "u1",
          username: "Alice",
          elo: 1200,
          socketId: "s1",
          joinedAt: 1000,
        }),
        JSON.stringify({
          userId: "u2",
          username: "Bob",
          elo: 1300,
          socketId: "s2",
          joinedAt: 2000,
        }),
      ]),
      zrem: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue([
        JSON.stringify({
          userId: "u1",
          username: "Alice",
          elo: 1200,
          socketId: "s1",
          joinedAt: 1000,
        }),
      ]),
    };

    mockRedis = {
      getClient: vi.fn().mockReturnValue(mockClient),
      getJSON: vi.fn().mockResolvedValue({
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: 1000,
      }),
    };

    store = new MatchmakingQueueStore(mockRedis as unknown as RedisService);
  });

  it("adds a ticket to Redis", async () => {
    const ticket: MatchmakingTicket = {
      userId: "u1",
      username: "Alice",
      elo: 1200,
      socketId: "s1",
      joinedAt: 1000,
    };

    await store.addTicket(ticket);
    expect(mockPipeline.set).toHaveBeenCalledWith(
      `${MATCHMAKING_TICKET_PREFIX}u1`,
      JSON.stringify(ticket),
      "EX",
      300,
    );
    expect(mockPipeline.zadd).toHaveBeenCalledWith(
      MATCHMAKING_QUEUE_ZSET,
      1200,
      "u1",
    );
    expect(mockPipeline.exec).toHaveBeenCalled();
  });

  it("throws and removes sorted-set member when SET command fails and ZADD succeeds", async () => {
    const cleanupPipeline = {
      del: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    mockClient.pipeline
      .mockReturnValueOnce(mockPipeline)
      .mockReturnValueOnce(cleanupPipeline);

    mockPipeline.exec.mockResolvedValueOnce([
      [new Error("SET failed"), null],
      [null, 1],
    ]);

    const ticket: MatchmakingTicket = {
      userId: "u1",
      username: "Alice",
      elo: 1200,
      socketId: "s1",
      joinedAt: 1000,
    };

    await expect(store.addTicket(ticket)).rejects.toThrow("SET failed");
    expect(cleanupPipeline.zrem).toHaveBeenCalledWith(
      MATCHMAKING_QUEUE_ZSET,
      "u1",
    );
    expect(cleanupPipeline.del).not.toHaveBeenCalled();
    expect(cleanupPipeline.exec).toHaveBeenCalled();
  });

  it("throws and deletes ticket key when SET command succeeds and ZADD fails", async () => {
    const cleanupPipeline = {
      del: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    };
    mockClient.pipeline
      .mockReturnValueOnce(mockPipeline)
      .mockReturnValueOnce(cleanupPipeline);

    mockPipeline.exec.mockResolvedValueOnce([
      [null, "OK"],
      [new Error("ZADD failed"), null],
    ]);

    const ticket: MatchmakingTicket = {
      userId: "u1",
      username: "Alice",
      elo: 1200,
      socketId: "s1",
      joinedAt: 1000,
    };

    await expect(store.addTicket(ticket)).rejects.toThrow("ZADD failed");
    expect(cleanupPipeline.del).toHaveBeenCalledWith(
      `${MATCHMAKING_TICKET_PREFIX}u1`,
    );
    expect(cleanupPipeline.zrem).not.toHaveBeenCalled();
    expect(cleanupPipeline.exec).toHaveBeenCalled();
  });

  it("throws without compensating cleanup when both SET and ZADD fail", async () => {
    const cleanupPipeline = {
      del: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    mockClient.pipeline
      .mockReturnValueOnce(mockPipeline)
      .mockReturnValueOnce(cleanupPipeline);

    mockPipeline.exec.mockResolvedValueOnce([
      [new Error("SET failed"), null],
      [new Error("ZADD failed"), null],
    ]);

    const ticket: MatchmakingTicket = {
      userId: "u1",
      username: "Alice",
      elo: 1200,
      socketId: "s1",
      joinedAt: 1000,
    };

    await expect(store.addTicket(ticket)).rejects.toThrow("SET failed");
    expect(cleanupPipeline.del).not.toHaveBeenCalled();
    expect(cleanupPipeline.zrem).not.toHaveBeenCalled();
  });

  it("handles cleanup execution errors gracefully and rethrows original error", async () => {
    const cleanupPipeline = {
      del: vi.fn().mockReturnThis(),
      zrem: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error("Cleanup pipeline failed")),
    };
    mockClient.pipeline
      .mockReturnValueOnce(mockPipeline)
      .mockReturnValueOnce(cleanupPipeline);

    mockPipeline.exec.mockResolvedValueOnce([
      [null, "OK"],
      [new Error("ZADD failed"), null],
    ]);

    const ticket: MatchmakingTicket = {
      userId: "u1",
      username: "Alice",
      elo: 1200,
      socketId: "s1",
      joinedAt: 1000,
    };

    await expect(store.addTicket(ticket)).rejects.toThrow("ZADD failed");
  });

  it("removes a ticket from Redis", async () => {
    const result = await store.removeTicket("u1");
    expect(mockPipeline.del).toHaveBeenCalledWith(
      `${MATCHMAKING_TICKET_PREFIX}u1`,
    );
    expect(mockPipeline.zrem).toHaveBeenCalledWith(
      MATCHMAKING_QUEUE_ZSET,
      "u1",
    );
    expect(result).toBe(true);
  });

  it("gets single ticket", async () => {
    const ticket = await store.getTicket("u1");
    expect(ticket?.userId).toBe("u1");
    expect(mockRedis.getJSON).toHaveBeenCalledWith(
      `${MATCHMAKING_TICKET_PREFIX}u1`,
    );
  });

  it("gets queue count", async () => {
    const count = await store.getQueueCount();
    expect(count).toBe(5);
    expect(mockClient.zcard).toHaveBeenCalledWith(MATCHMAKING_QUEUE_ZSET);
  });

  it("gets all tickets and prunes stale", async () => {
    mockClient.mget.mockResolvedValueOnce([
      JSON.stringify({ userId: "u1", username: "Alice", elo: 1200 }),
      null, // stale ticket
    ]);

    const tickets = await store.getAllTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0].userId).toBe("u1");
    expect(mockClient.zrem).toHaveBeenCalledWith(MATCHMAKING_QUEUE_ZSET, "u2");
  });

  it("atomically pops tickets via Lua script", async () => {
    const popped = await store.atomicPopTickets(["u1"]);
    expect(popped).toHaveLength(1);
    expect(popped[0].userId).toBe("u1");
    expect(mockClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      MATCHMAKING_QUEUE_ZSET,
      `${MATCHMAKING_TICKET_PREFIX}u1`,
      "u1",
    );
  });

  it("skips malformed JSON entries while retaining valid tickets", async () => {
    mockClient.eval.mockResolvedValueOnce([
      JSON.stringify({
        userId: "u1",
        username: "Alice",
        elo: 1200,
        socketId: "s1",
        joinedAt: 1000,
      }),
      "not-valid-json",
    ]);

    const popped = await store.atomicPopTickets(["u1", "u2"]);
    expect(popped).toHaveLength(1);
    expect(popped[0].userId).toBe("u1");
  });

  it("returns empty array when popping empty userIds", async () => {
    const popped = await store.atomicPopTickets([]);
    expect(popped).toEqual([]);
    expect(mockClient.eval).not.toHaveBeenCalled();
  });

  it("returns empty array when Lua script finds missing tickets", async () => {
    mockClient.eval.mockResolvedValueOnce([]);
    const popped = await store.atomicPopTickets(["u1", "u2"]);
    expect(popped).toEqual([]);
  });
});
