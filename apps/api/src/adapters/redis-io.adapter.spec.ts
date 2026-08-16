import { EventEmitter } from "node:events";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type Redis from "ioredis";
import type { RedisOptions } from "ioredis";
import {
  RedisIoAdapter,
  REDIS_READY_TIMEOUT_MS,
  REDIS_QUIT_TIMEOUT_MS,
} from "./redis-io.adapter";

const { redisConstructorMock, createAdapterMock } = vi.hoisted(() => ({
  redisConstructorMock: vi.fn(),
  createAdapterMock: vi.fn(() => vi.fn()),
}));
vi.mock("ioredis", () => ({ default: redisConstructorMock }));
vi.mock("@socket.io/redis-adapter", () => ({
  createAdapter: createAdapterMock,
}));

// Minimal stand-in for the slice of the ioredis client waitForReady touches:
// a mutable `status` plus the ready/error/end event surface.
class FakeRedisClient extends EventEmitter {
  status = "connecting";
}

// Adds the connection-lifecycle surface connectToRedis/disconnect touch.
class FakeConnectClient extends FakeRedisClient {
  duplicate = vi.fn();
  quit = vi.fn().mockResolvedValue("OK");
  disconnect = vi.fn();
}

const privateClients = (adapter: RedisIoAdapter) =>
  adapter as unknown as {
    pubClient?: Redis;
    subClient?: Redis;
    adapterConstructor?: unknown;
  };

const waitForReady = (adapter: RedisIoAdapter, client: FakeRedisClient) =>
  (
    adapter as unknown as {
      waitForReady(name: "pub" | "sub", client: Redis): Promise<void>;
    }
  ).waitForReady("pub", client as unknown as Redis);

