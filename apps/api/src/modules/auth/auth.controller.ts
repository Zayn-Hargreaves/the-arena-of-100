// ============================================================
// Auth Controller - REST Endpoints
// ============================================================

import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { AuthService, AuthResult } from "./auth.service";
import { Public } from "../../common/decorators/public.decorator";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { GuestLoginDto, guestLoginSchema } from "./dto/guest-login.dto";
import { RefreshDto, refreshSchema } from "./dto/refresh.dto";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";

const guestLoginPipe = new ZodValidationPipe(guestLoginSchema);
const refreshPipe = new ZodValidationPipe(refreshSchema);

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
  ): Promise<AuthResult> {
    return this.authService.guestLogin(guestLoginDto.username);
  }

  @Post("refresh")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh access token" })
  @ApiResponse({ status: 200, description: "Token refreshed successfully" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async refresh(
    @Body(refreshPipe)
    refreshDto: RefreshDto,
  ): Promise<AuthResult> {
    return this.authService.refreshAccessToken(refreshDto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Logout player" })
  @ApiResponse({ status: 204, description: "Logout successful" })
  @ApiResponse({ status: 401, description: "Invalid token" })
  async logout(
    @Body(refreshPipe)
    refreshDto: RefreshDto,
  ): Promise<void> {
    await this.authService.logout(refreshDto.refreshToken);
  }
}
