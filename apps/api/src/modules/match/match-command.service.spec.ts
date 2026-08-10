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
  type CommandOutcome,
} from "./match-command.service";
import type { RedisService } from "../redis/redis.service";
import type { MatchService } from "./match.service";
import type { MatchOwnershipService } from "./match-ownership.service";
import type { ClusterService } from "../cluster/cluster.service";

type RedisMock = Record<string, ReturnType<typeof vi.fn>>;

type PrivateApplyService = {
  apply(env: CommandEnvelope, server: Server): Promise<CommandOutcome>;
};

function applyPrivate(
  svc: MatchCommandService,
  env: CommandEnvelope,
  server: Server,
): Promise<CommandOutcome> {
  return (svc as unknown as PrivateApplyService).apply(env, server);
}

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
      del: vi.fn().mockResolvedValue(1),
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
    (service as any).registered.set("m1", {
      server,
      abort: new AbortController(),
      lastClaimAt: 0,
    });

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

  it("pollOnce does not stamp lastClaimAt if registration was deregistered mid-sweep", async () => {
    const reg = { server, abort: new AbortController(), lastClaimAt: 0 };
    (service as any).registered.set("m-dereg", reg);

    redis.xautoclaim.mockImplementationOnce(async () => {
      service.deregisterMatch("m-dereg");
      return { nextCursor: "0-0", claimed: [] };
    });

    await service.pollOnce("m-dereg", server);
    expect(reg.lastClaimAt).toBe(0);
  });

  it("pollOnce does not stamp lastClaimAt if the poll signal is independently aborted after the final empty XAUTOCLAIM page", async () => {
    const reg = { server, abort: new AbortController(), lastClaimAt: 0 };
    (service as any).registered.set("m-signal-abort", reg);
    const pollAc = new AbortController();

    redis.xautoclaim.mockImplementationOnce(async () => {
      pollAc.abort();
      return { nextCursor: "0-0", claimed: [] };
    });

    await service.pollOnce("m-signal-abort", server, pollAc.signal);
    expect(reg.lastClaimAt).toBe(0);
    expect(reg.abort.signal.aborted).toBe(false);
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

  describe("lifecycle (register / deregister / dispose / destroy)", () => {
    it("registerMatch updates the server reference for an already-registered match (no second xgroupCreate)", async () => {
      await service.registerMatch("m1", server);
      const newServer = { different: true } as unknown as Server;
      await service.registerMatch("m1", newServer);

      // Only one MKSTREAM group-create across both calls.
      expect(redis.xgroupCreate).toHaveBeenCalledTimes(1);
      service.deregisterMatch("m1");
    });

    it("registerMatch logs but keeps the registration when xgroupCreate throws", async () => {
      const err = new Error("redis down");
      redis.xgroupCreate.mockRejectedValue(err);

      await service.registerMatch("m1", server);

      // The service must not propagate — the consumer will retry on the next
      // register, and the in-memory `registered` entry is set first.
      const registered = (
        service as unknown as { registered: Map<string, unknown> }
      ).registered;
      expect(registered.has("m1")).toBe(true);

      // And the error must be surfaced via logger.error (mocked in `make`).
      expect(
        vi.mocked((service as unknown as { logger: Logger }).logger.error),
      ).toHaveBeenCalledWith(expect.stringContaining("xgroupCreate failed"));
      service.deregisterMatch("m1");
    });

    it("deregisterMatch aborts the in-flight blocking read and is safe to call for an unknown match", () => {
      // No-op for an unknown match — the consumer was never registered.
      expect(() => service.deregisterMatch("unknown")).not.toThrow();
    });

    it("deregisterMatch clears the polling timer when the last match is removed", async () => {
      await service.registerMatch("m1", server);
      // After register, the poll timer is running.
      const pollTimer = (service as unknown as { pollTimer: unknown })
        .pollTimer;
      expect(pollTimer).not.toBeNull();

      service.deregisterMatch("m1");
      const after = (service as unknown as { pollTimer: unknown }).pollTimer;
      expect(after).toBeNull();
    });

    it("onModuleDestroy aborts all registered consumers and clears the poll timer", async () => {
      await service.registerMatch("m1", server);
      await service.registerMatch("m2", server);

      const registered = (
        service as unknown as {
          registered: Map<string, { abort: AbortController }>;
        }
      ).registered;
      // Debug: confirm we can see the AbortController via the iteration.
      expect(registered.size).toBe(2);
      const ac0 = registered.get("m1")!.abort;
      expect(typeof ac0.abort).toBe("function");
      expect(
        typeof (ac0 as unknown as { signal?: { aborted?: boolean } }).signal
          ?.aborted,
      ).toBe("boolean");

      service.onModuleDestroy();

      expect(registered.size).toBe(0);
      const pollTimer = (service as unknown as { pollTimer: unknown })
        .pollTimer;
      expect(pollTimer).toBeNull();
      // The AbortController's signal flips to aborted=true after .abort() runs.
      expect(ac0.signal.aborted).toBe(true);
    });
  });

  describe("disposeStream", () => {
    it("deletes the stream and the applied-event dedup set", async () => {
      await service.disposeStream("m1");
      expect(redis.xdelStream).toHaveBeenCalledWith("match:cmd:m1");
      expect(redis.del).toHaveBeenCalledWith("match:applied:m1");
    });

    it("swallows and logs a delete failure (no throw)", async () => {
      redis.xdelStream.mockRejectedValueOnce(new Error("boom"));

      await expect(service.disposeStream("m1")).resolves.toBeUndefined();
      // The applied-set DEL is short-circuited by the xdelStream throw
      // (one try/catch wrapping the whole sequence).
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe("pollOnce edges", () => {
    it("returns early on an already-aborted signal (takeover short-circuit)", async () => {
      const ac = new AbortController();
      ac.abort();
      await expect(service.pollOnce("m1", server, ac.signal)).resolves.toBe(0);
      expect(redis.xautoclaim).not.toHaveBeenCalled();
      expect(redis.xreadgroup).not.toHaveBeenCalled();
    });

    it("swallows autoclaim + xreadgroup failures (logs at warn, no throw)", async () => {
      redis.xautoclaim.mockRejectedValueOnce(new Error("boom-autoclaim"));
      redis.xreadgroup.mockRejectedValueOnce(new Error("boom-read"));
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );

      await expect(service.pollOnce("m1", server)).resolves.toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("pollOnce failed"),
      );
    });
  });

  describe("dispatchBuiltin + applySubmitAnswer paths", () => {
    it("applySubmitAnswer routes through the public wrapper (same outcome as apply)", async () => {
      const sm = {
        getState: () => ({ roomId: "r1", currentRoundNo: 2 }),
        getCurrentRound: () => ({
          roundNo: 2,
          answers: new Map<string, unknown>(),
        }),
        submitAnswer: vi.fn().mockReturnValue({
          submissionId: "sub-x",
          isCorrect: true,
          responseTimeMs: 200,
        }),
      } as any;
      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sismember = vi.fn().mockResolvedValue(false);
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);

      const env = submitEnv({
        body: {
          type: "submit_answer",
          userId: "p2",
          answer: "B",
          submissionId: "sub-x",
          clientTs: 100,
        },
      });
      await expect(service.applySubmitAnswer(env, server)).resolves.toBe(
        "APPLIED",
      );
      expect(sideEffects.publishAnswerResult).toHaveBeenCalled();
    });

    it("RETRY when sideEffects is null (submit_answer builtin guard)", async () => {
      // No setSideEffects call → sideEffects is null → dispatchBuiltin
      // returns RETRY for submit_answer.
      const env = submitEnv();
      await expect(service.applySubmitAnswer(env, server)).resolves.toBe(
        "RETRY",
      );
    });

    it("RETRY when state machine is missing (cold path: next owner reprocesses)", async () => {
      matchService.getStateMachine.mockResolvedValue(undefined);
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);

      await expect(
        service.applySubmitAnswer(submitEnv(), server),
      ).resolves.toBe("RETRY");
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION when state machine throws (stale/late command: ack + no broadcast)", async () => {
      const sm = {
        getState: () => ({ roomId: "r1", currentRoundNo: 1 }),
        getCurrentRound: () => ({
          roundNo: 1,
          answers: new Map<string, unknown>(),
        }),
        submitAnswer: vi.fn(() => {
          throw new Error("ROUND_NOT_ACTIVE");
        }),
      } as any;
      matchService.getStateMachine.mockResolvedValue(sm);
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);

      await expect(
        service.applySubmitAnswer(submitEnv(), server),
      ).resolves.toBe("DUPLICATE_SUBMISSION");
      expect(sideEffects.publishAnswerResult).not.toHaveBeenCalled();
    });

    it("RETRY for player_disconnect when no disconnect side effect is wired (B5 not deployed yet)", async () => {
      const env: CommandEnvelope = {
        eventId: "evt-dc-1",
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: { type: "player_disconnect" as const, userId: "p1" },
      };
      // No setSideEffects → no handlePlayerDisconnect → RETRY.
      await expect(applyPrivate(service, env, server)).resolves.toBe("RETRY");
    });
  });

  describe("recoverDuplicateEvent edges", () => {
    it("RETRY when SM is missing in applyAnswerAuthoritative (cold path: next owner reprocesses)", async () => {
      // `applyAnswerAuthoritative` itself short-circuits with RETRY when the
      // state machine is gone — it does NOT route to recoverDuplicateEvent.
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);
      matchService.getStateMachine.mockResolvedValue(undefined);

      const owner = { fence: 5, leaseValue: "node-a:5" };
      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("RETRY");
    });

    it("returns DUPLICATE_EVENT when no current round (post-finish heal)", async () => {
      // To reach recoverDuplicateEvent, the eventId must already be in
      // `match:applied:<id>` (sismember=true) — that is the redelivery path.
      redis.sismember.mockResolvedValue(true);
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);
      const sm = {
        getState: () => ({ roomId: "r1", currentRoundNo: 0 }),
        getCurrentRound: () => null,
      } as any;
      matchService.getStateMachine.mockResolvedValue(sm);

      const owner = { fence: 5, leaseValue: "node-a:5" };
      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("DUPLICATE_EVENT");
    });

    it("returns DUPLICATE_EVENT when the user has no recorded answer in the round", async () => {
      redis.sismember.mockResolvedValue(true);
      const sideEffects = {
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn().mockResolvedValue(undefined),
      };
      service.setSideEffects(sideEffects);
      const sm = {
        getState: () => ({ roomId: "r1", currentRoundNo: 1 }),
        getCurrentRound: () => ({ roundNo: 1, answers: new Map() }),
      } as any;
      matchService.getStateMachine.mockResolvedValue(sm);

      const owner = { fence: 5, leaseValue: "node-a:5" };
      await expect(
        service.applyAnswerAuthoritative(submitEnv(), owner, server),
      ).resolves.toBe("DUPLICATE_EVENT");
    });
  });

  describe("dispatcher override (B4a test hook)", () => {
    it("an injected dispatcher wins over the built-in apply path", async () => {
      const dispatcher = vi.fn().mockResolvedValue("APPLIED" as const);
      service.setDispatcher(dispatcher);

      await expect(applyPrivate(service, submitEnv(), server)).resolves.toBe(
        "APPLIED",
      );
      expect(dispatcher).toHaveBeenCalledWith(
        submitEnv(),
        { fence: 5, leaseValue: "node-a:5" },
        server,
      );
    });
  });

  describe("applyDisconnectAuthoritative edges", () => {
    const dcEnv = (): CommandEnvelope => ({
      eventId: "evt-dc-x",
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "player_disconnect" as const, userId: "p9" },
    });

    it("sadd failure after APPLIED still returns APPLIED (heal via redelivery)", async () => {
      const handle = vi.fn().mockResolvedValue("APPLIED");
      service.setSideEffects({
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn(),
        handlePlayerDisconnect: handle,
      });
      redis.sismember.mockResolvedValue(false);
      redis.sadd.mockRejectedValueOnce(new Error("sadd boom"));

      await expect(applyPrivate(service, dcEnv(), server)).resolves.toBe(
        "APPLIED",
      );
      expect(redis.sadd).toHaveBeenCalledWith("match:applied:m1", "evt-dc-x");
    });

    it("RETRY when dedup read fails (cannot verify redelivery status)", async () => {
      service.setSideEffects({
        publishAnswerResult: vi.fn(),
        checkEarlyTermination: vi.fn(),
        handlePlayerDisconnect: vi.fn().mockResolvedValue("APPLIED"),
      });
      redis.sismember.mockRejectedValueOnce(new Error("boom"));

      await expect(applyPrivate(service, dcEnv(), server)).resolves.toBe(
        "RETRY",
      );
    });
  });

  describe("deadLetterEntry (private — exercised through processEntry)", () => {
    it("logs at warn after persisting the dead-letter entry", async () => {
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );

      await service.processEntry("m1", { id: "1-0", data: "garbage" }, server);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dead-lettered invalid command entry"),
      );
    });

    it("logs at error when sadd to the dead-letter set fails", async () => {
      const errSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "error",
      );
      redis.sadd.mockRejectedValueOnce(new Error("sadd boom"));

      await service.processEntry("m1", { id: "1-0", data: "garbage" }, server);

      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("deadLetterEntry: failed to persist"),
      );
      // Entry left in the PEL: no ack, no xdel.
      expect(redis.xack).not.toHaveBeenCalled();
      expect(redis.xdel).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Coverage gap fill — polling loop iteration + mid-loop abort.
  // ============================================================
  describe("coverage gaps (B4a polling loop)", () => {
    it("ensurePolling iterates every registered match and dispatches a poll", async () => {
      vi.useFakeTimers();
      const pollOnceSpy = vi.spyOn(service, "pollOnce").mockResolvedValue(0);

      // Register two matches — polling loop iterates both.
      await service.registerMatch("m-a", server);
      await service.registerMatch("m-b", server);

      // Advance by POLL_INTERVAL_MS (250) — the setInterval callback fires.
      vi.advanceTimersByTime(250);
      // The dispatch is async; flush microtasks so the promise chain settles.
      await Promise.resolve();
      await Promise.resolve();

      expect(pollOnceSpy).toHaveBeenCalledWith(
        "m-a",
        server,
        expect.any(AbortSignal),
      );
      expect(pollOnceSpy).toHaveBeenCalledWith(
        "m-b",
        server,
        expect.any(AbortSignal),
      );

      vi.useRealTimers();
    });

    it("pollOnce short-circuits mid-loop when the abort signal fires between entries", async () => {
      // Force two entries through xreadgroup; abort the registration's signal
      // BEFORE the second entry is processed. (mock is on RedisService's own
      // xreadgroup method, so return the already-parsed StreamEntry[] shape.)
      redis.xreadgroup.mockResolvedValueOnce([
        {
          id: "1-0",
          data: JSON.stringify(submitEnv({ matchId: "m-mid-abort" })),
        },
        {
          id: "2-0",
          data: JSON.stringify(
            submitEnv({ matchId: "m-mid-abort", eventId: "evt-2" }),
          ),
        },
      ]);
      redis.xautoclaim.mockResolvedValueOnce({
        nextCursor: "0-0",
        claimed: [],
      });

      // Drive the abort from a standalone controller rather than a
      // registration: registerMatch now starts the self-re-arming read loop
      // immediately, and that loop would race this call for the one-shot
      // xreadgroup mock. pollOnce's mid-loop short-circuit is what's under
      // test here, and it only depends on the signal it is handed.
      const ac = new AbortController();
      let firstEntryDone = false;
      service.setDispatcher(async () => {
        if (!firstEntryDone) {
          firstEntryDone = true;
          ac.abort();
        }
        return "APPLIED";
      });

      await service.pollOnce("m-mid-abort", server, ac.signal);

      // First entry was acked; second entry MUST NOT have been processed.
      expect(redis.xack).toHaveBeenCalledTimes(1);
      expect(redis.xack).toHaveBeenCalledWith(
        "match:cmd:m-mid-abort",
        OWNER_GROUP,
        "1-0",
      );
    });
  });
});
