import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ConfigService } from "@nestjs/config";
import { Role } from "@prisma/client";
import { UnauthorizedException } from "@nestjs/common";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as jwt from "jsonwebtoken";

describe("AuthService", () => {
  let service: AuthService;
  let prisma: PrismaService;
  let redis: RedisService;
  let configService: ConfigService;

  const mockSecret = "test-secret-key";

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as PrismaService;

    redis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    } as unknown as RedisService;

    configService = {
      get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
        if (key === "JWT_SECRET") return mockSecret;
        if (key === "JWT_EXPIRES_IN") return "24h";
        if (key === "REFRESH_EXPIRES_IN") return 604800;
        return defaultValue;
      }),
    } as unknown as ConfigService;

    service = new AuthService(prisma, redis, configService);
  });

  describe("constructor & options", () => {
    it("should initialize with values from configService", () => {
      expect(service.getRefreshTokenTtlSeconds()).toBe(604800);
      expect(service.getAccessTokenTtlSeconds()).toBe(86400); // 24h = 86400s
    });

    it("should handle alternative expiration formats in parseDurationToSeconds", () => {
      // Create service instances with different jwt expiration config values
      const testCases = [
        { configVal: "30s", expected: 30 },
        { configVal: "15m", expected: 900 },
        { configVal: "2h", expected: 7200 },
        { configVal: "5d", expected: 432000 },
        { configVal: "3600", expected: 3600 }, // numeric value as string
        { configVal: "invalid-duration", expected: 86400 }, // fallback
      ];

      for (const { configVal, expected } of testCases) {
        const customConfig = {
          get: vi.fn().mockImplementation((key: string, defaultValue?: any) => {
            if (key === "JWT_EXPIRES_IN") return configVal;
            return defaultValue;
          }),
        } as unknown as ConfigService;

        const customService = new AuthService(prisma, redis, customConfig);
        expect(customService.getAccessTokenTtlSeconds()).toBe(expected);
      }
    });
  });

  describe("guestLogin", () => {
    it("should find and login an existing guest user, preserving their role", async () => {
      const existingUser = {
        id: "user-123",
        username: "existing_guest",
        role: Role.GUEST,
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as any);
      vi.mocked(redis.set).mockResolvedValue(undefined);

      const result = await service.guestLogin("existing_guest");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: "existing_guest" },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining("refresh:"),
        "user-123",
        604800,
      );
      expect(result.user).toEqual({
        id: "user-123",
        username: "existing_guest",
        role: Role.GUEST,
      });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it("should create and login a new guest user if not found", async () => {
      const newUser = {
        id: "new-user-789",
        username: "new_guest",
        role: Role.GUEST,
      };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(newUser as any);
      vi.mocked(redis.set).mockResolvedValue(undefined);

      const result = await service.guestLogin("new_guest");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: "new_guest" },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          username: "new_guest",
          guestId: expect.any(String),
          role: Role.GUEST,
        },
      });
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining("refresh:"),
        "new-user-789",
        604800,
      );
      expect(result.user).toEqual({
        id: "new-user-789",
        username: "new_guest",
        role: Role.GUEST,
      });
    });

    it("should throw UnauthorizedException when attempting to guest login as 'admin'", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(service.guestLogin("admin")).rejects.toThrow(
        new UnauthorizedException("Cannot create admin user via guest login"),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("verifyToken", () => {
    it("should successfully verify a valid JWT token and return payload", () => {
      const payload = {
        userId: "user-123",
        username: "john_doe",
        role: Role.GUEST,
      };
      const token = jwt.sign(payload, mockSecret);

      const result = service.verifyToken(token);

      expect(result).toMatchObject(payload);
    });

    it("should throw UnauthorizedException if JWT token is invalid", () => {
      expect(() => service.verifyToken("invalid-signature-jwt")).toThrow(
        new UnauthorizedException("Invalid or expired token"),
      );
    });
  });

  describe("refreshAccessToken", () => {
    it("should refresh tokens successfully if refresh token is valid", async () => {
      const userId = "user-789";
      const user = {
        id: userId,
        username: "refreshed_user",
        role: Role.GUEST,
      };
      vi.mocked(redis.get).mockResolvedValue(userId);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(user as any);
      vi.mocked(redis.del).mockResolvedValue(undefined);
      vi.mocked(redis.set).mockResolvedValue(undefined);

      const result = await service.refreshAccessToken("valid-refresh-token");

      expect(redis.get).toHaveBeenCalledWith("refresh:valid-refresh-token");
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
      });
      expect(redis.del).toHaveBeenCalledWith("refresh:valid-refresh-token");
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining("refresh:"),
        userId,
        604800,
      );
      expect(result.user).toEqual({
        id: userId,
        username: "refreshed_user",
        role: Role.GUEST,
      });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it("should throw UnauthorizedException if refresh token is not found in Redis", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.refreshAccessToken("expired-refresh-token"),
      ).rejects.toThrow(new UnauthorizedException("Invalid refresh token"));
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("should throw UnauthorizedException if user is not found in database", async () => {
      vi.mocked(redis.get).mockResolvedValue("nonexistent-id");
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.refreshAccessToken("valid-refresh-token"),
      ).rejects.toThrow(new UnauthorizedException("User not found"));
    });
  });

  describe("logout", () => {
    it("should delete the refresh token from Redis", async () => {
      vi.mocked(redis.del).mockResolvedValue(undefined);

      await service.logout("token-to-delete");

      expect(redis.del).toHaveBeenCalledWith("refresh:token-to-delete");
    });
  });
});
