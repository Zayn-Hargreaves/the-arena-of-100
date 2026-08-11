import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RedisService } from "./redis.service";

vi.mock("ioredis", () => ({
  default: vi.fn(),
}));

type SubscriberMock = {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  /** Also used as the blocking-reader connection from client.duplicate(). */
  xreadgroup: ReturnType<typeof vi.fn>;
  emit: (channel: string, message: string) => void;
};

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
  exists: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
  time: ReturnType<typeof vi.fn>;
  duplicate: ReturnType<typeof vi.fn>;
  xadd: ReturnType<typeof vi.fn>;
  xreadgroup: ReturnType<typeof vi.fn>;
  xack: ReturnType<typeof vi.fn>;
  xdel: ReturnType<typeof vi.fn>;
  xgroup: ReturnType<typeof vi.fn>;
  xautoclaim: ReturnType<typeof vi.fn>;
  xpending: ReturnType<typeof vi.fn>;
  xclaim: ReturnType<typeof vi.fn>;
};

// Build a controllable subscriber connection (what client.duplicate() returns).
// `emit` invokes the registered "message" dispatch listener so tests can drive
// pub/sub delivery without a real Redis.
function makeSubscriber(): SubscriberMock {
  let messageListener: ((ch: string, msg: string) => void) | undefined;
  const sub: SubscriberMock = {
    on: vi.fn((event: string, handler: (ch: string, msg: string) => void) => {
      if (event === "message") messageListener = handler;
      return sub;
    }),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    quit: vi.fn().mockResolvedValue("OK"),
    // Also used as the blocking-reader connection from client.duplicate().
    xreadgroup: vi.fn().mockResolvedValue(null),
    emit: (channel: string, message: string) =>
      messageListener?.(channel, message),
  };
  return sub;
}

type ServiceInternals = {
  logger: Logger;
};

