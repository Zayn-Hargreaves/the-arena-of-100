import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import {
  AuthService,
  ACCESS_TOKEN_TYP,
  DAILY_SESSION_TYP,
  isRejectedAdminPassword,
} from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { Prisma, Role } from "@prisma/client";

const EXPECTED_REJECTED_ADMIN_PASSWORDS = [
  "arena100admin",
  "change-me-admin-password",
] as const;

type ServiceInternals = {
  parseExpiresInToSeconds: (value: string) => number;
  generateTokens: (
    userId: string,
    username: string,
    role: Role,
  ) => Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; username: string; role: Role };
  }>;
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

  it("clamps sub-second durations to at least 1 second so JWT expiresIn is never 0", () => {
    const service = buildService("500ms");
    expect(getParse(service)("500ms")).toBe(1);
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

describe("AuthService.guestLogin", () => {
  function buildServiceWithPrisma() {
    const configService = {
      get: vi.fn((key: string, fallback?: string | number) => {
        if (key === "JWT_SECRET") return "test-secret";
        if (key === "JWT_EXPIRES_IN") return "24h";
        if (key === "REFRESH_EXPIRES_IN") return 604800;
        return fallback;
      }),
    } as unknown as ConfigService;
    const prismaService = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;
    const redisService = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    const service = new AuthService(prismaService, redisService, configService);
    return { service, prisma: prismaService, redis: redisService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new user with role GUEST and guestSecret when username does not exist", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "u-1",
      username: "guest_player",
      guestId: "generated-secret-12345",
      role: Role.GUEST,
    } as never);

    const result = await service.guestLogin("guest_player");

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: "guest_player",
        role: Role.GUEST,
        guestId: expect.any(String),
      }),
    });
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(result.user).toEqual({
      id: "u-1",
      username: "guest_player",
      role: Role.GUEST,
    });
    expect(result.guestSecret).toBe("generated-secret-12345");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it("sanitizes profanity before creating a guest user", async () => {
    const { service, prisma } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "u-1",
      username: "bad****",
      guestId: "gid",
      role: Role.GUEST,
    } as never);

    const result = await service.guestLogin("badshit");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: "bad****" },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: "bad****" }),
    });
    expect(result.user.username).toBe("bad****");
  });

  it("re-reads an existing guest user when create hits a unique race with matching secret", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    const raceError = Object.assign(
      Object.create(Prisma.PrismaClientKnownRequestError.prototype),
      { code: "P2002" },
    );
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "u-existing",
        username: "regular_user",
        guestId: "gid-123456",
        role: Role.GUEST,
      } as never);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(raceError as never);

    const result = await service.guestLogin("regular_user", "gid-123456");

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(result.user.role).toBe(Role.GUEST);
    expect(result.guestSecret).toBe("gid-123456");
  });

  it("returns existing guest user when guestSecret matches", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-existing",
      username: "regular_user",
      guestId: "gid-123456",
      role: Role.GUEST,
    } as never);

    const result = await service.guestLogin("regular_user", "gid-123456");

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(result.user.role).toBe(Role.GUEST);
    expect(result.guestSecret).toBe("gid-123456");
  });

  it("rejects login when username is taken and guestSecret does not match", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-existing",
      username: "regular_user",
      guestId: "real-secret-123456",
      role: Role.GUEST,
    } as never);

    await expect(
      service.guestLogin("regular_user", "wrong-secret-654321"),
    ).rejects.toThrow("USERNAME_TAKEN");

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rejects login when username is taken and guestSecret is omitted", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-existing",
      username: "regular_user",
      guestId: "real-secret-123456",
      role: Role.GUEST,
    } as never);

    await expect(service.guestLogin("regular_user")).rejects.toThrow(
      "USERNAME_TAKEN",
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rejects legacy guest user without guestId (no claim/backfill)", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-legacy",
      username: "legacy_user",
      guestId: null,
      role: Role.GUEST,
    } as never);

    await expect(
      service.guestLogin("legacy_user", "any-secret-12345"),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("ignores client-supplied guestSecret when creating a new user", async () => {
    const { service, prisma } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockImplementation((async ({ data }: any) => {
      return {
        id: "u-1",
        username: "new_player",
        guestId: data.guestId,
        role: Role.GUEST,
      } as never;
    }) as any);

    const result = await service.guestLogin(
      "new_player",
      "client-chosen-secret",
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: "new_player",
        guestId: expect.not.stringMatching(/^client-chosen-secret$/),
      }),
    });
    expect(result.guestSecret).toBeTruthy();
    expect(result.guestSecret).not.toBe("client-chosen-secret");
  });

  it("rejects existing non-guest users from guest login", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-existing",
      username: "regular_user",
      guestId: "gid",
      role: Role.ADMIN,
    } as never);

    await expect(service.guestLogin("regular_user")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rejects a unique race when the raced user is missing", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    const raceError = Object.assign(
      Object.create(Prisma.PrismaClientKnownRequestError.prototype),
      { code: "P2002" },
    );
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(raceError as never);

    await expect(service.guestLogin("regular_user")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rethrows non-unique create errors", async () => {
    const { service, prisma, redis } = buildServiceWithPrisma();
    const error = new Error("database unavailable");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockRejectedValueOnce(error as never);

    await expect(service.guestLogin("regular_user")).rejects.toThrow(error);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("rejects reserved usernames before user lookup", async () => {
    const inputs = [
      "admin",
      "ad-min",
      "a d m i n",
      "a*dmin",
      "ａｄｍｉｎ",
      "ＡＤＭＩＮ",
      "ádmin",
    ];

    for (const username of inputs) {
      const { service, prisma } = buildServiceWithPrisma();

      await expect(service.guestLogin(username)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    }
  });

  it("rejects fully filtered guest usernames before user lookup", async () => {
    const { service, prisma } = buildServiceWithPrisma();

    await expect(service.guestLogin("!!!")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("AuthService.verifyToken", () => {
  function buildServiceForVerify() {
    const configService = {
      get: vi.fn((key: string, fallback?: string | number) => {
        if (key === "JWT_SECRET") return "test-secret";
        if (key === "JWT_EXPIRES_IN") return "1h";
        if (key === "REFRESH_EXPIRES_IN") return 604800;
        return fallback;
      }),
    } as unknown as ConfigService;
    return new AuthService(
      {} as PrismaService,
      {} as RedisService,
      configService,
    );
  }

  // Signed WITHOUT a `typ` claim on purpose: access tokens live for 24h, so
  // rejecting untyped ones would sign out every session already in flight at
  // deploy time. This is the backward-compatibility guarantee documented on
  // verifyToken — do not "tighten" it into a rejection until one full token
  // TTL has elapsed since the typ marker shipped.
  it("returns the decoded payload when the token is valid", () => {
    const service = buildServiceForVerify();
    const token = jwt.sign(
      { userId: "u-1", username: "p1", role: Role.GUEST },
      "test-secret",
      { expiresIn: 60 },
    );
    const payload = service.verifyToken(token);
    expect(payload).toMatchObject({
      userId: "u-1",
      username: "p1",
      role: Role.GUEST,
    });
  });

  // ---- token-type separation ----
  it("accepts a token carrying the access typ marker", () => {
    const service = buildServiceForVerify();
    const token = jwt.sign(
      {
        userId: "u-1",
        username: "p1",
        role: Role.GUEST,
        typ: ACCESS_TOKEN_TYP,
      },
      "test-secret",
      { expiresIn: 60 },
    );

    expect(service.verifyToken(token)).toMatchObject({ userId: "u-1" });
  });

  it("rejects a daily session token replayed as an access token", () => {
    const service = buildServiceForVerify();
    // Same secret, different purpose — only `typ` tells them apart.
    const sessionToken = jwt.sign(
      {
        sub: "u-1",
        dateKey: "2026-08-09",
        dailyQuestionId: "dq-1",
        typ: DAILY_SESSION_TYP,
      },
      "test-secret",
      { expiresIn: 60 },
    );

    expect(() => service.verifyToken(sessionToken)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a verifying token whose payload carries no identity", () => {
    const service = buildServiceForVerify();
    // Signed correctly, but unusable: callers read `.userId` straight off it.
    const token = jwt.sign({ role: Role.GUEST }, "test-secret", {
      expiresIn: 60,
    });

    expect(() => service.verifyToken(token)).toThrow(UnauthorizedException);
  });

  it("rejects an access token replayed as a daily session token", () => {
    const service = buildServiceForVerify();
    const accessToken = jwt.sign(
      {
        userId: "u-1",
        username: "p1",
        role: Role.GUEST,
        typ: ACCESS_TOKEN_TYP,
      },
      "test-secret",
      { expiresIn: 60 },
    );

    expect(() => service.verifyDailySession(accessToken)).toThrow(
      UnauthorizedException,
    );
  });

  it("round-trips a daily session token with its pinned start", () => {
    const service = buildServiceForVerify();
    const token = service.signDailySession({
      sub: "u-1",
      dateKey: "2026-08-09",
      dailyQuestionId: "dq-1",
      startedAtMs: 1_700_000_000_000,
    });

    expect(service.verifyDailySession(token)).toMatchObject({
      sub: "u-1",
      dailyQuestionId: "dq-1",
      startedAtMs: 1_700_000_000_000,
    });
  });

  it("round-trips an unpinned (null) start", () => {
    const service = buildServiceForVerify();
    // Anonymous fetches and session-store outages both mint a null pin; it is
    // a legitimate value meaning "no speed bonus", not a malformed claim.
    const token = service.signDailySession({
      sub: "anon",
      dateKey: "2026-08-09",
      dailyQuestionId: "dq-1",
      startedAtMs: null,
    });

    expect(service.verifyDailySession(token)).toMatchObject({
      sub: "anon",
      startedAtMs: null,
    });
  });

  it("rejects a daily session token carrying no pinned start", () => {
    const service = buildServiceForVerify();
    // Hand-rolled: signDailySession cannot produce this, and jwt.sign drops
    // `undefined`, so an absent claim and an explicitly-undefined one are the
    // same token on the wire.
    const token = jwt.sign(
      {
        sub: "u-1",
        dateKey: "2026-08-09",
        dailyQuestionId: "dq-1",
        typ: DAILY_SESSION_TYP,
      },
      "test-secret",
      { expiresIn: 60 },
    );

    expect(() => service.verifyDailySession(token)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a daily session token whose pinned start is a string", () => {
    const service = buildServiceForVerify();
    // A stringified pin would pass the cast and then be compared numerically
    // downstream, so it must not verify.
    const token = jwt.sign(
      {
        sub: "u-1",
        dateKey: "2026-08-09",
        dailyQuestionId: "dq-1",
        startedAtMs: "1700000000000",
        typ: DAILY_SESSION_TYP,
      },
      "test-secret",
      { expiresIn: 60 },
    );

    expect(() => service.verifyDailySession(token)).toThrow(
      UnauthorizedException,
    );
  });

  it("throws UnauthorizedException for an invalid token", () => {
    const service = buildServiceForVerify();
    expect(() => service.verifyToken("not-a-real-token")).toThrow(
      UnauthorizedException,
    );
  });
});

describe("AuthService.refreshAccessToken", () => {
  function buildServiceForRefresh() {
    const configService = {
      get: vi.fn((key: string, fallback?: string | number) => {
        if (key === "JWT_SECRET") return "test-secret";
        if (key === "JWT_EXPIRES_IN") return "1h";
        if (key === "REFRESH_EXPIRES_IN") return 604800;
        return fallback;
      }),
    } as unknown as ConfigService;
    const prismaService = {
      user: { findUnique: vi.fn() },
    } as unknown as PrismaService;
    const redisService = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    const service = new AuthService(prismaService, redisService, configService);
    return { service, prisma: prismaService, redis: redisService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rotates the refresh token and returns new tokens for a valid user", async () => {
    const { service, prisma, redis } = buildServiceForRefresh();
    vi.mocked(redis.get).mockResolvedValueOnce("u-1");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      username: "p1",
      guestId: "gid",
      role: Role.GUEST,
    } as never);

    const result = await service.refreshAccessToken("old-refresh");

    expect(redis.del).toHaveBeenCalledWith("refresh:old-refresh");
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(result.user.id).toBe("u-1");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it("throws UnauthorizedException when the refresh token is unknown", async () => {
    const { service, redis, prisma } = buildServiceForRefresh();
    vi.mocked(redis.get).mockResolvedValueOnce(null);

    await expect(service.refreshAccessToken("bad")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the user no longer exists", async () => {
    const { service, redis, prisma } = buildServiceForRefresh();
    vi.mocked(redis.get).mockResolvedValueOnce("u-gone");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    await expect(service.refreshAccessToken("orphan")).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("AuthService.logout", () => {
  it("deletes the refresh token from Redis", async () => {
    const configService = {
      get: vi.fn((key: string, fallback?: string | number) => {
        if (key === "JWT_SECRET") return "test-secret";
        if (key === "JWT_EXPIRES_IN") return "1h";
        if (key === "REFRESH_EXPIRES_IN") return 604800;
        return fallback;
      }),
    } as unknown as ConfigService;
    const redis = {
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    const service = new AuthService({} as PrismaService, redis, configService);

    await service.logout("rt-xyz");

    expect(redis.del).toHaveBeenCalledWith("refresh:rt-xyz");
  });
});

describe("AuthService.getRefreshTokenTtlSeconds", () => {
  it("returns the configured refresh TTL in seconds", () => {
    const service = buildService("1h");
    expect(service.getRefreshTokenTtlSeconds()).toBe(604800);
  });
});

describe("AuthService.adminLogin", () => {
  function buildAdminService(config: Record<string, string | number> = {}) {
    const configValues: Record<string, string | number> = {
      JWT_SECRET: "test-secret",
      JWT_EXPIRES_IN: "1h",
      REFRESH_EXPIRES_IN: 604800,
      NODE_ENV: "test",
      ADMIN_PASSWORD: "strong-admin-password",
      ...config,
    };
    const configService = {
      get: vi.fn((key: string, fallback?: string | number) => {
        return key in configValues ? configValues[key] : fallback;
      }),
    } as unknown as ConfigService;
    const prismaService = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;
    const redisService = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService;
    return {
      service: new AuthService(prismaService, redisService, configService),
      prisma: prismaService,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the fixed admin user when missing", async () => {
    const { service, prisma } = buildAdminService();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: "admin-1",
      username: "admin",
      guestId: "gid",
      role: Role.ADMIN,
    } as never);

    const result = await service.adminLogin("strong-admin-password");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: "admin" },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: "admin",
        role: Role.ADMIN,
      }),
    });
    expect(result.user.role).toBe(Role.ADMIN);
    expect(result.user.username).toBe("admin");
  });

  it("never promotes a non-admin user named admin", async () => {
    const { service, prisma } = buildAdminService();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-guest",
      username: "admin",
      guestId: "gid",
      role: Role.GUEST,
    } as never);

    await expect(service.adminLogin("strong-admin-password")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects wrong password", async () => {
    const { service, prisma } = buildAdminService();
    await expect(service.adminLogin("wrong")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects missing or short ADMIN_PASSWORD (< 12 chars)", async () => {
    const { service: serviceEmpty } = buildAdminService({ ADMIN_PASSWORD: "" });
    await expect(serviceEmpty.adminLogin("anything")).rejects.toThrow(
      UnauthorizedException,
    );

    const { service: serviceShort } = buildAdminService({
      ADMIN_PASSWORD: "short-pass",
    });
    await expect(serviceShort.adminLogin("short-pass")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("logs in successfully when admin user already exists without creating user", async () => {
    const { service, prisma } = buildAdminService();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "admin-existing",
      username: "admin",
      guestId: "gid",
      role: Role.ADMIN,
    } as never);

    const result = await service.adminLogin("strong-admin-password");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: "admin" },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.user.id).toBe("admin-existing");
    expect(result.user.role).toBe(Role.ADMIN);
    expect(result.user.username).toBe("admin");
  });

  it("contains all expected rejected admin passwords in the denylist", () => {
    for (const password of EXPECTED_REJECTED_ADMIN_PASSWORDS) {
      expect(isRejectedAdminPassword(password)).toBe(true);
    }
    expect(isRejectedAdminPassword("a-secure-custom-admin-password-1234")).toBe(
      false,
    );
  });

  it("rejects default password outside development/test", async () => {
    for (const password of EXPECTED_REJECTED_ADMIN_PASSWORDS) {
      const { service } = buildAdminService({
        NODE_ENV: "production",
        ADMIN_PASSWORD: password,
      });
      await expect(service.adminLogin(password)).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });
});

describe("AuthService.generateTokens", () => {
  it("issues a signed access token and stores the refresh token in Redis", async () => {
    const service = buildService("1h");
    const redis = (
      service as unknown as { redis: { set: ReturnType<typeof vi.fn> } }
    ).redis;

    const internal = (
      service as unknown as ServiceInternals
    ).generateTokens.bind(service) as ServiceInternals["generateTokens"];

    const result = await internal("u-1", "p1", Role.GUEST);

    expect(redis.set).toHaveBeenCalledTimes(1);
    const setCall = vi.mocked(redis.set).mock.calls[0];
    expect(setCall[0]).toMatch(/^refresh:/);
    expect(setCall[1]).toBe("u-1");
    expect(setCall[2]).toBe(604800);
    expect(result.user).toEqual({
      id: "u-1",
      username: "p1",
      role: Role.GUEST,
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const decoded = jwt.verify(result.accessToken, "test-secret") as {
      userId: string;
      username: string;
      role: Role;
    };
    expect(decoded).toMatchObject({
      userId: "u-1",
      username: "p1",
      role: Role.GUEST,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});
