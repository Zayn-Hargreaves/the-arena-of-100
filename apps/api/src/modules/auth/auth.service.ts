// ============================================================
// Auth Service - JWT Authentication
// ============================================================

import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import * as jwt from "jsonwebtoken";
import ms from "ms";
import { nanoid } from "nanoid";
import { Prisma, Role } from "@prisma/client";
import { sanitizeNickname, baseNormalize } from "../../common/moderation";

export interface TokenPayload {
  userId: string;
  username: string;
  role: Role;
}

const RESERVED_USERNAMES = ["admin"];

function normalizeReservedUsername(value: string): string {
  return baseNormalize(value);
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
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

  // Guest Login (no password, just username)
  async guestLogin(username: string): Promise<AuthResult> {
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

    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            username: safeUsername,
            guestId: nanoid(12),
            role: Role.GUEST, // Always create new users as GUEST
          },
        });
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
        } else {
          throw error;
        }
      }
    }

    if (!user || user.role !== Role.GUEST) {
      throw new UnauthorizedException("Cannot use reserved username");
    }

    return this.generateTokens(user.id, user.username, user.role);
  }

  // Generate JWT tokens
  private async generateTokens(
    userId: string,
    username: string,
    role: Role,
  ): Promise<AuthResult> {
    const payload: TokenPayload = { userId, username, role };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.accessTokenTtlSeconds,
    } as jwt.SignOptions);

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

  // Verify JWT token
  verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as TokenPayload;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
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
