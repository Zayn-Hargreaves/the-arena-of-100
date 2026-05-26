import { AuthController } from "./auth.controller";
import { AuthService, AuthResult } from "./auth.service";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Role } from "@prisma/client";

describe("AuthController", () => {
  let controller: AuthController;
  let service: AuthService;

  const mockAuthResult: AuthResult = {
    accessToken: "access-token-123",
    refreshToken: "refresh-token-456",
    user: {
      id: "player-id-789",
      username: "guest_player",
      role: Role.GUEST,
    },
  };

  beforeEach(() => {
    const mockAuthService = {
      guestLogin: vi.fn(),
      refreshAccessToken: vi.fn(),
      logout: vi.fn(),
      getAccessTokenTtlSeconds: vi.fn().mockReturnValue(86400),
      getRefreshTokenTtlSeconds: vi.fn().mockReturnValue(604800),
    };
    service = mockAuthService as unknown as AuthService;
    const mockConfigService = { get: vi.fn().mockReturnValue("development") };
    controller = new AuthController(service, mockConfigService as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("guestLogin", () => {
    const guestLoginDto = { username: "guest_player" };
    const reply = {
      header: vi.fn(),
    } as any;

    it("should login guest user successfully", async () => {
      vi.mocked(service.guestLogin).mockResolvedValue(mockAuthResult);

      const result = await controller.guestLogin(guestLoginDto, reply);

      expect(service.guestLogin).toHaveBeenCalledWith(guestLoginDto.username);
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token=access-token-123"),
          expect.stringContaining("HttpOnly"),
          expect.stringContaining("arena_refresh_token=refresh-token-456"),
        ]),
      );
      expect(result).toEqual(mockAuthResult.user);
    });

    it("should handle guest login errors", async () => {
      const error = new Error("Failed to login guest");
      vi.mocked(service.guestLogin).mockRejectedValue(error);

      await expect(controller.guestLogin(guestLoginDto, reply)).rejects.toThrow(
        "Failed to login guest",
      );
      expect(service.guestLogin).toHaveBeenCalledWith(guestLoginDto.username);
    });
  });

  describe("refresh", () => {
    const refreshDto = { refreshToken: "refresh-token-456" };
    const request = { headers: { cookie: "" } } as any;
    const reply = { header: vi.fn() } as any;

    it("should refresh access token from body successfully", async () => {
      vi.mocked(service.refreshAccessToken).mockResolvedValue(mockAuthResult);

      const result = await controller.refresh(request, reply, refreshDto);

      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        refreshDto.refreshToken,
      );
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token=access-token-123"),
          expect.stringContaining("HttpOnly"),
          expect.stringContaining("arena_refresh_token=refresh-token-456"),
        ]),
      );
      expect(result).toEqual(mockAuthResult.user);
    });

    it("should prefer cookie token over body token when both present", async () => {
      const requestWithCookie = {
        headers: { cookie: "arena_refresh_token=cookie-token-789" },
      } as any;
      vi.mocked(service.refreshAccessToken).mockResolvedValue(mockAuthResult);

      const result = await controller.refresh(
        requestWithCookie,
        reply,
        refreshDto,
      );

      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        "cookie-token-789",
      );
      expect(result).toEqual(mockAuthResult.user);
    });

    it("should handle refresh access token errors", async () => {
      const error = new Error("Invalid token");
      vi.mocked(service.refreshAccessToken).mockRejectedValue(error);

      await expect(
        controller.refresh(request, reply, refreshDto),
      ).rejects.toThrow("Invalid token");
      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        refreshDto.refreshToken,
      );
    });
  });

  describe("logout", () => {
    const refreshDto = { refreshToken: "refresh-token-456" };
    const request = { headers: { cookie: "" } } as any;
    const reply = { header: vi.fn() } as any;

    it("should logout successfully", async () => {
      vi.mocked(service.logout).mockResolvedValue(undefined);

      const result = await controller.logout(request, reply, refreshDto);

      expect(service.logout).toHaveBeenCalledWith(refreshDto.refreshToken);
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token="),
          expect.stringContaining("Max-Age=0"),
          expect.stringContaining("arena_refresh_token="),
        ]),
      );
      expect(result).toBeUndefined();
    });

    it("should read token from cookie on logout", async () => {
      const requestWithCookie = {
        headers: { cookie: "arena_refresh_token=cookie-token-789" },
      } as any;
      vi.mocked(service.logout).mockResolvedValue(undefined);

      await controller.logout(requestWithCookie, reply, refreshDto);

      expect(service.logout).toHaveBeenCalledWith("cookie-token-789");
    });

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      vi.mocked(service.logout).mockRejectedValue(error);

      await expect(
        controller.logout(request, reply, refreshDto),
      ).rejects.toThrow("Logout failed");
      expect(service.logout).toHaveBeenCalledWith(refreshDto.refreshToken);
    });
  });
});
