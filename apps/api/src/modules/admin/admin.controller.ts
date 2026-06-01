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
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SyncQuestionsDto, syncQuestionsSchema } from "./dto/sync-questions.dto";

@ApiTags("Admin")
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("questions/sync")
  @ApiOperation({ summary: "Sync database questions with seed data" })
  @ApiResponse({ status: 201, description: "Questions successfully synced" })
  async syncQuestions(
    @Body(new ZodValidationPipe(syncQuestionsSchema)) dto: SyncQuestionsDto,
  ) {
    return this.adminService.syncQuestions(dto.clearExisting);
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
