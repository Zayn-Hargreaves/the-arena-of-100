import { Socket, Server } from "socket.io";
import { ServerEvent } from "@arena/shared";
import { GameGateway } from "./game.gateway";
import { AuthHandler } from "./handlers/auth.handler";
import { RoomHandler } from "./handlers/room.handler";
import { MatchHandler } from "./handlers/match.handler";
import { AuthService } from "../modules/auth/auth.service";
import { PresenceService } from "../modules/match/presence.service";
import { GameLoopService } from "../modules/match/game-loop.service";

describe("GameGateway", () => {
  let gateway: GameGateway;
  let authHandler: AuthHandler;
  let roomHandler: RoomHandler;
  let matchHandler: MatchHandler;
  let authService: AuthService;
  let presenceService: PresenceService;
  let gameLoopService: GameLoopService;
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
    authService = {
      verifyToken: vi.fn(),
    } as unknown as AuthService;
    presenceService = {
      setServer: vi.fn(),
      updatePresence: vi.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService;
    gameLoopService = {
      setServer: vi.fn(),
    } as unknown as GameLoopService;

    gateway = new GameGateway(
      authHandler,
      roomHandler,
      matchHandler,
      authService,
      presenceService,
      gameLoopService,
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
      rooms: new Set<string>(),
    } as unknown as Socket;
  });

  describe("handleConnection", () => {
    it("logs connection without error", async () => {
      await gateway.handleConnection(client);
      // handleConnection only logs now; no reconnection logic
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

    it("registers a middleware and sets server on presence service", () => {
      expect(mockServer.use).toHaveBeenCalled();
      expect(middleware).toBeTypeOf("function");
      expect(presenceService.setServer).toHaveBeenCalledWith(mockServer);
      expect(gameLoopService.setServer).toHaveBeenCalledWith(mockServer);
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

    describe("handleHeartbeat", () => {
      it("updates presence when user is a member of the heartbeat room", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r1");

        await gateway.handleHeartbeat(client, { roomId: "r1" });

        expect(presenceService.updatePresence).toHaveBeenCalledWith("r1", "u1");
      });

      it("skips presence update when the user is not a member of the heartbeat room", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r2");

        await gateway.handleHeartbeat(client, { roomId: "r1" });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("ignores the event when userId is missing", async () => {
        client.data = {};
        await gateway.handleHeartbeat(client, { roomId: "r1" });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("ignores the event when roomId is missing", async () => {
        client.data.userId = "u1";
        await gateway.handleHeartbeat(client, { roomId: "" });

        expect(presenceService.updatePresence).not.toHaveBeenCalled();
      });

      it("catches presence update errors and warns without throwing", async () => {
        client.data.userId = "u1";
        (client.rooms as Set<string>).add("room:r1");
        vi.mocked(presenceService.updatePresence).mockRejectedValueOnce(
          new Error("redis down"),
        );
        const warnSpy = vi.spyOn(gateway["logger"], "warn");

        await expect(
          gateway.handleHeartbeat(client, { roomId: "r1" }),
        ).resolves.not.toThrow();

        expect(warnSpy.mock.calls[0][0]).toMatch(/u1.*r1/);
      });
    });
  });
});
