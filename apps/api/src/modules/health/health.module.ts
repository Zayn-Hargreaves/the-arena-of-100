// ============================================================
// Health Module - System Health Check
// ============================================================

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { CpuSamplerService } from "./services/cpu-sampler.service";
import { EventLoopLagService } from "./services/event-loop-lag.service";

@Module({
  controllers: [HealthController],
  providers: [CpuSamplerService, EventLoopLagService],
  exports: [CpuSamplerService, EventLoopLagService],
})
export class HealthModule {}
