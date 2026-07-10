import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { LobbyCountdownService } from "./lobby-countdown.service";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";
import { RoomStatus, GAME_CONFIG, ServerEvent } from "@arena/shared";
import { Server } from "socket.io";
import {
  readPersistedCountdownEnd,
  LOBBY_COUNTDOWN_INDEX_KEY as COUNTDOWN_INDEX_KEY,
} from "./game-loop.countdown-store";

vi.mock("./game-loop.countdown-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./game-loop.countdown-store")>();
  return {
    ...actual,
    // Default to the real implementation so tests that drive
    // `readPersistedCountdownEnd` indirectly (via the mocked Redis
    // client's get()/smembers()) get real parsing behaviour. Tests
    // that need to force a specific return value still override it
    // with `vi.mocked(readPersistedCountdownEnd).mockResolvedValueOnce(...)`.
    readPersistedCountdownEnd: vi.fn(actual.readPersistedCountdownEnd),
  };
});

describe("LobbyCountdownService", () => {
  let service: LobbyCountdownService;
  let roomService: RoomService;
  let redisService: any;
  let mockServer: Server;
  let loggerErrorSpy: any;

  beforeEach(() => {
    roomService = {
      getRoom: vi.fn().mockResolvedValue({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      }),
      updateRoomStatus: vi.fn().mockResolvedValue({}),
    } as unknown as RoomService;

    redisService = createMockRedisService();

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    // Deliberately NOT calling service.setServer() here: several
    // recovery/countdown tests (moved from game-loop.service.spec.ts)
    // exercise the "server not wired up yet" branches and opt into a
    // server themselves via setServer()/setLauncher() when needed —
    // matching the collaborator's real boot order (onModuleInit can
    // run before the gateway calls setServer).
    service = new LobbyCountdownService(roomService, redisService);

    loggerErrorSpy = vi
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => {});
    vi.spyOn((service as any).logger, "log").mockImplementation(() => {});
    vi.spyOn((service as any).logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Builds a fresh LobbyCountdownService with its own redis mock so
  // tests can drive boot-recovery scenarios (SMEMBERS/GET overrides,
  // a spy-able multi() chain) without disturbing the shared
  // `service`/`redisService` from beforeEach. Moved here from
  // game-loop.service.spec.ts's `buildService` helper, which built a
  // whole GameLoopService around the same LobbyCountdownService
  // construction — this harness constructs the collaborator directly.
  function buildLobbyCountdown(
    redisOverrides: { smembers?: unknown; get?: unknown } = {},
  ) {
    const redis = createMockRedisService() as any;
    const multiSpy = vi.fn(() => ({
      set: () => ({ sadd: () => ({ exec: () => Promise.resolve([]) }) }),
      del: () => ({ srem: () => ({ exec: () => Promise.resolve([]) }) }),
      sadd: () => ({ exec: () => Promise.resolve([]) }),
      srem: () => ({ exec: () => Promise.resolve([]) }),
      exec: () => Promise.resolve([]),
    }));
    vi.spyOn(redis.getClient(), "multi").mockImplementation(
      multiSpy as unknown as () => unknown,
    );
    if (redisOverrides.smembers !== undefined) {
      vi.mocked(redis.getClient().smembers).mockResolvedValueOnce(
        redisOverrides.smembers as string[],
      );
    }
    if (redisOverrides.get !== undefined) {
      vi.mocked(redis.getClient().get).mockResolvedValueOnce(
        redisOverrides.get as string | null,
      );
    }
    const svc = new LobbyCountdownService(roomService, redis);
    return { svc, redis, multiSpy };
  }

  describe("onModuleInit and dead letter sweeping", () => {
    it("should sweep dead letter rooms when NODE_ENV is not test", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(["room-dl-1"]);
      client.exists.mockResolvedValueOnce(0); // Expired

      try {
        await service.onModuleInit();
        expect(client.smembers).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
        );
        expect(client.exists).toHaveBeenCalledWith(
          "room:recovery:dead-letter:room-dl-1",
        );
        expect(client.srem).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
          "room-dl-1",
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should handle error during sweepDeadLetterRooms", async () => {
      const client = redisService.getClient();
      client.smembers.mockRejectedValueOnce(new Error("Redis connection lost"));

      await (service as any).sweepDeadLetterRooms();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Failed to sweep dead-letter rooms:",
        expect.any(Error),
      );
    });

    it("should return early during sweepDeadLetterRooms if roomIds is null or undefined", async () => {
      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(null);

      await (service as any).sweepDeadLetterRooms();

      expect(client.exists).not.toHaveBeenCalled();
    });

    it("should skip removing dead letter room from set if exists is not 0", async () => {
      const client = redisService.getClient();
      client.smembers.mockResolvedValueOnce(["room-dl-1"]);
      client.exists.mockResolvedValueOnce(1); // Still valid/exists

      await (service as any).sweepDeadLetterRooms();

      expect(client.srem).not.toHaveBeenCalled();
    });
  });

  describe("maybeStartPublicCountdown persist and rollback failures", () => {
    it("should handle persist failure and rollback room status to WAITING", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        players: new Array(GAME_CONFIG.MIN_PLAYERS_TO_START).fill({
          userId: "p",
        }),
      } as any);

      vi.mocked(roomService.updateRoomStatus).mockResolvedValueOnce({} as any); // COUNTDOWN success

      // Mock Redis client to fail during transaction exec
      const client = redisService.getClient();
      vi.spyOn(client, "multi").mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValueOnce(new Error("Persist failed")),
      } as any);

      await expect(
        service.maybeStartPublicCountdown("room-1", mockServer),
      ).rejects.toThrow("Persist failed");

      expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
        "room-1",
        RoomStatus.WAITING,
      );
    });

    it("should log error if rollback fails after persist failure", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "room-1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        players: new Array(GAME_CONFIG.MIN_PLAYERS_TO_START).fill({
          userId: "p",
        }),
      } as any);

      vi.mocked(roomService.updateRoomStatus)
        .mockResolvedValueOnce({} as any) // COUNTDOWN success
        .mockRejectedValueOnce(new Error("Database crash")); // Rollback failure

      // Mock Redis client to fail during transaction exec
      const client = redisService.getClient();
      vi.spyOn(client, "multi").mockReturnValueOnce({
        set: vi.fn().mockReturnThis(),
        sadd: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValueOnce(new Error("Persist failed")),
      } as any);

      await expect(
        service.maybeStartPublicCountdown("room-1", mockServer),
      ).rejects.toThrow("Persist failed");

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to roll back room room-1 to WAITING after countdown persist failure:",
        ),
        expect.any(Error),
      );
    });
  });

  describe("getCountdownEnd non-finite values", () => {
    it("should return null when readPersistedCountdownEnd returns a non-finite value", async () => {
      vi.mocked(readPersistedCountdownEnd).mockResolvedValueOnce({
        kind: "present",
        value: Infinity,
      });

      const result = await service.getCountdownEnd("room-1");
      expect(result).toBeNull();
    });
  });

  describe("getCountdownEnd", () => {
    it("returns null when no countdown is active for the room", async () => {
      // H4 fix follow-up: getCountdownEnd is now async because it
      // falls back to Redis. The test awaits the returned promise.
      expect(await (service as any).getCountdownEnd("r1")).toBeNull();
    });

    it("returns the recorded countdownEndsAt for an active countdown", async () => {
      const endsAt = Date.now() + 10_000;
      (service as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: endsAt,
      });
      // H4 fix: same async-aware assertion.
      expect(await (service as any).getCountdownEnd("r1")).toBe(endsAt);
    });
  });

  describe("armLobbyCountdownTimer (private)", () => {
    it("deletes the in-memory slot and clears Redis when no server is available", async () => {
      const { svc, multiSpy } = buildLobbyCountdown();
      // No setServer() call → server is undefined
      (svc as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });

      (svc as any).armLobbyCountdownTimer("r1", Date.now() + 5000);

      expect((svc as any).lobbyCountdowns.has("r1")).toBe(false);
      // clearPersistedCountdown fires the multi() chain
      expect(multiSpy).toHaveBeenCalled();
    });

    it("arms a timer that triggers launchRoomMatch when the caller supplies a server", async () => {
      vi.useFakeTimers();
      const { svc } = buildLobbyCountdown();
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);

      (svc as any).armLobbyCountdownTimer(
        "r1",
        Date.now() + 5000,
        mockServer as unknown as Server,
      );

      expect((svc as any).lobbyCountdowns.has("r1")).toBe(true);

      await vi.advanceTimersByTimeAsync(5000);

      expect(launchSpy).toHaveBeenCalledWith("r1", mockServer);
      vi.useRealTimers();
    });
  });

  describe("handleRoomPlayerLeft", () => {
    it("is a no-op when no countdown is active for the room", async () => {
      await (service as any).handleRoomPlayerLeft("r1", mockServer);
      expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it("is a no-op when the room is not in COUNTDOWN status", async () => {
      // Pre-arm a countdown so the entry exists
      (service as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        players: [{ userId: "p1" }],
      } as any);

      await (service as any).handleRoomPlayerLeft("r1", mockServer);

      expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it("is a no-op when the room still has at least MIN_PLAYERS_TO_START players", async () => {
      (service as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.COUNTDOWN,
        players: [{ userId: "p1" }, { userId: "p2" }, { userId: "p3" }],
      } as any);

      await (service as any).handleRoomPlayerLeft("r1", mockServer);

      expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it("cancels the countdown, updates status, and emits ROOM_COUNTDOWN_CANCELLED + ROOM_STATUS_UPDATED", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      (service as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.COUNTDOWN,
        players: [{ userId: "p1" }], // below MIN
      } as any);

      await (service as any).handleRoomPlayerLeft("r1", mockServer);

      expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
        "r1",
        RoomStatus.WAITING,
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROOM_COUNTDOWN_CANCELLED,
        expect.objectContaining({
          roomId: "r1",
          roomStatus: RoomStatus.WAITING,
          reason: "PLAYER_LEFT",
        }),
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROOM_STATUS_UPDATED,
        expect.objectContaining({
          roomId: "r1",
          roomStatus: RoomStatus.WAITING,
        }),
      );
      expect((service as any).lobbyCountdowns.has("r1")).toBe(false);
    });
  });

  describe("onModuleInit (lobby countdown recovery)", () => {
    it("returns immediately when recovery is already in flight", async () => {
      (service as any).recoveryInFlight = true;
      const smembersSpy = vi.spyOn(
        (service as any).redis.getClient(),
        "smembers",
      );

      await (service as any).onModuleInit();

      expect(smembersSpy).not.toHaveBeenCalled();
      (service as any).recoveryInFlight = false;
    });

    it("is a no-op when the countdowns set is empty", async () => {
      const { svc } = buildLobbyCountdown({ smembers: [] });
      await (svc as any).onModuleInit();
      // No further calls into Redis beyond the initial SMEMBERS
      expect(svc).toBeDefined();
    });

    it("removes a room from the index when its payload key is missing", async () => {
      const { svc, redis } = buildLobbyCountdown({
        smembers: ["rMissing"],
      });
      // get() returns null by default → direct srem path (no multi needed)
      const sremSpy = redis.getClient().srem;
      await (svc as any).onModuleInit();
      expect(sremSpy).toHaveBeenCalledWith(COUNTDOWN_INDEX_KEY, "rMissing");
    });

    it("removes a room from the index when its stored countdownEndsAt is unparseable", async () => {
      const { svc, redis, multiSpy } = buildLobbyCountdown({
        smembers: ["rBad"],
        get: "not-a-number",
      });
      // readPersistedCountdownEnd now treats unparseable values
      // as "missing" (it returns { kind: "missing" } for non-finite
      // parsed ints), so the recovery path takes the same code
      // branch as a missing key: a single SREM on the index set
      // rather than a full clearPersistedCountdown multi() chain.
      const sremSpy = redis.getClient().srem;
      await (svc as any).onModuleInit();
      expect(sremSpy).toHaveBeenCalledWith(COUNTDOWN_INDEX_KEY, "rBad");
      // Pin the srem-only branch: the recovery path must NOT have
      // entered the clearPersistedCountdown multi()/exec() chain.
      // Without this assertion, a regression that loosened the
      // parser to treat "not-a-number" as 0 (parseInt would return
      // NaN, but a future bug could flip the branch ordering) would
      // still satisfy the SREM expectation because clearPersistedCountdown
      // also issues an SREM internally.
      expect(multiSpy).not.toHaveBeenCalled();
    });

    it("re-arms a timer for a future countdown (uses the injected server)", async () => {
      vi.useFakeTimers();
      const futureEnd = Date.now() + 60_000;
      const { svc } = buildLobbyCountdown({
        smembers: ["rFuture"],
        get: String(futureEnd),
      });
      // Inject a server so the arm path can use it
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);
      (svc as any).setServer(mockServer as unknown as Server);

      await (svc as any).onModuleInit();

      // Countdown is now armed in-memory
      expect((svc as any).lobbyCountdowns.has("rFuture")).toBe(true);
      // Advancing past the future end fires launchRoomMatch
      await vi.advanceTimersByTimeAsync(60_000);
      expect(launchSpy).toHaveBeenCalledWith("rFuture", mockServer);
      vi.useRealTimers();
    });

    it("launches immediately when the recovered countdown already expired and a server is set", async () => {
      const pastEnd = Date.now() - 1000;
      const { svc } = buildLobbyCountdown({
        smembers: ["rExpired"],
        get: String(pastEnd),
      });
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);
      (svc as any).setServer(mockServer as unknown as Server);

      await (svc as any).onModuleInit();
      // Give the void promise chain a microtask to flush
      await Promise.resolve();

      expect(launchSpy).toHaveBeenCalledWith("rExpired", mockServer);
    });

    it("re-queues via scheduleRecoveryRetry when clearPersistedCountdown returns false for an expired countdown (server wired)", async () => {
      // New branch: the `if (!cleared)` path inside onModuleInit's
      // expired-countdown handler when the server IS wired up
      // (game-loop.service.ts:213-219). When clearPersistedCountdown
      // fails to actually remove the persisted entry, the recovery
      // must be re-queued via scheduleRecoveryRetry instead of
      // launching the match.
      const pastEnd = Date.now() - 1000;
      const { svc } = buildLobbyCountdown({
        smembers: ["rClearFail"],
        get: String(pastEnd),
      });
      vi.spyOn(svc as any, "clearPersistedCountdown").mockResolvedValue(false);
      const scheduleRetrySpy = vi
        .spyOn(svc as any, "scheduleRecoveryRetry")
        .mockImplementation(() => {});
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);
      const warnSpy = vi.spyOn((svc as any).logger, "warn");
      (svc as any).setServer(mockServer as unknown as Server);

      await (svc as any).onModuleInit();
      // Flush the async clearPersistedCountdown → .then callback
      await Promise.resolve();
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovery clear failed for room rClearFail"),
      );
      expect(scheduleRetrySpy).toHaveBeenCalled();
      // launchRoomMatch must NOT be called — the clear failed.
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("buffers expired countdowns into pendingRecovery when no server is wired up (C4)", async () => {
      // C4 fix: the previous behaviour was to silently clear the
      // persisted entry when the recovered countdown had expired
      // but the server was not yet wired up. That left the room
      // stuck in COUNTDOWN forever and the next restart would
      // re-issue the same warning, looping the broken state.
      //
      // New behaviour: the recovery is buffered in
      // `pendingRecovery` and replayed by `drainPendingRecovery`
      // the moment `setServer` is called. No Redis state is
      // touched on the no-server path.
      const pastEnd = Date.now() - 1000;
      const { svc, multiSpy } = buildLobbyCountdown({
        smembers: ["rExpiredNoServer"],
        get: String(pastEnd),
      });
      // No setServer call → server is undefined

      await (svc as any).onModuleInit();

      // The recovery was buffered, NOT cleared.
      expect((svc as any).pendingRecovery).toEqual([
        {
          roomId: "rExpiredNoServer",
          countdownEndsAt: pastEnd,
          expired: true,
          retryCount: 0,
        },
      ]);
      // The Redis multi() path was NOT used — the persisted entry
      // stays in place until setServer drains the buffer.
      expect(multiSpy).not.toHaveBeenCalled();
    });

    it("drains pendingRecovery when setServer is called (C4)", async () => {
      // C4 fix: pendingRecovery entries are replayed through
      // launchRoomMatch / armLobbyCountdownTimer the moment
      // setServer is called. This test exercises the expired path
      // (room launches immediately) and the unexpired path
      // (room re-arms its timer).
      const now = Date.now();
      const pastEnd = now - 1000;
      const futureEnd = now + 60_000;
      const { svc, redis } = buildLobbyCountdown({
        smembers: ["rExpired", "rFuture"],
      });
      // mockImplementation lets us return a different value per
      // key, which the two roomIds in smembers require.
      vi.mocked(redis.getClient().get).mockImplementation(
        async (key: string) => {
          if (typeof key !== "string") return null;
          if (key.endsWith("rExpired")) return String(pastEnd);
          if (key.endsWith("rFuture")) return String(futureEnd);
          return null;
        },
      );

      await (svc as any).onModuleInit();
      expect((svc as any).pendingRecovery).toHaveLength(2);

      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);
      vi.spyOn(svc as any, "clearPersistedCountdown").mockResolvedValue(true);

      svc.setServer(mockServer as unknown as Server);
      await Promise.resolve();
      await Promise.resolve();

      // The buffer is drained atomically.
      expect((svc as any).pendingRecovery).toEqual([]);
      // Expired entry → launchRoomMatch was called.
      expect(launchSpy).toHaveBeenCalledWith("rExpired", mockServer);
      // Future entry → the lobbyCountdowns map was populated.
      expect((svc as any).lobbyCountdowns.has("rFuture")).toBe(true);
    });

    it("onModuleInit after setServer does not re-buffer (C4)", async () => {
      // Sanity: once setServer has been called, `this.server` is
      // truthy. A subsequent onModuleInit must use the direct
      // launch / arm paths, NOT re-buffer. Re-buffering would mean
      // the buffer grows unbounded across multiple re-inits.
      const pastEnd = Date.now() - 1000;
      const { svc, redis } = buildLobbyCountdown({
        smembers: ["rExpired"],
      });
      vi.mocked(redis.getClient().smembers).mockResolvedValue(["rExpired"]);
      vi.mocked(redis.getClient().get).mockImplementation(
        async (key: string) => {
          if (typeof key !== "string") return null;
          if (key.endsWith("rExpired")) return String(pastEnd);
          return null;
        },
      );
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      svc.setLauncher(launchSpy);
      vi.spyOn(svc as any, "clearPersistedCountdown").mockResolvedValue(true);

      // First recovery (no server) → buffer populated.
      await (svc as any).onModuleInit();
      expect((svc as any).pendingRecovery).toHaveLength(1);

      // setServer drains the buffer; server is now set.
      svc.setServer(mockServer as unknown as Server);
      await Promise.resolve();
      await Promise.resolve();
      expect(launchSpy).toHaveBeenCalledTimes(1);
      expect((svc as any).pendingRecovery).toEqual([]);

      // Second recovery (server set) → launches directly, no
      // re-buffer. The buffer stays empty and launch is called a
      // second time (idempotency is launchRoomMatch's own
      // responsibility, tested elsewhere).
      await (svc as any).onModuleInit();
      await Promise.resolve();
      expect(launchSpy).toHaveBeenCalledTimes(2);
      expect((svc as any).pendingRecovery).toEqual([]);
    });

    it("logs and continues when a per-room recovery error is thrown", async () => {
      const { svc, redis } = buildLobbyCountdown({
        smembers: ["rBoom"],
      });
      // Make the per-room get() throw
      vi.mocked(redis.getClient().get).mockRejectedValueOnce(
        new Error("redis timeout"),
      );
      const errorSpy = vi.spyOn((svc as any).logger, "error");

      await (svc as any).onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("rBoom"),
        expect.any(Error),
      );
    });

    it("resets the recoveryInFlight guard even if the top-level recovery throws", async () => {
      const { svc, redis } = buildLobbyCountdown();
      // Make SMEMBERS itself reject
      vi.mocked(redis.getClient().smembers).mockRejectedValueOnce(
        new Error("top-level boom"),
      );
      const errorSpy = vi.spyOn((svc as any).logger, "error");

      await (svc as any).onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        "Lobby countdown recovery failed:",
        expect.any(Error),
      );
      // Guard must be reset so a later invocation can run
      expect((svc as any).recoveryInFlight).toBe(false);
    });
  });

  describe("maybeStartPublicCountdown", () => {
    it("starts public room countdown when enough players join", async () => {
      vi.useFakeTimers();

      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      service.setLauncher(launchSpy);

      const result = await service.maybeStartPublicCountdown(
        "room-1",
        mockServer,
      );

      expect(result).not.toBeNull();
      expect(vi.mocked(roomService.updateRoomStatus)).toHaveBeenCalledWith(
        "room-1",
        RoomStatus.COUNTDOWN,
      );

      await vi.advanceTimersByTimeAsync(GAME_CONFIG.COUNTDOWN_DURATION_MS);

      expect(launchSpy).toHaveBeenCalledWith("room-1", mockServer);

      vi.useRealTimers();
    });

    it("cancels room countdown when players drop below minimum", async () => {
      vi.useFakeTimers();

      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.getRoom)
        .mockResolvedValueOnce({
          id: "room-1",
          type: "PUBLIC",
          status: RoomStatus.WAITING,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any)
        .mockResolvedValueOnce({
          id: "room-1",
          type: "PUBLIC",
          status: RoomStatus.COUNTDOWN,
          currentMatchId: null,
          players: [{ userId: "p1" }],
        } as any);

      await service.maybeStartPublicCountdown("room-1", mockServer);
      await service.handleRoomPlayerLeft("room-1", mockServer);

      expect(vi.mocked(roomService.updateRoomStatus)).toHaveBeenCalledWith(
        "room-1",
        RoomStatus.WAITING,
      );
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROOM_COUNTDOWN_CANCELLED,
        expect.objectContaining({ reason: "PLAYER_LEFT" }),
      );

      vi.useRealTimers();
    });
  });

  describe("maybeStartPublicCountdown (additional paths)", () => {
    it("returns null for a PRIVATE room", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        type: "PRIVATE",
        status: RoomStatus.WAITING,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      const result = await (service as any).maybeStartPublicCountdown(
        "r1",
        mockServer,
      );
      expect(result).toBeNull();
    });

    it("returns null when the room is not in WAITING status", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        type: "PUBLIC",
        status: RoomStatus.IN_GAME,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      const result = await (service as any).maybeStartPublicCountdown(
        "r1",
        mockServer,
      );
      expect(result).toBeNull();
    });

    it("returns null when a countdown slot exists but the stored entry vanished", async () => {
      const countdowns = (service as any).lobbyCountdowns as Map<
        string,
        { timer: NodeJS.Timeout; countdownEndsAt: number }
      >;
      countdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });
      const getSpy = vi.spyOn(countdowns, "get").mockReturnValueOnce(undefined);

      const result = await (service as any).maybeStartPublicCountdown(
        "r1",
        mockServer,
      );

      expect(result).toBeNull();
      expect(getSpy).toHaveBeenCalledWith("r1");
    });

    it("returns null when there are fewer than MIN_PLAYERS_TO_START players", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        players: [{ userId: "p1" }],
      } as any);

      const result = await (service as any).maybeStartPublicCountdown(
        "r1",
        mockServer,
      );
      expect(result).toBeNull();
    });

    it("returns the existing countdown entry when one is already armed", async () => {
      const endsAt = Date.now() + 30_000;
      (service as any).lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: endsAt,
      });

      const result = await (service as any).maybeStartPublicCountdown(
        "r1",
        mockServer,
      );

      // The service returns the whole entry (timer + countdownEndsAt);
      // we only care that the endsAt we stored is what comes back.
      expect(result?.countdownEndsAt).toBe(endsAt);
      // updateRoomStatus must NOT be called a second time
      expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
    });
  });

  describe("Lobby countdown error & edge-case paths", () => {
    // Helper: build a service whose redis client throws on the next
    // `multi()` invocation. Used to exercise the `catch` blocks in
    // `persistLobbyCountdown` and `clearPersistedCountdown` without
    // needing a real Redis.
    function buildServiceWithFailingMulti(throwFrom: "set" | "del") {
      const redis = createMockRedisService() as any;
      const failingExec = vi.fn().mockRejectedValue(new Error("redis down"));
      const multiSpy = vi.fn(() => {
        const mockMulti: any = {};
        mockMulti.set = vi.fn().mockReturnValue(mockMulti);
        mockMulti.del = vi.fn().mockReturnValue(mockMulti);
        mockMulti.sadd = vi.fn().mockReturnValue(mockMulti);
        mockMulti.srem = vi.fn().mockReturnValue(mockMulti);
        mockMulti.exec = vi.fn().mockImplementation(() => {
          if (throwFrom === "set" && mockMulti.set.mock.calls.length > 0) {
            return failingExec();
          }
          if (throwFrom === "del" && mockMulti.del.mock.calls.length > 0) {
            return failingExec();
          }
          return Promise.resolve([]);
        });
        return mockMulti;
      });
      vi.spyOn(redis.getClient(), "multi").mockImplementation(
        multiSpy as unknown as () => unknown,
      );
      const svc = new LobbyCountdownService(roomService, redis);
      return { svc, redis, failingExec, multiSpy };
    }

    it("propagates errors thrown by persistLobbyCountdown (redis SET chain fails)", async () => {
      const { svc, multiSpy } = buildServiceWithFailingMulti("set");

      await expect(
        (svc as any).persistLobbyCountdown("r1", Date.now() + 5000),
      ).rejects.toThrow();

      expect(multiSpy).toHaveBeenCalled();
    });

    it("logs and swallows errors thrown by clearPersistedCountdown (redis DEL chain fails)", async () => {
      const { svc, multiSpy } = buildServiceWithFailingMulti("del");
      const warnSpy = vi.spyOn((svc as any).logger, "warn");

      await (svc as any).clearPersistedCountdown("r1");

      expect(multiSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to clear persisted countdown for room r1: redis down",
        ),
      );
    });

    it("logs and swallows non-Error rejections thrown by clearPersistedCountdown (string DEL chain fail)", async () => {
      const redis = createMockRedisService() as any;
      const multiSpy = vi.fn(() => {
        const mockMulti: any = {};
        mockMulti.set = vi.fn().mockReturnValue(mockMulti);
        mockMulti.del = vi.fn().mockReturnValue(mockMulti);
        mockMulti.sadd = vi.fn().mockReturnValue(mockMulti);
        mockMulti.srem = vi.fn().mockReturnValue(mockMulti);
        mockMulti.exec = vi.fn().mockRejectedValueOnce("redis down (string)");
        return mockMulti;
      });
      vi.spyOn(redis.getClient(), "multi").mockImplementation(
        multiSpy as unknown as () => unknown,
      );
      const svc = new LobbyCountdownService(roomService, redis);
      const warnSpy = vi.spyOn((svc as any).logger, "warn");

      await (svc as any).clearPersistedCountdown("r1");

      expect(multiSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to clear persisted countdown for room r1: redis down (string)",
        ),
      );
    });

    it("maybeStartPublicCountdown rolls back the in-memory slot, fires clearPersistedCountdown, and rethrows when updateRoomStatus fails", async () => {
      vi.useFakeTimers();
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
        new Error("db write failed"),
      );
      const errorSpy = vi.spyOn((service as any).logger, "error");
      // The catch block fires void this.clearPersistedCountdown(roomId) —
      // spy on the redis client's multi() so we can assert the cleanup
      // pipeline runs (and therefore the dead persisted entry is wiped
      // so a retry can re-arm cleanly).
      const multiSpy = vi.spyOn((service as any).redis.getClient(), "multi");

      await expect(
        (service as any).maybeStartPublicCountdown("r1", mockServer),
      ).rejects.toThrow("db write failed");

      // In-memory countdown slot must be cleared so a retry can re-arm
      expect((service as any).lobbyCountdowns.has("r1")).toBe(false);
      // The cleanup pipeline (DEL + SREM) must have been queued to wipe
      // the persisted entry. multi() is called at least twice: once for
      // the initial persist attempt, once for the cleanup in the catch.
      expect(multiSpy).toHaveBeenCalled();
      // No error is logged by the service itself — the catch only
      // re-throws; the caller is expected to surface/log the failure.
      expect(errorSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("armLobbyCountdownTimer's setTimeout callback logs and swallows launchRoomMatch failures", async () => {
      vi.useFakeTimers();
      const { svc } = buildLobbyCountdown();
      const launchError = new Error("launch boom");
      svc.setLauncher(vi.fn().mockRejectedValue(launchError));
      const errorSpy = vi.spyOn((svc as any).logger, "error");

      (svc as any).armLobbyCountdownTimer(
        "r1",
        Date.now() + 5000,
        mockServer as unknown as Server,
      );

      // Advance past the countdown; the timer callback's .catch() runs
      await vi.advanceTimersByTimeAsync(5000);
      // Flush the void promise chain
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to auto-start lobby countdown for room r1",
        launchError,
      );
      vi.useRealTimers();
    });

    it("onModuleInit logs and swallows errors from the recovery launchRoomMatch (server wired up)", async () => {
      // The countdown is already past expiry, a server IS wired up, and
      // launchRoomMatch rejects — the .catch() on the fire-and-forget
      // promise must log the failure instead of crashing the process.
      const pastEnd = Date.now() - 1000;
      const { svc } = buildLobbyCountdown({
        smembers: ["rExpired"],
        get: String(pastEnd),
      });
      const launchError = new Error("recovery launch boom");
      svc.setLauncher(vi.fn().mockRejectedValue(launchError));
      (svc as any).setServer(mockServer as unknown as Server);
      const errorSpy = vi.spyOn((svc as any).logger, "error");

      await (svc as any).onModuleInit();
      // Flush the void promise chain
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        "Recovery launch failed for room rExpired:",
        launchError,
      );
    });

    it("onModuleInit does not touch Redis when the no-server path is taken (C4)", async () => {
      // C4 fix follow-up: previously, when the countdown had expired
      // and the server was not yet wired up, the service issued a
      // fire-and-forget `clearPersistedCountdown` call. That call
      // could fail and would have been logged via .catch(). With the
      // C4 fix, no clearPersistedCountdown call is made on the
      // no-server path — the recovery is buffered instead. This
      // test pins the new contract.
      const pastEnd = Date.now() - 1000;
      const { svc } = buildLobbyCountdown({
        smembers: ["rExpiredNoServer"],
        get: String(pastEnd),
      });
      const clearSpy = vi.spyOn(svc as any, "clearPersistedCountdown");
      const errorSpy = vi.spyOn((svc as any).logger, "error");

      await (svc as any).onModuleInit();
      await Promise.resolve();
      await Promise.resolve();

      // The clear path is not invoked on the no-server path.
      expect(clearSpy).not.toHaveBeenCalled();
      // No error is logged because no call rejected.
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Failed to clear persisted countdown"),
        expect.any(Error),
      );
      // The recovery was buffered for later drain.
      expect((svc as any).pendingRecovery).toEqual([
        {
          roomId: "rExpiredNoServer",
          countdownEndsAt: pastEnd,
          expired: true,
          retryCount: 0,
        },
      ]);
    });
  });

  describe("drainPendingRecovery", () => {
    it("returns early when the buffer is empty (no work to do)", async () => {
      // New branch: `if (this.pendingRecovery.length === 0) return;`
      // at game-loop.service.ts:109. Calling setServer on a fresh
      // service must not invoke armLobbyCountdownTimer or
      // launchRoomMatch.
      const armSpy = vi.spyOn(service as any, "armLobbyCountdownTimer");
      const launchSpy = vi.fn();
      service.setLauncher(launchSpy);

      service.setServer(mockServer as unknown as Server);
      await Promise.resolve();

      expect(armSpy).not.toHaveBeenCalled();
      expect(launchSpy).not.toHaveBeenCalled();
      expect((service as any).pendingRecovery).toEqual([]);
    });

    it("logs and swallows a launch failure for an expired entry in the buffer", async () => {
      // New branch: the .catch() on the fire-and-forget
      // `void this.launchRoomMatch(...)` inside drainPendingRecovery
      // for `entry.expired === true` (game-loop.service.ts:119-123).
      // Pin the contract: a rejected launchRoomMatch must NOT
      // bubble up; the error is logged at error level.
      const launchError = new Error("drain launch boom");
      service.setLauncher(vi.fn().mockRejectedValue(launchError));
      vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
        true,
      );
      (service as any).pendingRecovery.push({
        roomId: "rExpired",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
      });
      const errorSpy = vi.spyOn((service as any).logger, "error");

      service.setServer(mockServer as unknown as Server);
      // Flush the void promise chain several times — the
      // rejected promise is detached. The chain is now:
      // clearPersistedCountdown() → .then(launchRoomMatch) → .catch(logger.error)
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        "Pending-recovery launch failed for room rExpired:",
        launchError,
      );
      // The buffer is drained atomically even on the failure
      // path — we never leave the entry behind.
      expect((service as any).pendingRecovery).toEqual([]);
    });

    it("re-queues via scheduleRecoveryRetry when clearPersistedCountdown returns false for an expired entry", async () => {
      // New branch: the `if (!cleared)` path inside
      // drainPendingRecovery's expired-entry handler
      // (game-loop.service.ts:134-139). When clearPersistedCountdown
      // fails to actually remove the persisted countdown (returns
      // false), the entry must be re-queued via scheduleRecoveryRetry
      // rather than launching the match.
      vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
        false,
      );
      const scheduleRetrySpy = vi
        .spyOn(service as any, "scheduleRecoveryRetry")
        .mockImplementation(() => {});
      const launchSpy = vi.fn().mockResolvedValue({ id: "m1" });
      service.setLauncher(launchSpy);
      const warnSpy = vi.spyOn((service as any).logger, "warn");
      const entry = {
        roomId: "rClearFail",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
      };
      (service as any).pendingRecovery.push(entry);

      service.setServer(mockServer as unknown as Server);
      // Flush the promise chain: clearPersistedCountdown resolves,
      // then the .then callback runs the !cleared path.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Recovery clear failed for room rClearFail"),
      );
      expect(scheduleRetrySpy).toHaveBeenCalledWith(entry);
      // launchRoomMatch must NOT be called — the clear failed.
      expect(launchSpy).not.toHaveBeenCalled();
      // Buffer drained.
      expect((service as any).pendingRecovery).toEqual([]);
    });
  });

  describe("onModuleInit no-server, non-expired branch", () => {
    it("buffers a NON-expired future countdown into pendingRecovery when no server is wired up", async () => {
      // New branch: the `else` arm of the `if (this.server)` check
      // in the non-expired arm of onModuleInit
      // (game-loop.service.ts:207-216). The expired no-server
      // arm is already covered by the existing C4 test; the
      // non-expired arm was missing.
      const futureEnd = Date.now() + 60_000;
      vi.mocked(
        (service as any).redis.getClient().smembers,
      ).mockResolvedValueOnce(["rFuture"] as any);
      vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
        String(futureEnd),
      );
      // No setServer call → server is undefined.

      await (service as any).onModuleInit();

      expect((service as any).pendingRecovery).toEqual([
        {
          roomId: "rFuture",
          countdownEndsAt: futureEnd,
          expired: false,
          retryCount: 0,
        },
      ]);
    });
  });

  describe("getCountdownEnd Redis fallback", () => {
    it("returns the parsed countdownEndsAt from Redis when in-memory is empty (Redis hit)", async () => {
      // New branch: the `client.get(...) → parse → return parsed`
      // happy path at game-loop.service.ts:391-394. The in-memory
      // hit path is already covered; the Redis hit path was not.
      const endsAt = Date.now() + 10_000;
      vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
        String(endsAt),
      );

      expect(await (service as any).getCountdownEnd("r1")).toBe(endsAt);
    });

    it("returns null when Redis returns a non-numeric string (parseInt → NaN)", async () => {
      // New branch: the `Number.isFinite(parsed) ? parsed : null`
      // ternary at game-loop.service.ts:394. A corrupt Redis
      // payload must be treated as "no countdown" — the
      // alternative (return NaN and crash downstream arithmetic)
      // is worse.
      vi.mocked((service as any).redis.getClient().get).mockResolvedValueOnce(
        "not-a-number",
      );

      expect(await (service as any).getCountdownEnd("r1")).toBeNull();
    });

    it("returns null and logs a warning when Redis throws", async () => {
      // New branch: the `catch (error)` arm at
      // game-loop.service.ts:395-402. A Redis outage must not
      // crash the WS handler that called `getCountdownEnd`
      // (e.g. AuthHandler.handleAuthenticate's reconnect path).
      vi.mocked((service as any).redis.getClient().get).mockRejectedValueOnce(
        new Error("redis down"),
      );
      const warnSpy = vi.spyOn((service as any).logger, "warn");

      expect(await (service as any).getCountdownEnd("r1")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "getCountdownEnd: Redis read failed for room r1: redis down",
        ),
      );
    });

    it("returns null and logs a warning when Redis throws a non-Error object (string)", async () => {
      vi.mocked((service as any).redis.getClient().get).mockRejectedValueOnce(
        "redis down string",
      );
      const warnSpy = vi.spyOn((service as any).logger, "warn");

      expect(await (service as any).getCountdownEnd("r1")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "getCountdownEnd: Redis read failed for room r1: redis down string",
      );
    });
  });

  describe("scheduleRecoveryRetry", () => {
    it("schedules a retry with exponential backoff and tracks active recovery retries", async () => {
      vi.useFakeTimers();
      const entry = {
        roomId: "room-retry-1",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 0,
      };

      const drainSpy = vi
        .spyOn(service as any, "drainPendingRecovery")
        .mockImplementation(() => {});

      (service as any).scheduleRecoveryRetry(entry);

      // Check it was added to active recovery retries
      expect((service as any).activeRecoveryRetries.has("room-retry-1")).toBe(
        true,
      );

      // Fast forward 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      // Should have pushed a new entry with nextRetry count to pendingRecovery
      expect((service as any).pendingRecovery).toContainEqual({
        ...entry,
        retryCount: 1,
      });
      expect(drainSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("deduplicates scheduled retries if the room is already being retried", () => {
      vi.useFakeTimers();
      const entry = {
        roomId: "room-retry-dup",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 0,
      };

      // Mark it as already retrying
      (service as any).activeRecoveryRetries.add("room-retry-dup");

      const setTimeoutSpy = vi.spyOn(global, "setTimeout");

      (service as any).scheduleRecoveryRetry(entry);

      // setTimeout should not be called since it was deduplicated
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    });

    it("aborts recovery when max attempts are exceeded, logs alert, clears countdown, and registers in dead-letter", async () => {
      vi.useFakeTimers();
      const entry = {
        roomId: "room-retry-max",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 5, // Next retry will be 6 (> 5)
      };

      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});
      const clearCountdownSpy = vi
        .spyOn(service as any, "clearPersistedCountdown")
        .mockResolvedValue(true);
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      const saddSpy = vi.spyOn((service as any).redis.getClient(), "sadd");
      const roomEmitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: roomEmitSpy });
      service.setServer(mockServer as unknown as Server);

      (service as any).scheduleRecoveryRetry(entry);

      await vi.waitFor(() => {
        expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
          "room-retry-max",
          RoomStatus.WAITING,
          null,
          {
            expectedStatus: RoomStatus.COUNTDOWN,
            expectedCurrentMatchId: null,
          },
        );
        expect(clearCountdownSpy).toHaveBeenCalledWith("room-retry-max");
        expect(roomEmitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_STATUS_UPDATED,
          expect.objectContaining({
            roomId: "room-retry-max",
            roomStatus: RoomStatus.WAITING,
            currentMatchId: null,
          }),
        );
      });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Max recovery retries (5) exceeded for room room-retry-max",
        ),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[ALERT][RECOVERY_ABORTED] Room recovery failed after max retries. Room ID: room-retry-max",
        ),
      );
      expect(saddSpy).toHaveBeenCalledWith(
        "room:recovery:dead-letter",
        "room-retry-max",
      );
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
      saddSpy.mockRestore();
      vi.useRealTimers();
    });

    it("skips the WAITING rollback emit when the guarded status update no longer matches", async () => {
      const entry = {
        roomId: "room-retry-skip-rollback",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 5,
      };

      vi.spyOn((service as any).logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn((service as any).logger, "warn");
      vi.mocked(roomService.updateRoomStatus).mockResolvedValueOnce(
        null as any,
      );
      const clearCountdownSpy = vi
        .spyOn(service as any, "clearPersistedCountdown")
        .mockResolvedValue(true);
      const roomEmitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: roomEmitSpy });
      service.setServer(mockServer as unknown as Server);

      (service as any).scheduleRecoveryRetry(entry);
      await Promise.resolve();
      await Promise.resolve();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping WAITING rollback for room room-retry-skip-rollback",
        ),
      );
      expect(roomEmitSpy).not.toHaveBeenCalledWith(
        ServerEvent.ROOM_STATUS_UPDATED,
        expect.anything(),
      );
      expect(clearCountdownSpy).toHaveBeenCalledWith(
        "room-retry-skip-rollback",
      );
    });

    it("logs rollback failures during max-retry abort", async () => {
      const entry = {
        roomId: "room-retry-rollback-error",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 5,
      };

      const rollbackError = new Error("rollback write failed");
      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});
      vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
        rollbackError,
      );
      vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
        true,
      );

      (service as any).scheduleRecoveryRetry(entry);
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to roll back Room room-retry-rollback-error status to WAITING after recovery abort:",
        rollbackError,
      );
    });

    it("logs error when sadd to dead-letter set fails during max-retry abort", async () => {
      // Lines 419-423: the .catch() handler on the fire-and-forget
      // sadd("room:recovery:dead-letter") call. When Redis rejects
      // the sadd, the error must be logged without crashing.
      const entry = {
        roomId: "room-deadletter-fail",
        countdownEndsAt: Date.now() - 1000,
        expired: true,
        retryCount: 5, // >= MAX_RETRIES → triggers the abort path
      };

      const saddError = new Error("redis sadd boom");
      vi.spyOn(
        (service as any).redis.getClient(),
        "sadd",
      ).mockRejectedValueOnce(saddError);
      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => {});
      vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
        true,
      );

      (service as any).scheduleRecoveryRetry(entry);
      // Flush the void promise chain so the .catch handler runs
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to record room room-deadletter-fail in dead-letter set:",
        ),
        saddError,
      );
    });

    describe("reliability hardening fixes (retention, cleanup, timer rollback)", () => {
      it("sadd and setex (TTL key) are both called during max-retry abort", async () => {
        const entry = {
          roomId: "room-retry-ttl",
          countdownEndsAt: Date.now() - 1000,
          expired: true,
          retryCount: 5,
        };

        const client = (service as any).redis.getClient();
        const saddSpy = vi.spyOn(client, "sadd").mockResolvedValue(1);
        const setSpy = vi.spyOn(client, "set").mockResolvedValue("OK");
        vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
          true,
        );

        (service as any).scheduleRecoveryRetry(entry);

        // flush promises
        await Promise.resolve();
        await Promise.resolve();

        expect(saddSpy).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
          "room-retry-ttl",
        );
        expect(setSpy).toHaveBeenCalledWith(
          "room:recovery:dead-letter:room-retry-ttl",
          "1",
          "EX",
          604800,
        );
      });

      it("sweepDeadLetterRooms sweeps and cleans up expired room IDs", async () => {
        const client = (service as any).redis.getClient();
        const smembersSpy = vi
          .spyOn(client, "smembers")
          .mockResolvedValue(["room-expired", "room-active"]);
        const existsSpy = vi
          .spyOn(client, "exists")
          .mockImplementation(async (...args: any[]) => {
            const key = args[0];
            if (key === "room:recovery:dead-letter:room-expired") return 0;
            if (key === "room:recovery:dead-letter:room-active") return 1;
            return 0;
          });
        const sremSpy = vi.spyOn(client, "srem").mockResolvedValue(1);

        vi.spyOn((service as any).logger, "log").mockImplementation(() => {});

        await (service as any).sweepDeadLetterRooms();

        expect(smembersSpy).toHaveBeenCalledWith("room:recovery:dead-letter");
        expect(existsSpy).toHaveBeenCalledWith(
          "room:recovery:dead-letter:room-expired",
        );
        expect(existsSpy).toHaveBeenCalledWith(
          "room:recovery:dead-letter:room-active",
        );
        expect(sremSpy).toHaveBeenCalledWith(
          "room:recovery:dead-letter",
          "room-expired",
        );
        expect(sremSpy).not.toHaveBeenCalledWith(
          "room:recovery:dead-letter",
          "room-active",
        );
      });

      it("clearLobbyCountdownBestEffort explicitly cancels armed countdown timers", () => {
        const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
        const fakeTimer = globalThis.setTimeout(() => {}, 10000);

        (service as any).lobbyCountdowns.set("room-timer-test", {
          timer: fakeTimer,
          countdownEndsAt: Date.now() + 10000,
        });

        vi.spyOn(service as any, "clearPersistedCountdown").mockResolvedValue(
          true,
        );

        (service as any).clearLobbyCountdownBestEffort("room-timer-test");

        expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
        expect((service as any).lobbyCountdowns.has("room-timer-test")).toBe(
          false,
        );
        globalThis.clearTimeout(fakeTimer); // clean up just in case
      });
    });
  });
});
