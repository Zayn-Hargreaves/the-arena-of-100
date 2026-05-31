// ============================================================
// Admin Controller - Secured Maintenance API Endpoints
// ============================================================

import { Controller, Post, Body } from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { Role } from "@prisma/client";

@ApiTags("Admin")
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("questions/sync")
  @ApiOperation({ summary: "Sync database questions with seed data" })
  @ApiResponse({ status: 201, description: "Questions successfully synced" })
  async syncQuestions(@Body() body: { clearExisting?: boolean }) {
    const clearExisting = body?.clearExisting ?? true;
    return this.adminService.syncQuestions(clearExisting);
  }

  @Post("system/reset")
  @ApiOperation({
    summary: "Reset system state: clear all lobbies, matches, and Redis cache",
  })
  @ApiResponse({ status: 201, description: "System successfully reset" })
  async resetSystem() {
    return this.adminService.resetSystem();
  }
}
