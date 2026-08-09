// ============================================================
// Daily Challenge Controller - Phase 1 REST surface
//
//   GET  /daily/today       public, optional auth (personalises `alreadyAttempted`)
//   POST /daily/submit      authenticated, one attempt per UTC day
//   GET  /daily/leaderboard public, Redis-cached 60s
// ============================================================

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import { DailyService } from "./daily.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "../auth/auth.service";
import { ACCESS_TOKEN_COOKIE, getCookieValue } from "../auth/auth-cookie";
import type { AuthenticatedRequest } from "../auth/auth.types";
import {
  dailyLeaderboardQuerySchema,
  dailySubmitSchema,
  type DailyLeaderboardQuery,
  type DailyLeaderboardResponse,
  type DailySubmitInput,
  type DailySubmitResponse,
  type DailyTodayResponse,
} from "./dto";

const submitPipe = new ZodValidationPipe(dailySubmitSchema);
const leaderboardQueryPipe = new ZodValidationPipe(dailyLeaderboardQuerySchema);

const ONE_MINUTE_MS = 60_000;

@ApiTags("Daily")
@Controller("daily")
export class DailyController {
  constructor(
    private readonly dailyService: DailyService,
    private readonly authService: AuthService,
  ) {}

  @Get("today")
  @Public()
  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE_MS } })
  @ApiOperation({
    summary:
      "Get today's daily challenge (5 questions, correct answers stripped)",
  })
  @ApiResponse({ status: 200, description: "Today's challenge returned" })
  @ApiResponse({
    status: 404,
    description: "No challenge configured for today",
  })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async getToday(@Req() request: FastifyRequest): Promise<DailyTodayResponse> {
    // Public route: the guard never populates `request.user`, so the token is
    // resolved here by hand. A missing or invalid token is not an error — it
    // just means `alreadyAttempted` cannot be personalised.
    return this.dailyService.getToday(this.resolveOptionalUserId(request));
  }

  @Post("submit")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE_MS } })
  @ApiOperation({
    summary: "Submit today's answers (one attempt per UTC day)",
  })
  @ApiResponse({ status: 200, description: "Attempt graded and stored" })
  @ApiResponse({ status: 400, description: "Invalid payload" })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  @ApiResponse({
    status: 404,
    description: "No challenge configured for today",
  })
  @ApiResponse({ status: 409, description: "Already submitted today" })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Body(submitPipe) body: DailySubmitInput,
  ): Promise<DailySubmitResponse> {
    return this.dailyService.submit(request.user.userId, body);
  }

  @Get("leaderboard")
  @Public()
  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE_MS } })
  @ApiOperation({
    summary: "Top daily-challenge scores for a day — Redis-cached 60s",
  })
  @ApiResponse({ status: 200, description: "Leaderboard returned" })
  @ApiResponse({ status: 400, description: "Invalid query" })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async getLeaderboard(
    @Query(leaderboardQueryPipe) query: DailyLeaderboardQuery,
  ): Promise<DailyLeaderboardResponse> {
    return this.dailyService.getLeaderboard(query);
  }

  /**
   * Best-effort identity for public routes. Returns `undefined` for anonymous
   * callers and for malformed/expired tokens alike — the endpoint stays
   * readable either way, so a bad token must never turn into a 401 here.
   */
  private resolveOptionalUserId(request: FastifyRequest): string | undefined {
    const authHeader = request.headers.authorization;
    const headerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : undefined;
    const cookieToken = getCookieValue(
      request.headers.cookie,
      ACCESS_TOKEN_COOKIE,
    );
    const token = headerToken ?? cookieToken;

    if (!token) return undefined;

    try {
      return this.authService.verifyToken(token)?.userId;
    } catch {
      return undefined;
    }
  }
}
