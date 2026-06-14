import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, ERROR_MESSAGES } from "@arena/shared";
import { AuthHandler } from "./auth.handler";
import { AuthService } from "../../modules/auth/auth.service";
import { RoomService } from "../../modules/room/room.service";
import { MatchService } from "../../modules/match/match.service";
import { GameLoopService } from "../../modules/match/game-loop.service";
import { PresenceService } from "../../modules/match/presence.service";

describe("AuthHandler", () => {
  let handler: AuthHandler;
  let authService: AuthService;
  let roomService: RoomService;
  let matchService: MatchService;
  let gameLoopService: GameLoopService;
  let presenceService: PresenceService;
  let client: Socket;

  let mockSockets: Map<string, any>;

  beforeEach(() => {
    authService = { verifyToken: vi.fn() } as unknown as AuthService;
    roomService = {
      getUserActiveRooms: vi.fn().mockResolvedValue([]),
    } as unknown as RoomService;
    matchService = {
      getStateMachine: vi.fn(),
      persistStateMachine: vi.fn(),
    } as unknown as MatchService;
    gameLoopService = {
      handlePlayerDisconnect: vi.fn(),
      getCountdownEnd: vi.fn().mockReturnValue(null),
    } as unknown as GameLoopService;
    presenceService = {
      isPresent: vi.fn().mockResolvedValue(true),
      updatePresence: vi.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService;
    handler = new AuthHandler(
      authService,
      roomService,
      matchService,
      gameLoopService,
      presenceService,
    );
    mockSockets = new Map();
    client = {
      id: "socket-1",
      emit: vi.fn(),
      disconnect: vi.fn(),
      join: vi.fn(),
      data: {},
      nsp: {
        sockets: mockSockets,
      },
    } as unknown as Socket;
  });

  describe("handleAuthenticate", () => {
    it("sets client data and emits AUTHENTICATED on valid token", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      await handler.handleAuthenticate(client, { token: "valid-token" });

      expect(client.data.userId).toBe("u1");
      expect(client.data.username).toBe("Alice");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.AUTHENTICATED, {
        userId: "u1",
        username: "Alice",
      });
    });

    it("emits error on invalid token", async () => {
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      });
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw "string error";
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: ERROR_MESSAGES[ErrorCode.INVALID_TOKEN],
      });
    });

    it("kicks previous socket connection when same user authenticates", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      const oldSocket = {
        id: "socket-old",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(oldSocket.id, oldSocket);

      // First authentication
      await handler.handleAuthenticate(oldSocket, { token: "t1" });

      // Second authentication with same userId on different socket
      const newSocket = {
        id: "socket-new",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: {},
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(newSocket.id, newSocket);

      await handler.handleAuthenticate(newSocket, { token: "t2" });

      // Verify old socket was kicked
      expect(oldSocket.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.UNAUTHORIZED,
        message: ERROR_MESSAGES[ErrorCode.UNAUTHORIZED],
      });
      expect(oldSocket.disconnect).toHaveBeenCalledWith(true);

      // Verify new socket authenticated successfully
      expect(newSocket.data.userId).toBe("u1");
      expect(newSocket.emit).toHaveBeenCalledWith(ServerEvent.AUTHENTICATED, {
        userId: "u1",
        username: "Alice",
      });
    });
  });

  describe("handleDisconnect", () => {
    it("removes player from connected map on disconnect", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      handler.handleDisconnect(client);

      // Authenticate again with new socket to verify old mapping removed
      const client2 = {
        id: "socket-2",
        emit: vi.fn(),
        join: vi.fn(),
        data: {},
        nsp: {
          sockets: mockSockets,
        },
      } as unknown as Socket;
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client2, { token: "t" });
      expect(client2.data.userId).toBe("u1");
    });

    it("handles disconnect for unknown socket gracefully", () => {
      expect(() => handler.handleDisconnect(client)).not.toThrow();
    });

    it("does not delete mapping if active session socket ID is different", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });

      const oldSocket = {
        id: "socket-old",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(oldSocket.id, oldSocket);

      // Authenticate old socket
      await handler.handleAuthenticate(oldSocket, { token: "t1" });

      // Authenticate new socket
      const newSocket = {
        id: "socket-new",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: { userId: "u1" },
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(newSocket.id, newSocket);
      await handler.handleAuthenticate(newSocket, { token: "t2" });

      // Trigger disconnect on old socket
      handler.handleDisconnect(oldSocket);

      // Try authenticating a third socket.
      // If the map entry was deleted, the kick logic wouldn't run.
      // We check that the mapping still exists by showing newSocket is still in the map and will be kicked if we connect socket3
      const thirdSocket = {
        id: "socket-third",
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
        data: {},
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(thirdSocket.id, thirdSocket);

      await handler.handleAuthenticate(thirdSocket, { token: "t3" });

      // newSocket should have been kicked because it was still in the map
      expect(newSocket.disconnect).toHaveBeenCalledWith(true);
    });

    it("notifies active matches of player disconnect", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      (client.nsp as any).server = { to: vi.fn() } as any;

      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            currentMatchId: "m1",
          },
        },
      ] as any);

      await handler.handleDisconnect(client);

      expect(roomService.getUserActiveRooms).toHaveBeenCalledWith("u1");
      expect(gameLoopService.handlePlayerDisconnect).toHaveBeenCalledWith(
        "m1",
        "u1",
        client.nsp.server,
      );
    });

    it("handles getUserActiveRooms error on disconnect gracefully", async () => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
      await handler.handleAuthenticate(client, { token: "t" });

      vi.mocked(roomService.getUserActiveRooms).mockRejectedValue(
        new Error("db failure"),
      );

      const warnSpy = vi.spyOn(handler["logger"], "warn");

      await expect(handler.handleDisconnect(client)).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to notify match of disconnect for u1"),
        expect.any(Error),
      );
    });
  });

  describe("reconnection sync", () => {
    beforeEach(() => {
      vi.mocked(authService.verifyToken).mockReturnValue({
        userId: "u1",
        username: "Alice",
        role: "GUEST" as any,
      });
    });

    it("rejoins active rooms after authentication", async () => {
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            code: "ABC",
            type: "PUBLIC",
            status: "WAITING",
            hostId: "u1",
            currentMatchId: null,
            players: [{ userId: "u1", user: { username: "Alice" } }],
          },
        },
      ] as any);

      await handler.handleAuthenticate(client, { token: "t" });

      expect(client.join).toHaveBeenCalledWith("room:r1");
      expect(presenceService.updatePresence).toHaveBeenCalledWith("r1", "u1");
      // updatePresence must run before the ROOM_JOINED emit so the player
      // list sent to the client reflects the user as online.
      const updatePresenceOrder = vi.mocked(presenceService.updatePresence).mock
        .invocationCallOrder[0];
      const emitOrder = (client.emit as any).mock.invocationCallOrder.find(
        (n: number) => n > updatePresenceOrder,
      );
      expect(updatePresenceOrder).toBeDefined();
      expect(emitOrder).toBeDefined();
      expect(updatePresenceOrder).toBeLessThan(emitOrder as number);
      expect(presenceService.isPresent).toHaveBeenCalledWith("r1", "u1");
      expect(client.emit).toHaveBeenCalledWith(
        ServerEvent.ROOM_JOINED,
        expect.objectContaining({
          roomId: "r1",
          code: "ABC",
          roomType: "PUBLIC",
          roomStatus: "WAITING",
          players: expect.arrayContaining([
            expect.objectContaining({
              playerId: "u1",
              playerName: "Alice",
              isOnline: true,
            }),
          ]),
        }),
      );
    });

    it("emits snapshot, restores player status to active, and persists state machine when active match exists", async () => {
      const snapshot = { matchId: "m1", status: "ROUND_ACTIVE" };
      vi.mocked(roomService.getUserActiveRooms).mockResolvedValue([
        {
          joinedAt: new Date(),
          room: {
            id: "r1",
            code: "ABC",
            currentMatchId: "m1",
            players: [{ userId: "u1", user: { username: "Alice" } }],
          },
        },
      ] as any);

      const mockStateMachine = {
        reconnectPlayer: vi.fn(),
        getSnapshot: vi.fn().mockReturnValue(snapshot),
      };
      vi.mocked(matchService.getStateMachine).mockResolvedValue(
        mockStateMachine as any,
      );
      vi.mocked(matchService.persistStateMachine).mockResolvedValue();

      await handler.handleAuthenticate(client, { token: "t" });

      expect(mockStateMachine.reconnectPlayer).toHaveBeenCalledWith("u1");
      expect(matchService.persistStateMachine).toHaveBeenCalledWith("m1");
      expect(client.emit).toHaveBeenCalledWith(ServerEvent.SNAPSHOT, snapshot);
    });

    it("handles reconnection errors gracefully", async () => {
      vi.mocked(roomService.getUserActiveRooms).mockRejectedValue(
        new Error("db error"),
      );

      await expect(
        handler.handleAuthenticate(client, { token: "t" }),
      ).resolves.not.toThrow();
      // Auth still succeeded
      expect(client.data.userId).toBe("u1");
    });
  });
});
