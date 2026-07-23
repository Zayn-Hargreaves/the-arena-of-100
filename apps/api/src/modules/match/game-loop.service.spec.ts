import { GameLoopService } from "./game-loop.service";
import { LobbyCountdownService } from "./lobby-countdown.service";
import { MatchService } from "./match.service";
import { QuestionService } from "../question/question.service";
import { RoomStatus, ServerEvent, ErrorCode, RoomError } from "@arena/shared";
import { Server } from "socket.io";
import { vi, beforeEach, it, expect, describe } from "vitest";
import { RoomService } from "../room/room.service";
import { createMockRedisService } from "./redis.mock";

// B3 fix: GameLoopService now takes a `PrismaService` so it can open
// a `SELECT ... FOR UPDATE` transaction inside `launchRoomMatch`.
// Tests construct the service directly (no Nest DI), so we provide a
// minimal mock here. The default implementation makes
// `tx.$queryRaw` return a sensible "room exists, launchable" row
// so the existing launchRoomMatch tests pass without per-test
// setup. B3-specific tests override `__tx.$queryRaw` to drive the
// race scenarios (e.g. set `currentMatchId` to simulate a losing
// race).
function createMockPrismaService() {
  const txStub = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: "r1", status: RoomStatus.WAITING, currentMatchId: null },
      ]),
    room: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    $transaction: vi
      .fn()
      .mockImplementation(
        async <T>(fn: (tx: typeof txStub) => Promise<T>): Promise<T> => {
          return fn(txStub);
        },
      ),
    $queryRaw: vi.fn().mockResolvedValue([]),
    match: {
      delete: vi.fn().mockResolvedValue({}),
    },
    // Tests that need to drive the tx client pull this out.
    __tx: txStub,
  };
}

