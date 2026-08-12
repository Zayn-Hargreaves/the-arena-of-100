// ============================================================
// Users Controller - Profile endpoints
// ============================================================

import {
  Controller,
  Get,
  Patch,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  historyQuerySchema,
  type HistoryQuery,
  updateAvatarSchema,
  type UpdateAvatarInput,
  type HistoryResponse,
  type StatsResponse,
  type Phase3StatsResponse,
  type UserSummary,
} from "./dto";
import { AuthenticatedRequest } from "../auth/auth.types";

const historyQueryPipe = new ZodValidationPipe(historyQuerySchema);
const updateAvatarPipe = new ZodValidationPipe(updateAvatarSchema);

@ApiTags("Users")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me/stats")
  @ApiOperation({ summary: "Get the current user's profile stats" })
  @ApiResponse({ status: 200, description: "Profile stats returned" })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async getMyStats(@Req() req: AuthenticatedRequest): Promise<StatsResponse> {
    return this.usersService.getMyStats(req.user.userId);
  }

  @Get("me/history")
  @ApiOperation({ summary: "Get the current user's match history (paginated)" })
  @ApiResponse({ status: 200, description: "History returned" })
  @ApiResponse({ status: 400, description: "Invalid query" })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  async getMyHistory(
    @Req() req: AuthenticatedRequest,
    @Query(historyQueryPipe) query: HistoryQuery,
  ): Promise<HistoryResponse> {
    return this.usersService.getMyHistory(req.user.userId, query);
  }

  @Patch("me/avatar")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update the current user's avatar seed" })
  @ApiResponse({ status: 200, description: "Avatar updated" })
  @ApiResponse({ status: 400, description: "Invalid avatar seed" })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  async updateMyAvatar(
    @Req() req: AuthenticatedRequest,
    @Body(updateAvatarPipe) body: UpdateAvatarInput,
  ): Promise<UserSummary> {
    return this.usersService.updateMyAvatar(req.user.userId, body.avatar);
  }

  // Phase 3 — class winrate + current daily streak + sabotage count.
  // Distinct from /me/stats because it is Phase 3 specific (class
  // system + card system + streak). Kept as its own endpoint so the
  // surface stays additive — existing /me/stats consumers are not
  // disturbed if Phase 3 stats are unavailable for any reason.
  @Get("me/phase3-stats")
  @ApiOperation({
    summary:
      "Phase 3 — class winrate (CONG/THU), current streak, sabotage count",
  })
  @ApiResponse({ status: 200, description: "Phase 3 stats returned" })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async getMyPhase3Stats(
    @Req() req: AuthenticatedRequest,
  ): Promise<Phase3StatsResponse> {
    return this.usersService.getPhase3Stats(req.user.userId);
  }
}
