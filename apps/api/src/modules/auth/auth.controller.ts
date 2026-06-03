// ============================================================
// Auth Controller - REST Endpoints
// ============================================================

import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService, AuthResult } from "./auth.service";
import { Public } from "../../common/decorators/public.decorator";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { GuestLoginDto, guestLoginSchema } from "./dto/guest-login.dto";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { FastifyReply, FastifyRequest } from "fastify";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  CSRF_TOKEN_COOKIE,
  clearCookie,
  getCookieValue,
  resolveAccessTokenCookieMaxAge,
  serializeCookie,
  shouldUseSecureCookies,
  shouldUseCrossSiteCookies,
  getSameSiteSetting,
  generateCsrfToken,
} from "./auth-cookie";

const guestLoginPipe = new ZodValidationPipe(guestLoginSchema);

type AuthResponse = Omit<AuthResult, "refreshToken">;

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  ): Promise<AuthResponse> {
    const authResult = await this.authService.guestLogin(
      guestLoginDto.username,
    );
    this.writeAuthCookies(
      reply,
      authResult.accessToken,
      authResult.refreshToken,
    );

    return {
      accessToken: authResult.accessToken,
      user: authResult.user,
    };
  }

  @Get("csrf-token")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get CSRF token" })
  @ApiResponse({ status: 200, description: "CSRF token returned" })
  async getCsrfToken(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ csrfToken: string }> {
    const token = generateCsrfToken();
    const secure =
      shouldUseSecureCookies(process.env.NODE_ENV) ||
      shouldUseCrossSiteCookies();

    reply.header(
      "Set-Cookie",
      serializeCookie(CSRF_TOKEN_COOKIE, token, {
        httpOnly: false,
        secure,
        sameSite: getSameSiteSetting(),
        path: "/",
        maxAge: 24 * 60 * 60,
      }),
    );

    return { csrfToken: token };
  }

  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh access token" })
  @ApiResponse({ status: 200, description: "Token refreshed successfully" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const refreshToken = getCookieValue(
      request.headers.cookie,
      REFRESH_TOKEN_COOKIE,
    );

    if (!refreshToken) {
      throw new UnauthorizedException("Refresh token is required");
    }

    const authResult = await this.authService.refreshAccessToken(refreshToken);
    this.writeAuthCookies(
      reply,
      authResult.accessToken,
      authResult.refreshToken,
    );

    return {
      accessToken: authResult.accessToken,
      user: authResult.user,
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Logout player" })
  @ApiResponse({ status: 204, description: "Logout successful" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const refreshToken = getCookieValue(
      request.headers.cookie,
      REFRESH_TOKEN_COOKIE,
    );

    if (!refreshToken) {
      // Make logout idempotent - if no refresh token, still clear cookies and return success
      this.clearAuthCookies(reply);
      return;
    }

    await this.authService.logout(refreshToken);
    this.clearAuthCookies(reply);
  }

  private writeAuthCookies(
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string,
  ) {
    const secure =
      shouldUseSecureCookies(process.env.NODE_ENV) ||
      shouldUseCrossSiteCookies();
    const sameSite = getSameSiteSetting();
    const accessMaxAge = resolveAccessTokenCookieMaxAge(
      this.authService.getAccessTokenTtlSeconds(),
    );
    const refreshMaxAge = this.authService.getRefreshTokenTtlSeconds();
    const csrfToken = generateCsrfToken();

    reply.header("Set-Cookie", [
      serializeCookie(ACCESS_TOKEN_COOKIE, accessToken, {
        httpOnly: true,
        secure,
        sameSite,
        path: "/",
        maxAge: accessMaxAge,
      }),
      serializeCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
        httpOnly: true,
        secure,
        sameSite,
        path: "/",
        maxAge: refreshMaxAge,
      }),
      serializeCookie(CSRF_TOKEN_COOKIE, csrfToken, {
        httpOnly: false,
        secure,
        sameSite: getSameSiteSetting(),
        path: "/",
        maxAge: Math.min(accessMaxAge, 24 * 60 * 60),
      }),
    ]);
  }

  private clearAuthCookies(reply: FastifyReply) {
    const secure =
      shouldUseSecureCookies(process.env.NODE_ENV) ||
      shouldUseCrossSiteCookies();
    reply.header("Set-Cookie", [
      clearCookie(ACCESS_TOKEN_COOKIE, secure),
      clearCookie(REFRESH_TOKEN_COOKIE, secure),
      clearCookie(CSRF_TOKEN_COOKIE, secure),
    ]);
  }
}
