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
      },
      roomPlayer: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    } as unknown as PrismaService;
    redis = {
      setJSON: vi.fn(),
      getJSON: vi.fn(),
      sadd: vi.fn(),
      srem: vi.fn(),
      smembers: vi.fn(),
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
    it("joins room successfully", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoom as any);
      vi.mocked(prisma.roomPlayer.create).mockResolvedValue({} as any);
      vi.mocked(redis.getJSON).mockResolvedValue({ playerCount: 1 });

      const result = await service.joinRoom("ABC", "u2");

      expect(prisma.roomPlayer.create).toHaveBeenCalled();
      expect(redis.sadd).toHaveBeenCalledWith("room:r1:players", "u2");
      expect(result).toEqual(mockRoom);
    });

    it("throws ROOM_NOT_FOUND when room does not exist", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);
      await expect(service.joinRoom("INVALID", "u1")).rejects.toMatchObject({
        code: ErrorCode.ROOM_NOT_FOUND,
      });
    });

    it("throws ROOM_ALREADY_STARTED when room is in game", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        status: RoomStatus.IN_GAME,
        players: [],
        maxPlayers: 100,
      } as any);
      await expect(service.joinRoom("ABC", "u1")).rejects.toMatchObject({
        code: ErrorCode.ROOM_ALREADY_STARTED,
      });
    });

    it("throws ROOM_FULL when at capacity", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        status: RoomStatus.WAITING,
        maxPlayers: 1,
        players: [{ userId: "u1" }],
      } as any);
      await expect(service.joinRoom("ABC", "u2")).rejects.toMatchObject({
        code: ErrorCode.ROOM_FULL,
      });
    });

    it("skips creating roomPlayer if already in room", async () => {
      const mockRoom = {
        id: "r1",
        code: "ABC",
        status: RoomStatus.WAITING,
        maxPlayers: 100,
        players: [{ userId: "u1" }],
      };
      vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoom as any);

      await service.joinRoom("ABC", "u1");

      expect(prisma.roomPlayer.create).not.toHaveBeenCalled();
    });
  });

  describe("leaveRoom", () => {
    it("removes player and updates cache", async () => {
      vi.mocked(prisma.roomPlayer.deleteMany).mockResolvedValue({
        count: 1,
      } as any);
      vi.mocked(redis.getJSON).mockResolvedValue({
        playerCount: 2,
        hostId: "u1",
      });

      await service.leaveRoom("r1", "u2");

      expect(prisma.roomPlayer.deleteMany).toHaveBeenCalledWith({
        where: { roomId: "r1", userId: "u2" },
      });
      expect(redis.srem).toHaveBeenCalledWith("room:r1:players", "u2");
      expect(redis.setJSON).toHaveBeenCalled();
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

      const result = await service.updateRoomStatus("r1", RoomStatus.IN_GAME);

      expect(prisma.room.update).toHaveBeenCalled();
      expect(redis.setJSON).toHaveBeenCalled();
      expect(result).toEqual(room);
    });
  });

  describe("getRoomPlayerIds", () => {
    it("returns player ids from Redis", async () => {
      vi.mocked(redis.smembers).mockResolvedValue(["u1", "u2"]);
      const result = await service.getRoomPlayerIds("r1");
      expect(result).toEqual(["u1", "u2"]);
    });
  });
});
