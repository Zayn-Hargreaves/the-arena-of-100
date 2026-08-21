// ============================================================
// Auth Service - JWT Authentication
// ============================================================

import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DEFAULT_AVATAR_SEED,
  ErrorCode,
  isValidAvatarSeed,
} from "@arena/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import * as jwt from "jsonwebtoken";
import ms from "ms";
import { nanoid } from "nanoid";
import { Prisma, Role } from "@prisma/client";
import { sanitizeNickname, baseNormalize } from "../../common/moderation";
import crypto from "crypto";
import { invalidateLeaderboardCache } from "../rankings/leaderboard-cache.helper";

const FIXED_ADMIN_USERNAME = "admin";

const REJECTED_ADMIN_PASSWORDS = new Set([
  "arena100admin",
  "change-me-admin-password",
]);

function constantTimeCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export interface TokenPayload {
  userId: string;
  username: string;
  role: Role;
}

const RESERVED_USERNAMES = ["admin"];

/**
 * `typ` markers separating the two token families. Both are signed with the
 * same secret, so without an explicit type an access token could be replayed
 * as a Daily session token (granting a free speed bonus) and a session token
 * could be replayed as an access token (granting API access).
 */
export const ACCESS_TOKEN_TYP = "access";
export const DAILY_SESSION_TYP = "daily-session";

/** Session-token lifetime. Generous: the Daily Challenge is not a race. */
export const DAILY_SESSION_TTL_SECONDS = 30 * 60;

