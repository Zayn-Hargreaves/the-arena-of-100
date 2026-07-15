import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { RedisIoAdapter, REDIS_READY_TIMEOUT_MS } from "./redis-io.adapter";

// Minimal stand-in for the slice of the ioredis client waitForReady touches:
// a mutable `status` plus the ready/error/end event surface.
class FakeRedisClient extends EventEmitter {
  status = "connecting";
}

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

describe("RedisIoAdapter.waitForReady", () => {
  let adapter: RedisIoAdapter;

  beforeEach(() => {
    adapter = new RedisIoAdapter({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
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
