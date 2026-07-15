import { ClusterService } from "./cluster.service";

// A tiny fake ioredis client driving SCAN + MGET for getOwnedMatchIds.
function makeRedis(ownerKeys: Record<string, string>) {
  const keys = Object.keys(ownerKeys);
  const client = {
    // Single-page scan: return all matching keys then cursor "0".
    scan: vi
      .fn()
      .mockImplementation(
        async (_cursor: string, _match: string, pattern: string) => {
          const prefix = pattern.replace(/\*$/, "");
          return ["0", keys.filter((k) => k.startsWith(prefix))];
        },
      ),
    mget: vi
      .fn()
      .mockImplementation(async (...ks: string[]) =>
        ks.map((k) => ownerKeys[k]),
      ),
  };
  return { getClient: () => client } as never;
}

describe("ClusterService", () => {
  const ORIGINAL_INSTANCE_ID = process.env.INSTANCE_ID;
  afterEach(() => {
    vi.restoreAllMocks();
    // Restore INSTANCE_ID even if a test that mutated it failed mid-way.
    if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.INSTANCE_ID;
    else process.env.INSTANCE_ID = ORIGINAL_INSTANCE_ID;
  });

  it("derives nodeId from INSTANCE_ID", () => {
    const prev = process.env.INSTANCE_ID;
    process.env.INSTANCE_ID = "api-7";
    const svc = new ClusterService(makeRedis({}));
    expect(svc.nodeId).toBe("api-7");
    process.env.INSTANCE_ID = prev;
  });

  it("returns 0 sockets before the server is wired", () => {
    const svc = new ClusterService(makeRedis({}));
    expect(svc.getLocalSocketCount()).toBe(0);
  });

  it("counts local sockets from the /game namespace map", () => {
    const svc = new ClusterService(makeRedis({}));
    svc.setServer({
      sockets: new Map([
        ["a", {}],
        ["b", {}],
      ]),
    } as never);
    expect(svc.getLocalSocketCount()).toBe(2);
  });

  it("returns only matches owned by this node (fenced value)", async () => {
    process.env.INSTANCE_ID = "api-1";
    const svc = new ClusterService(
      makeRedis({
        "match:owner:m1": "api-1:3", // ours (fenced)
        "match:owner:m2": "api-2:1", // another node
        "match:owner:m3": "api-1", // ours (bare id)
      }),
    );
    const owned = await svc.getOwnedMatchIds();
    expect(owned.sort()).toEqual(["m1", "m3"]);
  });

  it("swallows scan errors and returns []", async () => {
    const redis = {
      getClient: () => ({
        scan: vi.fn().mockRejectedValue(new Error("redis down")),
      }),
    } as never;
    const svc = new ClusterService(redis);
    expect(await svc.getOwnedMatchIds()).toEqual([]);
  });
});
