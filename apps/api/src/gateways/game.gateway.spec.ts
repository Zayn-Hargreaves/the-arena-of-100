import { Socket, Server } from "socket.io";
import { ServerEvent } from "@arena/shared";
import { GameGateway } from "./game.gateway";
import { AuthHandler } from "./handlers/auth.handler";
import { RoomHandler } from "./handlers/room.handler";
import { MatchHandler } from "./handlers/match.handler";
import { RoomService } from "../modules/room/room.service";
import { MatchService } from "../modules/match/match.service";
import { AuthService } from "../modules/auth/auth.service";

describe("GameGateway", () => {
  let gateway: GameGateway;
  let authHandler: AuthHandler;
  let roomHandler: RoomHandler;
  let matchHandler: MatchHandler;
  let roomService: RoomService;
  let matchService: MatchService;
  let authService: AuthService;
  let client: Socket;

  beforeEach(() => {
    authHandler = {
      handleAuthenticate: vi.fn(),
      handleDisconnect: vi.fn(),
    } as unknown as AuthHandler;
    roomHandler = {
      handleCreateRoom: vi.fn(),
      handleJoinRoom: vi.fn(),
      handleLeaveRoom: vi.fn(),
    } as unknown as RoomHandler;
    matchHandler = {
      handleStartMatch: vi.fn(),
      handleSubmitAnswer: vi.fn(),
      handleRequestSnapshot: vi.fn(),
    } as unknown as MatchHandler;
    roomService = {
      getUserActiveRooms: vi.fn().mockResolvedValue([]),
    } as unknown as RoomService;
    matchService = {
      getStateMachine: vi.fn(),
    } as unknown as MatchService;
    authService = {
      verifyToken: vi.fn(),
    } as unknown as AuthService;

    gateway = new GameGateway(
      authHandler,
      roomHandler,
      matchHandler,
      roomService,
      matchService,
      authService,
    );
    // Set the private _server field
    (gateway as any)._server = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;

    client = {
      id: "socket-1",
      emit: vi.fn(),
      join: vi.fn(),
      data: {},
    } as unknown as Socket;
  });

  describe("handleConnection", () => {
    it("handles connection for unauthenticated client", async () => {
      await gateway.handleConnection(client);
      expect(roomService.getUserActiveRooms).not.toHaveBeenCalled();
    });

    it("reconnects authenticated user to multiple active rooms", async () => {
      client.data.userId = "u1";
      const activeRoom1 = {
        room: {
          id: "r1",
          code: "ABC",
          currentMatchId: null,
          players: [{ userId: "u1", user: { username: "Alice" } }],
        },
      };
      const activeRoom2 = {
        room: {
          id: "r2",
          code: "DEF",
          currentMatchId: null,
          players: [{ userId: "u1", user: { username: "Alice" } }],
        },
      };
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        activeRoom1,
        activeRoom2,
      ] as any);

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(client.join).toHaveBeenCalledWith("room:r2");
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.PLAYER_JOINED,
        expect.objectContaining({ roomId: "r1" }),
      );
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.PLAYER_JOINED,
        expect.objectContaining({ roomId: "r2" }),
      );
    });

    it("sends snapshot when active match exists in multiple rooms", async () => {
      client.data.userId = "u1";
      const snapshot1 = { matchId: "m1", status: "ROUND_ACTIVE" };
      const snapshot2 = { matchId: "m2", status: "ROUND_ACTIVE" };
      const activeRoom1 = {
        room: {
          id: "r1",
          code: "ABC",
          currentMatchId: "m1",
          players: [{ userId: "u1", user: { username: "Alice" } }],
        },
      };
      const activeRoom2 = {
        room: {
          id: "r2",
          code: "DEF",
          currentMatchId: "m2",
          players: [{ userId: "u1", user: { username: "Alice" } }],
        },
      };
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        activeRoom1,
        activeRoom2,
      ] as any);
      vi.mocked(matchService.getStateMachine).mockImplementation(
        async (matchId) => {
          if (matchId === "m1") {
            return { getSnapshot: vi.fn().mockReturnValue(snapshot1) } as any;
          }
          if (matchId === "m2") {
            return { getSnapshot: vi.fn().mockReturnValue(snapshot2) } as any;
          }
          return null;
        },
      );

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot1);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot2);
    });

    it("handles errors during reconnection gracefully", async () => {
      client.data.userId = "u1";
      vi.mocked(roomService.getUserActiveRooms).mockRejectedValue(
        new Error("db error"),
      );

      await expect(gateway.handleConnection(client)).resolves.not.toThrow();
    });
  });

  describe("afterInit middleware", () => {
    let middleware: any;
    let mockServer: any;

    beforeEach(() => {
      mockServer = {
        use: vi.fn().mockImplementation((fn) => {
          middleware = fn;
        }),
      };
      gateway.afterInit(mockServer);
    });

    it("registers a middleware", () => {
      expect(mockServer.use).toHaveBeenCalled();
      expect(middleware).toBeTypeOf("function");
    });

    it("successfully authenticates with auth.token", () => {
      const mockSocket = {
        handshake: {
          auth: { token: "valid-token" },
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-123",
        username: "test-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
      expect(mockSocket.data.userId).toBe("user-123");
      expect(mockSocket.data.username).toBe("test-user");
      expect(next).toHaveBeenCalled();
    });

    it("successfully authenticates with authorization header (Bearer)", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: { authorization: "Bearer valid-token-bearer" },
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-456",
        username: "bearer-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith(
        "valid-token-bearer",
      );
      expect(mockSocket.data.userId).toBe("user-456");
      expect(mockSocket.data.username).toBe("bearer-user");
      expect(next).toHaveBeenCalled();
    });

    it("successfully authenticates with authorization header (plain)", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: { authorization: "valid-token-plain" },
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "user-789",
        username: "plain-user",
      } as any);

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("valid-token-plain");
      expect(mockSocket.data.userId).toBe("user-789");
      expect(mockSocket.data.username).toBe("plain-user");
      expect(next).toHaveBeenCalled();
    });

    it("handles connection without token gracefully", () => {
      const mockSocket = {
        handshake: {
          auth: {},
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();

      middleware(mockSocket, next);

      expect(authService.verifyToken).not.toHaveBeenCalled();
      expect(mockSocket.data.userId).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it("handles invalid token gracefully without throwing", () => {
      const mockSocket = {
        handshake: {
          auth: { token: "invalid-token" },
          headers: {},
        },
        data: {},
      } as any;
      const next = vi.fn();
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      middleware(mockSocket, next);

      expect(authService.verifyToken).toHaveBeenCalledWith("invalid-token");
      expect(mockSocket.data.userId).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("handleDisconnect", () => {
    it("delegates to authHandler", async () => {
      await gateway.handleDisconnect(client);
      expect(authHandler.handleDisconnect).toHaveBeenCalledWith(client);
    });
  });

  describe("event handlers", () => {
    it("handleAuthenticate delegates to authHandler", () => {
      gateway.handleAuthenticate(client, { token: "t" });
      expect(authHandler.handleAuthenticate).toHaveBeenCalledWith(client, {
        token: "t",
      });
    });

    it("handleCreateRoom delegates to roomHandler", () => {
      gateway.handleCreateRoom(client, { roomType: "PUBLIC", maxPlayers: 10 });
      expect(roomHandler.handleCreateRoom).toHaveBeenCalledWith(client, {
        roomType: "PUBLIC",
        maxPlayers: 10,
      });
    });

    it("handleJoinRoom delegates to roomHandler", () => {
      gateway.handleJoinRoom(client, { roomCode: "ABC" });
      expect(roomHandler.handleJoinRoom).toHaveBeenCalledWith(client, {
        roomCode: "ABC",
      });
    });

    it("handleLeaveRoom delegates to roomHandler with server", () => {
      gateway.handleLeaveRoom(client, { roomId: "r1" });
      expect(roomHandler.handleLeaveRoom).toHaveBeenCalledWith(
        client,
        (gateway as any)._server,
        { roomId: "r1" },
      );
    });

    it("handleStartMatch delegates to matchHandler with server", () => {
      gateway.handleStartMatch(client, { roomId: "r1" });
      expect(matchHandler.handleStartMatch).toHaveBeenCalledWith(
        client,
        (gateway as any)._server,
        { roomId: "r1" },
      );
    });

    it("handleSubmitAnswer delegates to matchHandler", () => {
      gateway.handleSubmitAnswer(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });
      expect(matchHandler.handleSubmitAnswer).toHaveBeenCalledWith(client, {
        matchId: "m1",
        answer: "A",
        roundNo: 1,
        clientTimestamp: 1234567890,
      });
    });

    it("handleRequestSnapshot delegates to matchHandler", () => {
      gateway.handleRequestSnapshot(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
      expect(matchHandler.handleRequestSnapshot).toHaveBeenCalledWith(client, {
        matchId: "m1",
        lastSeenSeqNo: 0,
      });
    });

    it("handlePing emits PONG with timestamp", () => {
      gateway.handlePing(client);
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.PONG, {
        timestamp: expect.any(Number),
      });
    });
  });
});
