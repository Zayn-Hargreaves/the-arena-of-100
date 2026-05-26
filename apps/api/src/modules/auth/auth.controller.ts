// ============================================================
// Auth Controller - REST Endpoints
// ============================================================

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService, AuthResult } from "./auth.service";
import { Public } from "../../common/decorators/public.decorator";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { GuestLoginDto, guestLoginSchema } from "./dto/guest-login.dto";
import { RefreshDto, refreshSchema } from "./dto/refresh.dto";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getCookieValue,
  serializeCookie,
} from "../../common/utils/cookie";

const guestLoginPipe = new ZodValidationPipe(guestLoginSchema);
const refreshPipe = new ZodValidationPipe(refreshSchema);

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post("guest")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Guest login" })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async guestLogin(
    @Body(guestLoginPipe)
    guestLoginDto: GuestLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult["user"]> {
    const authResult = await this.authService.guestLogin(
      guestLoginDto.username,
    );

    reply.header("Set-Cookie", [
      serializeCookie(ACCESS_TOKEN_COOKIE, authResult.accessToken, {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: this.authService.getAccessTokenTtlSeconds(),
      }),
      serializeCookie(REFRESH_TOKEN_COOKIE, authResult.refreshToken, {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: this.authService.getRefreshTokenTtlSeconds(),
      }),
    ]);

    return authResult.user;
  }

  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh access token" })
  @ApiResponse({ status: 200, description: "Token refreshed successfully" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async refresh(
    @Req() request: FastifyRequest,
    @Body(refreshPipe)
    refreshDto: RefreshDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult["user"]> {
    const token =
      getCookieValue(request.headers.cookie, REFRESH_TOKEN_COOKIE) ??
      refreshDto.refreshToken;

    const authResult = await this.authService.refreshAccessToken(token);

    reply.header("Set-Cookie", [
      serializeCookie(ACCESS_TOKEN_COOKIE, authResult.accessToken, {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: this.authService.getAccessTokenTtlSeconds(),
      }),
      serializeCookie(REFRESH_TOKEN_COOKIE, authResult.refreshToken, {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: this.authService.getRefreshTokenTtlSeconds(),
      }),
    ]);

    return authResult.user;
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Logout player" })
  @ApiResponse({ status: 204, description: "Logout successful" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async logout(
    @Req() request: FastifyRequest,
    @Body(refreshPipe)
    refreshDto: RefreshDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token =
      getCookieValue(request.headers.cookie, REFRESH_TOKEN_COOKIE) ??
      refreshDto.refreshToken;

    await this.authService.logout(token);

    reply.header("Set-Cookie", [
      serializeCookie(ACCESS_TOKEN_COOKIE, "", {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      }),
      serializeCookie(REFRESH_TOKEN_COOKIE, "", {
        httpOnly: true,
        secure: this.configService.get("NODE_ENV") === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      }),
    ]);
  }
}
