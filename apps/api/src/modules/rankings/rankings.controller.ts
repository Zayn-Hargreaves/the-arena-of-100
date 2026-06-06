// ============================================================
// Rankings Controller - Leaderboard endpoint
// ============================================================

import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { RankingsService } from "./rankings.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Public } from "../../common/decorators/public.decorator";
import {
  leaderboardQuerySchema,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from "./dto";

const leaderboardQueryPipe = new ZodValidationPipe(leaderboardQuerySchema);

const LEADERBOARD_THROTTLE_TTL_MS = 60_000; // 1 minute

@ApiTags("Rankings")
@Controller("rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get("leaderboard")
  @Public()
  @Throttle({ default: { limit: 30, ttl: LEADERBOARD_THROTTLE_TTL_MS } })
  @ApiOperation({
    summary: "Get top players (wins) — weekly or all-time, Redis-cached 60s",
  })
  @ApiResponse({ status: 200, description: "Leaderboard returned" })
  @ApiResponse({ status: 400, description: "Invalid query" })
  @ApiResponse({ status: 429, description: "Rate limit exceeded" })
  async getLeaderboard(
    @Query(leaderboardQueryPipe) query: LeaderboardQuery,
  ): Promise<LeaderboardResponse> {
    return this.rankingsService.getLeaderboard(query);
  }
}
