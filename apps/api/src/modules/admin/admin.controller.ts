// ============================================================
// Admin Controller - Secured Maintenance API Endpoints
// ============================================================

import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthenticatedRequest } from "../auth/auth.types";
import {
  SyncQuestionsDto,
  syncQuestionsSchema,
} from "./dto/sync-questions.dto";
import {
  TerminateRoomDto,
  terminateRoomSchema,
} from "./dto/terminate-room.dto";
import {
  GetAuditEventsDto,
  getAuditEventsSchema,
} from "./dto/get-audit-events.dto";

const getAuditEventsPipe = new ZodValidationPipe(getAuditEventsSchema);

@ApiTags("Admin")
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("questions/sync")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sync database questions with seed data" })
  @ApiResponse({ status: 200, description: "Questions successfully synced" })
  @ApiBody({ type: SyncQuestionsDto, required: false })
  async syncQuestions(
    @Req() req: AuthenticatedRequest,
    @Body() body?: SyncQuestionsDto,
  ) {
    // Body is optional: an empty POST should default clearExisting to true
    // rather than being rejected by the validation pipe.
    const parsed = syncQuestionsSchema.parse(body ?? {});
    return this.adminService.syncQuestions(
      parsed.clearExisting,
      req.user.userId,
    );
  }

  @Post("system/reset")
  @Throttle({ default: { limit: 2, ttl: 300000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset system state: clear all lobbies, matches, and Redis cache",
  })
  @ApiResponse({ status: 200, description: "System successfully reset" })
  async resetSystem(@Req() req: AuthenticatedRequest) {
    return this.adminService.resetSystem(req.user.userId);
  }

  @Post("rooms/:roomId/terminate")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Force-terminate a room and any active match (admin kill switch)",
  })
  @ApiParam({ name: "roomId", description: "Room ID to terminate" })
  @ApiBody({ type: TerminateRoomDto, required: false })
  @ApiResponse({ status: 200, description: "Room terminated" })
  @ApiResponse({ status: 404, description: "Room not found" })
  async terminateRoom(
    @Req() req: AuthenticatedRequest,
    @Param("roomId") roomId: string,
    @Body() body?: TerminateRoomDto,
  ) {
    // Body is optional: an empty POST should default message to undefined
    // rather than being rejected by the validation pipe.
    const parsed = terminateRoomSchema.parse(body ?? {});
    return this.adminService.terminateRoom(
      roomId,
      req.user.userId,
      parsed.message,
    );
  }

  @Get("audit-events")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Max rows to return (1-100)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    type: Number,
    description: "Rows to skip",
  })
  @ApiQuery({
    name: "roomId",
    required: false,
    type: String,
    description: "Filter by room ID",
  })
  @ApiQuery({
    name: "eventType",
    required: false,
    type: String,
    description: "Filter by event type",
  })
  @ApiQuery({
    name: "adminUserId",
    required: false,
    type: String,
    description: "Filter by admin user ID",
  })
  @ApiOperation({ summary: "Query admin audit events (paginated)" })
  @ApiResponse({ status: 200, description: "Audit events returned" })
  @ApiResponse({ status: 400, description: "Invalid query" })
  async getAuditEvents(@Query(getAuditEventsPipe) query: GetAuditEventsDto) {
    return this.adminService.getAuditEvents(query);
  }
}