function normalizeReservedUsername(value: string): string {
  return baseNormalize(value);
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  guestSecret?: string;
  user: {
    id: string;
    username: string;
    role: Role;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshExpiresIn: number; // seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.jwtSecret = this.configService.get<string>(
      "JWT_SECRET",
      "arena-100-secret-key",
    );
    this.jwtExpiresIn = this.configService.get<string>("JWT_EXPIRES_IN", "24h");
    this.accessTokenTtlSeconds = this.parseExpiresInToSeconds(
      this.jwtExpiresIn,
    );
    this.refreshExpiresIn = this.configService.get<number>(
      "REFRESH_EXPIRES_IN",
      604800,
    ); // 7 days
  }

  // Guest Login (no password, username + optional persistent guest secret + optional avatar)
  async guestLogin(
    username: string,
    guestSecret?: string,
    avatar?: string,
  ): Promise<AuthResult> {
    const safeUsername = sanitizeNickname(username);
    if (safeUsername === null) {
      throw new UnauthorizedException("Invalid guest username");
    }
    if (RESERVED_USERNAMES.includes(normalizeReservedUsername(safeUsername))) {
      throw new UnauthorizedException("Cannot use reserved username");
    }

    let user = await this.prisma.user.findUnique({
      where: { username: safeUsername },
    });

    let isNewUser = false;

    if (!user) {
      // Always server-generate guest secrets — never accept client-chosen values.
      const assignedGuestSecret = nanoid(24);
      const chosenAvatar =
        avatar && isValidAvatarSeed(avatar) ? avatar : DEFAULT_AVATAR_SEED;

      try {
        user = await this.prisma.user.create({
          data: {
            username: safeUsername,
            guestId: assignedGuestSecret,
            avatar: chosenAvatar,
            role: Role.GUEST, // Always create new users as GUEST
          },
        });
        isNewUser = true;
        this.logger.log(
          `New guest user created: ${safeUsername} with role ${user.role}`,
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          user = await this.prisma.user.findUnique({
            where: { username: safeUsername },
          });
          isNewUser = false;
        } else {
          throw error;
        }
      }
    }

    if (!user || user.role !== Role.GUEST) {
      throw new UnauthorizedException("Cannot use reserved username");
    }

    if (!isNewUser) {
      // Existing user: require matching guest secret. Legacy rows without
      // guestId cannot be claimed (would allow account takeover).
      if (!user.guestId) {
        throw new UnauthorizedException({
          code: ErrorCode.USERNAME_TAKEN,
          message: ErrorCode.USERNAME_TAKEN,
        });
      }
      const trimmedSecret = guestSecret?.trim();
      if (!trimmedSecret || user.guestId !== trimmedSecret) {
        throw new UnauthorizedException({
          code: ErrorCode.USERNAME_TAKEN,
          message: ErrorCode.USERNAME_TAKEN,
        });
      }

      if (avatar && isValidAvatarSeed(avatar) && user.avatar !== avatar) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { avatar },
        });
        await this.invalidateLeaderboardCache();
      }
    }

    const tokens = await this.generateTokens(user.id, user.username, user.role);
    return {
      ...tokens,
      guestSecret: user.guestId ?? undefined,
    };
  }

  private async invalidateLeaderboardCache(): Promise<void> {
    await invalidateLeaderboardCache(this.redis, this.logger);
  }

  // Admin Login — fixed identity "admin" only; never promote arbitrary users.
  async adminLogin(password: string): Promise<AuthResult> {
    const adminPassword = this.configService.get<string>("ADMIN_PASSWORD");
    const nodeEnv = this.configService.get<string>("NODE_ENV", "development");

    if (!adminPassword || adminPassword.length < 12) {
      this.logger.error(
        "ADMIN_PASSWORD is missing or shorter than 12 characters",
      );
      throw new UnauthorizedException("Invalid admin credentials");
    }

    // Reject well-known defaults outside local development.
    if (
      nodeEnv !== "development" &&
      nodeEnv !== "test" &&
      REJECTED_ADMIN_PASSWORDS.has(adminPassword)
    ) {
      this.logger.error("ADMIN_PASSWORD must not use the default value");
      throw new UnauthorizedException("Invalid admin credentials");
    }

    if (!password || !constantTimeCompare(password, adminPassword)) {
      throw new UnauthorizedException("Invalid admin credentials");
    }

    let adminUser = await this.prisma.user.findUnique({
      where: { username: FIXED_ADMIN_USERNAME },
    });

    if (!adminUser) {
      try {
        adminUser = await this.prisma.user.create({
          data: {
            username: FIXED_ADMIN_USERNAME,
            guestId: nanoid(12),
            role: Role.ADMIN,
          },
        });
        this.logger.log(`Created admin user: ${FIXED_ADMIN_USERNAME}`);
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          adminUser = await this.prisma.user.findUnique({
            where: { username: FIXED_ADMIN_USERNAME },
          });
        } else {
          throw error;
        }
      }
    }

    if (!adminUser || adminUser.role !== Role.ADMIN) {
      // Never promote a non-admin account that happens to be named "admin".
      throw new UnauthorizedException("Invalid admin credentials");
    }

    return this.generateTokens(
      adminUser.id,
      adminUser.username,
      adminUser.role,
    );
  }

  // Generate JWT tokens
  private async generateTokens(
    userId: string,
    username: string,
    role: Role,
  ): Promise<AuthResult> {
    const payload: TokenPayload = { userId, username, role };

    const accessToken = jwt.sign(
      { ...payload, typ: ACCESS_TOKEN_TYP },
      this.jwtSecret,
      {
        expiresIn: this.accessTokenTtlSeconds,
      } as jwt.SignOptions,
    );

    const refreshToken = nanoid(64);

    // Store refresh token in Redis
    await this.redis.set(
      `refresh:${refreshToken}`,
      userId,
      this.refreshExpiresIn,
    );

    return {
      accessToken,
      refreshToken,
      user: { id: userId, username, role },
    };
  }

  /**
   * Verifies an access token.
   *
   * Rejects any token carrying a foreign `typ` (notably a Daily session
   * token), but deliberately ACCEPTS a token with no `typ` at all: access
   * tokens live for 24h, so refusing untyped ones would sign out every
   * session already in flight when this deploys and break live socket
   * handshakes. The marker can be made mandatory once one full token TTL has
   * elapsed since rollout.
   */
  verifyToken(token: string): TokenPayload {
    let decoded: TokenPayload & { typ?: string };

    try {
      decoded = jwt.verify(token, this.jwtSecret) as TokenPayload & {
        typ?: string;
      };
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    if (decoded?.typ !== undefined && decoded.typ !== ACCESS_TOKEN_TYP) {
      throw new UnauthorizedException("Not an access token");
    }

    // A token that verifies but carries no identity is unusable downstream:
    // callers read `.userId` straight off it. Two of the three call sites do
    // not re-check, so the guarantee belongs here.
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      typeof decoded?.username !== "string"
    ) {
      throw new UnauthorizedException("Invalid token payload");
    }

    return decoded;
  }

  /**
   * Signs a Daily Challenge session token.
   *
   * `startedAtMs` is the authoritative session start, pinned by the caller so
   * it survives token reissuance — re-fetching the questions mints a new token
   * but must NOT reset the clock, or the speed bonus would be free. `iat` is
   * deliberately not used for timing for exactly that reason.
   */
  signDailySession(claims: {
    sub: string;
    dateKey: string;
    dailyQuestionId: string;
    startedAtMs: number | null;
  }): string {
    return jwt.sign({ ...claims, typ: DAILY_SESSION_TYP }, this.jwtSecret, {
      expiresIn: DAILY_SESSION_TTL_SECONDS,
    });
  }

  /** Verifies a Daily session token and rejects tokens of any other type. */
  verifyDailySession(token: string): {
    sub: string;
    dateKey: string;
    dailyQuestionId: string;
    startedAtMs: number | null;
    iat: number;
  } {
    let decoded: {
      typ?: string;
      sub?: string;
      dateKey?: string;
      dailyQuestionId?: string;
      startedAtMs?: number | null;
      iat?: number;
    };

    // Normalised exactly as verifyToken does: jwt throws JsonWebTokenError /
    // TokenExpiredError, which would otherwise escape as a raw library error
    // while every other failure below leaves here as UnauthorizedException.
    try {
      decoded = jwt.verify(token, this.jwtSecret) as typeof decoded;
    } catch {
      throw new UnauthorizedException("Invalid or expired daily session token");
    }

    if (decoded?.typ !== DAILY_SESSION_TYP) {
      throw new UnauthorizedException("Not a daily session token");
    }

    // `startedAtMs` is what the speed bonus is measured from. A missing or
    // non-numeric claim would survive the cast below and be read downstream as
    // if it were a real pin, so it is rejected here rather than trusted.
    // Explicit `null` stays legal: that is how an unpinnable session (anonymous
    // fetch, or the session store being down) forfeits the bonus.
    if (
      decoded.startedAtMs !== null &&
      !Number.isFinite(decoded.startedAtMs as number)
    ) {
      throw new UnauthorizedException("Invalid daily session payload");
    }

    return decoded as {
      sub: string;
      dateKey: string;
      dailyQuestionId: string;
      startedAtMs: number | null;
      iat: number;
    };
  }

  // Refresh token
  async refreshAccessToken(refreshToken: string): Promise<AuthResult> {
    const userId = await this.redis.get(`refresh:${refreshToken}`);

    if (!userId) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    // Delete old refresh token
    await this.redis.del(`refresh:${refreshToken}`);

    return this.generateTokens(user.id, user.username, user.role);
  }

  // Logout
  async logout(refreshToken: string): Promise<void> {
    await this.redis.del(`refresh:${refreshToken}`);
  }

  getRefreshTokenTtlSeconds(): number {
    return this.refreshExpiresIn;
  }

  getAccessTokenTtlSeconds(): number {
    return this.accessTokenTtlSeconds;
  }

  private parseExpiresInToSeconds(value: string): number {
    const trimmed = value.trim();

    // Handle pure numbers as seconds (backward compatibility)
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }

    // Use ms package to parse the time duration. ms throws on empty strings
    // and may return undefined for unrecognized formats.
    let milliseconds: number | string | undefined;
    try {
      milliseconds = ms(trimmed as ms.StringValue);
    } catch {
      return 24 * 60 * 60;
    }

    // Convert milliseconds to seconds and ensure it's a finite positive number
    if (
      typeof milliseconds === "number" &&
      Number.isFinite(milliseconds) &&
      milliseconds > 0
    ) {
      return Math.max(1, Math.ceil(milliseconds / 1000));
    }

    // Fallback to 24 hours (24 * 60 * 60 seconds) on invalid input
    return 24 * 60 * 60;
  }
}