const expectNoListeners = (client: FakeRedisClient) => {
  expect(client.listenerCount("ready")).toBe(0);
  expect(client.listenerCount("error")).toBe(0);
  expect(client.listenerCount("end")).toBe(0);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("RedisIoAdapter.waitForReady", () => {
  let adapter: RedisIoAdapter;

  beforeEach(() => {
    adapter = new RedisIoAdapter({} as never);
  });

  it("resolves immediately for an already-ready client", async () => {
    const client = new FakeRedisClient();
    client.status = "ready";

    await expect(waitForReady(adapter, client)).resolves.toBeUndefined();
    expectNoListeners(client);
  });

  it("rejects immediately for an already-ended client, without listeners", async () => {
    const client = new FakeRedisClient();
    client.status = "end";

    await expect(waitForReady(adapter, client)).rejects.toThrow(
      "closed before becoming ready",
    );
    expectNoListeners(client);
  });

  it("resolves once the client emits ready and removes its listeners", async () => {
    const client = new FakeRedisClient();
    const pending = waitForReady(adapter, client);

    client.emit("ready");

    await expect(pending).resolves.toBeUndefined();
    expectNoListeners(client);
  });

  it("rejects on the first connection error", async () => {
    const client = new FakeRedisClient();
    const pending = waitForReady(adapter, client);

    client.emit("error", new Error("ECONNREFUSED"));

    await expect(pending).rejects.toThrow("failed to connect: ECONNREFUSED");
    expectNoListeners(client);
  });

  it("rejects when the connection ends before becoming ready", async () => {
    const client = new FakeRedisClient();
    const pending = waitForReady(adapter, client);

    client.emit("end");

    await expect(pending).rejects.toThrow("closed before becoming ready");
    expectNoListeners(client);
  });

  it("rejects after the ready timeout and cleans up listeners", async () => {
    vi.useFakeTimers();
    const client = new FakeRedisClient();
    const pending = waitForReady(adapter, client);
    const assertion = expect(pending).rejects.toThrow("not ready after");

    vi.advanceTimersByTime(REDIS_READY_TIMEOUT_MS);

    await assertion;
    expectNoListeners(client);
  });

  it("a late ready after the timeout does not resolve or leak", async () => {
    vi.useFakeTimers();
    const client = new FakeRedisClient();
    const pending = waitForReady(adapter, client);
    const assertion = expect(pending).rejects.toThrow("not ready after");

    vi.advanceTimersByTime(REDIS_READY_TIMEOUT_MS);
    client.emit("ready"); // ignored: listeners were removed on timeout

    await assertion;
    expectNoListeners(client);
  });
});

describe("RedisIoAdapter.connectToRedis", () => {
  it("tears down both clients, rethrows, and stays unusable when a client fails readiness", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready"; // pub side connects fine
    const sub = new FakeConnectClient(); // sub side stays "connecting"
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    const pending = adapter.connectToRedis("redis://localhost:6379");
    sub.emit("error", new Error("ECONNREFUSED"));

    // The original readiness error propagates...
    await expect(pending).rejects.toThrow("failed to connect: ECONNREFUSED");
    // ...after both clients were torn down,
    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(sub.quit).toHaveBeenCalledTimes(1);
    // ...the client refs were reset so a later disconnect() is a no-op,
    expect(privateClients(adapter).pubClient).toBeUndefined();
    expect(privateClients(adapter).subClient).toBeUndefined();
    // ...and the adapter refuses to hand out a server wired to dead clients.
    expect(() => adapter.createIOServer(0)).toThrow(
      "connectToRedis() must be called before createIOServer()",
    );
  });

  it("rejects a second call while the first connection is live, leaving it untouched", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis("redis://localhost:6379");

    await expect(
      adapter.connectToRedis("redis://localhost:6379"),
    ).rejects.toThrow("already connected or connecting");
    // The live pair was neither replaced nor torn down.
    expect(privateClients(adapter).pubClient).toBe(pub);
    expect(privateClients(adapter).subClient).toBe(sub);
    expect(privateClients(adapter).adapterConstructor).toBeDefined();
    expect(pub.quit).not.toHaveBeenCalled();
    expect(sub.quit).not.toHaveBeenCalled();
  });

  it("allows a reconnect after disconnect() cleared the previous connection", async () => {
    const makeReadyPair = () => {
      const pub = new FakeConnectClient();
      pub.status = "ready";
      const sub = new FakeConnectClient();
      sub.status = "ready";
      pub.duplicate.mockReturnValue(sub);
      return { pub, sub };
    };
    const first = makeReadyPair();
    const second = makeReadyPair();
    redisConstructorMock
      .mockImplementationOnce(() => first.pub)
      .mockImplementationOnce(() => second.pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis("redis://localhost:6379");
    await adapter.disconnect();

    await expect(
      adapter.connectToRedis("redis://localhost:6379"),
    ).resolves.toBeUndefined();
    // The whole first pair was quit exactly once by disconnect().
    expect(first.pub.quit).toHaveBeenCalledTimes(1);
    expect(first.sub.quit).toHaveBeenCalledTimes(1);
    expect(privateClients(adapter).pubClient).toBe(second.pub);
  });

  it("rejects a reconnect once a Socket.IO server was created", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    // A server created before the reconnect keeps its RedisAdapter bound to
    // the quit clients — stub the base server so no real socket opens.
    const fakeServer = { adapter: vi.fn() };
    const superCreate = vi
      .spyOn(IoAdapter.prototype, "createIOServer")
      .mockReturnValue(fakeServer);

    try {
      const adapter = new RedisIoAdapter({} as never);
      await adapter.connectToRedis("redis://localhost:6379");
      expect(adapter.createIOServer(0)).toBe(fakeServer);
      await adapter.disconnect();

      await expect(
        adapter.connectToRedis("redis://localhost:6379"),
      ).rejects.toThrow("cannot reconnect after createIOServer()");
    } finally {
      superCreate.mockRestore();
    }
  });

  it("connects successfully with Sentinel options object", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis({
      sentinels: [{ host: "127.0.0.1", port: 26379 }],
      name: "mymaster",
      keyPrefix: "arena:",
    });

    expect(redisConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sentinels: [{ host: "127.0.0.1", port: 26379 }],
        name: "mymaster",
        keyPrefix: "arena:",
        maxRetriesPerRequest: null,
        reconnectOnError: expect.any(Function),
      }),
    );
    const [sentinelPassedOpts] = (redisConstructorMock.mock.lastCall ?? []) as [
      RedisOptions | undefined,
    ];
    expect(sentinelPassedOpts?.reconnectOnError).toBeDefined();
    expect(
      sentinelPassedOpts?.reconnectOnError?.(
        new Error("READONLY You can't write against a read only replica."),
      ),
    ).toBe(2);
    expect(
      sentinelPassedOpts?.reconnectOnError?.(new Error("ECONNREFUSED")),
    ).toBe(false);
    expect(privateClients(adapter).pubClient).toBe(pub);
    expect(privateClients(adapter).subClient).toBe(sub);
  });

  it("connects successfully with environment variable map containing REDIS_SENTINELS", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis({
      REDIS_SENTINELS: "sentinel-1:26379,sentinel-2:26380",
      REDIS_SENTINEL_MASTER_NAME: "arena-master",
      REDIS_KEY_PREFIX: "arena-io:",
    });

    expect(redisConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sentinels: [
          { host: "sentinel-1", port: 26379 },
          { host: "sentinel-2", port: 26380 },
        ],
        name: "arena-master",
        keyPrefix: "arena-io:",
        maxRetriesPerRequest: null,
      }),
    );
  });

  it("connects successfully with RedisOptions containing only password and keyPrefix", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis({
      password: "secret-password",
      keyPrefix: "arena-opts:",
    });

    expect(redisConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "secret-password",
        keyPrefix: "arena-opts:",
        maxRetriesPerRequest: null,
        reconnectOnError: expect.any(Function),
      }),
    );
    const [directPassedOpts] = (redisConstructorMock.mock.lastCall ?? []) as [
      RedisOptions | undefined,
    ];
    expect(directPassedOpts?.reconnectOnError).toBeDefined();
    expect(
      directPassedOpts?.reconnectOnError?.(
        new Error("READONLY You can't write against a read only replica."),
      ),
    ).toBe(2);
    expect(
      directPassedOpts?.reconnectOnError?.(new Error("ECONNREFUSED")),
    ).toBe(false);
    expect(createAdapterMock).toHaveBeenCalledWith(
      pub,
      sub,
      expect.objectContaining({
        key: "arena-opts::socket.io",
      }),
    );
  });

  it("applies parsed.options.keyPrefix from env map to adapter creation", async () => {
    const pub = new FakeConnectClient();
    pub.status = "ready";
    const sub = new FakeConnectClient();
    sub.status = "ready";
    pub.duplicate.mockReturnValue(sub);
    redisConstructorMock.mockImplementation(() => pub);

    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis({
      REDIS_KEY_PREFIX: "env-channel-prefix:",
    });

    expect(redisConstructorMock).toHaveBeenCalledWith(
      "redis://localhost:6379",
      expect.objectContaining({
        keyPrefix: "env-channel-prefix:",
        maxRetriesPerRequest: null,
      }),
    );
    expect(createAdapterMock).toHaveBeenCalledWith(
      pub,
      sub,
      expect.objectContaining({
        key: "env-channel-prefix::socket.io",
      }),
    );
  });
});

