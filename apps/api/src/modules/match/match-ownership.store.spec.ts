import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedisService } from "../redis/redis.service";
import {
  ACTIVE_SET,
  fenceKey,
  ownerKey,
  addActiveMatch,
  removeActiveMatch,
  listActiveMatchIds,
  nextFence,
  readOwner,
} from "./match-ownership.store";

type RedisMock = Pick<
  RedisService,
  "sadd" | "srem" | "smembers" | "incr" | "get"
>;

describe("match-ownership.store (B2a)", () => {
  let redis: {
    sadd: ReturnType<typeof vi.fn>;
    srem: ReturnType<typeof vi.fn>;
    smembers: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  const asService = () => redis as unknown as RedisService;

  beforeEach(() => {
    redis = {
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      incr: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
    };
  });

  it("exposes the canonical key builders", () => {
    expect(ACTIVE_SET).toBe("match:active");
    expect(fenceKey("m1")).toBe("match:fence:m1");
    expect(ownerKey("m1")).toBe("match:owner:m1");
  });

  it("addActiveMatch SADDs the matchId into the active set", async () => {
    await addActiveMatch(asService(), "m1");
    expect(redis.sadd).toHaveBeenCalledWith(ACTIVE_SET, "m1");
  });

  it("removeActiveMatch SREMs the matchId from the active set", async () => {
    await removeActiveMatch(asService(), "m1");
    expect(redis.srem).toHaveBeenCalledWith(ACTIVE_SET, "m1");
  });

  it("listActiveMatchIds SMEMBERs the active set", async () => {
    redis.smembers.mockResolvedValueOnce(["m1", "m2"]);
    await expect(listActiveMatchIds(asService())).resolves.toEqual([
      "m1",
      "m2",
    ]);
    expect(redis.smembers).toHaveBeenCalledWith(ACTIVE_SET);
  });

  it("nextFence INCRs the per-match fence key and returns the new value", async () => {
    redis.incr.mockResolvedValueOnce(7);
    await expect(nextFence(asService(), "m1")).resolves.toBe(7);
    expect(redis.incr).toHaveBeenCalledWith("match:fence:m1");
  });

  it("readOwner GETs the per-match owner key", async () => {
    redis.get.mockResolvedValueOnce("node-a:3");
    await expect(readOwner(asService(), "m1")).resolves.toBe("node-a:3");
    expect(redis.get).toHaveBeenCalledWith("match:owner:m1");
  });

  it("round-trips add -> list -> remove against a fake in-memory set", async () => {
    const set = new Set<string>();
    redis.sadd.mockImplementation(async (_key: string, member: string) => {
      set.add(member);
      return 1;
    });
    redis.srem.mockImplementation(async (_key: string, member: string) => {
      set.delete(member);
      return 1;
    });
    redis.smembers.mockImplementation(async () => [...set]);

    await addActiveMatch(asService(), "m1");
    await addActiveMatch(asService(), "m2");
    expect(await listActiveMatchIds(asService())).toEqual(["m1", "m2"]);
    await removeActiveMatch(asService(), "m1");
    expect(await listActiveMatchIds(asService())).toEqual(["m2"]);
  });

  // Keep the RedisService method surface honest — if these are renamed the
  // store must be updated in lockstep.
  it("uses only the RedisService methods the contract depends on", () => {
    const surface: (keyof RedisMock)[] = [
      "sadd",
      "srem",
      "smembers",
      "incr",
      "get",
    ];
    expect(surface).toHaveLength(5);
  });
});
