import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  MatchCommandService,
  OWNER_GROUP,
  CMD_DEAD_LETTER_SET,
  type CommandEnvelope,
  type SubmitAnswerBody,
  type CommandDispatcher,
} from "./match-command.service";
import type { RedisService } from "../redis/redis.service";
import type { MatchService } from "./match.service";
import type { MatchOwnershipService } from "./match-ownership.service";
import type { ClusterService } from "../cluster/cluster.service";

type RedisMock = Record<string, ReturnType<typeof vi.fn>>;

function submitEnv(
  overrides: Partial<CommandEnvelope<SubmitAnswerBody>> = {},
): CommandEnvelope<SubmitAnswerBody> {
  return {
    eventId: "evt-1",
    schemaVersion: 1,
    matchId: "m1",
    emittedByNodeId: "node-b",
    emittedAt: 1000,
    body: {
      type: "submit_answer",
      userId: "p1",
      answer: "A",
      submissionId: "sub-1",
      clientTs: 900,
    },
    ...overrides,
  };
}

describe("MatchCommandService (B4a)", () => {
  let redis: RedisMock;
  let matchService: Record<string, ReturnType<typeof vi.fn>>;
  let ownership: { currentFence: ReturnType<typeof vi.fn> };
  let service: MatchCommandService;
  const server = {} as Server;

  const make = (nodeId = "node-a") => {
    const cluster = { nodeId } as unknown as ClusterService;
    const svc = new MatchCommandService(
      redis as unknown as RedisService,
      matchService as unknown as MatchService,
      ownership as unknown as MatchOwnershipService,
      cluster,
    );
    (svc as unknown as { logger: Logger }).logger = new Logger("t", {
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
      xadd: vi.fn().mockResolvedValue("1-0"),
      xreadgroup: vi.fn().mockResolvedValue([]),
      xack: vi.fn().mockResolvedValue(1),
      xdel: vi.fn().mockResolvedValue(1),
      xgroupCreate: vi.fn().mockResolvedValue(undefined),
      xautoclaim: vi.fn().mockResolvedValue({ nextCursor: "0-0", claimed: [] }),
      xdelStream: vi.fn().mockResolvedValue(undefined),
      sadd: vi.fn().mockResolvedValue(1),
      sismember: vi.fn().mockResolvedValue(false),
      set: vi.fn().mockResolvedValue(undefined),
    };
    matchService = {
      getStateMachine: vi.fn(),
      persistStateMachine: vi.fn().mockResolvedValue("APPLIED"),
      evictStateMachine: vi.fn(),
    };
    ownership = {
      currentFence: vi
        .fn()
        .mockReturnValue({ fence: 5, leaseValue: "node-a:5" }),
    };
    service = make();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it("forward XADDs the JSON envelope to match:cmd:<id>", async () => {
    const env = submitEnv();
    await service.forward(env);
    expect(redis.xadd).toHaveBeenCalledWith(
      "match:cmd:m1",
      JSON.stringify(env),
    );
  });

  it("apply aborts with RETRY (no dispatch) when the lease is lost", async () => {
    ownership.currentFence.mockReturnValue(null);
    const dispatcher = vi.fn();
    service.setDispatcher(dispatcher);

    await expect(service.applySubmitAnswer(submitEnv(), server)).resolves.toBe(
      "RETRY",
    );
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("apply dispatches with the current owner snapshot when still owner", async () => {
    const dispatcher = vi.fn<CommandDispatcher>().mockResolvedValue("APPLIED");
    service.setDispatcher(dispatcher);

    await expect(service.applySubmitAnswer(submitEnv(), server)).resolves.toBe(
      "APPLIED",
    );
    expect(dispatcher).toHaveBeenCalledWith(
      submitEnv(),
      { fence: 5, leaseValue: "node-a:5" },
      server,
    );
  });

  it("apply returns RETRY when no dispatcher is wired yet (nothing acked/lost)", async () => {
    await expect(service.applySubmitAnswer(submitEnv(), server)).resolves.toBe(
      "RETRY",
    );
  });

  it("processEntry XACKs a valid entry on a non-RETRY outcome", async () => {
    service.setDispatcher(vi.fn().mockResolvedValue("APPLIED"));

    await service.processEntry(
      "m1",
      { id: "1-0", data: JSON.stringify(submitEnv()) },
      server,
    );

    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "1-0");
  });

  it("processEntry leaves a RETRY entry pending (no XACK)", async () => {
    service.setDispatcher(vi.fn().mockResolvedValue("RETRY"));

    await service.processEntry(
      "m1",
      { id: "1-0", data: JSON.stringify(submitEnv()) },
      server,
    );

    expect(redis.xack).not.toHaveBeenCalled();
  });

  it("processEntry XACKs a player_disconnect entry when the side effect returns APPLIED", async () => {
    // B5: the disconnect side effect reports the underlying persist outcome.
    // On APPLIED (and on the pre-condition NOOP) the entry is XACKed.
    service.setSideEffects({
      publishAnswerResult: vi.fn(),
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      handlePlayerDisconnect: vi.fn().mockResolvedValue("APPLIED"),
    });

    const env = {
      eventId: "evt-dc-1",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect", userId: "p1" },
    };

    await service.processEntry(
      "m1",
      { id: "9-0", data: JSON.stringify(env) },
      server,
    );

    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "9-0");
  });

  it("processEntry leaves a player_disconnect entry pending when the side effect returns RETRY (lease lost)", async () => {
    // B5 hardening (symmetric with submit_answer): a non-APPLIED outcome from
    // the runner (RETRY/BLIND) MUST be mapped to "RETRY" by the side effect so
    // the entry stays pending and the new owner re-evaluates. Without this,
    // the entry would be XACKed and the disconnect silently dropped.
    service.setSideEffects({
      publishAnswerResult: vi.fn(),
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      handlePlayerDisconnect: vi.fn().mockResolvedValue("RETRY"),
    });

    const env = {
      eventId: "evt-dc-2",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect", userId: "p1" },
    };

    await service.processEntry(
      "m1",
      { id: "9-1", data: JSON.stringify(env) },
      server,
    );

    expect(redis.xack).not.toHaveBeenCalled();
    // RETRY must NOT mark the eventId applied — next owner reprocesses.
    expect(redis.sadd).not.toHaveBeenCalledWith("match:applied:m1", "evt-dc-2");
  });

  it("processEntry acks a redelivered player_disconnect without re-invoking the side effect", async () => {
    // eventId already in match:applied → ackable no-op (no second PLAYER_LEFT).
    redis.sismember.mockResolvedValue(true);
    const handlePlayerDisconnect = vi.fn().mockResolvedValue("APPLIED");
    service.setSideEffects({
      publishAnswerResult: vi.fn(),
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      handlePlayerDisconnect,
    });

    const env = {
      eventId: "evt-dc-dup",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect", userId: "p1" },
    };

    await service.processEntry(
      "m1",
      { id: "9-2", data: JSON.stringify(env) },
      server,
    );

    expect(handlePlayerDisconnect).not.toHaveBeenCalled();
    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "9-2");
  });

  it("processEntry records eventId after a successful player_disconnect apply", async () => {
    const handlePlayerDisconnect = vi.fn().mockResolvedValue("APPLIED");
    service.setSideEffects({
      publishAnswerResult: vi.fn(),
      checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      handlePlayerDisconnect,
    });

    const env = {
      eventId: "evt-dc-3",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect", userId: "p1" },
    };

    await service.processEntry(
      "m1",
      { id: "9-3", data: JSON.stringify(env) },
      server,
    );

    expect(handlePlayerDisconnect).toHaveBeenCalledOnce();
    expect(redis.sadd).toHaveBeenCalledWith("match:applied:m1", "evt-dc-3");
    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "9-3");
  });

  it("processEntry dead-letters an invalid entry, then XACKs + XDELs it", async () => {
    await service.processEntry("m1", { id: "1-0", data: "{not json" }, server);

    expect(redis.sadd).toHaveBeenCalledWith(CMD_DEAD_LETTER_SET, "m1");
    expect(redis.set).toHaveBeenCalled();
    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "1-0");
    expect(redis.xdel).toHaveBeenCalledWith("match:cmd:m1", "1-0");
  });

  it("processEntry does NOT ack an invalid entry when dead-letter persistence fails", async () => {
    redis.set.mockRejectedValue(new Error("redis down"));

    await service.processEntry("m1", { id: "1-0", data: "garbage" }, server);

    expect(redis.xack).not.toHaveBeenCalled();
    expect(redis.xdel).not.toHaveBeenCalled();
  });

  it("parseAndValidate rejects a cross-stream matchId mismatch", () => {
    const env = submitEnv({ matchId: "OTHER" });
    expect(service.parseAndValidate(JSON.stringify(env), "m1")).toBeNull();
  });

  it("parseAndValidate rejects a wrong schemaVersion and an unknown body type", () => {
    expect(
      service.parseAndValidate(
        JSON.stringify({ ...submitEnv(), schemaVersion: 2 }),
        "m1",
      ),
    ).toBeNull();
    expect(
      service.parseAndValidate(
        JSON.stringify({ ...submitEnv(), body: { type: "nope" } }),
        "m1",
      ),
    ).toBeNull();
  });

  it("parseAndValidate accepts a well-formed player_disconnect envelope", () => {
    const env = {
      eventId: "evt-2",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect", userId: "p1" },
    };
    expect(service.parseAndValidate(JSON.stringify(env), "m1")).not.toBeNull();
  });

  it("pollOnce XAUTOCLAIMs idle pending entries (failover takeover) before reading new ones", async () => {
    const pendingEnv = submitEnv({ eventId: "evt-pending" });
    redis.xautoclaim.mockResolvedValueOnce({
      nextCursor: "0-0",
      claimed: [{ id: "7-0", data: JSON.stringify(pendingEnv) }],
    });
    service.setDispatcher(vi.fn().mockResolvedValue("APPLIED"));

    await service.pollOnce("m1", server);

    expect(redis.xautoclaim).toHaveBeenCalledWith(
      "match:cmd:m1",
      OWNER_GROUP,
      "node-a",
      expect.any(Number),
      "0-0",
      expect.any(Number),
    );
    // The claimed (previously-stranded) entry was processed + acked.
    expect(redis.xack).toHaveBeenCalledWith("match:cmd:m1", OWNER_GROUP, "7-0");
  });

  it("registerMatch creates the consumer group with MKSTREAM (idempotent)", async () => {
    await service.registerMatch("m1", server);
    expect(redis.xgroupCreate).toHaveBeenCalledWith(
      "match:cmd:m1",
      OWNER_GROUP,
      { mkStream: true },
    );
    // Second register is a no-op group-wise.
    redis.xgroupCreate.mockClear();
    await service.registerMatch("m1", server);
    expect(redis.xgroupCreate).not.toHaveBeenCalled();
    service.deregisterMatch("m1");
  });

  describe("applyAnswerAuthoritative (B4b single-writer)", () => {
    const owner = { fence: 5, leaseValue: "node-a:5" };
    let sideEffects: {
      publishAnswerResult: ReturnType<typeof vi.fn>;
      checkEarlyTermination: ReturnType<typeof vi.fn>;
    };

    const machine = (answers = new Map<string, unknown>()) =>
      ({
        getState: () => ({ roomId: "r1", currentRoundNo: 1 }),
        getCurrentRound: () => ({ roundNo: 1, answers }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "sub-1",
          isCorrect: true,
          responseTimeMs: 500,
        }),
      }) as any;

    beforeEach(() => {
      sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);
      redis.sismember = vi.fn().mockResolvedValue(false);
      redis.sadd = vi.fn().mockResolvedValue(1);
    });

    it("APPLIED: persists, records the eventId, publishes ANSWER_RESULT, runs early termination", async () => {
      const sm = machine();
      matchService.getStateMachine.mockResolvedValue(sm);

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("APPLIED");

      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(redis.sadd).toHaveBeenCalledWith("match:applied:m1", "evt-1");
      expect(sideEffects.publishAnswerResult).toHaveBeenCalled();
      expect(sideEffects.checkEarlyTermination).toHaveBeenCalledWith(
        "m1",
        "r1",
        server,
      );
    });

    it("RETRY: a persist non-APPLIED evicts the unpersisted mutation and emits nothing", async () => {
      matchService.getStateMachine.mockResolvedValue(machine());
      matchService.persistStateMachine.mockResolvedValue("RETRY");

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("RETRY");

      expect(matchService.evictStateMachine).toHaveBeenCalledWith("m1");
      expect(redis.sadd).not.toHaveBeenCalled();
      expect(sideEffects.publishAnswerResult).not.toHaveBeenCalled();
    });

    it("same submissionId (incomplete prior attempt): heals via recoverDuplicateEvent before ack", async () => {
      const answers = new Map([
        ["p1", { submissionId: "sub-1", isCorrect: true, responseTimeMs: 500 }],
      ]);
      const sm = machine(answers);
      matchService.getStateMachine.mockResolvedValue(sm);

      // eventId not in applied (sadd may have failed on the first attempt), but
      // the answer is already in SM → route through recover, not a silent no-op.
      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("DUPLICATE_EVENT");

      expect(sm.submitAnswer).not.toHaveBeenCalled();
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(sideEffects.publishAnswerResult).toHaveBeenCalled();
      expect(sideEffects.checkEarlyTermination).toHaveBeenCalledWith(
        "m1",
        "r1",
        server,
      );
    });

    it("APPLIED: sadd failure after side effects still returns APPLIED; redelivery heals via DUPLICATE_EVENT", async () => {
      const answers = new Map<string, unknown>();
      const sm = machine(answers);
      matchService.getStateMachine.mockResolvedValue(sm);
      // First call: sadd rejects → return APPLIED without a durable marker.
      redis.sadd = vi.fn().mockRejectedValue(new Error("sadd boom"));

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("APPLIED");

      expect(sideEffects.publishAnswerResult).toHaveBeenCalledTimes(1);
      expect(sideEffects.checkEarlyTermination).toHaveBeenCalledTimes(1);

      // Second call (redelivery with the same envelope): sadd now succeeds and
      // the answer is already in SM (same submissionId) → recoverDuplicateEvent
      // re-publishes the canonical answer result, not submitAnswer.
      redis.sadd = vi.fn().mockResolvedValue(1);
      answers.set("p1", {
        submissionId: "sub-1",
        isCorrect: true,
        responseTimeMs: 500,
      });
      sideEffects.publishAnswerResult.mockClear();
      sideEffects.checkEarlyTermination.mockClear();
      sm.submitAnswer.mockClear();
      matchService.persistStateMachine.mockClear();

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("DUPLICATE_EVENT");

      expect(sm.submitAnswer).not.toHaveBeenCalled();
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      // Recovery republishes the canonical result idempotently.
      expect(sideEffects.publishAnswerResult).toHaveBeenCalledTimes(1);
      expect(sideEffects.checkEarlyTermination).toHaveBeenCalledTimes(1);
    });

    it("recoverDuplicateEvent returns RETRY (no publish) when the lease is lost mid-recovery", async () => {
      const answers = new Map([
        ["p1", { submissionId: "sub-1", isCorrect: true, responseTimeMs: 500 }],
      ]);
      const sm = machine(answers);
      matchService.getStateMachine.mockResolvedValue(sm);

      // Outer apply() fence: owner alive. Recovery entry fence: owner alive.
      // Recovery pre-publish fence: lease taken over by another node → must
      // abort, not broadcast.
      ownership.currentFence
        .mockReturnValueOnce({ fence: 5, leaseValue: "node-a:5" })
        .mockReturnValueOnce({ fence: 5, leaseValue: "node-a:5" })
        .mockReturnValueOnce(null);

      await expect(
        service.applySubmitAnswer(submitEnv(), server),
      ).resolves.toBe("RETRY");

      expect(ownership.currentFence.mock.calls.length).toBeGreaterThanOrEqual(
        3,
      );
      expect(sideEffects.publishAnswerResult).not.toHaveBeenCalled();
      expect(sideEffects.checkEarlyTermination).not.toHaveBeenCalled();
    });

    it("DUPLICATE_EVENT: a redelivered eventId re-publishes the persisted result idempotently (heal)", async () => {
      redis.sismember.mockResolvedValue(true); // eventId already applied
      const answers = new Map([
        ["p1", { submissionId: "sub-1", isCorrect: true, responseTimeMs: 500 }],
      ]);
      matchService.getStateMachine.mockResolvedValue(machine(answers));

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("DUPLICATE_EVENT");

      // No new persist, but the canonical result is re-emitted for the submitter.
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
      expect(sideEffects.publishAnswerResult).toHaveBeenCalled();
    });

    it("RETRY: a dedup read failure aborts without applying or acking", async () => {
      redis.sismember.mockRejectedValue(new Error("redis down"));

      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("RETRY");

      expect(matchService.getStateMachine).not.toHaveBeenCalled();
    });
  });
});
