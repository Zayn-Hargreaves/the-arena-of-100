import { Socket, Server } from "socket.io";
import { ServerEvent, ErrorCode, RoomError, RoomStatus } from "@arena/shared";
import { RoomHandler } from "./room.handler";
import { RoomService } from "../../modules/room/room.service";
import { GameLoopService } from "../../modules/match/game-loop.service";

describe("RoomHandler", () => {
  let handler: RoomHandler;
  let roomService: RoomService;
  let gameLoopService: {
    maybeStartPublicCountdown: ReturnType<typeof vi.fn>;
    handleRoomPlayerLeft: ReturnType<typeof vi.fn>;
    getCountdownEnd: ReturnType<typeof vi.fn>;
  };
  let client: Socket;
  let server: Server;

  beforeEach(() => {
    roomService = {
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
    } as unknown as RoomService;
    gameLoopService = {
      maybeStartPublicCountdown: vi.fn().mockResolvedValue(null),
      handleRoomPlayerLeft: vi.fn().mockResolvedValue(undefined),
      getCountdownEnd: vi.fn().mockReturnValue(null),
    };
    handler = new RoomHandler(
      roomService,
      gameLoopService as unknown as GameLoopService,
    );
    client = {
      emit: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockImplementation(() => ({ emit: vi.fn() })),
      data: { userId: "u1", username: "Alice" },
      nsp: { server: { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } },
    } as unknown as Socket;
    server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;
  });

  describe("handleCreateRoom", () => {
    it("creates room and emits ROOM_CREATED", async () => {
      vi.mocked(roomService.createRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        type: "PUBLIC",
        hostId: "u1",
      } as any);

      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 100,
      });

      expect(roomService.createRoom).toHaveBeenCalledWith(
        "u1",
        "PUBLIC",
        100,
        undefined,
        undefined,
      );
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_CREATED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u1",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        currentMatchId: null,
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            isOnline: true,
          },
        ],
      });
    });

    it("emits error when not authenticated", async () => {
      client.data = {};
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.UNAUTHORIZED }),
      );
    });

    it("emits error with RoomError code on service failure", async () => {
      vi.mocked(roomService.createRoom).mockRejectedValue(
        new RoomError(ErrorCode.ROOM_FULL),
      );
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_FULL }),
      );
    });

    it("emits INTERNAL_ERROR for generic errors", async () => {
      vi.mocked(roomService.createRoom).mockRejectedValue(new Error("db down"));
      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });

    it("creates room with timeLimit and category", async () => {
      vi.mocked(roomService.createRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        type: "PUBLIC",
        hostId: "u1",
      } as any);

      await handler.handleCreateRoom(client, {
        roomType: "PUBLIC",
        maxPlayers: 100,
        timeLimit: 15,
        category: "SCIENCE",
      });

      expect(roomService.createRoom).toHaveBeenCalledWith(
        "u1",
        "PUBLIC",
        100,
        15,
        "SCIENCE",
      );
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_CREATED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u1",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        currentMatchId: null,
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            isOnline: true,
          },
        ],
      });
    });
  });

  describe("handleJoinRoom", () => {
    it("joins room and emits PLAYER_JOINED to room and client", async () => {
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PUBLIC",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        joined: true,
        players: [
          {
            userId: "u1",
            user: { username: "Alice" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(roomService.joinRoom).toHaveBeenCalledWith("ABC123", "u1");
      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.to).toHaveBeenCalledWith("room:r1");
      const roomEmit = (client.to as any).mock.results[0].value.emit;
      expect(roomEmit).toHaveBeenCalledWith(ServerEvent.PLAYER_JOINED, {
        roomId: "r1",
        playerId: "u1",
        playerName: "Alice",
        isOnline: true,
      });
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ROOM_JOINED, {
        roomId: "r1",
        code: "ABC123",
        hostId: "u9",
        roomType: "PUBLIC",
        roomStatus: RoomStatus.WAITING,
        currentMatchId: null,
        countdownEndsAt: null,
        players: [
          {
            playerId: "u1",
            playerName: "Alice",
            isOnline: true,
          },
        ],
      });
      expect(gameLoopService.maybeStartPublicCountdown).toHaveBeenCalledWith(
        "r1",
        client.nsp.server,
      );
    });

    it("does not emit PLAYER_JOINED when user is already in room", async () => {
      vi.mocked(roomService.joinRoom).mockResolvedValue({
        id: "r1",
        code: "ABC123",
        hostId: "u9",
        type: "PRIVATE",
        status: RoomStatus.WAITING,
        currentMatchId: null,
        joined: false,
        players: [
          {
            userId: "u1",
            user: { username: "Alice" },
          },
        ],
      } as any);

      await handler.handleJoinRoom(client, { roomCode: "ABC123" });

      expect(client.to).not.toHaveBeenCalled();
    });

    it("emits error when roomCode is missing", async () => {
      await handler.handleJoinRoom(client, { roomCode: "" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_NOT_FOUND }),
      );
    });

    it("emits error on service failure", async () => {
      vi.mocked(roomService.joinRoom).mockRejectedValue(
        new RoomError(ErrorCode.ROOM_NOT_FOUND),
      );
      await handler.handleJoinRoom(client, { roomCode: "INVALID" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({ code: ErrorCode.ROOM_NOT_FOUND }),
      );
    });

    it("emits INTERNAL_ERROR for generic errors", async () => {
      vi.mocked(roomService.joinRoom).mockRejectedValue(new Error("db down"));
      await handler.handleJoinRoom(client, { roomCode: "ABC" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });
  });

  describe("handleLeaveRoom", () => {
    it("leaves room and emits PLAYER_LEFT", async () => {
      vi.mocked(roomService.leaveRoom).mockResolvedValue(undefined as any);

      await handler.handleLeaveRoom(client, server, { roomId: "r1" });

      expect(roomService.leaveRoom).toHaveBeenCalledWith("r1", "u1");
      expect(client.leave).toHaveBeenCalledWith("room:r1");
      expect(server.to).toHaveBeenCalledWith("room:r1");
      const serverEmit = (server.to as any).mock.results[0].value.emit;
      expect(serverEmit).toHaveBeenCalledWith(ServerEvent.PLAYER_LEFT, {
        roomId: "r1",
        playerId: "u1",
        reason: "LEFT",
      });
      expect(gameLoopService.handleRoomPlayerLeft).toHaveBeenCalledWith(
        "r1",
        server,
      );
    });

    it("emits error on failure", async () => {
      vi.mocked(roomService.leaveRoom).mockRejectedValue(new Error("fail"));
      await handler.handleLeaveRoom(client, server, { roomId: "r1" });
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ERROR,
        expect.objectContaining({
          code: ErrorCode.INTERNAL_ERROR,
          message: "Internal server error",
        }),
      );
    });
  });
});
