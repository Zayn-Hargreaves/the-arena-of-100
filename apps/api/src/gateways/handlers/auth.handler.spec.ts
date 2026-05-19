import { Socket } from "socket.io";
import { ServerEvent, ErrorCode, ERROR_MESSAGES } from "@arena/shared";
import { AuthHandler } from "./auth.handler";
import { AuthService } from "../../modules/auth/auth.service";

describe("AuthHandler", () => {
  let handler: AuthHandler;
  let authService: AuthService;
  let client: Socket;

  let mockSockets: Map<string, any>;

  beforeEach(() => {
    authService = { verifyToken: vi.fn() } as unknown as AuthService;
    handler = new AuthHandler(authService);
    mockSockets = new Map();
    client = {
      id: "socket-1",
      emit: vi.fn(),
      disconnect: vi.fn(),
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
        data: {},
        nsp: { sockets: mockSockets },
      } as unknown as Socket;
      mockSockets.set(thirdSocket.id, thirdSocket);

      await handler.handleAuthenticate(thirdSocket, { token: "t3" });

      // newSocket should have been kicked because it was still in the map
      expect(newSocket.disconnect).toHaveBeenCalledWith(true);
    });
  });
});
