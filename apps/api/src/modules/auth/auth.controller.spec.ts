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
    guestSecret: "guest-secret-abc",
    user: {
      id: "player-id-789",
      username: "guest_player",
      role: Role.GUEST,
    },
  };

  beforeEach(() => {
    const mockAuthService = {
      guestLogin: vi.fn(),
      adminLogin: vi.fn(),
      refreshAccessToken: vi.fn(),
      logout: vi.fn(),
      getAccessTokenTtlSeconds: vi.fn().mockReturnValue(3600),
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
    const guestLoginDto = {
      username: "guest_player",
      guestSecret: "guest-secret-abc",
    };
    const reply = { header: vi.fn() } as unknown as {
      header: (name: string, value: string[]) => void;
    };

    it("should login guest user successfully", async () => {
      vi.mocked(service.guestLogin).mockResolvedValue(mockAuthResult);

      const result = await controller.guestLogin(guestLoginDto, reply as never);

      expect(service.guestLogin).toHaveBeenCalledWith(
        guestLoginDto.username,
        guestLoginDto.guestSecret,
        undefined,
      );
      expect(result).toEqual({
        accessToken: mockAuthResult.accessToken,
        guestSecret: mockAuthResult.guestSecret,
        user: mockAuthResult.user,
      });
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_refresh_token="),
        ]),
      );
    });

    it("should handle guest login errors", async () => {
      const error = new Error("Failed to login guest");
      vi.mocked(service.guestLogin).mockRejectedValue(error);

      await expect(
        controller.guestLogin(guestLoginDto, reply as never),
      ).rejects.toThrow("Failed to login guest");
      expect(service.guestLogin).toHaveBeenCalledWith(
        guestLoginDto.username,
        guestLoginDto.guestSecret,
        undefined,
      );
    });
  });

  describe("adminLogin", () => {
    const adminLoginDto = {
      password: "strong-admin-password",
    };
    const reply = { header: vi.fn() } as unknown as {
      header: (name: string, value: string[]) => void;
    };

    it("should login admin user successfully and return body without guestSecret", async () => {
      const adminAuthResult: AuthResult = {
        accessToken: "admin-access-token-123",
        refreshToken: "admin-refresh-token-456",
        guestSecret: "guest-secret-that-must-be-omitted",
        user: {
          id: "admin-id-1",
          username: "admin",
          role: Role.ADMIN,
        },
      };
      vi.mocked(service.adminLogin).mockResolvedValue(adminAuthResult);

      const result = await controller.adminLogin(adminLoginDto, reply as never);

      expect(service.adminLogin).toHaveBeenCalledWith(adminLoginDto.password);
      expect(result).toEqual({
        accessToken: adminAuthResult.accessToken,
        user: adminAuthResult.user,
      });
      expect(result).not.toHaveProperty("guestSecret");
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token="),
          expect.stringContaining("arena_refresh_token="),
        ]),
      );
    });

    it("should handle admin login errors", async () => {
      const error = new UnauthorizedException("Invalid admin credentials");
      vi.mocked(service.adminLogin).mockRejectedValue(error);

      await expect(
        controller.adminLogin(adminLoginDto, reply as never),
      ).rejects.toThrow(UnauthorizedException);
      expect(service.adminLogin).toHaveBeenCalledWith(adminLoginDto.password);
    });
  });

  describe("refresh", () => {
    const request = {
      headers: { cookie: "arena_refresh_token=refresh-token-456" },
    } as unknown as { headers: { cookie: string } };
    const reply = { header: vi.fn() } as unknown as {
      header: (name: string, value: string[]) => void;
    };

    it("should refresh access token successfully", async () => {
      vi.mocked(service.refreshAccessToken).mockResolvedValue(mockAuthResult);

      const result = await controller.refresh(request as never, reply as never);

      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        "refresh-token-456",
      );
      expect(result).toEqual({
        accessToken: mockAuthResult.accessToken,
        user: mockAuthResult.user,
      });
    });

    it("should handle refresh access token errors", async () => {
      const error = new Error("Invalid token");
      vi.mocked(service.refreshAccessToken).mockRejectedValue(error);

      await expect(
        controller.refresh(request as never, reply as never),
      ).rejects.toThrow("Invalid token");
      expect(service.refreshAccessToken).toHaveBeenCalledWith(
        "refresh-token-456",
      );
    });

    it("should throw when refresh token cookie is missing", async () => {
      const noCookieRequest = { headers: {} };
      await expect(
        controller.refresh(noCookieRequest as never, reply as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("logout", () => {
    const request = {
      headers: { cookie: "arena_refresh_token=refresh-token-456" },
    } as unknown as { headers: { cookie: string } };
    const reply = { header: vi.fn() } as unknown as {
      header: (name: string, value: string[]) => void;
    };

    it("should logout successfully", async () => {
      vi.mocked(service.logout).mockResolvedValue(undefined);

      const result = await controller.logout(request as never, reply as never);

      expect(service.logout).toHaveBeenCalledWith("refresh-token-456");
      expect(result).toBeUndefined();
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token="),
          expect.stringContaining("arena_refresh_token="),
        ]),
      );
    });

    it("should handle logout errors", async () => {
      const error = new Error("Logout failed");
      vi.mocked(service.logout).mockRejectedValue(error);

      await expect(
        controller.logout(request as never, reply as never),
      ).rejects.toThrow("Logout failed");
      expect(service.logout).toHaveBeenCalledWith("refresh-token-456");
    });

    it("should logout successfully even when refresh token is missing (idempotent)", async () => {
      const noCookieRequest = {
        headers: {},
      } as unknown as { headers: { cookie: string } };

      // Should not call authService.logout when refresh token is missing
      const result = await controller.logout(
        noCookieRequest as never,
        reply as never,
      );

      // Should still clear cookies even when refresh token is missing
      expect(service.logout).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
      expect(reply.header).toHaveBeenCalledWith(
        "Set-Cookie",
        expect.arrayContaining([
          expect.stringContaining("arena_access_token="),
          expect.stringContaining("arena_refresh_token="),
        ]),
      );
    });
  });
});
