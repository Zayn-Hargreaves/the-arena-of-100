// ============================================================
// Daily Challenge Module - Phase 1
// Depends on AuthModule for optional-token resolution on the
// public GET /daily/today route.
// ============================================================

import { Module } from "@nestjs/common";
import { DailyService } from "./daily.service";
import { DailyController } from "./daily.controller";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [DailyController],
  providers: [DailyService],
  exports: [DailyService],
})
export class DailyModule {}
