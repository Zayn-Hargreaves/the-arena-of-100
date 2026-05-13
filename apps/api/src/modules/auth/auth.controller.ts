// ============================================================
// Auth Controller - REST Endpoints
// ============================================================

import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { AuthService, AuthResult } from "./auth.service";
import { z } from "zod";

const guestLoginSchema = z.object({
  username: z.string().min(3).max(20).trim(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("guest")
  @HttpCode(HttpStatus.OK)
  async guestLogin(@Body() body: unknown): Promise<AuthResult> {
    const { username } = guestLoginSchema.parse(body);
    return this.authService.guestLogin(username);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown): Promise<AuthResult> {
    const { refreshToken } = refreshSchema.parse(body);
    return this.authService.refreshAccessToken(refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: unknown): Promise<void> {
    const { refreshToken } = refreshSchema.parse(body);
    await this.authService.logout(refreshToken);
  }
}
