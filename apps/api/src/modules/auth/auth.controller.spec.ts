import { AuthController } from "./auth.controller";
import { AuthService, AuthResult } from "./auth.service";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Role } from "@prisma/client";
import { UnauthorizedException } from "@nestjs/common";

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
    const request = {
      headers: { cookie: "arena_refresh_token=refresh-token-456" },
    } as any;
    const reply = { header: vi.fn() } as any;

    it("should refresh access token from cookie successfully", async () => {
      vi.mocked(service.refreshAccessToken).mockResolvedValue(mockAuthResult);

      const result = await controller.refresh(request, reply);

      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        "refresh-token-456",
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

    it("should handle refresh access token errors", async () => {
      const error = new Error("Invalid token");
      vi.mocked(service.refreshAccessToken).mockRejectedValue(error);

      await expect(controller.refresh(request, reply)).rejects.toThrow(
        "Invalid token",
      );
      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        "refresh-token-456",
      );
    });

    it("should throw UnauthorizedException when no token is provided in cookie", async () => {
      const emptyRequest = { headers: { cookie: "" } } as any;
      await expect(controller.refresh(emptyRequest, reply)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.refreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    const request = {
      headers: { cookie: "arena_refresh_token=refresh-token-456" },
    } as any;
    const reply = { header: vi.fn() } as any;

    it("should logout successfully", async () => {
      vi.mocked(service.logout).mockResolvedValue(undefined);

      const result = await controller.logout(request, reply);

      expect(service.logout).toHaveBeenCalledWith("refresh-token-456");
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

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      vi.mocked(service.logout).mockRejectedValue(error);

      await expect(controller.logout(request, reply)).rejects.toThrow(
        "Logout failed",
      );
      expect(service.logout).toHaveBeenCalledWith("refresh-token-456");
    });

    it("should throw UnauthorizedException when no token is provided in cookie", async () => {
      const emptyRequest = { headers: { cookie: "" } } as any;
      await expect(controller.logout(emptyRequest, reply)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(service.logout).not.toHaveBeenCalled();
    });
  });
});
