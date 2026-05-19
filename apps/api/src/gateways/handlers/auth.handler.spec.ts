import { Socket } from "socket.io";
import { ServerEvent, ErrorCode } from "@arena/shared";
import { AuthHandler } from "./auth.handler";
import { AuthService } from "../../modules/auth/auth.service";

describe("AuthHandler", () => {
  let handler: AuthHandler;
  let authService: AuthService;
  let client: Socket;

  beforeEach(() => {
    authService = { verifyToken: vi.fn() } as unknown as AuthService;
    handler = new AuthHandler(authService);
    client = {
      id: "socket-1",
      emit: vi.fn(),
      data: {},
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
        message: "Token không hợp lệ",
      });
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(authService.verifyToken).mockImplementation(() => {
        throw "string error";
      });

      await handler.handleAuthenticate(client, { token: "bad" });

      expect(client.emit).toHaveBeenCalledWith(ServerEvent.ERROR, {
        code: ErrorCode.INVALID_TOKEN,
        message: "Token không hợp lệ",
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
        data: {},
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
  });
});
