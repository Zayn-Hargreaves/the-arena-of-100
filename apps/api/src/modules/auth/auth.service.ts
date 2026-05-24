// ============================================================
// Auth Service - JWT Authentication
// ============================================================

import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import * as jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { Role } from "@prisma/client";

export interface TokenPayload {
  userId: string;
  username: string;
  role: Role;
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
    this.refreshExpiresIn = this.configService.get<number>(
      "REFRESH_EXPIRES_IN",
      604800,
    ); // 7 days
  }

  getAccessTokenTtlSeconds(): number {
    return this.parseDurationToSeconds(this.jwtExpiresIn, 86400);
  }

  getRefreshTokenTtlSeconds(): number {
    return this.refreshExpiresIn;
  }

  // Guest Login (no password, just username)
  async guestLogin(username: string): Promise<AuthResult> {
    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      // Prevent creation of "admin" user via guest login
      if (username === "admin") {
        throw new UnauthorizedException(
          "Cannot create admin user via guest login",
        );
      }

      user = await this.prisma.user.create({
        data: {
          username,
          guestId: nanoid(12),
          role: Role.GUEST, // Always create new users as GUEST
        },
      });
      this.logger.log(
        `New guest user created: ${username} with role ${user.role}`,
      );
    }
    // If user exists, preserve their existing role when logging in

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
      expiresIn: this.jwtExpiresIn,
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

  private parseDurationToSeconds(value: string, fallback: number): number {
    const normalized = value.trim().toLowerCase();

    const unitMatch = normalized.match(/^(\d+)([smhd])$/);
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const unit = unitMatch[2];

      if (unit === "s") return amount;
      if (unit === "m") return amount * 60;
      if (unit === "h") return amount * 60 * 60;
      if (unit === "d") return amount * 60 * 60 * 24;
    }

    const numericValue = Number(normalized);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }

    return fallback;
  }
}
