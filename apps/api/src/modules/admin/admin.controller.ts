// ============================================================
// Admin Controller - Secured Maintenance API Endpoints
// ============================================================

import {
  Controller,
  Post,
  Body,
  Param,
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
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import {
  SyncQuestionsDto,
  syncQuestionsSchema,
} from "./dto/sync-questions.dto";
import {
  TerminateRoomDto,
  terminateRoomSchema,
} from "./dto/terminate-room.dto";

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
  async syncQuestions(@Body() body?: SyncQuestionsDto) {
    // Body is optional: an empty POST should default clearExisting to true
    // rather than being rejected by the validation pipe.
    const parsed = syncQuestionsSchema.parse(body ?? {});
    return this.adminService.syncQuestions(parsed.clearExisting);
  }

  @Post("system/reset")
  @Throttle({ default: { limit: 2, ttl: 300000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset system state: clear all lobbies, matches, and Redis cache",
  })
  @ApiResponse({ status: 200, description: "System successfully reset" })
  async resetSystem() {
    return this.adminService.resetSystem();
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
    @Param("roomId") roomId: string,
    @Body() body?: TerminateRoomDto,
  ) {
    // Body is optional: an empty POST should default message to undefined
    // rather than being rejected by the validation pipe.
    const parsed = terminateRoomSchema.parse(body ?? {});
    return this.adminService.terminateRoom(roomId, parsed.message);
  }
}
