import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import { MatchStateMachine } from "@arena/game-core";
import {
  MatchOwnershipService,
  RECOVERY_MAX_RETRIES,
} from "./match-ownership.service";
import type { RedisService } from "../redis/redis.service";
import type { ClusterService } from "../cluster/cluster.service";

// ============================================================
// B3b — boot recovery, orphan sweep, retry/dead-letter, requeue.
// The RedisService failover primitives are mocked (their Lua is unit
// tested in redis.service.spec); here we assert the SERVICE's
// orchestration: acquire → hydrate → revalidate → resume, and the
// three-way TERMINAL / null / acquired branches.
// ============================================================

type RedisMock = Record<string, ReturnType<typeof vi.fn>>;

function makeSm(roomId = "room-1", status = "COUNTDOWN"): MatchStateMachine {
  return {
    getState: () => ({ roomId, status }),
    getEventLog: () => [],
    getCurrentRound: () => null,
  } as unknown as MatchStateMachine;
}

describe("MatchOwnershipService recovery (B3b)", () => {
  let redis: RedisMock;
  let recovery: {
    getStateMachine: ReturnType<typeof vi.fn>;
    getRoomIdByMatchId: ReturnType<typeof vi.fn>;
    resumeMatchLoop: ReturnType<typeof vi.fn>;
  };
  let service: MatchOwnershipService;
  const server = {} as Server;

  const make = (nodeId = "node-a") => {
    const cluster = { nodeId } as unknown as ClusterService;
    const svc = new MatchOwnershipService(
      redis as unknown as RedisService,
      cluster,
    );
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
    svc.setRecoveryDeps(recovery);
    return svc;
  };

  beforeEach(() => {
    redis = {
      acquireMatchLease: vi
        .fn()
        .mockResolvedValue({ fence: 5, leaseValue: "node-a:5" }),
      renewLease: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      releaseLeaseAndIndex: vi.fn().mockResolvedValue(true),
      removeActiveIfStateAbsent: vi.fn().mockResolvedValue("PRESENT"),
      removeActiveIfTombstoned: vi.fn().mockResolvedValue("REMOVED"),
      finalizeMatchTombstone: vi.fn().mockResolvedValue("FINALIZED"),
      requeueDeadLetter: vi.fn().mockResolvedValue("REQUEUED"),
      smembers: vi.fn().mockResolvedValue([]),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      serverTimeMs: vi.fn().mockResolvedValue(1_000_000),
    };
    recovery = {
      getStateMachine: vi.fn().mockResolvedValue(makeSm()),
      getRoomIdByMatchId: vi.fn().mockResolvedValue("room-1"),
      resumeMatchLoop: vi.fn().mockResolvedValue(undefined),
    };
    service = make();
  });

  afterEach(() => {
    service.onModuleDestroy(); // clears any scheduled retry timers
  });

  // ---- attemptRecovery: the three-way acquire branch ----------

  it("acquires, hydrates, revalidates, and resumes an owner-less match", async () => {
    await (service as any).attemptRecovery("m1", server);

    expect(redis.acquireMatchLease).toHaveBeenCalledWith(
      "match:owner:m1",
      "match:fence:m1",
      "match:tombstone:m1",
      "node-a",
      15,
    );
    expect(recovery.getStateMachine).toHaveBeenCalledWith("m1");
    expect(recovery.resumeMatchLoop).toHaveBeenCalledWith(
      "m1",
      expect.anything(),
      "room-1",
      server,
    );
    expect(service.isOwner("m1")).toBe(true);
  });

  it("TERMINAL: a tombstoned match is dropped and removed from match:active, never resumed", async () => {
    redis.acquireMatchLease.mockResolvedValue("TERMINAL");

    await (service as any).attemptRecovery("m1", server);

    expect(redis.removeActiveIfTombstoned).toHaveBeenCalledWith(
      "match:tombstone:m1",
      "match:active",
      "m1",
    );
    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
    expect(service.isOwner("m1")).toBe(false);
    // No retry context left for a terminal match.
    expect((service as any).retries.has("m1")).toBe(false);
  });

  it("null (live owner): does not resume, does not clean the index, leaves the match discoverable", async () => {
    redis.acquireMatchLease.mockResolvedValue(null);

    await (service as any).attemptRecovery("m1", server);

    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
    expect(redis.removeActiveIfTombstoned).not.toHaveBeenCalled();
    expect(redis.finalizeMatchTombstone).not.toHaveBeenCalled();
    expect(service.isOwner("m1")).toBe(false);
  });

  it("cleaned: a confirmed-absent state finalizes the tombstone (reason=cleaned), never resumes", async () => {
    recovery.getStateMachine.mockResolvedValue(undefined);

    await (service as any).attemptRecovery("m1", server);

    expect(redis.finalizeMatchTombstone).toHaveBeenCalledWith(
      "match:owner:m1",
      "match:fence:m1",
      "match:tombstone:m1",
      "match:active",
      "match:recovery:dead-letter",
      "m1",
      expect.objectContaining({ reason: "cleaned", expectedFence: 5 }),
    );
    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
    expect(service.isOwner("m1")).toBe(false);
  });

  it("recoverable hydrate failure: keeps the lease, schedules a retry, does NOT clean the index", async () => {
    recovery.getStateMachine.mockRejectedValue(new Error("redis timeout"));

    await (service as any).attemptRecovery("m1", server);

    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
    expect(redis.finalizeMatchTombstone).not.toHaveBeenCalled();
    expect(redis.removeActiveIfTombstoned).not.toHaveBeenCalled();
    // Lease retained (heartbeat renews) + a retry is scheduled.
    expect(service.isOwner("m1")).toBe(true);
    expect((service as any).retries.has("m1")).toBe(true);
  });

  it("lost lease before resume aborts and preserves match:active for the new owner", async () => {
    // Acquire succeeds, but the pre-resume revalidation renew fails.
    redis.renewLease.mockResolvedValue(false);

    await (service as any).attemptRecovery("m1", server);

    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
    expect(redis.finalizeMatchTombstone).not.toHaveBeenCalled();
    expect(service.isOwner("m1")).toBe(false);
  });

  // ---- boot recovery scan -------------------------------------

  it("boot: buffers ONLY the matchId before the server is wired (no acquire/hydrate)", async () => {
    redis.smembers.mockResolvedValue(["m1"]);
    // no setServer yet

    await (service as any).recoverOnBoot();

    expect(redis.acquireMatchLease).not.toHaveBeenCalled();
    expect(recovery.getStateMachine).not.toHaveBeenCalled();
    expect((service as any).pendingRecovery).toContain("m1");

    // Draining with a wired server completes the full flow.
    service.setServer(server);
    await vi.waitFor(() =>
      expect(recovery.resumeMatchLoop).toHaveBeenCalledWith(
        "m1",
        expect.anything(),
        "room-1",
        server,
      ),
    );
  });

  it("boot: stale index (no state blob) is removed by the conditional cleanup, never acquired", async () => {
    redis.smembers.mockResolvedValue(["m1"]);
    redis.removeActiveIfStateAbsent.mockResolvedValue("REMOVED");
    service.setServer(server);

    await (service as any).recoverOnBoot();

    expect(redis.removeActiveIfStateAbsent).toHaveBeenCalledWith(
      "match:state:m1",
      "match:active",
      "m1",
    );
    expect(redis.acquireMatchLease).not.toHaveBeenCalled();
    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
  });

  // ---- orphan sweep -------------------------------------------

  it("orphan sweep: a peer takes over an owner-less match exactly once", async () => {
    redis.smembers.mockResolvedValue(["m1"]);
    service.setServer(server);

    // Node A wins the acquire; node B sees the lease held (null).
    const recoveryB = {
      getStateMachine: vi.fn().mockResolvedValue(makeSm()),
      getRoomIdByMatchId: vi.fn().mockResolvedValue("room-1"),
      resumeMatchLoop: vi.fn().mockResolvedValue(undefined),
    };
    const redisB: RedisMock = {
      ...redis,
      acquireMatchLease: vi.fn().mockResolvedValue(null), // A already holds it
      smembers: vi.fn().mockResolvedValue(["m1"]),
    };
    const clusterB = { nodeId: "node-b" } as unknown as ClusterService;
    const svcB = new MatchOwnershipService(
      redisB as unknown as RedisService,
      clusterB,
    );
    (svcB as unknown as { logger: Logger }).logger = new Logger("t", {
      timestamp: false,
    });
    vi.spyOn(
      (svcB as unknown as { logger: Logger }).logger,
      "warn",
    ).mockImplementation(() => undefined);
    svcB.setRecoveryDeps(recoveryB);
    svcB.setServer(server);

    await service.orphanSweep();
    await svcB.orphanSweep();

    expect(recovery.resumeMatchLoop).toHaveBeenCalledTimes(1);
    expect(recoveryB.resumeMatchLoop).not.toHaveBeenCalled();
    svcB.onModuleDestroy();
  });

  it("orphan sweep: skips a match this node already drives", async () => {
    redis.smembers.mockResolvedValue(["m1"]);
    (service as any).owned.set("m1", {
      roomId: "room-1",
      fence: 5,
      leaseValue: "node-a:5",
    });
    service.setServer(server);

    await service.orphanSweep();

    expect(redis.acquireMatchLease).not.toHaveBeenCalled();
    expect(recovery.resumeMatchLoop).not.toHaveBeenCalled();
  });

  // ---- dead-letter on retry exhaustion ------------------------

  it("dead-letters the match after RECOVERY_MAX_RETRIES, then releases the lease", async () => {
    (service as any).owned.set("m1", {
      roomId: "room-1",
      fence: 5,
      leaseValue: "node-a:5",
    });
    (service as any).retries.set("m1", {
      count: RECOVERY_MAX_RETRIES,
      timer: null,
    });

    (service as any).scheduleRecoveryRetry("m1", server);
    await vi.waitFor(() =>
      expect(redis.finalizeMatchTombstone).toHaveBeenCalledWith(
        "match:owner:m1",
        "match:fence:m1",
        "match:tombstone:m1",
        "match:active",
        "match:recovery:dead-letter",
        "m1",
        expect.objectContaining({ reason: "dead-letter", expectedFence: 5 }),
      ),
    );
    await vi.waitFor(() =>
      expect(redis.releaseLease).toHaveBeenCalledWith(
        "match:owner:m1",
        "node-a:5",
      ),
    );
    expect(service.isOwner("m1")).toBe(false);
  });

  // ---- requeue (ops) ------------------------------------------

  it("requeueMatch delegates to the gated Lua op with the force flag", async () => {
    redis.requeueDeadLetter.mockResolvedValue("REQUEUED");

    await expect(service.requeueMatch("m1", true)).resolves.toBe("REQUEUED");

    expect(redis.requeueDeadLetter).toHaveBeenCalledWith(
      "match:tombstone:m1",
      "match:state:m1",
      "match:owner:m1",
      "match:fence:m1",
      "match:active",
      "match:recovery:dead-letter",
      "m1",
      { force: true },
    );
  });

  it("requeueMatch surfaces each gate rejection verbatim", async () => {
    for (const outcome of [
      "NOT_TERMINAL",
      "INVALID_TOMBSTONE",
      "FINALIZED",
      "NO_STATE",
      "CONFLICT",
    ] as const) {
      redis.requeueDeadLetter.mockResolvedValueOnce(outcome);
      await expect(service.requeueMatch("m1")).resolves.toBe(outcome);
    }
  });
});
