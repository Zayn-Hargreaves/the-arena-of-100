import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RedisService } from "./redis.service";

vi.mock("ioredis", () => ({
  default: vi.fn(),
}));

type RedisClientMock = {
  on: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  sadd: ReturnType<typeof vi.fn>;
  srem: ReturnType<typeof vi.fn>;
  smembers: ReturnType<typeof vi.fn>;
  sismember: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
};

type ServiceInternals = {
  logger: Logger;
};

describe("RedisService", () => {
  let service: RedisService;
  let configService: { get: ReturnType<typeof vi.fn> };
  let client: RedisClientMock;
  let eventHandlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    eventHandlers = {};
    client = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
        return client;
      }),
      quit: vi.fn().mockResolvedValue("OK"),
      get: vi.fn(),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      sismember: vi.fn(),
      incr: vi.fn().mockResolvedValue(1),
      publish: vi.fn().mockResolvedValue(1),
      eval: vi.fn(),
    };
    vi.mocked(Redis).mockImplementation(() => client as unknown as Redis);

    configService = {
      get: vi.fn((key: string, defaultValue?: string) => {
        if (key === "REDIS_URL") return defaultValue;
        return undefined;
      }),
    };

    service = new RedisService(configService as unknown as ConfigService);
    (service as unknown as ServiceInternals).logger = new Logger(
      RedisService.name,
      false,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates the redis client with the default URL and no key prefix when config is missing", () => {
    expect(Redis).toHaveBeenCalledWith("redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: expect.any(Function),
    });

    const options = vi.mocked(Redis).mock.calls[0][1];
    expect(options?.retryStrategy?.(1)).toBe(50);
    expect(options?.retryStrategy?.(100)).toBe(2000);
    expect(options).not.toHaveProperty("keyPrefix");
  });

  it("passes through a configured key prefix when present", () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: string) => {
        if (key === "REDIS_URL") return "redis://cache.internal:6380";
        if (key === "REDIS_KEY_PREFIX") return "arena:";
        return defaultValue;
      },
    );

    new RedisService(configService as unknown as ConfigService);

    expect(Redis).toHaveBeenLastCalledWith("redis://cache.internal:6380", {
      keyPrefix: "arena:",
      maxRetriesPerRequest: 3,
      retryStrategy: expect.any(Function),
    });
  });

  it("registers connect and error handlers that log connection state", () => {
    const logSpy = vi.spyOn(
      (service as unknown as ServiceInternals).logger,
      "log",
    );
    const errorSpy = vi.spyOn(
      (service as unknown as ServiceInternals).logger,
      "error",
    );

    eventHandlers.connect?.();
    eventHandlers.error?.({ message: "boom" });

    expect(client.on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(logSpy).toHaveBeenCalledWith("✅ Redis connected");
    expect(errorSpy).toHaveBeenCalledWith("❌ Redis error:", "boom");
  });

  it("sets values with ttl when one is provided", async () => {
    await service.set("room:1", "ready", 60);

    expect(client.set).toHaveBeenCalledWith("room:1", "ready", "EX", 60);
  });

  it("sets values without ttl when none is provided", async () => {
    await service.set("room:1", "ready");

    expect(client.set).toHaveBeenCalledWith("room:1", "ready");
  });

  it("reads and writes JSON values through the string helpers", async () => {
    client.get.mockResolvedValueOnce('{"players":3,"status":"waiting"}');

    const data = await service.getJSON<{ players: number; status: string }>(
      "room:1",
    );
    await service.setJSON("room:1", { players: 3, status: "waiting" }, 30);

    expect(data).toEqual({ players: 3, status: "waiting" });
    expect(client.set).toHaveBeenCalledWith(
      "room:1",
      '{"players":3,"status":"waiting"}',
      "EX",
      30,
    );
  });

  it("returns null from getJSON when the key is absent", async () => {
    client.get.mockResolvedValueOnce(null);

    await expect(service.getJSON("missing")).resolves.toBeNull();
  });

  it("converts redis sismember responses into booleans", async () => {
    client.sismember.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.sismember("room:1", "u1")).resolves.toBe(true);
    await expect(service.sismember("room:1", "u2")).resolves.toBe(false);
  });

  it("passes key and member through to the underlying sismember call", async () => {
    client.sismember.mockResolvedValueOnce(1);

    await service.sismember("room:presence:r1", "u1");

    expect(client.sismember).toHaveBeenCalledWith("room:presence:r1", "u1");
  });

  it("converts redis exists responses into booleans", async () => {
    // `exists` is not in the default client mock — register it for this test
    (client as unknown as { exists: ReturnType<typeof vi.fn> }).exists = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(service.exists("room:presence:r1:u1")).resolves.toBe(true);
    await expect(service.exists("room:missing")).resolves.toBe(false);
  });

  it("publishes messages through the redis client", async () => {
    await expect(service.publish("room-events", "ready")).resolves.toBe(1);

    expect(client.publish).toHaveBeenCalledWith("room-events", "ready");
  });

  it("forwards sadd calls and returns the integer reply from the client", async () => {
    client.sadd.mockResolvedValueOnce(3);

    await expect(
      service.sadd("room:r1:players", "u1", "u2", "u3"),
    ).resolves.toBe(3);
    expect(client.sadd).toHaveBeenCalledWith(
      "room:r1:players",
      "u1",
      "u2",
      "u3",
    );
  });

  it("forwards srem calls and returns the integer reply from the client", async () => {
    client.srem.mockResolvedValueOnce(2);

    await expect(service.srem("room:r1:players", "u1", "u2")).resolves.toBe(2);
    expect(client.srem).toHaveBeenCalledWith("room:r1:players", "u1", "u2");
  });

  it("forwards incr calls and returns the new value", async () => {
    client.incr.mockResolvedValueOnce(42);

    await expect(service.incr("counter:foo")).resolves.toBe(42);
    expect(client.incr).toHaveBeenCalledWith("counter:foo");
  });

  it("forwards get calls and returns the raw string reply", async () => {
    client.get.mockResolvedValueOnce("cached-value");

    await expect(service.get("any:key")).resolves.toBe("cached-value");
    expect(client.get).toHaveBeenCalledWith("any:key");
  });

  it("forwards del calls", async () => {
    client.del.mockResolvedValueOnce(1);

    await service.del("any:key");

    expect(client.del).toHaveBeenCalledWith("any:key");
  });

  it("forwards smembers calls and returns the array of members", async () => {
    client.smembers.mockResolvedValueOnce(["u1", "u2", "u3"]);

    await expect(service.smembers("room:r1:players")).resolves.toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    expect(client.smembers).toHaveBeenCalledWith("room:r1:players");
  });

  it("executes lua scripts with key and arg counts", async () => {
    client.eval.mockResolvedValueOnce("OK");

    await expect(
      service.eval("return ARGV[1]", ["room:1", "room:2"], ["payload"]),
    ).resolves.toBe("OK");

    expect(client.eval).toHaveBeenCalledWith(
      "return ARGV[1]",
      2,
      "room:1",
      "room:2",
      "payload",
    );
  });

  it("quits the redis client when the module is destroyed", async () => {
    const logSpy = vi.spyOn(
      (service as unknown as ServiceInternals).logger,
      "log",
    );

    await service.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("🔌 Redis disconnected");
  });
});
