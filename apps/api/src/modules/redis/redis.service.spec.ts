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
  });
});
