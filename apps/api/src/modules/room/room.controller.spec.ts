import { RoomController, AuthenticatedRequest } from "./room.controller";
import { RoomService } from "./room.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { JoinRoomDto } from "./dto/join-room.dto";
import { RoomStatus } from "@arena/shared";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Role } from "@prisma/client";

describe("RoomController", () => {
  let controller: RoomController;
  let service: RoomService;

  // Mock basic room
  const mockRoom = {
    id: "room-id-123",
    code: "ABCDEF",
    type: "PUBLIC",
    status: RoomStatus.WAITING,
    hostId: "user-id-host",
    maxPlayers: 100,
    currentMatchId: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Mock room with simple players list (for joinRoom)
  const mockRoomWithPlayers = {
    ...mockRoom,
    players: [
      {
        id: "room-player-id",
        roomId: "room-id-123",
        userId: "user-id-host",
        joinedAt: new Date(),
      },
    ],
  };

  // Mock room with detailed players list (for getRoom / getRoomByCode)
  const mockRoomWithDetailedPlayers = {
    ...mockRoom,
    players: [
      {
        id: "room-player-id",
        roomId: "room-id-123",
        userId: "user-id-host",
        joinedAt: new Date(),
        user: {
          id: "user-id-host",
          username: "host_player",
        },
      },
    ],
  };

  // Mock room with player count (for listPublicRooms)
  const mockRoomWithCount = {
    ...mockRoom,
    _count: {
      players: 1,
    },
  };

  const mockReq = {
    user: {
      userId: "user-id-host",
      username: "host_player",
      role: Role.GUEST,
    },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => {
    const mockRoomService = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      getRoom: vi.fn(),
      getRoomByCode: vi.fn(),
      listPublicRooms: vi.fn(),
      updateRoomStatus: vi.fn(),
      getRoomPlayerIds: vi.fn(),
    };
    service = mockRoomService as unknown as RoomService;
    controller = new RoomController(service);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("create", () => {
    const createRoomDto: CreateRoomDto = {
      roomType: "PUBLIC",
      maxPlayers: 100,
      timeLimit: 15,
      category: "ALL",
    };

    it("should create a room successfully using request context userId", async () => {
      vi.mocked(service.createRoom).mockResolvedValue(mockRoom);

      const result = await controller.create(createRoomDto, mockReq);

      expect(service.createRoom).toHaveBeenCalledWith(
        mockReq.user.userId,
        createRoomDto.roomType,
        createRoomDto.maxPlayers,
        createRoomDto.timeLimit,
        createRoomDto.category,
      );
      expect(result).toEqual(mockRoom);
    });

    it("should handle service errors", async () => {
      const error = new BadRequestException("Failed to create room");
      vi.mocked(service.createRoom).mockRejectedValue(error);

      await expect(controller.create(createRoomDto, mockReq)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.createRoom).toHaveBeenCalledWith(
        mockReq.user.userId,
        createRoomDto.roomType,
        createRoomDto.maxPlayers,
        createRoomDto.timeLimit,
        createRoomDto.category,
      );
    });
  });

  describe("join", () => {
    const joinRoomDto: JoinRoomDto = {
      roomCode: "ABCDEF",
    };

    it("should join a room successfully using request context userId", async () => {
      vi.mocked(service.joinRoom).mockResolvedValue(mockRoomWithPlayers);

      const result = await controller.join(joinRoomDto, mockReq);

      expect(service.joinRoom).toHaveBeenCalledWith(
        joinRoomDto.roomCode,
        mockReq.user.userId,
      );
      expect(result).toEqual(mockRoomWithPlayers);
    });

    it("should handle not found error", async () => {
      const error = new NotFoundException("Room not found");
      vi.mocked(service.joinRoom).mockRejectedValue(error);

      await expect(controller.join(joinRoomDto, mockReq)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("leave", () => {
    const roomId = "room-id-123";

    it("should leave a room successfully using request context userId", async () => {
      vi.mocked(service.leaveRoom).mockResolvedValue(undefined);

      const result = await controller.leave(roomId, mockReq);

      expect(service.leaveRoom).toHaveBeenCalledWith(
        roomId,
        mockReq.user.userId,
      );
      expect(result).toBeUndefined();
    });

    it("should handle leave room errors", async () => {
      const error = new BadRequestException("Not in room");
      vi.mocked(service.leaveRoom).mockRejectedValue(error);

      await expect(controller.leave(roomId, mockReq)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("listPublic", () => {
    it("should return public rooms successfully", async () => {
      const publicRooms = [mockRoomWithCount];
      vi.mocked(service.listPublicRooms).mockResolvedValue(publicRooms);

      const result = await controller.listPublic();

      expect(service.listPublicRooms).toHaveBeenCalled();
      expect(result).toEqual(publicRooms);
    });
  });

  describe("getRoom", () => {
    const roomId = "room-id-123";

    it("should return room by id successfully", async () => {
      vi.mocked(service.getRoom).mockResolvedValue(mockRoomWithDetailedPlayers);

      const result = await controller.getRoom(roomId);

      expect(service.getRoom).toHaveBeenCalledWith(roomId);
      expect(result).toEqual(mockRoomWithDetailedPlayers);
    });

    it("should handle not found room id", async () => {
      const error = new NotFoundException("Room not found");
      vi.mocked(service.getRoom).mockRejectedValue(error);

      await expect(controller.getRoom(roomId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getByCode", () => {
    const code = "ABCDEF";

    it("should return room by code successfully", async () => {
      vi.mocked(service.getRoomByCode).mockResolvedValue(
        mockRoomWithDetailedPlayers,
      );

      const result = await controller.getByCode(code);

      expect(service.getRoomByCode).toHaveBeenCalledWith(code);
      expect(result).toEqual(mockRoomWithDetailedPlayers);
    });

    it("should handle not found room code", async () => {
      const error = new NotFoundException("Room not found");
      vi.mocked(service.getRoomByCode).mockRejectedValue(error);

      await expect(controller.getByCode(code)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
