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
    controller = new AuthController(service);
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
          expect.stringContaining("Secure"),
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

    it("should refresh access token successfully", async () => {
      vi.mocked(service.refreshAccessToken).mockResolvedValue(mockAuthResult);

      const result = await controller.refresh(refreshDto);

      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        refreshDto.refreshToken,
      );
      expect(result).toEqual(mockAuthResult);
    });

    it("should handle refresh access token errors", async () => {
      const error = new Error("Invalid token");
      vi.mocked(service.refreshAccessToken).mockRejectedValue(error);

      await expect(controller.refresh(refreshDto)).rejects.toThrow(
        "Invalid token",
      );
      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        refreshDto.refreshToken,
      );
    });
  });

  describe("logout", () => {
    const refreshDto = { refreshToken: "refresh-token-456" };

    it("should logout successfully", async () => {
      vi.mocked(service.logout).mockResolvedValue(undefined);

      const result = await controller.logout(refreshDto);

      expect(service.logout).toHaveBeenCalledWith(refreshDto.refreshToken);
      expect(result).toBeUndefined();
    });

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      vi.mocked(service.logout).mockRejectedValue(error);

      await expect(controller.logout(refreshDto)).rejects.toThrow(
        "Logout failed",
      );
      expect(service.logout).toHaveBeenCalledWith(refreshDto.refreshToken);
    });
  });
});