describe("RedisIoAdapter.disconnect", () => {
  it("force-disconnects a client whose quit() rejects", async () => {
    const pub = new FakeConnectClient();
    pub.quit.mockRejectedValue(new Error("Connection is closed."));
    const sub = new FakeConnectClient();

    const adapter = new RedisIoAdapter({} as never);
    privateClients(adapter).pubClient = pub as unknown as Redis;
    privateClients(adapter).subClient = sub as unknown as Redis;

    await expect(adapter.disconnect()).resolves.toBeUndefined();

    expect(pub.disconnect).toHaveBeenCalledTimes(1);
    // The clean quit path never needs a force-close.
    expect(sub.disconnect).not.toHaveBeenCalled();
    // All refs are cleared so the adapter is inert until reconnected.
    expect(privateClients(adapter).pubClient).toBeUndefined();
    expect(privateClients(adapter).subClient).toBeUndefined();
    expect(privateClients(adapter).adapterConstructor).toBeUndefined();
  });

  it("force-disconnects a client whose quit() never settles, before the timeout logs and resolves", async () => {
    vi.useFakeTimers();
    const pub = new FakeConnectClient();
    pub.quit.mockReturnValue(new Promise(() => {})); // never resolves
    const sub = new FakeConnectClient();
    sub.quit.mockReturnValue(new Promise(() => {})); // never resolves

    const adapter = new RedisIoAdapter({} as never);
    privateClients(adapter).pubClient = pub as unknown as Redis;
    privateClients(adapter).subClient = sub as unknown as Redis;
    // Seed a sentinel adapterConstructor so the trailing assertion proves
    // disconnect() cleared it, rather than passing because it was never set.
    privateClients(adapter).adapterConstructor = vi.fn();

    const pending = adapter.disconnect();

    // Advance just past the 5s quit timeout so both force-disconnects fire.
    await vi.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS + 1);

    // disconnect() uses Promise.allSettled and only logs the rejection —
    // it resolves regardless. Callers observe the failure through the log
    // and the force-disconnected clients.
    await expect(pending).resolves.toBeUndefined();
    // Both clients were force-disconnected on timeout.
    expect(pub.disconnect).toHaveBeenCalledTimes(1);
    expect(sub.disconnect).toHaveBeenCalledTimes(1);
    // All refs are cleared so the adapter is inert until reconnected.
    expect(privateClients(adapter).pubClient).toBeUndefined();
    expect(privateClients(adapter).subClient).toBeUndefined();
    expect(privateClients(adapter).adapterConstructor).toBeUndefined();
  });
});
