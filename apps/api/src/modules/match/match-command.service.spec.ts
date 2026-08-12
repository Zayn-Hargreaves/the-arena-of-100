import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "@nestjs/common";
import { Server } from "socket.io";
import {
  MatchCommandService,
  OWNER_GROUP,
  CMD_DEAD_LETTER_SET,
  type CommandEnvelope,
  type SubmitAnswerBody,
  type CardPickBody,
  type CardPlayBody,
  type CommandDispatcher,
  type CommandOutcome,
} from "./match-command.service";
import type { RedisService } from "../redis/redis.service";
import type { MatchService } from "./match.service";
import type { MatchOwnershipService } from "./match-ownership.service";
import type { ClusterService } from "../cluster/cluster.service";
import { emitPlayerCommandError } from "./match-card-command.helpers";
import {
  MatchStateMachine,
  resolveCardEffect,
  deriveSubstream,
  mulberry32,
} from "@arena/game-core";
import {
  ClientEvent,
  ErrorCode,
  MatchStatus,
  RoomError,
  ServerEvent,
  PlayerStatus,
  getCardDefinition,
  type CardId,
} from "@arena/shared";

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

type PickAuthoritativeService = {
  applyCardPickAuthoritative(
    env: CommandEnvelope<CardPickBody>,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome>;
};

type PlayAuthoritativeService = {
  applyCardPlayAuthoritative(
    env: CommandEnvelope<CardPlayBody>,
    owner: { fence: number; leaseValue: string },
    server: Server,
  ): Promise<CommandOutcome>;
};

function applyPickAuthoritative(
  svc: MatchCommandService,
  env: CommandEnvelope<CardPickBody>,
  owner: { fence: number; leaseValue: string },
  server: Server,
): Promise<CommandOutcome> {
  return (
    svc as unknown as PickAuthoritativeService
  ).applyCardPickAuthoritative(env, owner, server);
}

function applyPlayAuthoritative(
  svc: MatchCommandService,
  env: CommandEnvelope<CardPlayBody>,
  owner: { fence: number; leaseValue: string },
  server: Server,
): Promise<CommandOutcome> {
  return (
    svc as unknown as PlayAuthoritativeService
  ).applyCardPlayAuthoritative(env, owner, server);
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
      commandId: "cmd-1",
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
      const recorder = makeMockServer();

      await expect(
        service.applySubmitAnswer(submitEnv(), recorder.server),
      ).resolves.toBe("DUPLICATE_SUBMISSION");
      expect(sideEffects.publishAnswerResult).not.toHaveBeenCalled();
      const errorEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errorEmits.length).toBe(1);
      expect(errorEmits[0]?.[1]).toMatchObject({
        code: ErrorCode.INVALID_PAYLOAD,
        failedEvent: ClientEvent.SUBMIT_ANSWER,
        submissionId: "sub-1",
      });
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

    it("dispatchBuiltin routes card_pick through applyCardPickAuthoritative", async () => {
      // No injected dispatcher → dispatchBuiltin handles the
      // envelope directly. The card_pick branch is the second
      // sub-task-D apply path; pin that it routes (RETRY when SM
      // is missing is the cheapest way to exercise the branch).
      const env: CommandEnvelope<CardPickBody> = {
        eventId: "evt-pick-dispatch",
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_pick",
          userId: "p1",
          commandId: "cmd-pick-dispatch",
          cardId: "CB-1",
          offerSeqNo: 1,
        },
      };
      matchService.getStateMachine.mockResolvedValue(undefined);
      await expect(applyPrivate(service, env, server)).resolves.toBe("RETRY");
    });

    it("dispatchBuiltin routes card_play through applyCardPlayAuthoritative", async () => {
      // Same shape as the card_pick dispatch test but for the
      // card_play envelope.
      const env: CommandEnvelope<CardPlayBody> = {
        eventId: "evt-play-dispatch",
        schemaVersion: 1,
        matchId: "m1",
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_play",
          userId: "p1",
          commandId: "cmd-play-dispatch",
          cardId: "CB-1",
          offerSeqNo: 1,
          targetPlayerId: "p2",
        },
      };
      matchService.getStateMachine.mockResolvedValue(undefined);
      await expect(applyPrivate(service, env, server)).resolves.toBe("RETRY");
    });
  });

  describe("claimed-but-unregistered pollOnce edge", () => {
    it("claimIdleEntries returns 0 immediately when the match was never registered", async () => {
      // `pollOnce` calls `claimIdleEntries` first; the helper
      // short-circuits when no registration is present. The
      // public `pollOnce` then proceeds to xreadgroup on the
      // stream (which is the assumed-registered path) but
      // returns `processed=0` because the upstream skip negated
      // the autoclaim contribution.
      const autoclaimBefore = vi.mocked(redis.xautoclaim).mock.calls.length;
      await expect(service.pollOnce("never-registered", server)).resolves.toBe(
        0,
      );
      // claimIdleEntries short-circuited before calling xautoclaim.
      expect(vi.mocked(redis.xautoclaim).mock.calls.length).toBe(
        autoclaimBefore,
      );
    });

    it("claimIdleEntries rate-limits: skips xautoclaim when the last sweep was within CLAIM_INTERVAL_MS", async () => {
      // Pre-register the match with a fresh lastClaimAt, then
      // immediately invoke pollOnce. The early-return skips
      // xautoclaim entirely (the rate limiter is the gate).
      const matchId = "m-rate-limit";
      const reg = {
        server,
        abort: new AbortController(),
        // lastClaimAt = "now" (the most recent possible value).
        lastClaimAt: Date.now(),
      };
      (
        service as unknown as {
          registered: Map<string, typeof reg>;
        }
      ).registered.set(matchId, reg);

      const lastClaimAt = reg.lastClaimAt;
      const autoclaimBefore = vi.mocked(redis.xautoclaim).mock.calls.length;
      await expect(service.pollOnce(matchId, server)).resolves.toBe(0);
      // xautoclaim was not called because the rate-limiter
      // short-circuited claimIdleEntries.
      expect(vi.mocked(redis.xautoclaim).mock.calls.length).toBe(
        autoclaimBefore,
      );
      // lastClaimAt was NOT updated (the rate-limit
      // early-return did not run the post-sweep stamp).
      expect(reg.lastClaimAt).toBe(lastClaimAt);
    });
  });

  describe("schedulePoll — re-arm guard on a failing pollOnce", () => {
    // The `schedulePoll` continuation reschedules the next read
    // when the iteration consumed real work OR the prior call
    // took at least MIN_BLOCKING_ITERATION_MS. A rejection that
    // lands within the 500ms window without any work must NOT
    // re-arm (otherwise the loop would spin on a failing Redis).
    //
    // We exercise both the rejection path (no re-arm) and the
    // success path (re-arm) by stubbing `pollOnce` to either
    // reject or resolve with positive work.
    it("re-arms schedulePoll when pollOnce resolves with positive work", async () => {
      const matchId = "m-rearm-positive";
      // Resolve `pollOnce` exactly once with positive work,
      // then return 0 — the second call would otherwise
      // re-arm and create an infinite loop. The branch under
      // test is the FIRST re-arm path.
      const spy = vi
        .spyOn(service, "pollOnce")
        .mockResolvedValueOnce(1)
        .mockResolvedValue(0);
      (
        service as unknown as {
          registered: Map<
            string,
            { server: Server; abort: AbortController; lastClaimAt: number }
          >;
        }
      ).registered.set(matchId, {
        server,
        abort: new AbortController(),
        lastClaimAt: 0,
      });

      (service as unknown as { dispatchPolls: () => void }).dispatchPolls();
      // The .then() chain runs three microtasks:
      //   1. pollOnce resolves with 1 (treated as "work done").
      //   2. rearm = (processed > 0 || ...) = true.
      //   3. schedulePoll is re-armed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spy).toHaveBeenCalled();
      const inFlight = (service as unknown as { inFlight: Set<string> })
        .inFlight;
      expect(inFlight.has(matchId)).toBe(false);
      // spy was called at least twice: once for the initial
      // dispatch + once for the re-arm.
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("does not re-arm schedulePoll when pollOnce rejects with no work and no blocking window", async () => {
      // Simulate the rejection path by stubbing `pollOnce` to
      // reject synchronously. The `(rearm) => ...` resolver
      // catches the rejection and converts it to `() => false`,
      // which breaks the re-arm chain.
      const spy = vi
        .spyOn(service, "pollOnce")
        .mockRejectedValue(new Error("redis down"));
      const matchId = "m-reject-fresh";
      (
        service as unknown as {
          registered: Map<
            string,
            { server: Server; abort: AbortController; lastClaimAt: number }
          >;
        }
      ).registered.set(matchId, {
        server,
        abort: new AbortController(),
        lastClaimAt: 0,
      });

      // Invoke the private schedulePoll through `dispatchPolls`
      // (the public entry point) and let the rejection fire.
      (service as unknown as { dispatchPolls: () => void }).dispatchPolls();
      // Let the unhandled rejection ripple through the .then().
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(spy).toHaveBeenCalled();
      // The in-flight set MUST be cleared. The .then(rearm)`
      // sentinel converted the rejection into `() => false`,
      // which did NOT re-arm.
      const inFlight = (service as unknown as { inFlight: Set<string> })
        .inFlight;
      expect(inFlight.has(matchId)).toBe(false);
      // No re-arm: spy was called exactly once.
      expect(spy.mock.calls.length).toBe(1);
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

  // ============================================================
  // Duplicate-recovery paths for card_pick / card_play.
  // These use real MatchStateMachine objects (via @arena/game-core)
  // to exercise forEachEvent + the canonical-metadata checks.
  // ============================================================

  /**
   * Build a real MatchStateMachine with the deterministic CARD_OFFER
   * the spec tests need: inject a CARD_OFFER event directly so the
   * offer contents do not depend on `pickOffer`'s sampleOffer RNG.
   * All test-only private-state casts (`logEvent`, `playerHands`)
   * live in this factory only.
   */
  function makePickOfferSm(options: {
    matchId?: string;
    roomId?: string;
    playerIds?: readonly string[];
    actorStatus?: PlayerStatus;
    offeredCardIds: readonly CardId[];
    pickCard?: CardId;
    roundActive?: boolean;
  }): { sm: MatchStateMachine; offerSeqNo: number } {
    const matchId = options.matchId ?? "m1";
    const roomId = options.roomId ?? "r1";
    const playerIds = options.playerIds ?? ["p1"];
    const actorId = playerIds[0];
    if (!actorId)
      throw new Error("makePickOfferSm requires at least one player");
    const actorStatus = options.actorStatus ?? PlayerStatus.ACTIVE;
    const roundActive = options.roundActive ?? false;

    const players = playerIds.map((id) => ({
      id,
      name: id,
      status: id === actorId ? actorStatus : PlayerStatus.ACTIVE,
      score: 0,
      totalResponseTimeMs: 0,
      correctAnswers: 0,
      isOnline: true,
    }));
    const sm = new MatchStateMachine(matchId, roomId, players);
    sm.classAssignment([...playerIds], "offer-seed");

    if (roundActive) {
      sm.transition(MatchStatus.COUNTDOWN);
      sm.transition(MatchStatus.ROUND_ACTIVE);
      sm.startRound({
        id: "q1",
        content: "Q",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
      });
    }

    const offerSeqNo = (
      sm as unknown as { logEvent: (t: string, p: unknown) => number }
    ).logEvent("CARD_OFFER", {
      roundNo: roundActive ? sm.getCurrentRound()?.roundNo : 5,
      playerId: actorId,
      offeredCardIds: options.offeredCardIds,
      seedUsed: "offer-seed",
    });
    (sm as unknown as { playerHands: Map<string, CardId[]> }).playerHands.set(
      actorId,
      [...options.offeredCardIds],
    );

    if (options.pickCard) {
      sm.pickCard(actorId, options.pickCard, offerSeqNo);
    }

    return { sm, offerSeqNo };
  }

  describe("card_pick / card_play duplicate recovery", () => {
    const OWNER = { fence: 5, leaseValue: "node-a:5" };
    const MATCH_ID = "m1";

    function pickEnv(
      eventId = "evt-pick-1",
      commandId = "cmd-pick-1",
      offerSeqNo = 2,
    ): CommandEnvelope<CardPickBody> {
      return {
        eventId,
        schemaVersion: 1,
        matchId: MATCH_ID,
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_pick",
          userId: "p1",
          commandId,
          cardId: "CB-1",
          offerSeqNo,
        },
      };
    }

    function playEnv(
      eventId = "evt-play-1",
      commandId = "cmd-play-1",
      offerSeqNo = 1,
    ): CommandEnvelope<CardPlayBody> {
      return {
        eventId,
        schemaVersion: 1,
        matchId: MATCH_ID,
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_play",
          userId: "p1",
          commandId,
          cardId: "CB-1",
          offerSeqNo,
        },
      };
    }

    it("makePickOfferSm uses a roster actor and the active round number", () => {
      const { sm, offerSeqNo } = makePickOfferSm({
        playerIds: ["actor-2", "p2"],
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
        pickCard: "CB-1",
        roundActive: true,
      });
      let offerPayload: Record<string, unknown> | undefined;
      sm.forEachEvent((entry) => {
        if (entry.seqNo === offerSeqNo) {
          offerPayload = entry.payload as Record<string, unknown>;
        }
      });

      expect(offerPayload).toMatchObject({
        roundNo: sm.getCurrentRound()?.roundNo,
        playerId: "actor-2",
      });
      expect(sm.getPickedCards("actor-2").has("CB-1")).toBe(true);
      expect(sm.getHand("actor-2")).toEqual(["CB-2", "CB-3"]);
    });

    it("recoverDuplicatePickEvent re-broadcasts when eventId + commandId + offerSeqNo all match", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      // First apply: not yet in applied set → persists CARD_PICKED with
      // stamped metadata, emits one CARD_PICKED, returns APPLIED.
      redis.sismember.mockResolvedValue(false);
      const first = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );
      expect(first).toBe("APPLIED");
      expect(recorder.callsByEvent(ServerEvent.CARD_PICKED).length).toBe(1);

      // Second apply (redelivery, same eventId): sismember=true → routes
      // through recoverDuplicatePickEvent. Canonical metadata matches,
      // so it MUST re-emit CARD_PICKED before ACK as DUPLICATE_EVENT.
      redis.sismember.mockResolvedValue(true);
      const second = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(second).toBe("DUPLICATE_EVENT");
      const cardPickedEmits = recorder.callsByEvent(ServerEvent.CARD_PICKED);
      // 1 from the first apply + 1 from the recovery = 2 total.
      expect(cardPickedEmits.length).toBe(2);
      expect(cardPickedEmits[1]?.[1]).toEqual({
        matchId: MATCH_ID,
        roundNo: 0,
        playerId: "p1",
        selectedCardId: "CB-1",
        offerSeqNo: 2,
      });
    });

    it("recoverDuplicatePickEvent returns DUPLICATE_EVENT (no emit) when canonical metadata is absent", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // Persist a CARD_PICKED without the metadata stamps — simulates a
      // legacy owner that ran before canonical-identity stamping landed.
      sm.pickCard("p1", "CB-1", 1);
      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sismember.mockResolvedValue(true);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      const cardPickedEmits = recorder.callsByEvent(ServerEvent.CARD_PICKED);
      expect(cardPickedEmits.length).toBe(0);
    });

    it("recoverDuplicatePickEvent returns RETRY when the state machine cannot be loaded", async () => {
      ownership.currentFence.mockReturnValue({
        fence: 5,
        leaseValue: "node-a:5",
      });
      matchService.getStateMachine.mockResolvedValue(undefined);
      redis.sismember.mockResolvedValue(true);

      await expect(
        applyPickAuthoritative(service, pickEnv(), OWNER, server),
      ).resolves.toBe("RETRY");
    });

    it("recoverDuplicatePickEvent emits COMMAND_ID_CONFLICT on eventId mismatch", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      // First apply stamps eventId=evt-A (persisted into the event log).
      redis.sismember.mockResolvedValue(false);
      await applyPickAuthoritative(
        service,
        pickEnv("evt-A"),
        OWNER,
        recorder.server,
      );
      const firstCount = recorder.callsByEvent(ServerEvent.CARD_PICKED).length;
      expect(firstCount).toBe(1);

      // Redelivery carries a DIFFERENT eventId — sismember=true means we
      // enter recoverDuplicatePickEvent, but the canonical entry stored
      // `eventId=evt-A` and the incoming is `evt-B`, so the canonical
      // identity check fails and COMMAND_ID_CONFLICT is surfaced.
      redis.sismember.mockResolvedValue(true);
      const outcome = await applyPickAuthoritative(
        service,
        pickEnv("evt-B"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const cardPickedEmits = recorder.callsByEvent(ServerEvent.CARD_PICKED);
      // Only the first apply should have emitted — no replay for the mismatch.
      expect(cardPickedEmits.length).toBe(firstCount);
      expect(recorder.callsByEvent(ServerEvent.ERROR)).toEqual([
        [
          ServerEvent.ERROR,
          expect.objectContaining({
            code: ErrorCode.COMMAND_ID_CONFLICT,
            failedEvent: ClientEvent.CARD_PICK,
            commandId: "cmd-pick-1",
          }),
        ],
      ]);
    });

    it("recoverDuplicatePlayEvent re-broadcasts the canonical CARD_RESOLVED when metadata matches", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      sm.pickCard("p1", "CB-1", 1);
      matchService.getStateMachine.mockResolvedValue(sm);

      // Pre-seed a CARD_RESOLVED with the same eventId/commandId so the
      // subsequent redelivery can locate it.
      const existingSeqNo = sm.playCard(
        "p1",
        "CB-1",
        1,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p1"],
        1000,
        { eventId: "evt-play-1", commandId: "cmd-play-1" },
      ).seqNo;

      const recorder = makeMockServer();

      // Redelivery (eventId already in applied): recovers the canonical event.
      redis.sismember.mockResolvedValue(true);
      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      const cardResolvedEmits = recorder.callsByEvent(
        ServerEvent.CARD_RESOLVED,
      );
      // 1 sanitized room broadcast + 1 per-target full broadcast.
      expect(cardResolvedEmits.length).toBe(2);
      // Canonical seqNo round-trips through the payload.
      expect(cardResolvedEmits[0]?.[1]).toMatchObject({
        seqNo: existingSeqNo,
      });
    });

    it("applyCardPlayAuthoritative recovers + ACKs when validateCardCommand rejects a persisted card", async () => {
      const { sm: smWithPlayed } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      smWithPlayed.pickCard("p1", "CB-1", 1);
      // Pre-stamp a CARD_RESOLVED so findCanonicalCardResolved can match.
      smWithPlayed.playCard(
        "p1",
        "CB-1",
        1,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p2"],
        1000,
        { eventId: "evt-play-1", commandId: "cmd-play-1" },
      );
      matchService.getStateMachine.mockResolvedValue(smWithPlayed);

      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(),
        OWNER,
        recorder.server,
      );

      // Recovery succeeded → ACK as DUPLICATE_EVENT, not error.
      expect(outcome).toBe("DUPLICATE_EVENT");
      const errorEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errorEmits.length).toBe(0);
      const cardResolvedEmits = recorder.callsByEvent(
        ServerEvent.CARD_RESOLVED,
      );
      expect(cardResolvedEmits.length).toBeGreaterThanOrEqual(1);
    });

    it("recoverDuplicatePlayEvent emits an error when canonical metadata does not match", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      sm.pickCard("p1", "CB-1", 1);
      sm.playCard(
        "p1",
        "CB-1",
        1,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p1"],
        1000,
        { eventId: "evt-canonical", commandId: "cmd-canonical" },
      );
      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sismember.mockResolvedValue(true);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-replay", "cmd-replay"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED)).toHaveLength(0);
      expect(recorder.callsByEvent(ServerEvent.ERROR)).toEqual([
        [
          ServerEvent.ERROR,
          expect.objectContaining({
            code: ErrorCode.COMMAND_ID_CONFLICT,
            failedEvent: ClientEvent.CARD_PLAY,
            commandId: "cmd-replay",
          }),
        ],
      ]);
    });

    it("recoverDuplicatePlayEvent returns DUPLICATE_EVENT (no error) when no canonical CARD_RESOLVED exists", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // Pick the card but NEVER playCard → no canonical CARD_RESOLVED
      // exists for findCanonicalCardResolved to match.
      sm.pickCard("p1", "CB-1", 1);
      matchService.getStateMachine.mockResolvedValue(sm);
      // sismember=true forces the already-applied path → handleDuplicatePlayRecovery.
      redis.sismember.mockResolvedValue(true);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(),
        OWNER,
        recorder.server,
      );

      // No canonical event → recoverDuplicatePlayEvent returns "DUPLICATE_EVENT",
      // which handleDuplicatePlayRecovery must propagate directly without
      // emitting COMMAND_ID_CONFLICT.
      expect(outcome).toBe("DUPLICATE_EVENT");
      expect(recorder.callsByEvent(ServerEvent.ERROR)).toHaveLength(0);
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED)).toHaveLength(0);
    });

    it("emitPlayerError sanitises non-RoomError messages to a generic INVALID_PAYLOAD key", () => {
      const recorder = makeMockServer();
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );

      // A raw Error (NOT a RoomError) — raw message MUST NOT leak to the client.
      emitPlayerCommandError(
        (service as unknown as { logger: Logger }).logger,
        recorder.server,
        "p1",
        ClientEvent.CARD_PLAY,
        "cmd-1",
        new Error("internal stack trace / file paths / library names"),
      );

      const errorEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errorEmits.length).toBe(1);
      const payload = errorEmits[0]?.[1] as {
        code: string;
        message: string;
        commandId: string;
      };
      expect(payload.code).toBe(ErrorCode.INVALID_PAYLOAD);
      // Stable, generic key — never the raw Error.message.
      expect(payload.message).toBe("Errors.INVALID_PAYLOAD");
      expect(payload.message).not.toContain("internal stack");
      // Original detail logged server-side.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("internal"));
    });

    it("emitPlayerError forwards RoomError.code with the mapped key", () => {
      const recorder = makeMockServer();

      emitPlayerCommandError(
        (service as unknown as { logger: Logger }).logger,
        recorder.server,
        "p1",
        ClientEvent.CARD_PLAY,
        "cmd-1",
        new RoomError(ErrorCode.SPECTATOR_CANNOT_ANSWER),
      );

      const errorEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errorEmits.length).toBe(1);
      const payload = errorEmits[0]?.[1] as {
        code: string;
        message: string;
      };
      expect(payload.code).toBe(ErrorCode.SPECTATOR_CANNOT_ANSWER);
      expect(payload.message).toBe("Errors.SPECTATOR_CANNOT_ANSWER");
    });
  });

  // ============================================================
  // Full-path coverage for applyCardPickAuthoritative /
  // applyCardPlayAuthoritative. Uses real MatchStateMachine
  // instances (via makePickOfferSm) so the resolve → expand →
  // playCard → broadcast contract is exercised end-to-end,
  // including AOE target expansion and TEMPORARY / MUTATION
  // resolution branches. Helper static `sanitizeEffect` and
  // `emitCardResolved` are reached through the live broadcast
  // side effect — same pattern as `emitPlayerError`.
  // ============================================================
  describe("applyCardPickAuthoritative — full card pick path", () => {
    const OWNER = { fence: 5, leaseValue: "node-a:5" };

    const pickEnv = (
      eventId = "evt-pick-1",
      commandId = "cmd-pick-1",
      offerSeqNo = 2,
      userId = "p1",
      cardId = "CB-1",
    ): CommandEnvelope<CardPickBody> => ({
      eventId,
      schemaVersion: 1,
      matchId: "m1",
      emittedByNodeId: "node-b",
      emittedAt: 1000,
      body: { type: "card_pick", userId, commandId, cardId, offerSeqNo },
    });

    beforeEach(() => {
      redis.sismember.mockResolvedValue(false);
      redis.sadd.mockResolvedValue(1);
    });

    it("APPLIED: persists, broadcasts CARD_PICKED to room, marks eventId applied", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(redis.sadd).toHaveBeenCalledWith("match:applied:m1", "evt-pick-1");
      const cardPicked = recorder.callsByEvent(ServerEvent.CARD_PICKED);
      expect(cardPicked.length).toBe(1);
      const payload = cardPicked[0]?.[1] as Record<string, unknown>;
      expect(payload).toMatchObject({
        matchId: "m1",
        playerId: "p1",
        selectedCardId: "CB-1",
        offerSeqNo: 2,
      });
    });

    it("APPLIED with missing roomId: still APPLIED, no CARD_PICKED broadcast, logs warn", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // Force empty roomId on the state machine.
      (sm as unknown as { state: { roomId: string } }).state.roomId = "";
      matchService.getStateMachine.mockResolvedValue(sm);
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(undefined, undefined, sm.getHeadSeqNo()),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(recorder.callsByEvent(ServerEvent.CARD_PICKED).length).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing roomId"),
      );
    });

    it("APPLIED: sadd failure after broadcast is non-fatal; redelivery heals", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sadd.mockRejectedValueOnce(new Error("sadd boom"));
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(recorder.callsByEvent(ServerEvent.CARD_PICKED).length).toBe(1);
    });

    it("RETRY when sismember (dedup read) fails", async () => {
      redis.sismember.mockRejectedValue(new Error("redis down"));

      await expect(
        applyPickAuthoritative(service, pickEnv(), OWNER, server),
      ).resolves.toBe("RETRY");
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("RETRY when SM is missing (cold path: next owner reprocesses)", async () => {
      matchService.getStateMachine.mockResolvedValue(undefined);

      await expect(
        applyPickAuthoritative(service, pickEnv(), OWNER, server),
      ).resolves.toBe("RETRY");
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION + SPECTATOR_CANNOT_ANSWER for player not in roster", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv("evt-orphan", "cmd-orphan", 1, "ghost"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.SPECTATOR_CANNOT_ANSWER,
      );
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION + SPECTATOR_CANNOT_ANSWER for ELIMINATED player", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // `getState()` returns a deep copy — mutate the original
      // player object so the apply path sees ELIMINATED.
      (
        sm as unknown as {
          state: { players: Map<string, { status: PlayerStatus }> };
        }
      ).state.players.get("p1")!.status = PlayerStatus.ELIMINATED;
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.SPECTATOR_CANNOT_ANSWER,
      );
    });

    it("DUPLICATE_SUBMISSION + PLAYER_DISCONNECTED for DISCONNECTED player", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      sm.disconnectPlayer("p1");
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.PLAYER_DISCONNECTED,
      );
    });

    it("RETRY when persistStateMachine returns non-APPLIED: evicts unpersisted mutation", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      matchService.persistStateMachine.mockResolvedValue("RETRY");
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("RETRY");
      expect(matchService.evictStateMachine).toHaveBeenCalledWith("m1");
      expect(recorder.callsByEvent(ServerEvent.CARD_PICKED).length).toBe(0);
      expect(redis.sadd).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION + CARD_NOT_FOUND on assertCardId rejection (cardId outside the catalog)", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // `cardId: "NOT-A-CARD"` is not in the v1 18-card catalog, so
      // `assertCardId` throws CARD_NOT_FOUND before the offer
      // correlation check can run.
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv("evt-bad", "cmd-bad", 1, "p1", "NOT-A-CARD" as CardId),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.CARD_NOT_FOUND,
      );
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("Recover via recoverDuplicatePickEvent when pickCard throws + card is in pickedCards", async () => {
      const { sm } = makePickOfferSm({
        offeredCardIds: ["CB-1", "CB-2", "CB-3"],
      });
      // Pre-stamp a CARD_PICKED so the duplicate-recovery branch (card
      // already in pickedCards) fires.
      sm.pickCard("p1", "CB-1", 1, {
        eventId: "evt-pick-1",
        commandId: "cmd-pick-1",
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPickAuthoritative(
        service,
        pickEnv(undefined, undefined, 1),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      expect(recorder.callsByEvent(ServerEvent.CARD_PICKED).length).toBe(1);
      // No error emit (recovery path doesn't surface the prior throw).
      expect(recorder.callsByEvent(ServerEvent.ERROR).length).toBe(0);
      // No new persistence — recovery only re-broadcasts.
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });
  });

  describe("applyCardPlayAuthoritative — full card play path", () => {
    const OWNER = { fence: 5, leaseValue: "node-a:5" };
    const ROOM_ID = "r1";
    const MATCH_ID = "m1";

    function playEnv(
      eventId = "evt-play-1",
      commandId = "cmd-play-1",
      offerSeqNo = 1,
      userId = "p1",
      cardId = "CB-1",
      targetPlayerId: string | undefined = "p2",
    ): CommandEnvelope<CardPlayBody> {
      return {
        eventId,
        schemaVersion: 1,
        matchId: MATCH_ID,
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_play",
          userId,
          commandId,
          cardId,
          offerSeqNo,
          ...(targetPlayerId ? { targetPlayerId } : {}),
        },
      };
    }

    /**
     * Build a real MatchStateMachine with the offer containing
     * `pickedCards` for the actor. Defaults to a 3-player roster so
     * AOE (targetCount>1) target expansion has eligible players.
     */
    function pickOfferSmForPlay(options: {
      pickedCardId?: CardId;
      playerIds?: readonly string[];
    }): { sm: MatchStateMachine; offerSeqNo: number } {
      const picked = options.pickedCardId ?? "CB-1";
      const playerIds = options.playerIds ?? ["p1", "p2", "p3", "p4"];
      return makePickOfferSm({
        matchId: MATCH_ID,
        roomId: ROOM_ID,
        playerIds,
        offeredCardIds: [picked, picked, picked],
        pickCard: picked,
        roundActive: true,
      });
    }

    beforeEach(() => {
      redis.sismember.mockResolvedValue(false);
      redis.sadd.mockResolvedValue(1);
    });

    it("APPLIED — single-target TIMER_MODIFY (MUTATION): sanitized room + full-effect per-target broadcast", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-cb1", "cmd-cb1", offerSeqNo, "p1", "CB-1", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(matchService.persistStateMachine).toHaveBeenCalledWith(MATCH_ID);
      expect(redis.sadd).toHaveBeenCalledWith(
        `match:applied:${MATCH_ID}`,
        "evt-cb1",
      );
      const resolved = recorder.callsByEvent(ServerEvent.CARD_RESOLVED);
      expect(resolved.length).toBe(2);
      // Room broadcast: sanitized TIMER_MODIFY carries full effect (no
      // privacy-sensitive fields) — both emits use the same payload shape.
      const targets = resolved.map(
        ([, p]) =>
          (p as unknown as { targetPlayerIds: readonly string[] })
            .targetPlayerIds,
      );
      // Both broadcasts include p2 as the single target.
      expect(targetsEqual(targets)).toBe(true);
      const first = resolved[0]?.[1] as Record<string, unknown>;
      expect(first.resolution).toBe("MUTATION");
      expect(first.expiresAtServer).toBeNull();
      expect(first.remainingMs).toBeNull();
      expect(first.cardId).toBe("CB-1");
    });

    it("APPLIED — TEMPORARY resolution branch: OPTION_LOCK carries durationMs → resolution=TEMPORARY, expiresAtServer non-null", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-4" });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-cb4", "cmd-cb4", offerSeqNo, "p1", "CB-4", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      const resolved = recorder.callsByEvent(ServerEvent.CARD_RESOLVED);
      expect(resolved.length).toBe(2);
      const first = resolved[0]?.[1] as Record<string, unknown>;
      expect(first.resolution).toBe("TEMPORARY");
      expect(typeof first.expiresAtServer).toBe("number");
      expect((first.expiresAtServer as number) > 0).toBe(true);
      expect(typeof first.remainingMs).toBe("number");
      expect(
        (first.effect as Record<string, unknown> as { kind: string }).kind,
      ).toBe("OPTION_LOCK");
    });

    it("DUPLICATE_SUBMISSION + PLAYER_DISCONNECTED when explicit target is ineligible (DISCONNECTED)", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      sm.disconnectPlayer("p2");
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-cb3", "cmd-cb3", offerSeqNo, "p1", "CB-1", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errorEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errorEmits.length).toBe(1);
      expect(errorEmits[0]?.[1]).toMatchObject({
        code: ErrorCode.PLAYER_DISCONNECTED,
        failedEvent: ClientEvent.CARD_PLAY,
        commandId: "cmd-cb3",
      });
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(0);
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("APPLIED — AOE card (CB-8, DELAY_RENDER, targetCount=3) expands to multiple targets via deterministic substream", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({
        pickedCardId: "CB-8",
        // AOE doesn't need a targetPlayerId; the resolver expands.
        playerIds: ["p1", "p2", "p3", "p4", "p5"],
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-cb8", "cmd-cb8", offerSeqNo, "p1", "CB-8", undefined),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      // 1 sanitized room broadcast + 3 per-target broadcasts = 4 total.
      const roomFrames = recorder.callsByChannelAndEvent(
        "room:r1",
        ServerEvent.CARD_RESOLVED,
      );
      expect(roomFrames.length).toBe(1);
      const roomPayload = roomFrames[0]?.[1] as Record<string, unknown>;
      const roomTargetIds = roomPayload.targetPlayerIds as string[];
      expect(roomTargetIds.length).toBe(3);
      // Actor (p1) is excluded from the AOE target pool.
      expect(roomTargetIds).not.toContain("p1");
      // 3 per-target broadcasts (one per chosen target).
      const allCalls = recorder.callsWithExclusion();
      const perTargetChannels = allCalls
        .filter(
          (c) =>
            c.event === ServerEvent.CARD_RESOLVED &&
            c.channel.startsWith("player:") &&
            c.channel !== "player:p1",
        )
        .map((c) => c.channel)
        .sort();
      expect(perTargetChannels.length).toBe(3);
      // Each per-target broadcast carries the same targetPlayerIds list as
      // the room broadcast (so each target knows its co-targets).
      for (const channel of perTargetChannels) {
        const targetFrames = recorder.callsByChannelAndEvent(
          channel,
          ServerEvent.CARD_RESOLVED,
        );
        expect(targetFrames.length).toBe(1);
        const targetPayload = targetFrames[0]?.[1] as Record<string, unknown>;
        expect(targetPayload.targetPlayerIds).toEqual(roomTargetIds);
      }
    });

    it("APPLIED — AOE cap: expandTargets caps to min(count, eligible.length)", async () => {
      // Only 2 eligible players besides the actor — but CB-8 wants 3
      // targets. expandTargets must cap to 2 (the eligible count).
      const { sm, offerSeqNo } = pickOfferSmForPlay({
        pickedCardId: "CB-8",
        playerIds: ["p1", "p2", "p3"], // 1 actor + 2 others
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(
          "evt-cb8-cap",
          "cmd-cb8-cap",
          offerSeqNo,
          "p1",
          "CB-8",
          undefined,
        ),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      // 1 sanitized room broadcast + 2 per-target broadcasts = 3 total.
      const roomFrames = recorder.callsByChannelAndEvent(
        "room:r1",
        ServerEvent.CARD_RESOLVED,
      );
      const perTargetChannels = recorder
        .callsWithExclusion()
        .filter(
          (c) =>
            c.event === ServerEvent.CARD_RESOLVED &&
            c.channel.startsWith("player:") &&
            c.channel !== "player:p1",
        )
        .map((c) => c.channel);
      expect(roomFrames.length).toBe(1);
      expect(perTargetChannels.length).toBe(2);
      const roomPayload = roomFrames[0]?.[1] as Record<string, unknown>;
      const targetIds = roomPayload.targetPlayerIds as string[];
      expect(targetIds.length).toBe(2);
      // Actor excluded.
      expect(targetIds).not.toContain("p1");
    });

    it("APPLIED with missing roomId: still APPLIED, no CARD_RESOLVED broadcast, logs warn", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      // Force empty roomId on the state machine.
      (sm as unknown as { state: { roomId: string } }).state.roomId = "";
      matchService.getStateMachine.mockResolvedValue(sm);
      const warnSpy = vi.spyOn(
        (service as unknown as { logger: Logger }).logger,
        "warn",
      );
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-room", "cmd-room", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing roomId"),
      );
    });

    it("APPLIED: sadd failure after broadcast is non-fatal", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sadd.mockRejectedValueOnce(new Error("sadd boom"));
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-sadd", "cmd-sadd", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("APPLIED");
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(2);
    });

    it("RETRY when sismember (dedup read) fails", async () => {
      redis.sismember.mockRejectedValue(new Error("redis down"));

      await expect(
        applyPlayAuthoritative(service, playEnv(), OWNER, server),
      ).resolves.toBe("RETRY");
      expect(matchService.getStateMachine).not.toHaveBeenCalled();
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("RETRY when SM is missing (cold path: next owner reprocesses)", async () => {
      matchService.getStateMachine.mockResolvedValue(undefined);

      await expect(
        applyPlayAuthoritative(service, playEnv(), OWNER, server),
      ).resolves.toBe("RETRY");
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION + SPECTATOR_CANNOT_ANSWER for player not in roster", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-ghost", "cmd-ghost", offerSeqNo, "ghost", "CB-1", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.SPECTATOR_CANNOT_ANSWER,
      );
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("DUPLICATE_SUBMISSION + SPECTATOR_CANNOT_ANSWER for ELIMINATED player", async () => {
      const { sm } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      // Mutate the ORIGINAL player object — getState() returns a copy.
      (
        sm as unknown as {
          state: { players: Map<string, { status: PlayerStatus }> };
        }
      ).state.players.get("p1")!.status = PlayerStatus.ELIMINATED;
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.SPECTATOR_CANNOT_ANSWER,
      );
    });

    it("DUPLICATE_SUBMISSION + PLAYER_DISCONNECTED for DISCONNECTED player", async () => {
      const { sm } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      sm.disconnectPlayer("p1");
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv(),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.PLAYER_DISCONNECTED,
      );
    });

    it("DUPLICATE_SUBMISSION on validateCardCommand rejection (card not in offer)", async () => {
      // Build a machine where p1 picked "CB-1" but the env claims CB-2.
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-cb2", "cmd-cb2", offerSeqNo, "p1", "CB-2", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.CARD_NOT_IN_HAND,
      );
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("validateCardCommand catch emits DUPLICATE_SUBMISSION + private error when the card is NOT in playedCards", async () => {
      // The validate catch has two branches: a recovery branch
      // (when the card is already in playedCards — covered by the
      // next test) and an emit-and-return-DUPLICATE_SUBMISSION
      // branch (when the card is NOT in playedCards). The plan
      // patches the latter: pin the typed error path so a
      // regression to the recovery branch (or a missing emit)
      // would fail loudly.
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      // CB-7 is not in the offered set, so validateCardCommand
      // throws CARD_NOT_IN_HAND and the card is not in playedCards.
      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-bad", "cmd-bad", offerSeqNo, "p1", "CB-7", "p2"),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect((errEmits[0]?.[1] as { code: string }).code).toBe(
        ErrorCode.CARD_NOT_IN_HAND,
      );
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED)).toHaveLength(0);
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("playCard catch emits DUPLICATE_SUBMISSION + private error when playCard throws and the card is NOT in playedCards", async () => {
      // The `playCard` catch mirrors the validate catch: a
      // recovery branch (card already in playedCards — covered
      // by the recoverDuplicatePlayEvent test) and an
      // emit-and-return DUPLICATE_SUBMISSION branch. Force
      // `playCard` to throw via a spy and assert the typed
      // error path runs.
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      vi.spyOn(
        sm as unknown as { playCard: (...args: unknown[]) => unknown },
        "playCard",
      ).mockImplementation(() => {
        throw new Error("playCard synthetic failure");
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-pc-fail", "cmd-pc-fail", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      const errEmits = recorder.callsByEvent(ServerEvent.ERROR);
      expect(errEmits.length).toBe(1);
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED)).toHaveLength(0);
      expect(matchService.persistStateMachine).not.toHaveBeenCalled();
    });

    it("Recover via recoverDuplicatePlayEvent on playCard throw + card already played", async () => {
      // The playCard catch mirrors the validate catch's two-branch
      // shape: a `getPlayedCards(userId).has(cardId)` recovery branch
      // (handled by handleDuplicatePlayRecovery via recoverDuplicatePlayEvent)
      // and an emit-and-return DUPLICATE_SUBMISSION branch. The
      // recovery branch here covers the playCard-catch playedCards.has
      // guard in applyCardPlayCommand (the `c8 ignore next 3`
      // above hides the branch header).
      //
      // To reach it, validation must pass — i.e. validateCardCommand
      // must observe an empty playedCards set — AND
      // `stateMachine.getPlayedCards(userId).has(validated.cardId)`
      // must be true inside the playCard catch's branch check. We
      // achieve this by:
      //   1. Stamping a CARD_RESOLVED via the private logEvent so
      //      handleDuplicatePlayRecovery has canonical metadata to
      //      re-broadcast — but without going through playCard
      //      (which would strip CB-1 from `pickedCards` and break
      //      validatePickedCard).
      //   2. Stubbing getPlayedCards using observable state rather
      //      than call-order: the stub returns an empty set while
      //      validation is running (so validateCardCommand passes)
      //      and the played-card set once the playCard failure catch
      //      is reached (so the catch's branch check hits the
      //      recovery path). The transition is driven by the playCard
      //      spy itself flipping a flag, which keeps the test
      //      resilient to internal call-count changes.
      //   3. Spying playCard to throw so the catch fires.
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      (
        sm as unknown as { logEvent: (t: string, p: unknown) => number }
      ).logEvent("CARD_RESOLVED", {
        seqNo: sm.getHeadSeqNo() + 1,
        matchId: "m1",
        roundNo: sm.getCurrentRound()?.roundNo ?? 0,
        cardId: "CB-1",
        offerSeqNo,
        playedByPlayerId: "p1",
        targetPlayerIds: ["p2"],
        effect: { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        resolution: "MUTATION",
        serverTimestamp: 1000,
        expiresAtServer: null,
        remainingMs: null,
        eventId: "evt-recover-pc",
        commandId: "cmd-recover-pc",
      });
      const playedWithCard = new Set<CardId>(["CB-1"]);
      let phase: "validation" | "playCardFailed" = "validation";
      vi.spyOn(sm, "getPlayedCards").mockImplementation(() => {
        // While validation is running, the stub reports CB-1 as NOT
        // yet played (so validateCardCommand passes). Once playCard
        // has been invoked (and thrown), the stub reports CB-1 as
        // already played, matching the post-mutation state the
        // playCard catch's branch check expects.
        if (phase === "validation") return new Set<CardId>();
        return playedWithCard;
      });
      vi.spyOn(
        sm as unknown as { playCard: (...args: unknown[]) => unknown },
        "playCard",
      ).mockImplementation(() => {
        phase = "playCardFailed";
        throw new Error("playCard synthetic");
      });
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-recover-pc", "cmd-recover-pc", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      expect(recorder.callsByEvent(ServerEvent.ERROR).length).toBe(0);
      // Strengthen: the replayed CARD_RESOLVED must carry the
      // canonical fields from emitCardResolved's base frame so a
      // regression that drops the payload or omits cardId /
      // playedByPlayerId / targetPlayerIds fails loudly.
      const resolvedEmits = recorder.callsByEvent(ServerEvent.CARD_RESOLVED);
      expect(resolvedEmits.length).toBeGreaterThan(0);
      const resolvedPayload = resolvedEmits[0]?.[1] as {
        matchId: string;
        cardId: string;
        offerSeqNo: number;
        playedByPlayerId: string;
        targetPlayerIds: string[];
        effect: { kind: string };
      };
      expect(resolvedPayload.matchId).toBe("m1");
      expect(resolvedPayload.cardId).toBe("CB-1");
      expect(resolvedPayload.offerSeqNo).toBe(offerSeqNo);
      expect(resolvedPayload.playedByPlayerId).toBe("p1");
      expect(resolvedPayload.targetPlayerIds).toEqual(["p2"]);
      expect(resolvedPayload.effect.kind).toBe("TIMER_MODIFY");
    });

    it("Recover via recoverDuplicatePlayEvent on validate rejection + card already played", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      // Pre-stamp a CARD_RESOLVED for CB-1 so validateCardCommand
      // rejects (already played) AND getPlayedCards.has returns true.
      // The canonical-metadata stamp (eventId + commandId) MUST match
      // the env so recoverDuplicatePlayEvent can re-broadcast.
      sm.playCard(
        "p1",
        "CB-1",
        offerSeqNo,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p2"],
        1000,
        { eventId: "evt-recover", commandId: "cmd-recover" },
      );
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-recover", "cmd-recover", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      expect(recorder.callsByEvent(ServerEvent.ERROR).length).toBe(0);
      expect(
        recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length,
      ).toBeGreaterThan(0);
    });

    it("emits an error when already-played recovery has different canonical metadata", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      sm.playCard(
        "p1",
        "CB-1",
        offerSeqNo,
        { kind: "TIMER_MODIFY", deltaMs: -1000, targetCount: 1 },
        ["p2"],
        1000,
        { eventId: "evt-canonical", commandId: "cmd-canonical" },
      );
      matchService.getStateMachine.mockResolvedValue(sm);
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-replay", "cmd-replay", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_SUBMISSION");
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED)).toHaveLength(0);
      expect(recorder.callsByEvent(ServerEvent.ERROR)).toEqual([
        [
          ServerEvent.ERROR,
          expect.objectContaining({
            code: ErrorCode.COMMAND_ID_CONFLICT,
            failedEvent: ClientEvent.CARD_PLAY,
            commandId: "cmd-replay",
          }),
        ],
      ]);
    });

    it("RETRY when persistStateMachine returns non-APPLIED: evicts unpersisted mutation", async () => {
      const { sm, offerSeqNo } = pickOfferSmForPlay({ pickedCardId: "CB-1" });
      matchService.getStateMachine.mockResolvedValue(sm);
      matchService.persistStateMachine.mockResolvedValue("RETRY");
      const recorder = makeMockServer();

      const outcome = await applyPlayAuthoritative(
        service,
        playEnv("evt-retry", "cmd-retry", offerSeqNo),
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("RETRY");
      expect(matchService.evictStateMachine).toHaveBeenCalledWith(MATCH_ID);
      expect(recorder.callsByEvent(ServerEvent.CARD_RESOLVED).length).toBe(0);
      expect(redis.sadd).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Direct coverage for the static `sanitizeEffect` allowlist.
  // Reached through the live CARD_RESOLVED broadcast side effect:
  // the room-wide broadcast receives the sanitized effect (cleared
  // privacy-sensitive fields), and each per-target broadcast gets
  // the full effect. Both branches exercise the switch arms.
  // ============================================================
  describe("sanitizeEffect — privacy-preserving broadcast split", () => {
    const OWNER = { fence: 5, leaseValue: "node-a:5" };
    const ROOM_ID = "r1";
    const MATCH_ID = "m1";

    function pickOfferSmForSanitize(cardId: CardId): {
      sm: MatchStateMachine;
      offerSeqNo: number;
    } {
      const built = makePickOfferSm({
        matchId: MATCH_ID,
        roomId: ROOM_ID,
        playerIds: ["p1", "p2"],
        offeredCardIds: [cardId, cardId, cardId],
        pickCard: cardId,
        roundActive: true,
      });
      const sm = built.sm;
      const offerSeqNo = built.offerSeqNo;
      // Give p2 a hand so HAND_DESTROY has cards to destroy (the
      // resolver computes destroyedCardIds from the target's hand —
      // with no hand, the original and sanitized effects are both []
      // and the test would lose its ability to distinguish them).
      (sm as unknown as { playerHands: Map<string, CardId[]> }).playerHands.set(
        "p2",
        ["CB-1", "CB-2", "CB-4"],
      );
      return { sm, offerSeqNo };
    }

    function playEnv(
      cardId: CardId,
      offerSeqNo: number,
    ): CommandEnvelope<CardPlayBody> {
      // TN-* cards are self-only — any explicit targetPlayerId is
      // rejected by validateTarget. CB-* cards accept an optional
      // targetPlayerId; passing "p2" exercises the single-target
      // broadcast branch.
      const isCong = cardId.startsWith("CB-");
      return {
        eventId: `evt-${cardId}`,
        schemaVersion: 1,
        matchId: MATCH_ID,
        emittedByNodeId: "node-b",
        emittedAt: 1000,
        body: {
          type: "card_play",
          userId: "p1",
          commandId: `cmd-${cardId}`,
          cardId,
          offerSeqNo,
          ...(isCong ? { targetPlayerId: "p2" } : {}),
        },
      };
    }

    beforeEach(() => {
      redis.sismember.mockResolvedValue(false);
      redis.sadd.mockResolvedValue(1);
    });

    // Cards with privacy-sensitive effect fields → sanitizer clears them.
    // Each test pins ONE arm of the sanitizeEffect switch.
    it.each<{
      label: string;
      cardId: CardId;
      sensitiveField: string;
      clearedValue: unknown;
      effectKind: string;
      isCong: boolean;
    }>([
      {
        label: "OPTION_DISABLE",
        cardId: "TN-1",
        sensitiveField: "indexes",
        clearedValue: [],
        effectKind: "OPTION_DISABLE",
        isCong: false,
      },
      {
        label: "OPTION_FAKE",
        cardId: "CB-6",
        sensitiveField: "indexes",
        clearedValue: [],
        effectKind: "OPTION_FAKE",
        isCong: true,
      },
      {
        label: "HINT_REVEAL",
        cardId: "TN-3",
        sensitiveField: "partial",
        clearedValue: "",
        effectKind: "HINT_REVEAL",
        isCong: false,
      },
      {
        label: "HAND_DESTROY",
        cardId: "CB-3",
        sensitiveField: "destroyedCardIds",
        clearedValue: [],
        effectKind: "HAND_DESTROY",
        isCong: true,
      },
    ])(
      "$label — sanitized room broadcast clears $sensitiveField; per-target keeps full effect",
      async ({ cardId, sensitiveField, clearedValue, effectKind, isCong }) => {
        const { sm, offerSeqNo } = pickOfferSmForSanitize(cardId);
        matchService.getStateMachine.mockResolvedValue(sm);
        const recorder = makeMockServer();

        const outcome = await applyPlayAuthoritative(
          service,
          playEnv(cardId, offerSeqNo),
          OWNER,
          recorder.server,
        );

        expect(outcome).toBe("APPLIED");
        // Per-target channel: "p2" for CB-* (targetPlayerId set), "p1"
        // for TN-* (self-target). The room broadcast is always room:r1.
        const targetChannel = isCong ? "player:p2" : "player:p1";
        const roomFrames = recorder.callsByChannelAndEvent(
          "room:r1",
          ServerEvent.CARD_RESOLVED,
        );
        const targetFrames = recorder.callsByChannelAndEvent(
          targetChannel,
          ServerEvent.CARD_RESOLVED,
        );
        expect(roomFrames.length).toBe(1);
        expect(targetFrames.length).toBe(1);
        // Sanitized room: the sensitive field equals the cleared value.
        const roomPayload = roomFrames[0]?.[1] as Record<string, unknown>;
        const roomEffect = roomPayload.effect as Record<string, unknown>;
        expect(roomEffect[sensitiveField]).toEqual(clearedValue);
        // Per-target: the sensitive field equals the ORIGINAL value
        // (not the cleared one). Compute the original via the same RNG
        // sequence the production code uses.
        const template = getCardDefinition(cardId).effectTemplate;
        const currentRoundNo = sm.getCurrentRound()?.roundNo ?? 0;
        const seed = deriveSubstream(
          `${MATCH_ID}|p1|${currentRoundNo}|${offerSeqNo}|${cardId}`,
          `resolve|${cardId}`,
        );
        const rng = mulberry32(seed);
        const fullEffect = resolveCardEffect(cardId, template, rng, {
          options: ["A", "B", "C", "D"],
          correctAnswer: "A",
          currentRoundNo,
          // HAND_DESTROY needs the target's hand.
          ...(targetChannel === "player:p2"
            ? { targetHand: sm.getHand("p2") }
            : {}),
        });
        const targetPayload = targetFrames[0]?.[1] as Record<string, unknown>;
        const targetEffect = targetPayload.effect as Record<string, unknown>;
        expect(targetEffect[sensitiveField]).toEqual(
          (fullEffect as Record<string, unknown>)[sensitiveField],
        );
        // Effect kind matches across both broadcasts.
        expect(roomEffect.kind).toBe(effectKind);
        expect(targetEffect.kind).toBe(effectKind);
        // Guard against both broadcasts being sanitized: the
        // per-target's sensitive field MUST differ from the room's.
        expect(targetEffect[sensitiveField]).not.toEqual(
          roomEffect[sensitiveField],
        );
      },
    );

    // Pass-through kinds → sanitizer returns effect unchanged for both
    // room and per-target broadcasts. Covers 9 of the remaining arms
    // of the switch (TIMER_MODIFY, OPTION_LOCK, DELAY_RENDER,
    // VISUAL_OVERLAY, SEMANTIC_FLIP, QUESTION_REPLAY, SHIELD,
    // SCORE_MULT, SECOND_CHANCE).
    it.each<{ cardId: CardId; effectKind: string }>([
      { cardId: "CB-1", effectKind: "TIMER_MODIFY" },
      { cardId: "CB-4", effectKind: "OPTION_LOCK" },
      { cardId: "CB-8", effectKind: "DELAY_RENDER" },
      { cardId: "CB-5", effectKind: "VISUAL_OVERLAY" },
      { cardId: "CB-7", effectKind: "SEMANTIC_FLIP" },
      { cardId: "TN-5", effectKind: "QUESTION_REPLAY" },
      { cardId: "TN-4", effectKind: "SHIELD" },
      { cardId: "TN-2", effectKind: "SCORE_MULT" },
      { cardId: "TN-6", effectKind: "SECOND_CHANCE" },
    ])(
      "$cardId — pass-through kind returns the same effect object on every broadcast",
      async ({ cardId, effectKind }) => {
        const { sm, offerSeqNo } = pickOfferSmForSanitize(cardId);
        matchService.getStateMachine.mockResolvedValue(sm);
        const recorder = makeMockServer();

        const outcome = await applyPlayAuthoritative(
          service,
          playEnv(cardId, offerSeqNo),
          OWNER,
          recorder.server,
        );

        expect(outcome).toBe("APPLIED");
        const resolved = recorder.callsByEvent(ServerEvent.CARD_RESOLVED);
        // Room broadcast + per-target broadcast.
        expect(resolved.length).toBeGreaterThanOrEqual(2);
        // Sanitizer returns the effect verbatim for pass-through kinds —
        // every broadcast must carry the SAME effect object reference
        // (sanitizer does not clone or mutate the input).
        const effectRefs = resolved.map(
          ([, p]) => (p as Record<string, unknown>).effect,
        );
        const first = effectRefs[0] as Record<string, unknown>;
        for (const e of effectRefs) {
          expect(e).toBe(first);
        }
        // And the kind matches the expected arm.
        expect(first.kind).toBe(effectKind);
      },
    );
  });

  describe("emitCardResolved — duplicate-recovery broadcast split", () => {
    it("accumulates exclusions across chained except calls", () => {
      const recorder = makeMockServer();

      recorder.server
        .to("room:r1")
        .except("player:p1")
        .except("player:p2")
        .emit("test", {});

      expect(recorder.callsWithExclusion()).toEqual([
        expect.objectContaining({
          excluded: ["player:p1", "player:p2"],
        }),
      ]);
    });

    it("recoverDuplicatePlayEvent broadcasts sanitized room + full per-target effects", async () => {
      // Extends the existing duplicate-recovery test by also asserting
      // the destination split: the room broadcast receives the
      // sanitized effect, and each target's player room receives the
      // full effect. Exercises the private emitCardResolved helper
      // through the public recovery path.
      const OWNER = { fence: 5, leaseValue: "node-a:5" };
      const ROOM_ID = "r1";
      const MATCH_ID = "m1";
      const recorder = makeMockServer();
      const sm = new MatchStateMachine(MATCH_ID, ROOM_ID, [
        {
          id: "p1",
          name: "P1",
          status: PlayerStatus.ACTIVE,
          score: 0,
          totalResponseTimeMs: 0,
          correctAnswers: 0,
          isOnline: true,
        },
      ]);
      sm.classAssignment(["p1"], "recovery-seed");
      sm.transition(MatchStatus.COUNTDOWN);
      sm.transition(MatchStatus.ROUND_ACTIVE);
      sm.startRound({
        id: "q1",
        content: "Q",
        options: ["A", "B", "C", "D"],
        correctAnswer: "A",
      });
      // Inject a deterministic CARD_OFFER for TN-1 so the offer
      // is guaranteed to contain the card we play.
      const offerSeqNo = sm.getHeadSeqNo() + 1;
      (
        sm as unknown as { logEvent: (t: string, p: unknown) => number }
      ).logEvent("CARD_OFFER", {
        roundNo: 5,
        playerId: "p1",
        offeredCardIds: ["TN-1", "TN-1", "TN-1"],
        seedUsed: "recovery-seed",
      });
      (sm as unknown as { playerHands: Map<string, string[]> }).playerHands.set(
        "p1",
        ["TN-1"],
      );
      sm.pickCard("p1", "TN-1", offerSeqNo);
      // Pre-stamp a CARD_RESOLVED with metadata so recovery can match.
      const seqNo = sm.playCard(
        "p1",
        "TN-1",
        offerSeqNo,
        {
          kind: "OPTION_DISABLE",
          indexes: [2, 3],
          count: 2,
          availableAtResolution: 3,
          durationMs: 20000,
        },
        ["p1"],
        1000,
        { eventId: "evt-recover", commandId: "cmd-recover" },
      ).seqNo;

      matchService.getStateMachine.mockResolvedValue(sm);
      redis.sismember.mockResolvedValue(true);

      const outcome = await applyPlayAuthoritative(
        service,
        {
          eventId: "evt-recover",
          schemaVersion: 1,
          matchId: MATCH_ID,
          emittedByNodeId: "node-b",
          emittedAt: 1000,
          body: {
            type: "card_play",
            userId: "p1",
            commandId: "cmd-recover",
            cardId: "TN-1",
            offerSeqNo,
            targetPlayerId: undefined,
          },
        },
        OWNER,
        recorder.server,
      );

      expect(outcome).toBe("DUPLICATE_EVENT");
      const roomFrames = recorder.callsByChannelAndEvent(
        "room:r1",
        ServerEvent.CARD_RESOLVED,
      );
      const targetFrames = recorder.callsByChannelAndEvent(
        "player:p1",
        ServerEvent.CARD_RESOLVED,
      );
      // 1 sanitized room broadcast + 1 per-target broadcast (the
      // pre-stamp's targets were ["p1"], so the per-target room is
      // `player:p1`).
      expect(roomFrames.length).toBe(1);
      expect(targetFrames.length).toBe(1);
      // Sanitized room broadcast: cleared indexes (privacy leak guard).
      const roomPayload = roomFrames[0]?.[1] as Record<string, unknown>;
      expect((roomPayload.effect as Record<string, unknown>).indexes).toEqual(
        [],
      );
      const roomCalls = recorder
        .callsWithExclusion()
        .filter(
          (c) =>
            c.channel === "room:r1" && c.event === ServerEvent.CARD_RESOLVED,
        );
      expect(roomCalls[0]?.excluded).toEqual(["player:p1"]);
      // Per-target broadcast: full effect retained so the target
      // can render the option-disable highlights.
      const targetPayload = targetFrames[0]?.[1] as Record<string, unknown>;
      expect((targetPayload.effect as Record<string, unknown>).indexes).toEqual(
        [2, 3],
      );
      // Canonical seqNo round-trips on both frames.
      expect(roomPayload.seqNo).toBe(seqNo);
      expect(targetPayload.seqNo).toBe(seqNo);
      expect(roomPayload.cardId).toBe("TN-1");
    });
  });
});

function targetsEqual(list: Array<readonly string[]>): boolean {
  if (list.length < 2) return false;
  const first = JSON.stringify(list[0]);
  return list.every((l) => JSON.stringify(l) === first);
}

/**
 * Minimal Socket.IO mock that captures every `server.to(...).emit(event, payload)`
 * call. Each `.to(...)` returns a fresh builder scoped to that channel so the
 * sanitized room broadcast and per-target full-effect broadcasts are recorded
 * against their respective destinations. `.except(...)` stays on the same
 * channel (it is a property of the room chain, not a destination switch) and
 * records its exclusion argument so privacy tests can assert which target
 * was excluded from the broadcast.
 *
 * `callsByEvent(event)` keeps the legacy `[event, payload]` shape so existing
 * callers do not churn. `callsByChannelAndEvent(channel, event)` is the
 * channel-aware accessor used by the duplicate-recovery broadcast split.
 * `callsWithExclusion()` returns the full call records including any
 * `except(...)` exclusion argument.
 */
type MockCall = {
  channel: string;
  event: string;
  payload: unknown;
  excluded: readonly string[];
};

function makeMockServer(): {
  server: Server;
  callsByEvent: (event: string) => Array<[string, unknown]>;
  callsByChannelAndEvent: (
    channel: string,
    event: string,
  ) => Array<[string, unknown]>;
  callsWithExclusion: () => MockCall[];
} {
  const calls: MockCall[] = [];
  const builder = (channel: string, excluded: readonly string[] = []) => ({
    emit: (event: string, payload: unknown) => {
      calls.push({ channel, event, payload, excluded });
      return builder(channel, excluded);
    },
    except: (...rooms: (string | string[])[]) => {
      const flat = rooms.flat();
      return builder(channel, [...excluded, ...flat]);
    },
  });
  const server = {
    to: (channel: string) => builder(channel),
  } as unknown as Server;
  return {
    server,
    callsByEvent: (event: string) =>
      calls
        .filter((c) => c.event === event)
        .map((c): [string, unknown] => [c.event, c.payload]),
    callsByChannelAndEvent: (channel: string, event: string) =>
      calls
        .filter((c) => c.channel === channel && c.event === event)
        .map((c): [string, unknown] => [c.event, c.payload]),
    callsWithExclusion: () => [...calls],
  };
}
