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
  type ClassStatsResponse,
  type UserSummary,
  ClassStatsResponseDto,
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

  // Class stats — class winrate + current daily streak + cards played
  // count. Distinct from /me/stats because it is class/card-system
  // specific (class system + card system + streak). Kept as its own
  // endpoint so the surface stays additive — existing /me/stats
  // consumers are not disturbed if class stats are unavailable for
  // any reason.
  @Get("me/class-stats")
  @ApiOperation({
    summary:
      "Class stats — class winrate (ATTACK/DEFENSE), current streak, cards played count",
  })
  @ApiResponse({
    status: 200,
    description: "Class stats returned",
    type: ClassStatsResponseDto,
  })
  @ApiResponse({ status: 401, description: "Unauthenticated" })
  @ApiResponse({ status: 404, description: "User not found" })
  async getMyClassStats(
    @Req() req: AuthenticatedRequest,
  ): Promise<ClassStatsResponse> {
    return this.usersService.getClassStats(req.user.userId);
  }
}
