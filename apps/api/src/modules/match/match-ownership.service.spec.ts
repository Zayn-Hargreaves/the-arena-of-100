import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger } from "@nestjs/common";
import {
  MatchOwnershipService,
  LEASE_TTL_SEC,
} from "./match-ownership.service";
import { ACTIVE_SET } from "./match-ownership.store";
import type { RedisService } from "../redis/redis.service";
import type { ClusterService } from "../cluster/cluster.service";

type RedisMock = {
  acquireLeaseWithFence: ReturnType<typeof vi.fn>;
  renewLease: ReturnType<typeof vi.fn>;
  releaseLease: ReturnType<typeof vi.fn>;
  releaseLeaseAndIndex: ReturnType<typeof vi.fn>;
  sadd: ReturnType<typeof vi.fn>;
  srem: ReturnType<typeof vi.fn>;
  smembers: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  serverTimeMs: ReturnType<typeof vi.fn>;
};

describe("MatchOwnershipService (B2b)", () => {
  let redis: RedisMock;
  let service: MatchOwnershipService;

  const makeService = (nodeId = "node-a") => {
    const cluster = { nodeId } as unknown as ClusterService;
    const svc = new MatchOwnershipService(
      redis as unknown as RedisService,
      cluster,
    );
    // Silence expected warn/error logs.
    (svc as unknown as { logger: Logger }).logger = new Logger("test", {
      timestamp: false,
    });
    vi.spyOn(
      (svc as unknown as { logger: Logger }).logger,
      "warn",
    ).mockImplementation(() => undefined);
    vi.spyOn(
      (svc as unknown as { logger: Logger }).logger,
      "error",
    ).mockImplementation(() => undefined);
    return svc;
  };

  beforeEach(() => {
    redis = {
      acquireLeaseWithFence: vi
        .fn()
        .mockResolvedValue({ fence: 1, leaseValue: "node-a:1" }),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      releaseLeaseAndIndex: vi.fn().mockResolvedValue(true),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      serverTimeMs: vi.fn().mockResolvedValue(1_000_000),
    };
    service = makeService();
  });

  describe("acquireOnLaunch", () => {
    it("acquires the lease, indexes match:active, and records ownership", async () => {
      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(true);

      expect(redis.acquireLeaseWithFence).toHaveBeenCalledWith(
        "match:owner:m1",
        "match:fence:m1",
        "node-a",
        LEASE_TTL_SEC,
      );
      expect(redis.sadd).toHaveBeenCalledWith(ACTIVE_SET, "m1");
      expect(service.isOwner("m1")).toBe(true);
      expect(service.getOwnedMatchIds()).toEqual(["m1"]);
      expect(service.getLeaseValue("m1")).toBe("node-a:1");
    });

    it("returns false and records nothing when the lease is already held", async () => {
      redis.acquireLeaseWithFence.mockResolvedValueOnce(null);

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(service.isOwner("m1")).toBe(false);
      expect(redis.sadd).not.toHaveBeenCalled();
    });

    it("returns false without recording ownership when the post-index renew fails", async () => {
      // Lease taken over between acquire and the active-index write.
      redis.renewLease.mockResolvedValue(false);

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(service.isOwner("m1")).toBe(false);
      // The active-index write still happened, so the match stays discoverable.
      expect(redis.sadd).toHaveBeenCalledWith(ACTIVE_SET, "m1");
    });

    it("releases the lease + index atomically and returns false when addActiveMatch fails every retry", async () => {
      redis.sadd.mockRejectedValue(new Error("redis down"));

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(service.isOwner("m1")).toBe(false);
      // Compensation goes through the atomic release-and-deindex CAS, never the
      // lease-only release (which would strand an owner-less match:active entry).
      expect(redis.releaseLeaseAndIndex).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:1",
        ACTIVE_SET,
        "m1",
      );
      expect(redis.releaseLease).not.toHaveBeenCalled();
    });

    it("atomically releases lease + index when renewLease exhausts its retry budget after indexing", async () => {
      // addActiveMatch (sadd) succeeds on every attempt so the match IS in
      // match:active, but the post-index renew throws all three times. The
      // compensation must remove BOTH the lease and the index entry atomically
      // (releaseLeaseAndIndex) — a lease-only release would orphan the index.
      redis.sadd.mockResolvedValue(1);
      redis.renewLease.mockRejectedValue(new Error("redis blip"));

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);

      expect(service.isOwner("m1")).toBe(false);
      expect(redis.releaseLeaseAndIndex).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:1",
        ACTIVE_SET,
        "m1",
      );
      expect(redis.releaseLease).not.toHaveBeenCalled();
    });

    it("hands off to match:active when the lease release cannot be proven", async () => {
      // addActiveMatch fails during indexing (all retries), then the atomic
      // release CAS also fails and the confirming read still shows our lease.
      let saddCalls = 0;
      redis.sadd.mockImplementation(async () => {
        saddCalls++;
        if (saddCalls <= 3) throw new Error("index write failed");
        return 1; // the final recovery handoff succeeds
      });
      redis.releaseLeaseAndIndex.mockResolvedValue(false);
      redis.get.mockResolvedValue("node-a:1"); // still ours ⇒ unproven release

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(service.isOwner("m1")).toBe(false);
      // The handoff re-adds the match to the index for B3b's orphan sweep.
      expect(saddCalls).toBeGreaterThan(3);
    });

    it("treats a thrown acquireLeaseWithFence as a recovery handoff and returns false", async () => {
      redis.acquireLeaseWithFence.mockRejectedValueOnce(
        new Error("truncated Lua payload"),
      );

      await expect(service.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(service.isOwner("m1")).toBe(false);
      // Recovery handoff ensured the match is in match:active.
      expect(redis.sadd).toHaveBeenCalledWith(ACTIVE_SET, "m1");
    });
  });

  describe("second instance", () => {
    it("cannot acquire a lease another node holds", async () => {
      // First node acquires.
      await service.acquireOnLaunch("m1", "r1");

      // Second node against the same (mock) Redis: lease already held → null.
      const redis2 = { ...redis, acquireLeaseWithFence: vi.fn() };
      redis2.acquireLeaseWithFence.mockResolvedValue(null);
      const cluster2 = { nodeId: "node-b" } as unknown as ClusterService;
      const svc2 = new MatchOwnershipService(
        redis2 as unknown as RedisService,
        cluster2,
      );

      await expect(svc2.acquireOnLaunch("m1", "r1")).resolves.toBe(false);
      expect(svc2.isOwner("m1")).toBe(false);
    });
  });

  describe("release", () => {
    it("atomically releases the lease + index via a single CAS", async () => {
      await service.acquireOnLaunch("m1", "r1");

      await service.release("m1");

      expect(redis.releaseLeaseAndIndex).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:1",
        ACTIVE_SET,
        "m1",
      );
      expect(service.isOwner("m1")).toBe(false);
    });

    it("drops local ownership but leaves Redis untouched when the CAS fails (ownership moved)", async () => {
      await service.acquireOnLaunch("m1", "r1");
      redis.releaseLeaseAndIndex.mockResolvedValue(false);

      await service.release("m1");

      expect(service.isOwner("m1")).toBe(false);
      // CAS returned false → the new owner's lease + index are left intact.
      expect(redis.srem).not.toHaveBeenCalled();
    });

    it("logs and leaves the entry for recovery when the CAS throws every retry", async () => {
      await service.acquireOnLaunch("m1", "r1");
      redis.releaseLeaseAndIndex.mockRejectedValue(new Error("redis down"));
      const errorSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "error",
      );

      await service.release("m1");

      expect(service.isOwner("m1")).toBe(false);
      expect(redis.releaseLeaseAndIndex).toHaveBeenCalledTimes(3);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("is a no-op for a match this node does not own", async () => {
      await service.release("unknown");
      expect(redis.releaseLeaseAndIndex).not.toHaveBeenCalled();
    });
  });

  describe("assertOwnership (B2c)", () => {
    it("returns false for a match this node does not own", async () => {
      await expect(service.assertOwnership("m1")).resolves.toBe(false);
      expect(redis.renewLease).not.toHaveBeenCalled();
    });

    it("returns true and renews the lease for an owned match", async () => {
      await service.acquireOnLaunch("m1", "r1");
      redis.renewLease.mockClear();
      redis.renewLease.mockResolvedValue(true);

      await expect(service.assertOwnership("m1")).resolves.toBe(true);
      expect(redis.renewLease).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:1",
        LEASE_TTL_SEC,
      );
    });

    it("returns false and relinquishes when the renew shows the lease is lost", async () => {
      await service.acquireOnLaunch("m1", "r1");
      const runner = { cancelMatchLoop: vi.fn() };
      service.setRoundRunner(runner);
      redis.renewLease.mockResolvedValue(false); // fence bumped by a takeover

      await expect(service.assertOwnership("m1")).resolves.toBe(false);
      expect(runner.cancelMatchLoop).toHaveBeenCalledWith("m1");
      expect(service.isOwner("m1")).toBe(false);
    });

    it("recovers ownership when a transient renew error resolves within the retry budget", async () => {
      await service.acquireOnLaunch("m1", "r1");
      const runner = { cancelMatchLoop: vi.fn() };
      service.setRoundRunner(runner);
      redis.renewLease
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValueOnce(true);

      await expect(service.assertOwnership("m1")).resolves.toBe(true);
      expect(runner.cancelMatchLoop).not.toHaveBeenCalled();
      expect(service.isOwner("m1")).toBe(true);
    });

    it("relinquishes for failover when the renew stays unavailable across all attempts", async () => {
      await service.acquireOnLaunch("m1", "r1");
      const runner = { cancelMatchLoop: vi.fn() };
      service.setRoundRunner(runner);
      // Every renewal attempt throws (Redis unreachable) — unrecoverable.
      redis.renewLease.mockRejectedValue(new Error("redis down"));

      await expect(service.assertOwnership("m1")).resolves.toBe(false);
      // Relinquished: timers cancelled + local ownership dropped so the lease
      // self-expires and another node can adopt the match.
      expect(runner.cancelMatchLoop).toHaveBeenCalledWith("m1");
      expect(service.isOwner("m1")).toBe(false);
    });
  });

  describe("heartbeat (B2c)", () => {
    it("renews every owned lease", async () => {
      await service.acquireOnLaunch("m1", "r1");
      await service.acquireOnLaunch("m2", "r2");
      redis.renewLease.mockClear();
      redis.renewLease.mockResolvedValue(true);

      await service.heartbeat();

      expect(redis.renewLease).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:1",
        LEASE_TTL_SEC,
      );
      expect(redis.renewLease).toHaveBeenCalledWith(
        "match:owner:m2",
        "node-a:1",
        LEASE_TTL_SEC,
      );
    });

    it("relinquishes a match (cancels timers, drops ownership) when its lease is lost", async () => {
      await service.acquireOnLaunch("m1", "r1");
      const runner = { cancelMatchLoop: vi.fn() };
      service.setRoundRunner(runner);
      redis.renewLease.mockResolvedValue(false);

      await service.heartbeat();

      expect(runner.cancelMatchLoop).toHaveBeenCalledWith("m1");
      expect(service.isOwner("m1")).toBe(false);
    });

    it("keeps ownership on a transient renew error (unproven loss)", async () => {
      await service.acquireOnLaunch("m1", "r1");
      redis.renewLease.mockRejectedValue(new Error("redis blip"));

      await service.heartbeat();

      expect(service.isOwner("m1")).toBe(true);
    });

    it("does not relinquish reacquired ownership when a stale renewal from a prior epoch resolves late", async () => {
      // Race: the match is released and reacquired (new lease/fence) while a
      // heartbeat's renew for the OLD lease is still in flight. When that stale
      // renewal finally resolves `false`, it must NOT relinquish the freshly
      // reacquired ownership (which would cancel the new match's timers).
      await service.acquireOnLaunch("m1", "r1");
      const runner = { cancelMatchLoop: vi.fn() };
      service.setRoundRunner(runner);

      // Hold the heartbeat's renew for the current (soon-to-be-stale) lease.
      let resolveStaleRenew!: (held: boolean) => void;
      redis.renewLease.mockImplementationOnce(
        () => new Promise<boolean>((r) => (resolveStaleRenew = r)),
      );
      const beat = service.heartbeat(); // renew for node-a:1 now pending
      await Promise.resolve();

      // Release and reacquire the same match → fresh entry (node-a:2).
      await service.release("m1");
      redis.acquireLeaseWithFence.mockResolvedValueOnce({
        fence: 2,
        leaseValue: "node-a:2",
      });
      await service.acquireOnLaunch("m1", "r1");
      expect(service.getLeaseValue("m1")).toBe("node-a:2");

      // The stale renewal (for the old lease) reports the lease is lost.
      resolveStaleRenew(false);
      await beat;

      // Reacquired ownership survives: no relinquish of the new epoch's entry.
      expect(runner.cancelMatchLoop).not.toHaveBeenCalled();
      expect(service.isOwner("m1")).toBe(true);
      expect(service.getLeaseValue("m1")).toBe("node-a:2");
    });

    it("publishes a clock offset against the shared Redis clock and indexes the node", async () => {
      redis.serverTimeMs.mockResolvedValue(2_000_000);
      await service.heartbeat();

      // set(node:clock:<nodeId>, "<offset>", ttl) + sadd(node:clocks, nodeId)
      expect(redis.set).toHaveBeenCalledWith(
        "node:clock:node-a",
        expect.any(String),
        expect.any(Number),
      );
      expect(redis.sadd).toHaveBeenCalledWith("node:clocks", "node-a");
    });

    it("does not overlap concurrent ticks (in-flight guard)", async () => {
      let resolveTime: (v: number) => void = () => undefined;
      redis.serverTimeMs.mockImplementation(
        () => new Promise<number>((r) => (resolveTime = r)),
      );
      const first = service.heartbeat();
      const second = service.heartbeat(); // should early-return
      // The heartbeat now renews owned leases BEFORE publishing the clock
      // offset, so serverTimeMs is only invoked a few microtasks in. Wait until
      // it is actually called before resolving, so the captured resolver is the
      // real one (not the initial no-op).
      while (redis.serverTimeMs.mock.calls.length === 0) {
        await Promise.resolve();
      }
      resolveTime(1_000_000);
      await Promise.all([first, second]);
      expect(redis.serverTimeMs).toHaveBeenCalledTimes(1);
    });
  });

  describe("computeMaxSkew (B2c)", () => {
    it("returns 0 with fewer than two live members", async () => {
      redis.smembers.mockResolvedValue(["node-a"]);
      redis.get.mockResolvedValue("5");
      await expect(service.computeMaxSkew()).resolves.toBe(0);
    });

    it("returns max(offset) - min(offset) across live members", async () => {
      redis.smembers.mockResolvedValue(["a", "b", "c"]);
      redis.get.mockImplementation(async (key: string) => {
        if (key === "node:clock:a") return "10";
        if (key === "node:clock:b") return "-5";
        if (key === "node:clock:c") return "3";
        return null;
      });
      // spread = 10 - (-5) = 15
      await expect(service.computeMaxSkew()).resolves.toBe(15);
    });

    it("prunes an expired clock key from the index on read", async () => {
      redis.smembers.mockResolvedValue(["a", "dead"]);
      redis.get.mockImplementation(async (key: string) =>
        key === "node:clock:a" ? "7" : null,
      );
      await service.computeMaxSkew();
      expect(redis.srem).toHaveBeenCalledWith("node:clocks", "dead");
    });
  });
});
