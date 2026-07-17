import { RoomService } from "./room.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { RoomStatus, ErrorCode } from "@arena/shared";

describe("RoomService", () => {
  let service: RoomService;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeEach(() => {
    prisma = {
      room: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      roomPlayer: {
        create: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        // Used by the WAITING join branch to count players under the
        // FOR UPDATE row lock.
        count: vi.fn().mockResolvedValue(0),
        // Used by the WAITING join branch to re-check membership under
        // the row lock. Defaults to null (no concurrent insert) so
        // existing tests don't need to mock it unless they want to
        // exercise the double-join no-op-rejoin path.
        findFirst: vi.fn().mockResolvedValue(null),
      },
      match: {
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      eventLog: {
        create: vi.fn().mockResolvedValue({}),
      },
      // $transaction supports two forms:
      //   1. Array form (legacy) — used by some tests for disbandRoom.
      //   2. Function form (interactive) — used by joinRoom for atomic
      //      capacity checks. We invoke the function with the same
      //      `prisma` mock so `tx.$queryRaw` and `tx.roomPlayer.count`
      //      resolve through the same vi.fn() instances the test setup
      //      already configures.
      $transaction: vi.fn((arg) =>
        typeof arg === "function" ? arg(prisma) : Promise.all(arg),
      ),
      $queryRaw: vi.fn(),
    } as unknown as PrismaService;
    redis = {
      setJSON: vi.fn(),
      getJSON: vi.fn(),
      sadd: vi.fn(),
      srem: vi.fn(),
      smembers: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      setIfAbsent: vi.fn().mockResolvedValue(true),
      del: vi.fn(),
      exists: vi.fn(),
      incr: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue(0),
      // Used by disbandRoom via clearPersistedCountdown, which issues a
      // raw ioredis multi().del().srem().exec() pipeline.
      getClient: vi.fn().mockReturnValue({
        multi: vi.fn(() => {
          const chain: any = {};
          chain.del = vi.fn(() => chain);
          chain.srem = vi.fn(() => chain);
          chain.exec = vi.fn().mockResolvedValue([
            [null, 1],
            [null, 1],
          ]);
          return chain;
        }),
      }),
    } as unknown as RedisService;
    service = new RoomService(prisma, redis);
  });

  describe("createRoom", () => {
    it("creates room in DB and caches in Redis", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC123",
        status: RoomStatus.WAITING,
        hostId: "u1",
        maxPlayers: 100,
        currentMatchId: null,
      };
      vi.mocked(prisma.room.create).mockResolvedValue(mockRoom as any);
      vi.mocked(prisma.roomPlayer.create).mockResolvedValue({} as any);

      const result = await service.createRoom("u1", "PUBLIC", 100);

      expect(prisma.room.create).toHaveBeenCalled();
      expect(prisma.roomPlayer.create).toHaveBeenCalledWith({
        data: { roomId: "r1", userId: "u1" },
      });
      expect(redis.setJSON).toHaveBeenCalled();
      expect(redis.sadd).toHaveBeenCalledWith("room:r1:players", "u1");
      expect(result).toEqual(mockRoom);
    });
  });

  describe("joinRoom", () => {
    it("joins WAITING room successfully as PLAYER", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoom as any);
      // WAITING branch: lock + count + create. The host is the only
      // existing RoomPlayer, so count returns 1.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { id: "r1", maxPlayers: 100 },
      ] as any);
      vi.mocked(prisma.roomPlayer.count).mockResolvedValue(1);
      vi.mocked(prisma.roomPlayer.create).mockResolvedValue({} as any);
      vi.mocked(redis.getJSON).mockResolvedValue({ playerCount: 1 });
      vi.mocked(redis.eval).mockImplementation(async (script: string) => {
        if (script.includes("incr")) return 2;
        return 0;
      });
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u2");

      // The FOR UPDATE lock must have been acquired as the first
      // statement inside the transaction.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.roomPlayer.count).toHaveBeenCalledWith({
        where: { roomId: "r1" },
      });
      expect(prisma.roomPlayer.create).toHaveBeenCalled();
      expect(redis.sadd).toHaveBeenCalledWith("room:r1:players", "u2");
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("incr"),
        ["room:r1:playerCount"],
        ["3600"],
      );
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["2"],
      );
      expect(result).toEqual({ id: "r1", joined: true, joinedAs: "PLAYER" });
    });

    it("joins successfully even if Redis fails to sync player count", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoom as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { id: "r1", maxPlayers: 100 },
      ] as any);
      vi.mocked(prisma.roomPlayer.count).mockResolvedValue(1);
      vi.mocked(prisma.roomPlayer.create).mockResolvedValue({} as any);
      vi.mocked(redis.getJSON).mockResolvedValue({ playerCount: 1 });
      vi.mocked(redis.eval).mockImplementation(async (script: string) => {
        if (script.includes("incr")) return 2;
        throw new Error("Redis connection lost");
      });
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u2");

      expect(prisma.roomPlayer.create).toHaveBeenCalled();
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("incr"),
        ["room:r1:playerCount"],
        ["3600"],
      );
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["2"],
      );
      expect(result).toEqual({ id: "r1", joined: true, joinedAs: "PLAYER" });
    });

    it("throws ROOM_NOT_FOUND when room does not exist", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.joinRoom("INVALID", "u1")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });
    });

    it("joins IN_GAME room as SPECTATOR (drop-in spectating baseline)", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        players: [{ userId: "u1" }],
        maxPlayers: 100,
      } as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u9");

      // Spectator must NOT trigger any DB write or playerCount bump —
      // they are a transient read-only viewer.
      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
      expect(redis.sadd).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "r1",
        joined: false,
        joinedAs: "SPECTATOR",
      });
    });

    it("joins FINISHED room as SPECTATOR (drop-in spectating baseline)", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.FINISHED,
        players: [{ userId: "u1" }],
        maxPlayers: 100,
      } as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u9");

      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
      expect(redis.sadd).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "r1",
        joined: false,
        joinedAs: "SPECTATOR",
      });
    });

    it("keeps existing player as PLAYER on reconnect to IN_GAME room", async () => {
      // Regression: a player whose socket dropped mid-match must come
      // back as a player, not be demoted to spectator. The user-record
      // check runs before the status check.
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        players: [{ userId: "u1" }],
        maxPlayers: 100,
      } as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u1");

      // Reconnect is a no-op for the player table.
      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "r1",
        joined: false,
        joinedAs: "PLAYER",
      });
    });

    it("keeps existing player as PLAYER on reconnect to FINISHED room", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.FINISHED,
        players: [{ userId: "u1" }],
        maxPlayers: 100,
      } as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u1");

      expect(result).toEqual({
        id: "r1",
        joined: false,
        joinedAs: "PLAYER",
      });
    });

    it("rejects COUNTDOWN join with ROOM_ALREADY_STARTED", async () => {
      // COUNTDOWN is a transient state right before launch; spectators
      // would arrive too late to be useful so we keep the strict reject
      // that pre-PR behaviour already had.
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.COUNTDOWN,
        players: [],
        maxPlayers: 100,
      } as any);

      await expect(service.joinRoom("ABC", "u9")).rejects.toMatchObject({
        code: ErrorCode.ROOM_ALREADY_STARTED,
      });
    });

    it("rejects STARTING join with ROOM_ALREADY_STARTED", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.STARTING,
        players: [],
        maxPlayers: 100,
      } as any);

      await expect(service.joinRoom("ABC", "u9")).rejects.toMatchObject({
        code: ErrorCode.ROOM_ALREADY_STARTED,
      });
    });

    it("throws ROOM_FULL when at capacity (WAITING)", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        status: RoomStatus.WAITING,
        maxPlayers: 1,
        players: [{ userId: "u1" }],
      } as any);
      // The WAITING branch locks the Room row then counts players
      // under that lock; the count is the source of truth for the
      // capacity check.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { id: "r1", maxPlayers: 1 },
      ] as any);
      vi.mocked(prisma.roomPlayer.count).mockResolvedValue(1);

      await expect(service.joinRoom("ABC", "u2")).rejects.toMatchObject({
        code: ErrorCode.ROOM_FULL,
      });
    });

    it("re-validates capacity under the FOR UPDATE row lock so concurrent joins cannot overshoot maxPlayers", async () => {
      // Regression for the TOCTOU race: a plain `tx.room.findUnique`
      // under READ COMMITTED would only issue a regular SELECT, so
      // two concurrent join requests could each read
      // `players.length = maxPlayers - 1`, both pass the check, and
      // both insert — overshooting maxPlayers. The fix wraps the
      // check + insert in a transaction whose first statement is
      // `SELECT ... FOR UPDATE` on the Room row; the second
      // concurrent request blocks at the lock until the first
      // commits, then re-evaluates capacity against the freshly
      // committed count.
      //
      // Here we simulate "another concurrent request filled the room
      // between the initial read and the in-tx count": the initial
      // findUnique shows maxPlayers=2, the FOR UPDATE lock returns
      // the same row, but the subsequent count (taken under the lock,
      // after the concurrent insert committed) returns 2 — so we
      // expect ROOM_FULL and no roomPlayer.create.
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 2,
        players: [{ userId: "u1" }],
      } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { id: "r1", maxPlayers: 2 },
      ] as any);
      vi.mocked(prisma.roomPlayer.count).mockResolvedValue(2); // full

      await expect(service.joinRoom("ABC", "u2")).rejects.toMatchObject({
        code: ErrorCode.ROOM_FULL,
      });
      // The lock acquisition must have happened, then the in-tx
      // count read the saturated value, then ROOM_FULL was thrown —
      // and the create must NOT have been called.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.roomPlayer.count).toHaveBeenCalled();
      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
    });

    it("throws ROOM_NOT_FOUND when the room is deleted between the outer read and the FOR UPDATE lock", async () => {
      // Edge case: the outer findUnique returned the row, but the
      // row was deleted by another transaction before this one could
      // acquire the lock. The service should surface a typed
      // ROOM_NOT_FOUND instead of crashing on the empty result.
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [],
      } as any);
      // FOR UPDATE returns no rows.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([] as any);

      await expect(service.joinRoom("ABC", "u2")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });
      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
    });

    it("converts a double-join race (same user from two requests) into a no-op rejoin under the lock", async () => {
      // Regression for the P2002 race: two near-simultaneous join
      // requests for the SAME *new* user both pass the outer
      // `isExistingPlayer` check (the second one sees the pre-tx
      // read before the first commits). The FOR UPDATE lock
      // serialises them. The second transaction's in-tx
      // findFirst re-check then sees the row inserted by the first
      // and treats it as a no-op rejoin (same outcome as the
      // early-return reconnect path). Without this, the second
      // create would violate `@@unique([roomId, userId])` and
      // surface as INTERNAL_ERROR.
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        // First request's view: this user is not yet a player
        // (because the first request hasn't committed yet).
        players: [],
      } as any);
      // The lock is acquired.
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { id: "r1", maxPlayers: 100 },
      ] as any);
      // The in-tx membership re-check sees the row inserted by
      // the concurrent (first) request.
      vi.mocked(prisma.roomPlayer.findFirst).mockResolvedValue({
        id: "rp-concurrent",
      } as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u2");

      // The rejoin path: no create, no Redis mutation, returns
      // PLAYER with `joined: false` (same shape as the early-
      // return reconnect path).
      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
      // Early-return from findFirst: the capacity check (count) is
      // intentionally skipped, otherwise the no-op rejoin would
      // touch the DB and could falsely trip ROOM_FULL on a room
      // that's already at capacity from the first request.
      expect(prisma.roomPlayer.count).not.toHaveBeenCalled();
      expect(redis.sadd).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: "r1",
        joined: false,
        joinedAs: "PLAYER",
      });
    });

    it("no-op rejoin for an existing player in WAITING room returns PLAYER", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoom as any);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.joinRoom("ABC", "u1");

      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "r1", joined: false, joinedAs: "PLAYER" });
    });
  });

  describe("leaveRoom", () => {
    it("removes player and updates cache", async () => {
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 1,
      } as any);
      vi.mocked(redis.eval).mockResolvedValue(1);
      vi.spyOn(service, "getRoom").mockResolvedValue({ id: "r1" } as any);

      const result = await service.leaveRoom("r1", "u2");

      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
        where: { roomId: "r1", userId: "u2" },
      });
      expect(redis.srem).toHaveBeenCalledWith("room:r1:players", "u2");
      // First eval: atomic decrement (clamped) for the counter key
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        ["room:r1:playerCount"],
        ["1", "3600"],
      );
      // Second eval: atomic field update for the cached room JSON
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["1"],
      );
      expect(result).toEqual({ id: "r1" });
    });
  });

  describe("getRoom", () => {
    it("returns room when found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({ id: "r1" } as any);
      const result = await service.getRoom("r1");
      expect(result).toEqual({ id: "r1" });
    });

    it("throws ROOM_NOT_FOUND when not found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.getRoom("r1")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });
    });
  });

  describe("getRoomByCode", () => {
    it("returns room when found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: "r1",
        code: "ABC",
      } as any);
      const result = await service.getRoomByCode("ABC");
      expect(result).toEqual({ id: "r1", code: "ABC" });
    });

    it("throws ROOM_NOT_FOUND when not found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.getRoomByCode("INVALID")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });
    });
  });

  describe("getUserActiveRooms", () => {
    it("returns active rooms for user", async () => {
      const mockRooms = [{ room: { id: "r1", status: "WAITING" } }];
      vi.mocked(prisma.roomPlayer.findMany).mockResolvedValue(mockRooms as any);
      const result = await service.getUserActiveRooms("u1");
      expect(prisma.roomPlayer.findMany).toHaveBeenCalledWith({
        where: {
          userId: "u1",
          room: { status: { not: RoomStatus.FINISHED } },
        },
        include: {
          room: {
            include: {
              players: {
                include: { user: { select: { id: true, username: true } } },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockRooms);
    });
  });

  describe("listPublicRooms", () => {
    it("returns public waiting rooms", async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);
      const result = await service.listPublicRooms();
      expect(result).toEqual([]);
    });
  });

  describe("updateRoomStatus", () => {
    it("updates status in DB and Redis", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "u1",
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.update).mockResolvedValue(room as any);

      const result = await service.updateRoomStatus(
        "r1",
        RoomStatus.IN_GAME,
        "m1",
      );

      expect(prisma.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: RoomStatus.IN_GAME, currentMatchId: "m1" },
        }),
      );
      expect(redis.setJSON).toHaveBeenCalled();
      expect(result).toEqual(room);
    });

    it("atomically updates only when the expected room state still matches", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        hostId: "u1",
        currentMatchId: null,
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);

      const result = await service.updateRoomStatus(
        "r1",
        RoomStatus.WAITING,
        null,
        {
          expectedStatus: RoomStatus.COUNTDOWN,
          expectedCurrentMatchId: null,
        },
      );

      expect(prisma.room.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "r1",
            status: RoomStatus.COUNTDOWN,
            currentMatchId: null,
          },
          data: { status: RoomStatus.WAITING, currentMatchId: null },
        }),
      );
      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({
          status: RoomStatus.WAITING,
          currentMatchId: null,
        }),
        expect.any(Number),
      );
      expect(result).toEqual(room);
    });

    it("omits optional atomic predicates that were not provided", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        hostId: "u1",
        currentMatchId: null,
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.room.findUnique).mockResolvedValue(room as any);

      await service.updateRoomStatus("r1", RoomStatus.WAITING, undefined, {
        expectedStatus: RoomStatus.COUNTDOWN,
      });

      expect(prisma.room.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "r1", status: RoomStatus.COUNTDOWN },
          data: { status: RoomStatus.WAITING },
        }),
      );
    });

    it("returns null when the guarded atomic update no longer matches", async () => {
      vi.mocked(prisma.room.updateMany).mockResolvedValue({ count: 0 } as any);

      const result = await service.updateRoomStatus(
        "r1",
        RoomStatus.WAITING,
        null,
        {
          expectedStatus: RoomStatus.COUNTDOWN,
          expectedCurrentMatchId: null,
        },
      );

      expect(result).toBeNull();
      expect(prisma.room.findUnique).not.toHaveBeenCalled();
      expect(redis.setJSON).not.toHaveBeenCalled();
    });

    // Regression for the cache-overwrite race: when the Redis
    // counter is already present (e.g. after concurrent joins),
    // updateRoomStatus must NOT overwrite it with the stale
    // `room.players.length` snapshot taken before the awaited DB
    // update. The counter is the server-authoritative source of
    // truth.
    it("preserves the existing Redis playerCount and does not overwrite it", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "u1",
        // Stale snapshot — a concurrent join happened between the
        // DB update and this call. Redis already holds 3.
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.update).mockResolvedValue(room as any);
      vi.mocked(redis.get).mockResolvedValue("3");

      await service.updateRoomStatus("r1", RoomStatus.IN_GAME, "m1");

      // The cached room JSON must use the live counter (3), not
      // the stale players.length (1).
      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 3 }),
        expect.any(Number),
      );
      // The counter key must NOT be rewritten — `set` is only used
      // to seed when the key is missing.
      expect(redis.set).not.toHaveBeenCalledWith(
        "room:r1:playerCount",
        expect.anything(),
        expect.anything(),
      );
    });

    it("seeds the Redis playerCount from players.length when the key is missing", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        hostId: "u1",
        players: [{ userId: "u1" }, { userId: "u2" }],
      };
      vi.mocked(prisma.room.update).mockResolvedValue(room as any);
      // redis.get returns null → key missing → seed from DB via
      // atomic SET NX (setIfAbsent) to close the TOCTOU window.
      vi.mocked(redis.get).mockResolvedValue(null);

      await service.updateRoomStatus("r1", RoomStatus.COUNTDOWN);

      expect(redis.setJSON).toHaveBeenCalledWith(
        "room:r1",
        expect.objectContaining({ playerCount: 2 }),
        expect.any(Number),
      );
      expect(redis.setIfAbsent).toHaveBeenCalledWith(
        "room:r1:playerCount",
        "2",
        3600,
      );
    });

    // Regression for the TOCTOU race: if a concurrent joinRoom
    // calls incr(counter) between our redis.get (returns null) and
    // our write, setIfAbsent (SET NX) must return false and we must
    // NOT overwrite the newer value. Plain redis.set would clobber
    // it with the stale players.length.
    it("does not overwrite a fresher counter value that appeared during the seed window", async () => {
      const room = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.IN_GAME,
        hostId: "u1",
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.update).mockResolvedValue(room as any);
      // Initial read shows key missing.
      vi.mocked(redis.get).mockResolvedValue(null);
      // SET NX returns "OK" only when the key did not exist. Simulate
      // a concurrent incr winning the race → setIfAbsent returns false.
      vi.mocked(redis.setIfAbsent).mockResolvedValue(false);

      await service.updateRoomStatus("r1", RoomStatus.IN_GAME, "m1");

      // setIfAbsent was attempted (the seed path ran) but reported
      // the key already existed. The cached room JSON still uses
      // the stale players.length (1) for this snapshot — that's the
      // trade-off the prior fix accepts; the key itself is intact
      // for the next read.
      expect(redis.setIfAbsent).toHaveBeenCalledWith(
        "room:r1:playerCount",
        "1",
        3600,
      );
      // Plain redis.set must NOT have been called as a fallback.
      expect(redis.set).not.toHaveBeenCalledWith(
        "room:r1:playerCount",
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe("getRoomPlayerIds", () => {
    it("returns player ids from Redis", async () => {
      vi.mocked(redis.smembers).mockResolvedValue(["u1", "u2"]);
      const result = await service.getRoomPlayerIds("r1");
      expect(result).toEqual(["u1", "u2"]);
    });
  });

  describe("getActiveRooms", () => {
    it("returns rooms in WAITING, COUNTDOWN, or STARTING status with their players", async () => {
      const mockRooms = [
        { id: "r1", status: "WAITING", players: [{ userId: "u1" }] },
        { id: "r2", status: "COUNTDOWN", players: [{ userId: "u2" }] },
      ];
      vi.mocked(prisma.room.findMany).mockResolvedValue(mockRooms as any);

      const result = await service.getActiveRooms();

      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: [
              RoomStatus.WAITING,
              RoomStatus.COUNTDOWN,
              RoomStatus.STARTING,
              RoomStatus.IN_GAME,
              RoomStatus.FINISHED,
            ],
          },
        },
        include: { players: true },
      });
      expect(result).toEqual(mockRooms);
    });

    it("returns an empty array when no rooms are active", async () => {
      vi.mocked(prisma.room.findMany).mockResolvedValue([]);

      const result = await service.getActiveRooms();

      expect(result).toEqual([]);
    });
  });

  describe("disbandRoom", () => {
    it("deletes room and players in db transaction when there is no match history", async () => {
      vi.mocked(prisma.match.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "r1" }] as any);

      await service.disbandRoom("r1");
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.room.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
      expect(redis.del).toHaveBeenCalledWith("room:r1:players");
      expect(redis.del).toHaveBeenCalledWith("room:r1");
      expect(redis.del).toHaveBeenCalledWith("room:r1:playerCount");
    });

    it("transitions room to FINISHED and clears currentMatchId when match history exists", async () => {
      vi.mocked(prisma.match.count).mockResolvedValue(1);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "r1" }] as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 2,
      } as any);

      await service.disbandRoom("r1");

      expect(prisma.room.delete).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
      const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
      expect(typeof txArg).toBe("function");
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: {
          status: RoomStatus.FINISHED,
          currentMatchId: null,
        },
      });
      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
        where: { roomId: "r1" },
      });
    });

    it("forces non-FINISHED matches for the room to FINISHED when match history exists", async () => {
      vi.mocked(prisma.match.count).mockResolvedValue(1);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "r1" }] as any);
      vi.mocked(prisma.room.update).mockResolvedValue({} as any);
      vi.mocked(prisma.match.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 1,
      } as any);

      await service.disbandRoom("r1");

      expect(prisma.match.updateMany).toHaveBeenCalledWith({
        where: { roomId: "r1", status: { not: "FINISHED" } },
        data: {
          status: "FINISHED",
          endedAt: expect.any(Date),
        },
      });
    });

    it("skips DB teardown when the room row is already gone under the lock", async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([] as any);

      await service.disbandRoom("r1");

      expect(prisma.match.count).not.toHaveBeenCalled();
      expect(prisma.room.delete).not.toHaveBeenCalled();
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it("clears presence keys for every player that was in the room", async () => {
      vi.mocked(redis.smembers).mockResolvedValue(["u1", "u2"]);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "r1" }] as any);

      await service.disbandRoom("r1");

      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u1");
      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u2");
    });

    it("clears the persisted lobby countdown key and index membership", async () => {
      const chain: any = {};
      chain.del = vi.fn(() => chain);
      chain.srem = vi.fn(() => chain);
      chain.exec = vi.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
      ]);
      const client = { multi: vi.fn(() => chain) };
      vi.mocked(redis.getClient).mockReturnValue(client as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "r1" }] as any);

      await service.disbandRoom("r1");

      expect(client.multi).toHaveBeenCalled();
      expect(chain.del).toHaveBeenCalledWith("room:countdown:r1");
      expect(chain.srem).toHaveBeenCalledWith("room:countdowns", "r1");
    });
  });

  describe("presence methods", () => {
    it("updates presence in Redis", async () => {
      await service.updatePresence("r1", "u1");
      expect(redis.set).toHaveBeenCalledWith("room:presence:r1:u1", "1", 20);
    });

    it("clears presence in Redis", async () => {
      await service.clearPresence("r1", "u1");
      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u1");
    });

    it("checks presence in Redis", async () => {
      vi.mocked(redis.exists).mockResolvedValue(true);
      const isPresent = await service.checkPresence("r1", "u1");
      expect(redis.exists).toHaveBeenCalledWith("room:presence:r1:u1");
      expect(isPresent).toBe(true);
    });
  });

  describe("removePlayer", () => {
    it("removes player, clears presence, and updates cache via atomic counter", async () => {
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 1,
      } as any);
      // eval() runs the atomic Lua script and returns the new clamped count
      vi.mocked(redis.eval).mockResolvedValue(1);
      vi.mocked(redis.getJSON).mockResolvedValue({ playerCount: 2 });

      await service.removePlayer("r1", "u2");

      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
        where: { roomId: "r1", userId: "u2" },
      });
      expect(redis.srem).toHaveBeenCalledWith("room:r1:players", "u2");
      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u2");
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        ["room:r1:playerCount"],
        ["1", "3600"],
      );
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["1"],
      );
    });
  });

  describe("removePlayerBatch", () => {
    it("does nothing if list of players is empty", async () => {
      await service.removePlayerBatch("r1", []);
      expect(prisma.roomPlayer.deleteMany).not.toHaveBeenCalled();
      expect(redis.srem).not.toHaveBeenCalled();
    });

    it("removes multiple players, clears presence, and updates cache in one go via atomic counter", async () => {
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 2,
      } as any);
      vi.mocked(redis.eval).mockResolvedValue(3);
      vi.mocked(redis.getJSON).mockResolvedValue({ playerCount: 5 });

      await service.removePlayerBatch("r1", ["u2", "u3"]);

      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
        where: { roomId: "r1", userId: { in: ["u2", "u3"] } },
      });
      expect(redis.srem).toHaveBeenCalledWith("room:r1:players", "u2", "u3");
      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u2");
      expect(redis.del).toHaveBeenCalledWith("room:presence:r1:u3");
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call"),
        ["room:r1:playerCount"],
        ["2", "3600"],
      );
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("cjson"),
        ["room:r1"],
        ["3"],
      );
    });
  });
});