// GameLoopService owns room-launch orchestration only (setServer,
// forceStartRoomMatch, the private launchRoomMatch Prisma
// row-lock/transaction, stopRoomRuntime, emitRoomTerminated, and
// constructor wiring). The timer-driven match loop lives in
// MatchRoundRunner (see match-round-runner.spec.ts) and the lobby
// countdown lifecycle lives in LobbyCountdownService (see
// lobby-countdown.service.spec.ts) — this file's mocks are kept
// minimal to what GameLoopService's constructor actually needs.
describe("GameLoopService", () => {
  let service: GameLoopService;
  let lobbyCountdown: LobbyCountdownService;
  let matchService: MatchService;
  let questionService: QuestionService;
  let roomService: RoomService;
  let mockServer: Server;

  beforeEach(() => {
    // launchRoomMatch calls matchService.createMatch directly; each
    // test that needs it assigns a fresh vi.fn() (matching the
    // pattern used throughout this file).
    matchService = {} as unknown as MatchService;

    questionService = {} as unknown as QuestionService;

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

    mockServer = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    lobbyCountdown = new LobbyCountdownService(
      roomService,
      createMockRedisService() as any,
    );
    service = new GameLoopService(
      matchService,
      questionService,
      roomService,
      createMockPrismaService() as any,
      lobbyCountdown,
      createMockMatchOwnership() as any,
      createMockMatchCommand() as any,
    );
  });

  // The admin kill-switch tests (stopRoomRuntime / emitRoomTerminated)
  // build a fresh GameLoopService per test so they can assert on a
  // dedicated LobbyCountdownService + redis multi() spy without
  // disturbing the shared `service`/`lobbyCountdown` from beforeEach.
  function buildService() {
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
    const svc = new GameLoopService(
      matchService,
      questionService,
      roomService,
      createMockPrismaService() as any,
      new LobbyCountdownService(roomService, redis),
      createMockMatchOwnership() as any,
      createMockMatchCommand() as any,
    );
    return { svc, redis, multiSpy };
  }

  // B2b: minimal MatchOwnershipService stub. acquireOnLaunch defaults to
  // success so launches proceed; release is a no-op resolve.
  function createMockMatchOwnership() {
    return {
      acquireOnLaunch: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
      getOwnedMatchIds: vi.fn().mockReturnValue([]),
      isOwner: vi.fn().mockReturnValue(true),
      getLeaseValue: vi.fn().mockReturnValue(undefined),
      // B2c additions.
      setRoundRunner: vi.fn(),
      assertOwnership: vi.fn().mockResolvedValue(true),
      getOwnershipSnapshot: vi.fn().mockReturnValue(undefined),
      computeMaxSkew: vi.fn().mockResolvedValue(0),
      // B3b additions (boot/orphan recovery wiring).
      setRecoveryDeps: vi.fn(),
      setServer: vi.fn(),
    };
  }

  // B4a/B4b: minimal MatchCommandService stub.
  function createMockMatchCommand() {
    return {
      setSideEffects: vi.fn(),
      setDispatcher: vi.fn(),
      registerMatch: vi.fn().mockResolvedValue(undefined),
      deregisterMatch: vi.fn(),
      disposeStream: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined),
    };
  }

  describe("forceStartRoomMatch", () => {
    it("delegates to launchRoomMatch with isAutoStart=false", async () => {
      const launchSpy = vi
        .spyOn(service as any, "launchRoomMatch")
        .mockResolvedValue({ id: "m1" });

      const result = await service.forceStartRoomMatch("r1", mockServer);

      expect(launchSpy).toHaveBeenCalledWith("r1", mockServer, {
        isAutoStart: false,
      });
      expect(result).toEqual({ id: "m1" });
    });
  });

  describe("launchRoomMatch", () => {
    it("throws ROOM_ALREADY_STARTED when the room is in a non-launchable status", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.IN_GAME,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
    });

    it("throws NOT_ENOUGH_PLAYERS and emits ROOM_COUNTDOWN_CANCELLED when autoStart && below MIN", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.COUNTDOWN,
        players: [{ userId: "p1" }], // below MIN
      } as any);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: true,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_ENOUGH_PLAYERS });

      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.ROOM_COUNTDOWN_CANCELLED,
        expect.objectContaining({
          roomId: "r1",
          reason: "NOT_ENOUGH_PLAYERS",
        }),
      );
      // room was reset to WAITING
      expect(roomService.updateRoomStatus).toHaveBeenCalledWith(
        "r1",
        RoomStatus.WAITING,
      );
    });

    it("throws NOT_ENOUGH_PLAYERS WITHOUT emitting a cancel event when NOT autoStart && below MIN", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        players: [{ userId: "p1" }], // below MIN
      } as any);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_ENOUGH_PLAYERS });

      // No countdown cancelled event should be emitted on a manual
      // forceStart with too few players (room was already WAITING)
      const cancelEmits = emitSpy.mock.calls.filter(
        (call) => call[0] === ServerEvent.ROOM_COUNTDOWN_CANCELLED,
      );
      expect(cancelEmits).toHaveLength(0);
    });

    it("clears an existing countdown from the lobby before proceeding", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      // Seed an active countdown
      (service as any).lobbyCountdown.lobbyCountdowns.set("r1", {
        timer: setTimeout(() => undefined, 100),
        countdownEndsAt: Date.now() + 5000,
      });
      vi.mocked(roomService.getRoom)
        .mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.COUNTDOWN,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any)
        .mockResolvedValueOnce({
          id: "r1",
          status: RoomStatus.COUNTDOWN,
          currentMatchId: null,
          players: [{ userId: "p1" }, { userId: "p2" }],
        } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });
      // Stub startMatchLoop to avoid the full round loop
      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockResolvedValue(undefined);

      await (service as any).launchRoomMatch("r1", mockServer, {
        isAutoStart: true,
      });

      expect((service as any).lobbyCountdown.lobbyCountdowns.has("r1")).toBe(
        false,
      );
    });

    it("happy path: updates status to STARTING, creates the match, and starts the loop", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });
      const startLoopSpy = vi
        .spyOn((service as any).roundRunner, "startMatchLoop")
        .mockResolvedValue(undefined);

      // B3 fix: launchRoomMatch now uses `prisma.$transaction` with
      // a `SELECT ... FOR UPDATE` for the atomic guard. The default
      // mock (see `createMockPrismaService`) returns a valid room
      // row, which lets the transaction commit and `createMatch`
      // run as before.
      const prisma = (service as any).prisma;
      const txUpdateSpy = vi.spyOn(prisma.__tx.room, "update");

      const match = await (service as any).launchRoomMatch("r1", mockServer, {
        isAutoStart: false,
      });

      expect(match).toEqual({ id: "m1" });
      // B3 fix: the STARTING transition is now performed inside
      // the transaction (tx.room.update) so a concurrent caller
      // racing on the same roomId is rejected by the lock. The
      // old `roomService.updateRoomStatus(r1, STARTING)` call is
      // no longer made for the launch transition; that path now
      // only runs in the rollback branch below.
      expect(txUpdateSpy).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { status: RoomStatus.STARTING },
      });
      expect(emitSpy).toHaveBeenCalledWith(
        ServerEvent.MATCH_STARTING,
        expect.objectContaining({ matchId: "m1" }),
      );
      expect(startLoopSpy).toHaveBeenCalledWith("m1", "r1", mockServer);
    });

    it("rolls back to WAITING and re-broadcasts ROOM_STATUS_UPDATED if createMatch throws", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockRejectedValue(new Error("db boom"));

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("db boom");

      // B3 fix: after the transaction commits (status=STARTING)
      // and createMatch throws, we revert the room status to
      // WAITING via the existing rollback path. The revert
      // itself still uses `roomService.updateRoomStatus` so the
      // existing assertion continues to hold.
      expect(roomService.updateRoomStatus).toHaveBeenLastCalledWith(
        "r1",
        RoomStatus.WAITING,
        null,
      );
      const rollback = emitSpy.mock.calls.find(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollback).toBeDefined();
    });

    // B3 fix: the old test asserted the "re-fetched room is no
    // longer launchable" race via `roomService.getRoom`. With the
    // `SELECT ... FOR UPDATE` transaction, the launchability
    // check happens inside the transaction against the locked
    // row. This new test overrides `tx.$queryRaw` to return a
    // row that is no longer launchable, asserting the
    // `ROOM_ALREADY_STARTED` path is still taken.
    it("B3: throws ROOM_ALREADY_STARTED when the locked row is no longer launchable (race)", async () => {
      const prisma = (service as any).prisma;
      // Simulate the case where, by the time we acquire the
      // FOR UPDATE lock, the room has already been transitioned
      // to STARTING by a previous launch.
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
        {
          id: "r1",
          status: RoomStatus.STARTING,
          currentMatchId: null,
        },
      ]);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
    });

    // B3 fix: same race, but the room still shows WAITING in the
    // outer fetch yet the previous launcher already set
    // `currentMatchId`. The transaction's currentMatchId check
    // catches this even though the status check would have passed.
    it("B3: throws ROOM_ALREADY_STARTED when the locked row has a non-null currentMatchId (race)", async () => {
      const prisma = (service as any).prisma;
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
        {
          id: "r1",
          status: RoomStatus.WAITING,
          currentMatchId: "m-already-running",
        },
      ]);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });
    });

    // B3 fix: the FOR UPDATE row is missing (room was deleted
    // between outer read and lock acquisition). The transaction
    // throws ROOM_NOT_FOUND so the caller gets a typed error.
    it("B3: throws ROOM_NOT_FOUND when the FOR UPDATE row is missing", async () => {
      const prisma = (service as any).prisma;
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([]);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_NOT_FOUND });
    });

    // B3 race-lost guard (finding from code review, 2026-06-14):
    // when the inner `tx.$queryRaw FOR UPDATE` throws
    // `ROOM_ALREADY_STARTED` (lock holder saw a non-WAITING/
    // COUNTDOWN status or a non-null `currentMatchId`),
    // another thread has already validly acquired the room
    // lock and set `status = STARTING` (or further) in their
    // own transaction. The previous unconditional rollback
    // in the outer `catch` would overwrite the winner's
    // `STARTING` with `WAITING` + emit
    // `ROOM_STATUS_UPDATED {WAITING}` to every connected
    // client — corrupting the winner's state and confusing
    // all spectators/players in the room channel.
    //
    // The new guard detects the race-lost error and skips
    // BOTH the revert AND the emit. Only the original
    // `ROOM_ALREADY_STARTED` error is propagated to the
    // caller (admin tooling / host force-start / auto-start
    // timer) so they can report "someone else got there
    // first" without us silently destroying the winner.
    it("B3 race-lost: does NOT revert room status when the lock-holder reports ROOM_ALREADY_STARTED", async () => {
      const prisma = (service as any).prisma;
      // Simulate the case where, by the time we acquired the
      // FOR UPDATE lock, the room's status had already moved
      // out of the launchable range (e.g. another thread set
      // `status = STARTING` in their transaction and committed
      // before our lock was released).
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
        {
          id: "r1",
          status: RoomStatus.STARTING,
          currentMatchId: null,
        },
      ]);
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

      // CRITICAL: no revert of the room status to WAITING.
      // The winning thread's STARTING state is preserved.
      expect(updateRoomStatusSpy).not.toHaveBeenCalled();
      // CRITICAL: no `ROOM_STATUS_UPDATED` broadcast. We
      // must not announce a state that the winning thread
      // didn't author.
      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollbackEmits).toHaveLength(0);
    });

    // Same race-lost guard for the inner `createMatch` catch
    // (defense-in-depth — `createMatch` currently doesn't
    // throw `ROOM_ALREADY_STARTED` directly, but if a future
    // refactor routes the FOR UPDATE check through it, the
    // same protection must apply).
    it("B3 race-lost (createMatch): does NOT revert room status when createMatch throws ROOM_ALREADY_STARTED", async () => {
      // The transaction guard passes (room is launchable), so
      // we reach `createMatch`. `createMatch` then throws the
      // race-lost error directly (e.g. a future refactor that
      // moves the FOR UPDATE check inside `createMatch`).
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      // The matchService mock from beforeEach has no
      // `createMatch` field; tests that need it attach a
      // vi.fn() to the object (matching the pattern used
      // elsewhere in this file). The vi.fn() exposes
      // `mockRejectedValueOnce` for the race-lost assertion.
      (matchService.createMatch as any) = vi
        .fn()
        .mockRejectedValueOnce(new RoomError(ErrorCode.ROOM_ALREADY_STARTED));
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

      // The winning thread's STARTING/IN_GAME state must
      // NOT be clobbered.
      expect(updateRoomStatusSpy).not.toHaveBeenCalled();
      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollbackEmits).toHaveLength(0);
    });

    // The B3 cleanup's inner createError catch wraps the
    // revert in a nested try/catch (lines 625-630). If
    // `createMatch` throws AND `roomService.updateRoomStatus`
    // (the revert) also throws, we hit the nested
    // `catch (revertError)` branch and log a fallback error.
    // This is a rare double-failure (DB down + Redis down at
    // the same time) but the test pins the logging path so a
    // future refactor can't drop the fallback silently.
    it("B3 nested cleanup: logs the secondary error when both createMatch AND the revert throw", async () => {
      // Default mock makes the FOR UPDATE pass (valid launchable
      // row). createMatch then throws a non-race error.
      (matchService.createMatch as any) = vi
        .fn()
        .mockRejectedValueOnce(new Error("primary failure: DB down"));
      // The revert path itself also throws. This is the
      // double-failure scenario.
      vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
        new Error("revert failure: DB still down"),
      );
      const errorSpy = vi.spyOn((service as any).logger, "error");

      // We expect the original `createError` to be rethrown.
      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("primary failure: DB down");

      // The nested catch (revertError) must have logged the
      // fallback message. We assert the message substring so a
      // future wording change in the log doesn't break the
      // test, but the structural property (the error log fired)
      // is pinned.
      const revertLogCall = errorSpy.mock.calls.find((call) =>
        String(call[0]).includes("Failed to revert Room r1 status to WAITING"),
      );
      expect(revertLogCall).toBeDefined();
    });

    it("B3 nested cleanup: logs the secondary error when both createMatch AND the revert throw a non-Error object", async () => {
      (matchService.createMatch as any) = vi
        .fn()
        .mockRejectedValueOnce(new Error("primary failure: DB down"));
      vi.mocked(roomService.updateRoomStatus).mockRejectedValueOnce(
        "revert failure string",
      );
      const errorSpy = vi.spyOn((service as any).logger, "error");

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("primary failure: DB down");

      const revertLogCall = errorSpy.mock.calls.find((call) =>
        String(call[0]).includes("Failed to revert Room r1 status to WAITING"),
      );
      expect(revertLogCall).toBeDefined();
      expect(revertLogCall?.[1]).toBeUndefined();
    });

    it("reverts room status and deletes orphaned match when startMatchLoop throws an error", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });

      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockRejectedValueOnce(new Error("startMatchLoop failed"));

      const prisma = (service as any).prisma;
      const matchDeleteSpy = vi.spyOn(prisma.match, "delete");
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("startMatchLoop failed");

      // Should clean up the orphaned match
      expect(matchDeleteSpy).toHaveBeenCalledWith({
        where: { id: "m1" },
      });

      // Should revert the room status to WAITING
      expect(updateRoomStatusSpy).toHaveBeenCalledWith(
        "r1",
        RoomStatus.WAITING,
        null,
      );

      // Should emit ROOM_STATUS_UPDATED with WAITING and null match ID
      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus ===
            RoomStatus.WAITING &&
          (call[1] as { currentMatchId: string | null }).currentMatchId ===
            null,
      );
      expect(rollbackEmits).toHaveLength(1);
    });

    it("launchRoomMatch throws ROOM_ALREADY_STARTED when the re-fetched room is no longer launchable (race)", async () => {
      // B3 fix: the previous version of this test drove the race
      // via a second `roomService.getRoom` call. The new code
      // reads the launchable status inside the
      // `SELECT ... FOR UPDATE` transaction, so we drive the race
      // by returning an IN_GAME row from `tx.$queryRaw`.
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });
      const prisma = (service as any).prisma;
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
        {
          id: "r1",
          status: RoomStatus.IN_GAME,
          currentMatchId: "m-existing",
        },
      ]);
      (matchService.createMatch as any) = vi.fn();

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

      // createMatch must NOT be called — the FOR UPDATE guard
      // prevents a double-start.
      expect(matchService.createMatch).not.toHaveBeenCalled();
      // B3 race-lost guard (code review 2026-06-14): the
      // winning thread has already set `status = STARTING` /
      // `IN_GAME` in their own transaction. We MUST NOT
      // overwrite that with `WAITING` — that would clobber
      // the winner's state and confuse every connected
      // client. The old "rollback to WAITING" expectation is
      // intentionally removed.
      expect(roomService.updateRoomStatus).not.toHaveBeenCalled();
    });
  });

  describe("Admin kill-switch helpers (PR #47)", () => {
    // ---- stopRoomRuntime ----
    describe("forceFinishMatchForDisband", () => {
      it("cancels timers, transitions SM to FINISHED with event log, and finishMatch with admin flag", async () => {
        const { svc } = buildService();
        const finishMatch = vi.fn().mockResolvedValue({});
        const persistStateMachine = vi.fn().mockResolvedValue(undefined);
        const canTransition = vi.fn().mockReturnValue(true);
        const transition = vi.fn();
        const finishMatchSm = vi.fn();
        const getState = vi.fn().mockReturnValue({ status: "ROUND_ACTIVE" });
        matchService.finishMatch = finishMatch;
        matchService.persistStateMachine = persistStateMachine;
        matchService.getStateMachine = vi.fn().mockResolvedValue({
          canTransition,
          transition,
          finishMatch: finishMatchSm,
          getState,
        });

        (svc as any).roundRunner.timers.initUsedQuestions("m-disband");
        (svc as any).roundRunner.timers.addTimer(
          "m-disband",
          setTimeout(() => undefined, 100),
        );

        await svc.forceFinishMatchForDisband("m-disband", "r-disband");

        expect((svc as any).roundRunner.timers.hasTimers("m-disband")).toBe(
          false,
        );
        expect(canTransition).toHaveBeenCalledWith("FINISHED");
        expect(transition).toHaveBeenCalledWith("FINISHED");
        expect(finishMatchSm).toHaveBeenCalled();
        expect(persistStateMachine).toHaveBeenCalledWith("m-disband");
        expect(finishMatch).toHaveBeenCalledWith(
          "m-disband",
          null,
          "r-disband",
          true,
        );
      });

      it("still calls finishMatch when no state machine is present", async () => {
        const { svc } = buildService();
        const finishMatch = vi.fn().mockResolvedValue({});
        matchService.finishMatch = finishMatch;
        matchService.getStateMachine = vi.fn().mockResolvedValue(null);

        await svc.forceFinishMatchForDisband("m-gone", "r-gone");

        expect(finishMatch).toHaveBeenCalledWith(
          "m-gone",
          null,
          "r-gone",
          true,
        );
      });

      it("awaits the in-flight natural finish and returns null when isMatchFinishing is true (B1.1 race guard)", async () => {
        // Regression test: forceFinishMatchForDisband must await the
        // in-flight finishMatchLoop and return null so the caller does
        // NOT emit a duplicate MATCH_FINISHED. Without the B1.1 guard
        // both callers would persist + broadcast, producing two events.
        const { svc } = buildService();
        matchService.finishMatch = vi.fn();
        matchService.getStateMachine = vi.fn();

        // Simulate "a natural finish is already running"
        let resolveFinish!: () => void;
        const finishPromise = new Promise<void>((r) => {
          resolveFinish = r;
        });
        const runner = (svc as any).roundRunner;
        runner.timers.beginFinish("m-race");
        runner.timers.registerFinishPromise("m-race", finishPromise);

        // Call forceFinishMatchForDisband — must wait, then return null
        const result = svc.forceFinishMatchForDisband("m-race", "r-race");

        // Let one microtask tick pass; the in-flight promise is still pending
        await Promise.resolve();
        // Resolve the in-flight finish
        resolveFinish();
        expect(await result).toBeNull();

        // finishMatch must NOT have been called (the natural finish owns the emission)
        expect(matchService.finishMatch).not.toHaveBeenCalled();
        expect(matchService.getStateMachine).not.toHaveBeenCalled();
      });

      it("skips canTransition + transition when state machine is already FINISHED", async () => {
        // The SM reached FINISHED before this method ran (e.g. rapid
        // double-disband). We must not call transition() again (it would
        // throw), but we still read totalRounds and call finishMatch.
        const { svc } = buildService();
        const transition = vi.fn();
        const canTransition = vi.fn().mockReturnValue(true);
        const finishMatchSm = vi.fn();
        const getState = vi
          .fn()
          .mockReturnValue({ status: "FINISHED", currentRoundNo: 3 });
        const persistStateMachine = vi.fn().mockResolvedValue(undefined);
        matchService.getStateMachine = vi.fn().mockResolvedValue({
          canTransition,
          transition,
          finishMatch: finishMatchSm,
          getState,
        });
        matchService.persistStateMachine = persistStateMachine;
        matchService.finishMatch = vi
          .fn()
          .mockResolvedValue({ winnerId: null, endedAt: new Date() });

        const result = await svc.forceFinishMatchForDisband(
          "m-already-done",
          "r-already-done",
        );

        // State machine is already FINISHED — transition must NOT be called
        expect(transition).not.toHaveBeenCalled();
        expect(finishMatchSm).not.toHaveBeenCalled();
        expect(persistStateMachine).not.toHaveBeenCalled();
        // finishMatch IS called (ensures DB row is marked finished)
        expect(matchService.finishMatch).toHaveBeenCalledWith(
          "m-already-done",
          null,
          "r-already-done",
          true,
        );
        // totalRounds comes from state machine
        expect(result?.totalRounds).toBe(3);
      });

      it("returns null and logs when finishMatch is an idempotent no-op (returns null/undefined)", async () => {
        // finishMatch returns null when another caller already finished
        // the match (update count: 0 path). We must return null so the
        // caller knows NOT to re-emit MATCH_FINISHED.
        const { svc } = buildService();
        const finishMatchSm = vi.fn();
        const getState = vi
          .fn()
          .mockReturnValue({ status: "ROUND_ACTIVE", currentRoundNo: 1 });
        matchService.getStateMachine = vi.fn().mockResolvedValue({
          canTransition: vi.fn().mockReturnValue(true),
          transition: vi.fn(),
          finishMatch: finishMatchSm,
          getState,
        });
        matchService.persistStateMachine = vi.fn().mockResolvedValue(undefined);
        // Simulate the idempotent no-op: finishMatch returns null
        matchService.finishMatch = vi.fn().mockResolvedValue(null);
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        const result = await svc.forceFinishMatchForDisband(
          "m-idempotent",
          "r-idempotent",
        );

        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "forceFinishMatchForDisband: match m-idempotent finishMatch returned null",
          ),
        );
      });

      it("logs a warn and re-throws when persistStateMachine throws inside the SM try block", async () => {
        // Regression: a transient Redis failure in persistStateMachine
        // must log at warn level and re-throw so the caller knows the
        // match was NOT cleanly persisted. The state machine itself is
        // not corrupted — only the Redis snapshot write failed.
        const { svc } = buildService();
        const persistError = new Error("Redis unavailable");
        matchService.getStateMachine = vi.fn().mockResolvedValue({
          canTransition: vi.fn().mockReturnValue(true),
          transition: vi.fn(),
          finishMatch: vi.fn(),
          getState: vi
            .fn()
            .mockReturnValue({ status: "ROUND_ACTIVE", currentRoundNo: 1 }),
        });
        matchService.persistStateMachine = vi
          .fn()
          .mockRejectedValueOnce(persistError);
        matchService.finishMatch = vi.fn();
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        await expect(
          svc.forceFinishMatchForDisband("m-persist-fail", "r-persist-fail"),
        ).rejects.toThrow("Redis unavailable");

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "forceFinishMatchForDisband: state-machine terminalization failed for match m-persist-fail",
          ),
        );
        // finishMatch must NOT be called after the SM try-block throws
        expect(matchService.finishMatch).not.toHaveBeenCalled();
      });

      it("logs a warn and re-throws when finishMatch itself throws", async () => {
        const { svc } = buildService();
        const dbError = new Error("DB write failed");
        matchService.getStateMachine = vi.fn().mockResolvedValue({
          canTransition: vi.fn().mockReturnValue(true),
          transition: vi.fn(),
          finishMatch: vi.fn(),
          getState: vi
            .fn()
            .mockReturnValue({ status: "ROUND_ACTIVE", currentRoundNo: 2 }),
        });
        matchService.persistStateMachine = vi.fn().mockResolvedValue(undefined);
        matchService.finishMatch = vi.fn().mockRejectedValueOnce(dbError);
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        await expect(
          svc.forceFinishMatchForDisband("m-db-fail", "r-db-fail"),
        ).rejects.toThrow("DB write failed");

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "forceFinishMatchForDisband: finishMatch failed for match m-db-fail",
          ),
        );
      });
    });

    describe("setServer", () => {
      it("wires server to lobbyCountdown so boot recovery can drain buffered events", () => {
        const { svc } = buildService();
        const mockSrv = {
          to: vi.fn().mockReturnValue({ emit: vi.fn() }),
        } as unknown as Server;
        const setServerSpy = vi.spyOn((svc as any).lobbyCountdown, "setServer");

        (svc as any).setServer(mockSrv);

        expect((svc as any).server).toBe(mockSrv);
        expect(setServerSpy).toHaveBeenCalledWith(mockSrv);
      });
    });

    describe("stopRoomRuntime", () => {
      it("clears the lobby countdown timer, removes the in-memory slot, and runs clearPersistedCountdown", async () => {
        const { svc, multiSpy } = buildService();
        // Seed an active lobby countdown
        (svc as any).lobbyCountdown.lobbyCountdowns.set("r1", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });

        await svc.stopRoomRuntime("r1", null);

        // In-memory slot cleared
        expect((svc as any).lobbyCountdown.lobbyCountdowns.has("r1")).toBe(
          false,
        );
        // clearPersistedCountdown fires the multi() chain
        expect(multiSpy).toHaveBeenCalled();
      });

      it("calls cancelMatchLoop when a matchId is provided (no countdown active)", async () => {
        const { svc } = buildService();
        // Seed match-level state so we can assert cancellation
        (svc as any).roundRunner.timers.initUsedQuestions("m1");
        (svc as any).roundRunner.timers.markQuestionUsed("m1", "q1");
        (svc as any).roundRunner.timers.addTimer(
          "m1",
          setTimeout(() => undefined, 100),
        );

        await svc.stopRoomRuntime("r2", "m1");

        // match-level state was cleared
        expect((svc as any).roundRunner.timers.hasUsedQuestions("m1")).toBe(
          false,
        );
        expect((svc as any).roundRunner.timers.hasTimers("m1")).toBe(false);
      });

      it("is a no-op for runtime state when neither countdown nor matchId are present", async () => {
        const { svc } = buildService();

        // Should not throw
        await expect(svc.stopRoomRuntime("r3", null)).resolves.toBeUndefined();
      });

      it("cancels match state when matchId is provided even with an active countdown", async () => {
        const { svc } = buildService();
        (svc as any).lobbyCountdown.lobbyCountdowns.set("r4", {
          timer: setTimeout(() => undefined, 100),
          countdownEndsAt: Date.now() + 5000,
        });
        (svc as any).roundRunner.timers.initUsedQuestions("m4");
        (svc as any).roundRunner.timers.markQuestionUsed("m4", "q1");

        await svc.stopRoomRuntime("r4", "m4");

        // Both layers cleaned
        expect((svc as any).lobbyCountdown.lobbyCountdowns.has("r4")).toBe(
          false,
        );
        expect((svc as any).roundRunner.timers.hasUsedQuestions("m4")).toBe(
          false,
        );
      });
    });

    // ---- emitRoomTerminated ----
    describe("emitRoomTerminated", () => {
      it("emits ROOM_TERMINATED to the room channel when server is wired up", () => {
        const { svc } = buildService();
        const emitSpy = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitSpy });
        (svc as any).setServer({ to: toSpy } as unknown as Server);

        svc.emitRoomTerminated("r1", {
          matchId: "m1",
          message: "Abandoned by host",
        });

        expect(toSpy).toHaveBeenCalledWith(expect.stringContaining("r1"));
        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_TERMINATED,
          expect.objectContaining({
            roomId: "r1",
            reason: "ADMIN_TERMINATED",
            matchId: "m1",
            message: "Abandoned by host",
          }),
        );
        // terminatedAt is a number
        const payload = emitSpy.mock.calls[0][1] as {
          terminatedAt: number;
        };
        expect(typeof payload.terminatedAt).toBe("number");
      });

      it("emits ROOM_TERMINATED with null matchId and undefined message when only the room is provided", () => {
        const { svc } = buildService();
        const emitSpy = vi.fn();
        const toSpy = vi.fn().mockReturnValue({ emit: emitSpy });
        (svc as any).setServer({ to: toSpy } as unknown as Server);

        svc.emitRoomTerminated("r2", { matchId: null });

        expect(emitSpy).toHaveBeenCalledWith(
          ServerEvent.ROOM_TERMINATED,
          expect.objectContaining({
            roomId: "r2",
            reason: "ADMIN_TERMINATED",
            matchId: null,
            message: undefined,
          }),
        );
      });

      it("logs a warning and does NOT emit when server has not been wired up", () => {
        // No setServer() call → server is undefined
        const { svc } = buildService();
        const warnSpy = vi.spyOn((svc as any).logger, "warn");

        // Should not throw
        expect(() =>
          svc.emitRoomTerminated("r3", { matchId: null }),
        ).not.toThrow();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "emitRoomTerminated: server not set, cannot emit for room r3",
          ),
        );
      });
    });
  });

  describe("launchRoomMatch outer-catch race-lost guard", () => {
    it("does NOT revert room status when the FOR UPDATE row reports ROOM_ALREADY_STARTED (B3 race-lost)", async () => {
      // New branch: the OUTER `catch (error) { if (isRaceLost) ... }`
      // arm at game-loop.service.ts:662-669. The INNER catch's
      // race-lost guard (around createMatch) is already covered
      // by the "B3 race-lost (createMatch)" test; the outer
      // catch's guard — reached when the transaction itself
      // throws ROOM_ALREADY_STARTED (e.g. another thread
      // committed STARTING between our outer read and our
      // FOR UPDATE) — was missing.
      const prisma = (service as any).prisma;
      vi.spyOn(prisma.__tx, "$queryRaw").mockResolvedValueOnce([
        {
          id: "r1",
          status: RoomStatus.STARTING,
          currentMatchId: null,
        },
      ]);
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ROOM_ALREADY_STARTED });

      // CRITICAL: the outer catch's race-lost branch must NOT
      // call updateRoomStatus(WAITING) — the winning thread
      // owns the room and has already set it to STARTING.
      expect(updateRoomStatusSpy).not.toHaveBeenCalled();
      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollbackEmits).toHaveLength(0);
    });
  });

  describe("launchRoomMatch orphaned match cleanup", () => {
    it("deletes the created match, reverts room status, and re-throws if startMatchLoop throws", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });

      const loopError = new Error("loop initialization failed");
      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockRejectedValueOnce(loopError);

      const deleteSpy = vi
        .spyOn((service as any).prisma.match, "delete")
        .mockResolvedValueOnce({} as any);
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
      const warnSpy = vi.spyOn((service as any).logger, "warn");

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("loop initialization failed");

      expect(deleteSpy).toHaveBeenCalledWith({
        where: { id: "m1" },
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Deleting orphaned match m1 for room r1",
      );
      expect(updateRoomStatusSpy).toHaveBeenCalledWith(
        "r1",
        RoomStatus.WAITING,
        null,
      );

      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollbackEmits).toHaveLength(1);
    });

    it("logs at error level when deleting the orphaned match throws but still reverts room status and throws the original error", async () => {
      const emitSpy = vi.fn();
      (mockServer.to as any).mockReturnValue({ emit: emitSpy });

      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });

      const loopError = new Error("loop initialization failed");
      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockRejectedValueOnce(loopError);

      const deleteError = new Error("delete failed");
      const deleteSpy = vi
        .spyOn((service as any).prisma.match, "delete")
        .mockRejectedValueOnce(deleteError);
      const updateRoomStatusSpy = vi.spyOn(roomService, "updateRoomStatus");
      const errorSpy = vi.spyOn((service as any).logger, "error");

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("loop initialization failed");

      expect(deleteSpy).toHaveBeenCalledWith({
        where: { id: "m1" },
      });
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to delete orphaned match m1:",
        deleteError,
      );
      expect(updateRoomStatusSpy).toHaveBeenCalledWith(
        "r1",
        RoomStatus.WAITING,
        null,
      );

      const rollbackEmits = emitSpy.mock.calls.filter(
        (call) =>
          call[0] === ServerEvent.ROOM_STATUS_UPDATED &&
          (call[1] as { roomStatus: string }).roomStatus === RoomStatus.WAITING,
      );
      expect(rollbackEmits).toHaveLength(1);
    });

    it("logs at error level and rethrows when launchRoomMatch primary failure is a non-Error object (string)", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);

      (matchService.createMatch as any) = vi
        .fn()
        .mockRejectedValueOnce("primary string failure");

      const errorSpy = vi.spyOn((service as any).logger, "error");

      let thrownErr: any;
      try {
        await (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        });
      } catch (err) {
        thrownErr = err;
      }

      expect(thrownErr).toBe("primary string failure");
      expect(errorSpy).toHaveBeenCalledWith(
        "Launch failed for room r1: primary string failure",
        undefined,
      );
    });
  });

  describe("B2b/B2c ownership acquire and release", () => {
    it("aborts launch when acquireOnLaunch returns false (no startMatchLoop)", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });
      const ownership = (service as any).matchOwnership;
      ownership.acquireOnLaunch.mockResolvedValueOnce(false);
      const startLoopSpy = vi
        .spyOn((service as any).roundRunner, "startMatchLoop")
        .mockResolvedValue(undefined);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow(/could not acquire owner lease/);

      expect(startLoopSpy).not.toHaveBeenCalled();
      // Lease was never acquired → release is not part of this rollback path.
      expect(ownership.release).not.toHaveBeenCalled();
    });

    it("releases ownership when startMatchLoop fails after a successful acquire", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });
      const ownership = (service as any).matchOwnership;
      ownership.acquireOnLaunch.mockResolvedValueOnce(true);
      const cancelSpy = vi.spyOn(
        (service as any).roundRunner,
        "cancelMatchLoop",
      );
      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockRejectedValueOnce(new Error("loop-boom"));

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("loop-boom");

      expect(cancelSpy).toHaveBeenCalledWith("m1");
      expect(ownership.release).toHaveBeenCalledWith("m1");
    });

    it("stopRoomRuntime releases ownership when a matchId is provided", async () => {
      const ownership = createMockMatchOwnership();
      const redis = createMockRedisService() as any;
      vi.spyOn(redis.getClient(), "multi").mockImplementation(
        () =>
          ({
            set: () => ({ sadd: () => ({ exec: () => Promise.resolve([]) }) }),
            del: () => ({ srem: () => ({ exec: () => Promise.resolve([]) }) }),
            sadd: () => ({ exec: () => Promise.resolve([]) }),
            srem: () => ({ exec: () => Promise.resolve([]) }),
            exec: () => Promise.resolve([]),
          }) as any,
      );
      const svc = new GameLoopService(
        matchService,
        questionService,
        roomService,
        createMockPrismaService() as any,
        new LobbyCountdownService(roomService, redis),
        ownership as any,
        createMockMatchCommand() as any,
      );

      await svc.stopRoomRuntime("r1", "m1");
      expect(ownership.release).toHaveBeenCalledWith("m1");
    });

    it("forceFinishMatchForDisband releases ownership before finishing", async () => {
      const ownership = createMockMatchOwnership();
      const redis = createMockRedisService() as any;
      vi.spyOn(redis.getClient(), "multi").mockImplementation(
        () =>
          ({
            set: () => ({ sadd: () => ({ exec: () => Promise.resolve([]) }) }),
            del: () => ({ srem: () => ({ exec: () => Promise.resolve([]) }) }),
            sadd: () => ({ exec: () => Promise.resolve([]) }),
            srem: () => ({ exec: () => Promise.resolve([]) }),
            exec: () => Promise.resolve([]),
          }) as any,
      );
      (matchService.getStateMachine as any) = vi.fn().mockResolvedValue(null);
      (matchService.finishMatch as any) = vi.fn().mockResolvedValue(null);
      const matchCommand = createMockMatchCommand();
      const svc = new GameLoopService(
        matchService,
        questionService,
        roomService,
        createMockPrismaService() as any,
        new LobbyCountdownService(roomService, redis),
        ownership as any,
        matchCommand as any,
      );

      await svc.forceFinishMatchForDisband("m9", "r9");
      expect(ownership.release).toHaveBeenCalledWith("m9");
      // B4b: disband path must clean match:cmd + match:applied (no stopRoomRuntime).
      expect(matchCommand.deregisterMatch).toHaveBeenCalledWith("m9");
      expect(matchCommand.disposeStream).toHaveBeenCalledWith("m9");
    });

    it("logs and continues launch rollback when release throws after a successful acquire", async () => {
      vi.mocked(roomService.getRoom).mockResolvedValueOnce({
        id: "r1",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        players: [{ userId: "p1" }, { userId: "p2" }],
      } as any);
      (matchService.createMatch as any) = vi
        .fn()
        .mockResolvedValue({ id: "m1" });
      const ownership = (service as any).matchOwnership;
      ownership.acquireOnLaunch.mockResolvedValueOnce(true);
      ownership.release.mockRejectedValueOnce(new Error("release-boom"));
      const cancelSpy = vi.spyOn(
        (service as any).roundRunner,
        "cancelMatchLoop",
      );
      vi.spyOn(
        (service as any).roundRunner,
        "startMatchLoop",
      ).mockRejectedValueOnce(new Error("loop-boom"));
      const errorSpy = vi
        .spyOn((service as any).logger, "error")
        .mockImplementation(() => undefined);

      await expect(
        (service as any).launchRoomMatch("r1", mockServer, {
          isAutoStart: false,
        }),
      ).rejects.toThrow("loop-boom");

      expect(cancelSpy).toHaveBeenCalledWith("m1");
      expect(ownership.release).toHaveBeenCalledWith("m1");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to release owner lease"),
        expect.anything(),
      );
    });
  });
});