describe("RedisService", () => {
  let service: RedisService;
  let configService: { get: ReturnType<typeof vi.fn> };
  let client: RedisClientMock;
  let subscriber: SubscriberMock;
  let eventHandlers: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    eventHandlers = {};
    subscriber = makeSubscriber();
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
      exists: vi.fn(),
      incr: vi.fn().mockResolvedValue(1),
      publish: vi.fn().mockResolvedValue(1),
      eval: vi.fn(),
      time: vi.fn().mockResolvedValue(["1000", "500000"]),
      duplicate: vi.fn(() => subscriber as unknown as Redis),
      xadd: vi.fn().mockResolvedValue("1-0"),
      xreadgroup: vi.fn().mockResolvedValue(null),
      xack: vi.fn().mockResolvedValue(1),
      xdel: vi.fn().mockResolvedValue(1),
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", [], []]),
      xpending: vi.fn().mockResolvedValue([0, null, null, null]),
      xclaim: vi.fn().mockResolvedValue([]),
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
      { timestamp: false },
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

    const options = (vi.mocked(Redis).mock.calls as any)[0][1];
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

  it("exposes the underlying redis client and uses NX writes for setIfAbsent", async () => {
    client.set
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null as unknown as "OK");

    expect(service.getClient()).toBe(client);
    await expect(service.setIfAbsent("room:1", "ready", 60)).resolves.toBe(
      true,
    );
    await expect(service.setIfAbsent("room:2", "ready")).resolves.toBe(false);

    expect(client.set).toHaveBeenNthCalledWith(
      1,
      "room:1",
      "ready",
      "EX",
      60,
      "NX",
    );
    expect(client.set).toHaveBeenNthCalledWith(2, "room:2", "ready", "NX");
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
    client.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

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

  // ============================================================
  // B0 — distributed lease primitives
  // ============================================================
  describe("lease primitives (B0)", () => {
    it("acquireLease creates via SET NX EX (true first, false while held)", async () => {
      client.set
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null as unknown as "OK");

      await expect(
        service.acquireLease("match:owner:m1", "node-a:1", 15),
      ).resolves.toBe(true);
      await expect(
        service.acquireLease("match:owner:m1", "node-b:2", 15),
      ).resolves.toBe(false);

      expect(client.set).toHaveBeenNthCalledWith(
        1,
        "match:owner:m1",
        "node-a:1",
        "EX",
        15,
        "NX",
      );
    });

    it("renewLease returns true and PEXPIREs in ms when the value matches", async () => {
      client.eval.mockResolvedValueOnce(1);

      await expect(
        service.renewLease("match:owner:m1", "node-a:1", 15),
      ).resolves.toBe(true);

      const [script, keyCount, key, expected, ttlMs] = client.eval.mock
        .calls[0] as unknown[];
      expect(script).toContain("PEXPIRE");
      expect(keyCount).toBe(1);
      expect(key).toBe("match:owner:m1");
      expect(expected).toBe("node-a:1");
      expect(ttlMs).toBe("15000"); // seconds → ms
    });

    it("renewLease returns false when the stored value differs (does not extend)", async () => {
      client.eval.mockResolvedValueOnce(0);

      await expect(
        service.renewLease("match:owner:m1", "node-a:1", 15),
      ).resolves.toBe(false);
    });

    it("releaseLease deletes only when the value matches", async () => {
      client.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(
        service.releaseLease("match:owner:m1", "node-a:1"),
      ).resolves.toBe(true);
      await expect(
        service.releaseLease("match:owner:m1", "node-b:2"),
      ).resolves.toBe(false);

      const [script] = client.eval.mock.calls[0] as unknown[];
      expect(script).toContain("DEL");
    });

    it("acquireLeaseWithFence returns {fence, leaseValue} on first acquisition", async () => {
      client.eval.mockResolvedValueOnce(["7", "node-a:7"]);

      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-a",
          15,
        ),
      ).resolves.toEqual({ fence: 7, leaseValue: "node-a:7" });

      const [script, keyCount, ownerKey, fenceKey, nodeId, ttl] = client.eval
        .mock.calls[0] as unknown[];
      expect(script).toContain("INCR");
      expect(keyCount).toBe(2);
      expect(ownerKey).toBe("match:owner:m1");
      expect(fenceKey).toBe("match:fence:m1");
      expect(nodeId).toBe("node-a");
      expect(ttl).toBe("15");
    });

    it("acquireLeaseWithFence returns null while a lease is held (fence not advanced)", async () => {
      client.eval.mockResolvedValueOnce(null);

      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-b",
          15,
        ),
      ).resolves.toBeNull();
    });

    it("acquireLeaseWithFence throws on a truncated payload (lease may already be written)", async () => {
      // Lua incremented the fence and SET the lease, but the reply was
      // truncated to ["1"]. Collapsing this to null would lose a real lease.
      client.eval.mockResolvedValueOnce(["1"]);

      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-a",
          15,
        ),
      ).rejects.toThrow(/malformed/);
    });

    it("acquireLeaseWithFence throws when leaseValue is inconsistent with nodeId:fence", async () => {
      client.eval.mockResolvedValueOnce(["7", "someone-else:7"]);

      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-a",
          15,
        ),
      ).rejects.toThrow(/inconsistent/);
    });

    it("acquireLeaseWithFence returns null when Lua replies undefined (live-owner path)", async () => {
      client.eval.mockResolvedValueOnce(undefined);

      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-b",
          15,
        ),
      ).resolves.toBeNull();
    });

    it("acquireLeaseWithFence throws when fence is non-positive or non-integer", async () => {
      client.eval.mockResolvedValueOnce(["0", "node-a:0"]);
      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-a",
          15,
        ),
      ).rejects.toThrow(/inconsistent/);

      client.eval.mockResolvedValueOnce(["1.5", "node-a:1.5"]);
      await expect(
        service.acquireLeaseWithFence(
          "match:owner:m1",
          "match:fence:m1",
          "node-a",
          15,
        ),
      ).rejects.toThrow(/inconsistent/);
    });

    it("releaseLeaseAndIndex maps APPLIED-style Lua (1) to true", async () => {
      client.eval.mockResolvedValueOnce(1);
      await expect(
        service.releaseLeaseAndIndex(
          "match:owner:m1",
          "node-a:1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe(true);
      const [script, keyCount] = client.eval.mock.calls[0] as unknown[];
      expect(script).toContain("SREM");
      expect(keyCount).toBe(2);
    });

    it("releaseLeaseAndIndex maps Lua 0 to false (ownership already moved)", async () => {
      client.eval.mockResolvedValueOnce(0);
      await expect(
        service.releaseLeaseAndIndex(
          "match:owner:m1",
          "node-a:1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe(false);
    });

    it("fencedStateSet passes owner/fence/state/revision keys and maps outcome", async () => {
      client.eval.mockResolvedValueOnce("APPLIED");
      await expect(
        service.fencedStateSet(
          "match:owner:m1",
          "match:fence:m1",
          "match:state:m1",
          "match:state-revision:m1",
          {
            leaseValue: "node-a:3",
            expectedFence: 3,
            blob: "{}",
            ttlSec: 86400,
            expectedRevision: 0,
            nextRevision: 1,
          },
        ),
      ).resolves.toBe("APPLIED");

      const [script, keyCount, k1, k2, k3, k4, lease, fence] = client.eval.mock
        .calls[0] as unknown[];
      expect(keyCount).toBe(4);
      expect([k1, k2, k3, k4]).toEqual([
        "match:owner:m1",
        "match:fence:m1",
        "match:state:m1",
        "match:state-revision:m1",
      ]);
      expect(lease).toBe("node-a:3");
      expect(fence).toBe("3");
      expect(script).toContain("APPLIED");
    });

    it("fencedStateSet returns RETRY on an explicit RETRY reply", async () => {
      client.eval.mockResolvedValueOnce("RETRY");
      await expect(
        service.fencedStateSet("o", "f", "s", "r", {
          leaseValue: "n:1",
          expectedFence: 1,
          blob: "{}",
          ttlSec: 10,
          expectedRevision: 0,
          nextRevision: 1,
        }),
      ).resolves.toBe("RETRY");
    });

    it("fencedStateSet throws on a contract-violating (non APPLIED/RETRY) Lua reply", async () => {
      // The script returns exactly "APPLIED" or "RETRY". Anything else is a
      // contract violation and must NOT be silently collapsed to a CAS miss.
      client.eval.mockResolvedValueOnce("UNEXPECTED");
      await expect(
        service.fencedStateSet("o", "f", "s", "r", {
          leaseValue: "n:1",
          expectedFence: 1,
          blob: "{}",
          ttlSec: 10,
          expectedRevision: 0,
          nextRevision: 1,
        }),
      ).rejects.toThrow();
    });

    it("fencedStateDelete deletes state+revision only when owner+fence still match", async () => {
      client.eval.mockResolvedValueOnce(1);
      await expect(
        service.fencedStateDelete("o", "f", "s", "r", {
          leaseValue: "n:3",
          expectedFence: 3,
        }),
      ).resolves.toBe(true);

      client.eval.mockResolvedValueOnce(0);
      await expect(
        service.fencedStateDelete("o", "f", "s", "r", {
          leaseValue: "n:3",
          expectedFence: 3,
        }),
      ).resolves.toBe(false);
    });

    it("serverTimeMs converts redis TIME [sec, micros] to epoch ms", async () => {
      client.time.mockResolvedValueOnce(["1000", "500000"]);
      // 1000s * 1000 + 500000micros/1000 = 1_000_500
      await expect(service.serverTimeMs()).resolves.toBe(1_000_500);
    });
  });

  // ============================================================
  // B0 — pub/sub subscribe machinery
  // ============================================================
  describe("stream wrappers (B4a)", () => {
    it("xadd appends with MAXLEN ~ and returns the id", async () => {
      client.xadd.mockResolvedValueOnce("5-0");
      await expect(service.xadd("match:cmd:m1", "{}")).resolves.toBe("5-0");
      const args = client.xadd.mock.calls[0] as unknown[];
      expect(args[0]).toBe("match:cmd:m1");
      expect(args).toContain("MAXLEN");
      expect(args).toContain("~");
      expect(args).toContain("*");
      expect(args).toContain("data");
    });

    it("xreadgroup uses a dedicated duplicate() connection, not the shared client", async () => {
      subscriber.xreadgroup.mockResolvedValueOnce([
        [
          "match:cmd:m1",
          [
            ["1-0", ["data", '{"a":1}']],
            ["2-0", ["data", '{"b":2}']],
          ],
        ],
      ]);
      const entries = await service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m1",
        16,
        1000,
      );
      expect(client.duplicate).toHaveBeenCalled();
      expect(subscriber.xreadgroup).toHaveBeenCalled();
      expect(client.xreadgroup).not.toHaveBeenCalled();
      expect(entries).toEqual([
        { id: "1-0", data: '{"a":1}' },
        { id: "2-0", data: '{"b":2}' },
      ]);
    });

    it("xreadgroup reuses a pooled blocking-reader connection across sequential calls", async () => {
      subscriber.xreadgroup.mockResolvedValue(null);
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);
      // Sequential: first call mints, second reuses from the pool.
      expect(client.duplicate).toHaveBeenCalledTimes(1);
      expect(subscriber.xreadgroup).toHaveBeenCalledTimes(2);
    });

    it("xreadgroup allocates distinct readers for concurrent in-flight polls", async () => {
      // Two overlapping xreadgroup calls must not share one blocked socket.
      let resolveFirst: (v: null) => void;
      const firstBlocked = new Promise<null>((r) => {
        resolveFirst = r;
      });
      const readerA = {
        xreadgroup: vi.fn().mockReturnValueOnce(firstBlocked),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      const readerB = {
        xreadgroup: vi.fn().mockResolvedValueOnce(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate
        .mockReturnValueOnce(readerA as unknown as Redis)
        .mockReturnValueOnce(readerB as unknown as Redis);

      const p1 = service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m1",
        16,
        1000,
      );
      // Let p1 acquire its reader before p2 starts.
      await Promise.resolve();
      const p2 = service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m2",
        16,
        1000,
      );
      await p2;
      resolveFirst!(null);
      await p1;

      expect(client.duplicate).toHaveBeenCalledTimes(2);
      expect(readerA.xreadgroup).toHaveBeenCalledTimes(1);
      expect(readerB.xreadgroup).toHaveBeenCalledTimes(1);
    });

    it("xreadgroup attaches a log-only error listener on each minted reader", async () => {
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );
      const reader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);

      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);

      // minted reader gets an error listener before being added to in-use.
      const errorCall = (reader.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === "error",
      );
      expect(errorCall).toBeDefined();
      // Invoking the listener with an error must log it (no throw, no unhandled).
      errorCall![1](new Error("mid-block socket error"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("blocking reader error"),
      );
    });

    it("xreadgroup NOGROUP on minted reader returns [] and discards the reader (no re-pool)", async () => {
      const reader = {
        xreadgroup: vi
          .fn()
          .mockRejectedValueOnce(
            new Error(
              "NOGROUP No such key 'match:cmd:m1' or consumer group 'owners'",
            ),
          ),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);

      // Failure/retry signal to the caller: empty entries (matches pollOnce
      // soft-fail contract).
      await expect(
        service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000),
      ).resolves.toEqual([]);

      // Rejected reader is removed from the in-use pool and never re-pooled.
      const inUse = (service as unknown as { blockingReadersInUse: Set<Redis> })
        .blockingReadersInUse;
      const pool = (service as unknown as { blockingReaderPool: Redis[] })
        .blockingReaderPool;
      expect(inUse.has(reader as unknown as Redis)).toBe(false);
      expect(pool).not.toContain(reader as unknown as Redis);
      expect(reader.disconnect).toHaveBeenCalled();

      // A subsequent xreadgroup must mint a fresh reader instead of reusing
      // the discarded one.
      const freshReader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(freshReader as unknown as Redis);
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);
      expect(client.duplicate).toHaveBeenCalledTimes(2);
    });

    it("xreadgroup does not mint a 17th reader while 16 are in use; waits for release", async () => {
      const max = 16;
      const resolvers: Array<(v: null) => void> = [];
      const readers = Array.from({ length: max }, (_, i) => {
        let resolveBlocked: (v: null) => void;
        const blocked = new Promise<null>((r) => {
          resolveBlocked = r;
        });
        resolvers.push((v) => resolveBlocked!(v));
        return {
          xreadgroup: vi
            .fn()
            .mockImplementationOnce(() => blocked)
            // Second call (handoff to waiting 17th poll) resolves immediately.
            .mockResolvedValueOnce(null),
          quit: vi.fn().mockResolvedValue("OK"),
          disconnect: vi.fn(),
          on: vi.fn(),
          id: i,
        };
      });
      for (const r of readers) {
        client.duplicate.mockReturnValueOnce(r as unknown as Redis);
      }

      const inFlight = readers.map((_, i) =>
        service.xreadgroup("owners", "node-a", `match:cmd:m${i}`, 16, 1000),
      );
      // Drain microtasks so all 16 acquire paths complete.
      for (let i = 0; i < max + 2; i++) await Promise.resolve();

      expect(client.duplicate).toHaveBeenCalledTimes(max);

      // 17th poll must wait — no extra duplicate until a reader is released.
      const p17 = service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m17",
        16,
        1000,
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();

      expect(client.duplicate).toHaveBeenCalledTimes(max);

      // Free one in-use reader; the waiter reuses it (still no 17th mint).
      resolvers[0]!(null);
      await inFlight[0];
      await p17;

      expect(client.duplicate).toHaveBeenCalledTimes(max);
      expect(readers[0]!.xreadgroup).toHaveBeenCalledTimes(2);

      for (let i = 1; i < max; i++) resolvers[i]!(null);
      await Promise.all(inFlight.slice(1));
    });

    it("onModuleDestroy closes in-use blocking readers mid-poll and does not re-pool", async () => {
      let resolveBlocked: (v: null) => void;
      const blocked = new Promise<null>((r) => {
        resolveBlocked = r;
      });
      const reader = {
        xreadgroup: vi.fn().mockReturnValueOnce(blocked),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);

      const poll = service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m1",
        16,
        1000,
      );
      await Promise.resolve();
      expect(reader.xreadgroup).toHaveBeenCalledTimes(1);

      await service.onModuleDestroy();

      expect(reader.disconnect).toHaveBeenCalled();
      // Settle the blocked read so the poll's finally/release path runs.
      resolveBlocked!(null);
      await poll;

      // Release after shutdown must not push the reader back into the idle pool.
      const pool = (service as unknown as { blockingReaderPool: Redis[] })
        .blockingReaderPool;
      expect(pool).toHaveLength(0);
    });

    it("xreadgroup short-circuits to [] when the signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort();
      const entries = await service.xreadgroup(
        "owners",
        "node-a",
        "match:cmd:m1",
        16,
        1000,
        ac.signal,
      );
      expect(entries).toEqual([]);
      expect(client.xreadgroup).not.toHaveBeenCalled();
      expect(subscriber.xreadgroup).not.toHaveBeenCalled();
    });

    it("xreadgroup returns [] on a null reply (no new entries)", async () => {
      subscriber.xreadgroup.mockResolvedValueOnce(null);
      await expect(
        service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000),
      ).resolves.toEqual([]);
    });

    it("xack acks only when ids are present", async () => {
      await expect(service.xack("s", "g")).resolves.toBe(0);
      expect(client.xack).not.toHaveBeenCalled();
      client.xack.mockResolvedValueOnce(2);
      await expect(service.xack("s", "g", "1-0", "2-0")).resolves.toBe(2);
      expect(client.xack).toHaveBeenCalledWith("s", "g", "1-0", "2-0");
    });

    it("xgroupCreate swallows BUSYGROUP (idempotent) but rethrows other errors", async () => {
      client.xgroup.mockRejectedValueOnce(
        new Error("BUSYGROUP Consumer Group name already exists"),
      );
      await expect(
        service.xgroupCreate("s", "g", { mkStream: true }),
      ).resolves.toBeUndefined();

      client.xgroup.mockRejectedValueOnce(new Error("boom"));
      await expect(service.xgroupCreate("s", "g")).rejects.toThrow("boom");
    });

    it("xdelStream deletes the whole stream via DEL", async () => {
      client.del.mockResolvedValueOnce(1);
      await expect(service.xdelStream("match:cmd:m1")).resolves.toBeUndefined();
      expect(client.del).toHaveBeenCalledWith("match:cmd:m1");
    });

    it("xdelStream propagates DEL failures", async () => {
      client.del.mockRejectedValueOnce(new Error("boom"));
      await expect(service.xdelStream("match:cmd:m1")).rejects.toThrow("boom");
    });

    it("xautoclaim returns { nextCursor, claimed } and terminates the loop at 0-0", async () => {
      client.xautoclaim.mockResolvedValueOnce([
        "0-0",
        [["9-0", ["data", '{"x":1}']]],
        [],
      ]);
      const { nextCursor, claimed } = await service.xautoclaim(
        "s",
        "g",
        "node-b",
        30000,
        "0-0",
        16,
      );
      expect(nextCursor).toBe("0-0");
      expect(claimed).toEqual([{ id: "9-0", data: '{"x":1}' }]);
    });

    it("xpending returns count + min/max ids + per-consumer counts", async () => {
      client.xpending.mockResolvedValueOnce([
        3,
        "1-0",
        "3-0",
        [["node-a", "3"]],
      ]);
      await expect(service.xpending("s", "g")).resolves.toEqual({
        count: 3,
        minId: "1-0",
        maxId: "3-0",
        consumers: [{ consumer: "node-a", count: 3 }],
      });
    });

    it("xpendingDetail reports idle ms + deliveries per entry", async () => {
      client.xpending.mockResolvedValueOnce([["1-0", "node-a", 45000, 2]]);
      const detail = await service.xpendingDetail("s", "g", {
        count: 10,
        minIdleMs: 30000,
      });
      expect(detail).toEqual([
        { id: "1-0", consumer: "node-a", idleMs: 45000, deliveryCount: 2 },
      ]);
      const args = client.xpending.mock.calls[0] as unknown[];
      expect(args).toContain("IDLE");
    });

    it("xclaim transfers requested ids and returns the claimed entries", async () => {
      client.xclaim.mockResolvedValueOnce([["1-0", ["data", "{}"]]]);
      const claimed = await service.xclaim("s", "g", "node-b", 30000, "1-0");
      expect(claimed).toEqual([{ id: "1-0", data: "{}" }]);
      expect(client.xclaim).toHaveBeenCalledWith(
        "s",
        "g",
        "node-b",
        30000,
        "1-0",
      );
      // No ids → no call.
      client.xclaim.mockClear();
      await expect(service.xclaim("s", "g", "node-b", 30000)).resolves.toEqual(
        [],
      );
      expect(client.xclaim).not.toHaveBeenCalled();
    });
  });

  describe("failover recovery primitives (B3b)", () => {
    it("acquireMatchLease returns { fence, leaseValue } and passes the tombstone key as KEYS[3]", async () => {
      client.eval.mockResolvedValueOnce(["3", "node-a:3"]);

      await expect(
        service.acquireMatchLease(
          "match:owner:m1",
          "match:fence:m1",
          "match:tombstone:m1",
          "node-a",
          15,
        ),
      ).resolves.toEqual({ fence: 3, leaseValue: "node-a:3" });

      const [script, keyCount, k1, k2, k3] = client.eval.mock
        .calls[0] as unknown[];
      expect(script).toContain("EXISTS");
      expect(keyCount).toBe(3);
      expect(k1).toBe("match:owner:m1");
      expect(k2).toBe("match:fence:m1");
      expect(k3).toBe("match:tombstone:m1");
    });

    it("acquireMatchLease maps 'TOMBSTONED' → 'TERMINAL' (distinct from the live-owner null)", async () => {
      client.eval.mockResolvedValueOnce("TOMBSTONED");
      await expect(
        service.acquireMatchLease("o", "f", "t", "node-a", 15),
      ).resolves.toBe("TERMINAL");

      client.eval.mockResolvedValueOnce(null);
      await expect(
        service.acquireMatchLease("o", "f", "t", "node-a", 15),
      ).resolves.toBeNull();
    });

    it("acquireMatchLease throws on a malformed non-nil payload (lease may have been written)", async () => {
      client.eval.mockResolvedValueOnce(["oops"]);
      await expect(
        service.acquireMatchLease("o", "f", "t", "node-a", 15),
      ).rejects.toThrow(/malformed Lua payload/);
    });

    it("removeActiveIfStateAbsent returns REMOVED / PRESENT", async () => {
      client.eval.mockResolvedValueOnce("REMOVED");
      await expect(
        service.removeActiveIfStateAbsent(
          "match:state:m1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe("REMOVED");

      client.eval.mockResolvedValueOnce("PRESENT");
      await expect(
        service.removeActiveIfStateAbsent(
          "match:state:m1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe("PRESENT");
    });

    it("removeIndexMemberIfValueUnchanged conditionally removes the indexed member", async () => {
      client.eval.mockResolvedValueOnce("REMOVED");
      await expect(
        service.removeIndexMemberIfValueUnchanged(
          "node:clock:a",
          "node:clocks",
          "a",
          null,
        ),
      ).resolves.toBe("REMOVED");

      const [script, keyCount, valueKey, indexKey, member, observedMissing] =
        client.eval.mock.calls[0] as unknown[];
      expect(script).toContain("redis.call('GET', KEYS[1])");
      expect(script).toContain("redis.call('SREM', KEYS[2], ARGV[1])");
      expect(keyCount).toBe(2);
      expect(valueKey).toBe("node:clock:a");
      expect(indexKey).toBe("node:clocks");
      expect(member).toBe("a");
      expect(observedMissing).toBe("1");

      client.eval.mockResolvedValueOnce("CHANGED");
      await expect(
        service.removeIndexMemberIfValueUnchanged(
          "node:clock:a",
          "node:clocks",
          "a",
          "7",
        ),
      ).resolves.toBe("CHANGED");
      expect(client.eval).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        2,
        "node:clock:a",
        "node:clocks",
        "a",
        "0",
        "7",
      );
    });

    it("removeActiveIfTombstoned returns REMOVED / ABSENT", async () => {
      client.eval.mockResolvedValueOnce("REMOVED");
      await expect(
        service.removeActiveIfTombstoned(
          "match:tombstone:m1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe("REMOVED");

      client.eval.mockResolvedValueOnce("ABSENT");
      await expect(
        service.removeActiveIfTombstoned(
          "match:tombstone:m1",
          "match:active",
          "m1",
        ),
      ).resolves.toBe("ABSENT");
    });

    it("finalizeMatchTombstone returns FINALIZED / STALE and SADDs only for dead-letter", async () => {
      client.eval.mockResolvedValueOnce("FINALIZED");
      await expect(
        service.finalizeMatchTombstone(
          "match:owner:m1",
          "match:fence:m1",
          "match:tombstone:m1",
          "match:active",
          "match:recovery:dead-letter",
          "m1",
          {
            leaseValue: "node-a:3",
            expectedFence: 3,
            reason: "dead-letter",
            ttlSec: 604800,
          },
        ),
      ).resolves.toBe("FINALIZED");

      const [script] = client.eval.mock.calls[0] as unknown[];
      expect(script).toContain("SADD");
      expect(script).toContain("dead-letter");

      client.eval.mockResolvedValueOnce("STALE");
      await expect(
        service.finalizeMatchTombstone("o", "f", "t", "a", "d", "m1", {
          leaseValue: "node-a:3",
          expectedFence: 3,
          reason: "cleaned",
          ttlSec: 604800,
        }),
      ).resolves.toBe("STALE");
    });

    it("requeueDeadLetter passes through each gate outcome and forwards the force flag", async () => {
      const outcomes = [
        "REQUEUED",
        "NOT_TERMINAL",
        "INVALID_TOMBSTONE",
        "FINALIZED",
        "NO_STATE",
        "CONFLICT",
      ] as const;
      for (const outcome of outcomes) {
        client.eval.mockResolvedValueOnce(outcome);
        await expect(
          service.requeueDeadLetter(
            {
              tombstoneKey: "match:tombstone:m1",
              stateKey: "match:state:m1",
              ownerKey: "match:owner:m1",
              fenceKey: "match:fence:m1",
              indexKey: "match:active",
              deadLetterSet: "match:recovery:dead-letter",
            },
            "m1",
            { force: true },
          ),
        ).resolves.toBe(outcome);
      }
      // force=true → ARGV[1] === "1"
      const lastCall = client.eval.mock.calls.at(-1) as unknown[];
      expect(lastCall.at(-2)).toBe("1"); // ARGV[1] force
      expect(lastCall.at(-1)).toBe("m1"); // ARGV[2] member
    });

    it("requeueDeadLetter throws on an unexpected Lua reply", async () => {
      client.eval.mockResolvedValueOnce("???");
      await expect(
        service.requeueDeadLetter(
          {
            tombstoneKey: "t",
            stateKey: "s",
            ownerKey: "o",
            fenceKey: "f",
            indexKey: "a",
            deadLetterSet: "d",
          },
          "m1",
          { force: false },
        ),
      ).rejects.toThrow(/unexpected Lua reply/);
    });
  });

  describe("subscribe/unsubscribe (B0)", () => {
    it("round-trips a published message to the handler", async () => {
      const received: string[] = [];
      await service.subscribe("ch1", (m) => received.push(m));

      expect(subscriber.subscribe).toHaveBeenCalledWith("ch1");
      subscriber.emit("ch1", "hello");
      expect(received).toEqual(["hello"]);
    });

    it("does not deliver a channel's message to a different channel's handler", async () => {
      const ch1: string[] = [];
      const ch2: string[] = [];
      await service.subscribe("ch1", (m) => ch1.push(m));
      await service.subscribe("ch2", (m) => ch2.push(m));

      subscriber.emit("ch1", "for-ch1");
      expect(ch1).toEqual(["for-ch1"]);
      expect(ch2).toEqual([]);
    });

    it("no-miss race: a message published right after subscribe() resolves is still delivered", async () => {
      const received: string[] = [];
      // If the dispatch listener / handler-map entry were registered AFTER the
      // SUBSCRIBE confirmation, this immediate publish would be lost.
      await service.subscribe("ch1", (m) => received.push(m));
      subscriber.emit("ch1", "immediate");
      expect(received).toEqual(["immediate"]);
    });

    it("unsubscribe removes only the given handler (channel stays live)", async () => {
      const h1: string[] = [];
      const h2: string[] = [];
      const fn1 = (m: string) => h1.push(m);
      const fn2 = (m: string) => h2.push(m);
      await service.subscribe("ch1", fn1);
      await service.subscribe("ch1", fn2);

      await service.unsubscribe("ch1", fn1);

      expect(subscriber.unsubscribe).not.toHaveBeenCalled();
      subscriber.emit("ch1", "still-here");
      expect(h1).toEqual([]);
      expect(h2).toEqual(["still-here"]);
    });

    it("unsubscribing the last handler tears down the Redis subscription", async () => {
      const received: string[] = [];
      const fn = (m: string) => received.push(m);
      await service.subscribe("ch1", fn);

      await service.unsubscribe("ch1", fn);

      expect(subscriber.unsubscribe).toHaveBeenCalledWith("ch1");
      subscriber.emit("ch1", "after-teardown");
      expect(received).toEqual([]);
    });

    it("issues only one Redis SUBSCRIBE for multiple handlers on the same channel", async () => {
      await service.subscribe("ch1", () => {});
      await service.subscribe("ch1", () => {});

      expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    });

    it("rolls back the handler on a rejected subscribe so a retry delivers exactly once", async () => {
      const received: string[] = [];
      const fn = (m: string) => received.push(m);
      subscriber.subscribe
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);

      await expect(service.subscribe("ch1", fn)).rejects.toThrow("boom");
      // Retry succeeds; the rolled-back handler must not be registered twice.
      await service.subscribe("ch1", fn);

      subscriber.emit("ch1", "once");
      expect(received).toEqual(["once"]);
    });

    it("a rejected subscribe on a channel with a live handler leaves the existing handler working", async () => {
      const h1: string[] = [];
      const fn1 = (m: string) => h1.push(m);
      await service.subscribe("ch1", fn1);

      // Second handler's subscribe path won't call Redis (channel already live),
      // so force a failure by rejecting a fresh subscribe on a NEW channel while
      // asserting ch1 is untouched.
      subscriber.subscribe.mockRejectedValueOnce(new Error("nope"));
      await expect(service.subscribe("ch2", () => {})).rejects.toThrow("nope");

      subscriber.emit("ch1", "alive");
      expect(h1).toEqual(["alive"]);
      // ch1 subscription was never torn down.
      expect(subscriber.unsubscribe).not.toHaveBeenCalledWith("ch1");
    });

    it("escalates to a subscriber reset when reconciliation unsubscribe fails every retry", async () => {
      // A live second channel so the rebuild has something to restore.
      const keep: string[] = [];
      await service.subscribe("keep", (m) => keep.push(m));

      // The failing subscribe: SUBSCRIBE accepted but reply dropped (reject),
      // and every reconciliation unsubscribe of the orphan also fails.
      subscriber.subscribe.mockRejectedValueOnce(new Error("dropped-reply"));
      subscriber.unsubscribe.mockRejectedValue(new Error("still-failing"));

      await expect(service.subscribe("orphan", () => {})).rejects.toThrow(
        "dropped-reply",
      );

      // Reset dropped + recreated the connection and rebuilt the wanted set.
      expect(subscriber.disconnect).toHaveBeenCalled();
      expect(client.duplicate).toHaveBeenCalledTimes(2); // original + rebuild
    });

    it("does not deadlock when a same-channel subscribe is queued behind one that triggers a reset", async () => {
      // Regression for the reset-drain deadlock: the first subscribe on ch1 has
      // its SUBSCRIBE accepted but the reply dropped (reject), and every
      // orphan-unsubscribe retry fails, so it escalates to a full subscriber
      // reset. A second subscribe on the SAME channel is queued behind it on the
      // channel chain. If the queued op were registered in the reset-drain set
      // at enqueue time, the reset triggered by the first op would wait on the
      // queued op, which cannot start until the first op finishes, which is
      // blocked on the reset → deadlock. Adding to the drain set only when the
      // op's callback actually starts breaks the cycle.
      const received: string[] = [];
      subscriber.subscribe.mockRejectedValueOnce(new Error("dropped-reply"));
      subscriber.unsubscribe.mockRejectedValue(
        new Error("orphan-unsub-failing"),
      );

      const first = service.subscribe("ch1", () => {});
      const second = service.subscribe("ch1", (m) => received.push(m));

      const results = await Promise.allSettled([first, second]);
      expect(results[0].status).toBe("rejected");
      // The queued subscribe completes (the one-shot SUBSCRIBE rejection is
      // exhausted, so its own SUBSCRIBE resolves against the rebuilt connection).
      expect(results[1].status).toBe("fulfilled");

      subscriber.emit("ch1", "delivered");
      expect(received).toEqual(["delivered"]);
    });

    it("does not deadlock when two DIFFERENT-channel subscribes fail and reset concurrently", async () => {
      // Regression for the cross-channel reset-drain deadlock. Two subscribes on
      // DIFFERENT channels (NOT serialized by the per-channel chain) both have
      // their SUBSCRIBE accepted-but-reply-dropped, and every orphan-unsubscribe
      // retry fails, so BOTH escalate to a subscriber reset concurrently. The
      // first reset's drain would await the second op while the second op is
      // itself blocked on that reset's barrier (and vice versa) — a cycle. The
      // handoff (detach) of an op that joins an in-progress reset breaks it.
      subscriber.subscribe
        .mockRejectedValueOnce(new Error("dropped-a"))
        .mockRejectedValueOnce(new Error("dropped-b"));
      subscriber.unsubscribe.mockRejectedValue(
        new Error("orphan-unsub-failing"),
      );

      const a = service.subscribe("chA", () => {});
      const b = service.subscribe("chB", () => {});

      // Neither promise hangs — both settle. (If the deadlock regressed, this
      // await would never resolve and the test would time out.)
      const results = await Promise.allSettled([a, b]);
      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");

      // A single reset rebuilt the connection (disconnect + one fresh duplicate).
      expect(subscriber.disconnect).toHaveBeenCalled();
      expect(client.duplicate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("isolates a sync-throwing message handler so siblings still receive", async () => {
      const good: string[] = [];
      const errorSpy = vi
        .spyOn((service as unknown as ServiceInternals).logger, "error")
        .mockImplementation(() => undefined);

      await service.subscribe("ch1", () => {
        throw new Error("sync-boom");
      });
      await service.subscribe("ch1", (m) => good.push(m));

      subscriber.emit("ch1", "payload");
      expect(good).toEqual(["payload"]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Message handler for channel ch1 threw"),
      );
    });

    it("isolates an async-rejecting message handler so siblings still receive", async () => {
      const good: string[] = [];
      const errorSpy = vi
        .spyOn((service as unknown as ServiceInternals).logger, "error")
        .mockImplementation(() => undefined);

      await service.subscribe("ch1", async () => {
        throw new Error("async-boom");
      });
      await service.subscribe("ch1", (m) => good.push(m));

      subscriber.emit("ch1", "payload");
      await Promise.resolve();
      await Promise.resolve();

      expect(good).toEqual(["payload"]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Async message handler for channel ch1 rejected",
        ),
      );
    });

    it("quits the subscriber connection on module destroy when one was created", async () => {
      await service.subscribe("ch1", () => {});
      await service.onModuleDestroy();
      expect(subscriber.quit).toHaveBeenCalled();
      expect(client.quit).toHaveBeenCalled();
    });

    it("retries a pending subscriber reset on the next lifecycle op", async () => {
      // Live channel so a later reset rebuild has non-empty handlers to re-subscribe.
      await service.subscribe("ch1", () => {});

      // A different-channel subscribe fails and escalates to reset. The rebuild
      // re-subscribes ch1 and we make that fail → resetPending is set.
      const rebuildSub = makeSubscriber();
      rebuildSub.subscribe.mockRejectedValue(new Error("rebuild-fail"));
      client.duplicate.mockReturnValueOnce(rebuildSub as unknown as Redis);

      subscriber.subscribe.mockRejectedValueOnce(
        new Error("ch2-subscribe-fail"),
      );
      subscriber.unsubscribe.mockRejectedValue(
        new Error("orphan-unsub-failing"),
      );

      await expect(service.subscribe("ch2", () => {})).rejects.toThrow();

      // Next lifecycle op retries the pending reset with a healthy subscriber.
      const recovered = makeSubscriber();
      client.duplicate.mockReturnValueOnce(recovered as unknown as Redis);
      recovered.subscribe.mockResolvedValue(undefined);

      await expect(service.subscribe("ch3", () => {})).resolves.toBeUndefined();
      expect(recovered.subscribe).toHaveBeenCalled();
    });

    it("unsubscribe is a no-op for an unknown channel or unknown handler", async () => {
      const known: string[] = [];
      const fn = (m: string) => known.push(m);
      await service.subscribe("ch1", fn);

      await expect(
        service.unsubscribe("never-subscribed", () => {}),
      ).resolves.toBeUndefined();
      await expect(
        service.unsubscribe("ch1", () => {}),
      ).resolves.toBeUndefined();

      expect(subscriber.unsubscribe).not.toHaveBeenCalled();
      subscriber.emit("ch1", "still");
      expect(known).toEqual(["still"]);
    });

    it("skips Redis UNSUBSCRIBE when the subscriber connection is already gone", async () => {
      const fn = () => {};
      await service.subscribe("ch1", fn);
      (service as unknown as { subscriber: null }).subscriber = null;

      await service.unsubscribe("ch1", fn);

      expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    });

    it("leaves the Redis subscription when handlers are re-added during a failed final unsubscribe", async () => {
      const keep: string[] = [];
      const keepFn = (m: string) => keep.push(m);
      const lastFn = () => {};
      await service.subscribe("ch1", keepFn);
      await service.subscribe("ch1", lastFn);

      // Drop keepFn first so lastFn is the final handler.
      await service.unsubscribe("ch1", keepFn);
      // Force the final unsubscribe to fail. Re-install keepFn on the channel
      // BEFORE the throw so the post-fail re-check sees the handler is wanted
      // again and short-circuits before resetSubscriber.
      subscriber.unsubscribe.mockImplementationOnce(async () => {
        const internals = service as unknown as {
          handlers: Map<string, Array<(m: string) => void>>;
        };
        internals.handlers.set("ch1", [keepFn]);
        throw new Error("unsub-fail");
      });

      await expect(service.unsubscribe("ch1", lastFn)).resolves.toBeUndefined();
      // Reset must NOT fire — the still-wanted handler survives the failure.
      expect(subscriber.disconnect).not.toHaveBeenCalled();
      subscriber.emit("ch1", "kept");
      expect(keep).toEqual(["kept"]);
    });
    it("rethrows the original unsubscribe error when the escalated reset also fails", async () => {
      const fn = () => {};
      const keepFn = () => {};
      await service.subscribe("ch1", keepFn);
      await service.subscribe("ch1", fn);
      // A second live channel so the rebuild has something to re-subscribe —
      // we make that rebuild subscribe reject, which fails the reset.
      await service.subscribe("ch2", () => {});
      // Drop keepFn so fn is the final handler on ch1.
      await service.unsubscribe("ch1", keepFn);

      subscriber.unsubscribe.mockRejectedValueOnce(new Error("unsub-original"));
      const rebuildSub = makeSubscriber();
      rebuildSub.subscribe.mockImplementation((channel: string) => {
        if (channel === "ch2") return Promise.reject(new Error("rebuild-fail"));
        return Promise.resolve(undefined);
      });
      client.duplicate.mockReturnValueOnce(rebuildSub as unknown as Redis);

      await expect(service.unsubscribe("ch1", fn)).rejects.toThrow(
        "unsub-original",
      );
    });

    it("reconcileAfterFailedSubscribe keeps a still-wanted channel subscription", async () => {
      // First handler lives; second handler's SUBSCRIBE is forced to reject by
      // temporarily clearing the handler list so doSubscribe issues Redis
      // SUBSCRIBE, then re-adding the first handler before reconcile runs.
      const keep: string[] = [];
      const keepFn = (m: string) => keep.push(m);
      await service.subscribe("ch1", keepFn);

      // Force a path where subscribe is attempted for ch1 again: clear handlers
      // so alreadyLive is false, then fail SUBSCRIBE while re-installing keepFn
      // so reconcile sees remaining handlers and keeps the subscription.
      const internals = service as unknown as {
        handlers: Map<string, Array<(m: string) => void>>;
      };
      internals.handlers.set("ch1", []);
      subscriber.subscribe.mockImplementationOnce(async () => {
        internals.handlers.set("ch1", [keepFn]);
        throw new Error("dropped-reply");
      });

      await expect(service.subscribe("ch1", () => {})).rejects.toThrow(
        "dropped-reply",
      );
      // No orphan unsubscribe / reset — channel still wanted.
      expect(subscriber.disconnect).not.toHaveBeenCalled();
      subscriber.emit("ch1", "alive");
      expect(keep).toEqual(["alive"]);
    });

    it("reconcileAfterFailedSubscribe is a no-op when the subscriber is already null", async () => {
      subscriber.subscribe.mockImplementationOnce(async () => {
        (service as unknown as { subscriber: null }).subscriber = null;
        throw new Error("dropped");
      });

      await expect(service.subscribe("orphan", () => {})).rejects.toThrow(
        "dropped",
      );
      expect(subscriber.disconnect).not.toHaveBeenCalled();
    });

    it("continues a subscriber reset when disconnect throws", async () => {
      await service.subscribe("keep", () => {});
      subscriber.disconnect.mockImplementation(() => {
        throw new Error("disconnect-boom");
      });
      subscriber.subscribe.mockRejectedValueOnce(new Error("dropped-reply"));
      subscriber.unsubscribe.mockRejectedValue(new Error("still-failing"));

      await expect(service.subscribe("orphan", () => {})).rejects.toThrow(
        "dropped-reply",
      );
      // Reset still rebuilt despite disconnect throw.
      expect(client.duplicate).toHaveBeenCalledTimes(2);
    });

    it("logs a non-Error rejection when a subscriber reset fails", async () => {
      await service.subscribe("ch1", () => {});
      const errorSpy = vi
        .spyOn((service as unknown as ServiceInternals).logger, "error")
        .mockImplementation(() => undefined);

      const rebuildSub = makeSubscriber();
      rebuildSub.subscribe.mockRejectedValue("string-fail");
      client.duplicate.mockReturnValueOnce(rebuildSub as unknown as Redis);

      subscriber.subscribe.mockRejectedValueOnce(new Error("ch2-fail"));
      subscriber.unsubscribe.mockRejectedValue(new Error("orphan-unsub"));

      await expect(service.subscribe("ch2", () => {})).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("string-fail"),
      );
    });

    it("ignores messages for channels with no registered handlers", async () => {
      await service.subscribe("ch1", () => {});
      const fn = () => {};
      await service.subscribe("ch2", fn);
      await service.unsubscribe("ch2", fn);

      // Dispatch for a fully-torn-down channel must not throw.
      expect(() => subscriber.emit("ch2", "ghost")).not.toThrow();
    });

    it("swallows subscriber.quit failures on module destroy", async () => {
      await service.subscribe("ch1", () => {});
      subscriber.quit.mockRejectedValueOnce(new Error("quit-fail"));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(client.quit).toHaveBeenCalled();
    });

    it("acquireBlockingReader short-circuits to null when shutting down", async () => {
      (
        service as unknown as { blockingReadersShuttingDown: boolean }
      ).blockingReadersShuttingDown = true;
      const result = await (
        service as unknown as {
          acquireBlockingReader: () => Promise<Redis | null>;
        }
      ).acquireBlockingReader();
      expect(result).toBeNull();
      expect(client.duplicate).not.toHaveBeenCalled();
    });

    it("acquireBlockingReader short-circuits to null when the signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort();
      const result = await (
        service as unknown as {
          acquireBlockingReader: (signal: AbortSignal) => Promise<Redis | null>;
        }
      ).acquireBlockingReader(ac.signal);
      expect(result).toBeNull();
      expect(client.duplicate).not.toHaveBeenCalled();
    });

    it("acquireBlockingReader waiter's onAbort handler removes the waiter and resolves it to null", async () => {
      // Saturate the in-use set so the next acquire enters the waiter branch.
      const inUse = (service as unknown as { blockingReadersInUse: Set<Redis> })
        .blockingReadersInUse;
      for (let i = 0; i < 16; i++) {
        inUse.add({} as unknown as Redis);
      }
      const ac = new AbortController();
      const waiterPromise = (
        service as unknown as {
          acquireBlockingReader: (signal: AbortSignal) => Promise<Redis | null>;
        }
      ).acquireBlockingReader(ac.signal);
      // Yield so the waiter is registered.
      for (let i = 0; i < 4; i++) await Promise.resolve();

      // Trigger the onAbort handler (lines 877-881).
      ac.abort();
      await expect(waiterPromise).resolves.toBeNull();
      // The waiter was removed from the queue.
      expect(
        (service as unknown as { blockingReaderWaiters: unknown[] })
          .blockingReaderWaiters.length,
      ).toBe(0);
    });

    it("acquireBlockingReader onAbort fires synchronously when the signal is already aborted at entry", async () => {
      // Saturate the in-use set so the next acquire enters the waiter branch.
      const inUse = (service as unknown as { blockingReadersInUse: Set<Redis> })
        .blockingReadersInUse;
      for (let i = 0; i < 16; i++) {
        inUse.add({} as unknown as Redis);
      }
      const ac = new AbortController();
      ac.abort();
      // Calling with an already-aborted signal must resolve to null
      // immediately via the synchronous onAbort path (lines 899-902).
      const result = await (
        service as unknown as {
          acquireBlockingReader: (signal: AbortSignal) => Promise<Redis | null>;
        }
      ).acquireBlockingReader(ac.signal);
      expect(result).toBeNull();
    });

    it("resolves pending blocking-reader waiters to null on shutdown", async () => {
      // Saturate the in-use set to MAX (16) so the next acquire goes through
      // the waiter path. When onModuleDestroy runs, those waiters are drained
      // and resolved to null.
      const inUse = (service as unknown as { blockingReadersInUse: Set<Redis> })
        .blockingReadersInUse;
      for (let i = 0; i < 16; i++) {
        inUse.add({} as unknown as Redis);
      }

      const ac = new AbortController();
      const waiterPromise = (
        service as unknown as {
          acquireBlockingReader: (signal: AbortSignal) => Promise<Redis | null>;
        }
      ).acquireBlockingReader(ac.signal);
      // Yield so the waiter is registered before destroy runs.
      for (let i = 0; i < 4; i++) await Promise.resolve();
      expect(
        (service as unknown as { blockingReaderWaiters: unknown[] })
          .blockingReaderWaiters.length,
      ).toBe(1);

      await service.onModuleDestroy();

      // Pending acquire() resolves to null rather than hanging.
      await expect(waiterPromise).resolves.toBeNull();
    });

    it("does not crash onModuleDestroy when an allocated reader's disconnect throws", async () => {
      const reader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(() => {
          throw new Error("disconnect-fail");
        }),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);

      // First xreadgroup mints + releases the reader back to the idle pool.
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);

      // onModuleDestroy must close every pooled reader; disconnect throws,
      // but the catch swallows it so the next teardown steps still run.
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(client.quit).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Coverage gap fill — error branches + lifecycle edges that
  // were uncovered in the patch report.
  // ============================================================
  describe("coverage gaps (B0/B3b/B4a)", () => {
    it("xdel with no ids short-circuits to 0 and never calls the client", async () => {
      client.xdel.mockClear();
      await expect(service.xdel("s")).resolves.toBe(0);
      expect(client.xdel).not.toHaveBeenCalled();
    });

    it("xdel forwards ids to the client and returns its reply", async () => {
      client.xdel.mockClear();
      client.xdel.mockResolvedValueOnce(2);
      await expect(service.xdel("s", "1-0", "2-0")).resolves.toBe(2);
      expect(client.xdel).toHaveBeenCalledWith("s", "1-0", "2-0");
    });

    it("acquireMatchLease throws on an inconsistent leaseValue (post-write)", async () => {
      // fence=7, leaseValue doesn't match `${nodeId}:${fence}` → mismatch.
      client.eval.mockResolvedValueOnce(["7", "someone-else:7"]);
      await expect(
        service.acquireMatchLease("o", "f", "t", "node-a", 15),
      ).rejects.toThrow(/inconsistent/);
    });

    it("removeActiveIfStateAbsent throws on an unexpected Lua reply", async () => {
      client.eval.mockResolvedValueOnce("???");
      await expect(
        service.removeActiveIfStateAbsent("s", "a", "m1"),
      ).rejects.toThrow(/unexpected Lua reply/);
    });

    it("removeActiveIfTombstoned throws on an unexpected Lua reply", async () => {
      client.eval.mockResolvedValueOnce("???");
      await expect(
        service.removeActiveIfTombstoned("t", "a", "m1"),
      ).rejects.toThrow(/unexpected Lua reply/);
    });

    it("finalizeMatchTombstone throws on an unexpected Lua reply", async () => {
      client.eval.mockResolvedValueOnce("???");
      await expect(
        service.finalizeMatchTombstone("o", "f", "t", "a", "d", "m1", {
          leaseValue: "node-a:1",
          expectedFence: 1,
          reason: "cleaned",
          ttlSec: 60,
        }),
      ).rejects.toThrow(/unexpected Lua reply/);
    });

    it("releaseBlockingReader disconnects and short-circuits while shutting down", async () => {
      const reader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(() => {
          throw new Error("disconnect-boom");
        }),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);
      // First call mints + releases to pool.
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);

      // Simulate an in-use reader that's about to be released after shutdown.
      // Pull it back into `in-use` so releaseBlockingReader exercises the
      // shutdown branch (delete + disconnect, no pool push, no waiter handoff).
      const inUse = (service as unknown as { blockingReadersInUse: Set<Redis> })
        .blockingReadersInUse;
      inUse.add(reader as unknown as Redis);
      (
        service as unknown as { blockingReadersShuttingDown: boolean }
      ).blockingReadersShuttingDown = true;

      const pool = (service as unknown as { blockingReaderPool: Redis[] })
        .blockingReaderPool;
      const poolBefore = pool.length;

      (
        service as unknown as {
          releaseBlockingReader: (r: Redis) => void;
        }
      ).releaseBlockingReader(reader as unknown as Redis);

      // Disconnect was called (and threw); the catch swallows the error
      // and the reader was NOT pushed back to the pool.
      expect(reader.disconnect).toHaveBeenCalled();
      expect(pool).toHaveLength(poolBefore); // pool unchanged
    });

    it("releaseBlockingReader closes the reader when the pool is already full", async () => {
      const reader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);

      // Pre-fill the pool to BLOCKING_READER_POOL_MAX (16) and have no waiters.
      const pool = (service as unknown as { blockingReaderPool: Redis[] })
        .blockingReaderPool;
      while (pool.length < 16) {
        pool.push({} as unknown as Redis);
      }
      expect(pool).toHaveLength(16);

      // The just-released reader cannot be re-pooled (pool full) and there
      // are no waiters to hand it to → disconnect runs.
      (
        service as unknown as {
          releaseBlockingReader: (r: Redis) => void;
        }
      ).releaseBlockingReader(reader as unknown as Redis);

      expect(reader.disconnect).toHaveBeenCalled();
      expect(pool).toHaveLength(16); // unchanged — the released reader dropped
    });

    it("releaseBlockingReader falls back to quit() when disconnect throws on overflow", async () => {
      const reader = {
        xreadgroup: vi.fn().mockResolvedValue(null),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(() => {
          throw new Error("disconnect-boom");
        }),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);
      await service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000);

      // Fill the pool so release falls into the disconnect branch.
      const pool = (service as unknown as { blockingReaderPool: Redis[] })
        .blockingReaderPool;
      while (pool.length < 16) {
        pool.push({} as unknown as Redis);
      }

      (
        service as unknown as {
          releaseBlockingReader: (r: Redis) => void;
        }
      ).releaseBlockingReader(reader as unknown as Redis);

      // disconnect throws → catch falls through to quit().
      expect(reader.quit).toHaveBeenCalled();
    });

    it("discardBlockingReader falls back to quit() when disconnect throws", async () => {
      const reader = {
        xreadgroup: vi.fn().mockRejectedValue(new Error("NOGROUP")),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(() => {
          throw new Error("disconnect-boom");
        }),
        on: vi.fn(),
      };
      client.duplicate.mockReturnValueOnce(reader as unknown as Redis);

      // Trigger the discard via a failed xreadgroup (NOGROUP path).
      await expect(
        service.xreadgroup("owners", "node-a", "match:cmd:m1", 16, 1000),
      ).resolves.toEqual([]);

      expect(reader.disconnect).toHaveBeenCalled();
      expect(reader.quit).toHaveBeenCalled();
    });

    it("awaitResetBarrier waits for an in-flight subscriber reset to resolve", async () => {
      // Drive an escalating reset: SUBSCRIBE rejected + every reconciliation
      // unsubscribe rejected → resetSubscriber rebuilds with a fresh subscriber
      // whose subscribe call hangs. While the rebuild is hung, a fresh subscribe
      // must block on awaitResetBarrier (lines 1340-1342).
      await service.subscribe("ch-keep", () => {});

      // Hold the rebuild's subscribe so the reset barrier stays pending.
      let resolveRebuild!: () => void;
      const rebuildSub = makeSubscriber();
      rebuildSub.subscribe.mockImplementation((channel: string) => {
        if (channel === "ch-keep") {
          return new Promise<void>((res) => (resolveRebuild = res));
        }
        return Promise.resolve(undefined);
      });
      client.duplicate.mockReturnValueOnce(rebuildSub as unknown as Redis);

      // First subscribe on a fresh channel: SUBSCRIBE rejected, every orphan-
      // unsubscribe retries rejected → escalation to full subscriber reset.
      subscriber.subscribe.mockRejectedValueOnce(new Error("dropped-reply"));
      subscriber.unsubscribe.mockRejectedValue(new Error("orphan-unsub-fail"));

      // The trigger subscribe is rejected AFTER the reset barrier resolves,
      // because reconcileAfterFailedSubscribe awaits the barrier before
      // rethrowing the original error. We resolve the rebuild FIRST, then
      // catch the rejection.
      const trigger = service
        .subscribe("ch-trigger", () => {})
        .catch(() => undefined);

      // Yield microtasks so resetSubscriber runs and starts the rebuild.
      for (let i = 0; i < 8; i++) await Promise.resolve();

      // The reset is now in flight (rebuild is hanging on subscribe).
      expect(
        (service as unknown as { resetInProgress: Promise<void> | null })
          .resetInProgress,
      ).not.toBeNull();
      expect(rebuildSub.subscribe).toHaveBeenCalled();

      // A second subscribe on a fresh channel must await the in-flight reset.
      let chainedSettled = false;
      const chained = service
        .subscribe("ch-chained", () => {})
        .then(() => {
          chainedSettled = true;
        });

      // Yield again — chained should NOT have settled yet because the reset
      // is still pending (its rebuild subscribe is hanging).
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(chainedSettled).toBe(false);

      // Resolve the rebuild's subscribe → reset barrier resolves → both
      // the trigger subscribe (which is awaiting the barrier inside
      // reconcileAfterFailedSubscribe) and the chained subscribe proceed.
      resolveRebuild();
      await trigger;
      await chained;

      expect(chainedSettled).toBe(true);
      expect(rebuildSub.subscribe).toHaveBeenCalledWith("ch-chained");
    });
  });
});
