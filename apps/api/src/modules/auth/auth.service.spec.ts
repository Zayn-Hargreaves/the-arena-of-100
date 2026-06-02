import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";
import { describe, it, expect, vi } from "vitest";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

type ServiceInternals = {
  parseExpiresInToSeconds: (value: string) => number;
};

function buildService(jwtExpiresIn: string): AuthService {
  const configValues: Record<string, string | number> = {
    JWT_SECRET: "test-secret",
    JWT_EXPIRES_IN: jwtExpiresIn,
    REFRESH_EXPIRES_IN: 604800,
  };

  const configService = {
    get: vi.fn((key: string, fallback?: string | number) => {
      return key in configValues ? configValues[key] : fallback;
    }),
  } as unknown as ConfigService;

  const prismaService = {} as PrismaService;
  const redisService = {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisService;

  return new AuthService(prismaService, redisService, configService);
}

function getParse(service: AuthService) {
  return (service as unknown as ServiceInternals).parseExpiresInToSeconds;
}

describe("AuthService.parseExpiresInToSeconds", () => {
  it("treats a numeric string as seconds (backward compatibility)", () => {
    const service = buildService("3600");
    expect(getParse(service)("3600")).toBe(3600);
  });

  it("parses duration strings via ms and converts to seconds", () => {
    const service = buildService("24h");
    expect(getParse(service)("24h")).toBe(86400);
  });

  it("trims surrounding whitespace before parsing", () => {
    const service = buildService("24h");
    expect(getParse(service)("  30m  ")).toBe(1800);
  });

  it("falls back to 24 hours when the value is invalid", () => {
    const service = buildService("invalid");
    expect(getParse(service)("invalid")).toBe(86400);
  });

  it("falls back to 24 hours on empty string", () => {
    const service = buildService("");
    expect(getParse(service)("")).toBe(86400);
  });

  it("falls back to 24 hours on non-positive numeric input", () => {
    const service = buildService("0");
    expect(getParse(service)("0")).toBe(86400);
  });
});

describe("AuthService.getAccessTokenTtlSeconds", () => {
  it("returns the parsed number of seconds, never null", () => {
    const numeric = buildService("3600");
    expect(numeric.getAccessTokenTtlSeconds()).toBe(3600);
    expect(numeric.getAccessTokenTtlSeconds()).not.toBeNull();

    const duration = buildService("15m");
    expect(duration.getAccessTokenTtlSeconds()).toBe(900);

    const invalid = buildService("not-a-duration");
    expect(invalid.getAccessTokenTtlSeconds()).toBe(86400);
  });
});

describe("AuthService JWT expiration unit alignment", () => {
  it("issues a JWT whose exp equals iat + ttl seconds for numeric JWT_EXPIRES_IN", () => {
    const service = buildService("3600");
    const accessTtl = service.getAccessTokenTtlSeconds();

    const token = jwt.sign(
      { userId: "u1", username: "p1", role: "GUEST" },
      "test-secret",
      { expiresIn: accessTtl },
    );

    const decoded = jwt.verify(token, "test-secret") as {
      iat: number;
      exp: number;
    };

    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it("issues a JWT whose exp equals iat + ttl seconds for duration JWT_EXPIRES_IN", () => {
    const service = buildService("1h");
    const accessTtl = service.getAccessTokenTtlSeconds();

    const token = jwt.sign(
      { userId: "u1", username: "p1", role: "GUEST" },
      "test-secret",
      { expiresIn: accessTtl },
    );

    const decoded = jwt.verify(token, "test-secret") as {
      iat: number;
      exp: number;
    };

    expect(decoded.exp - decoded.iat).toBe(3600);
  });
});
