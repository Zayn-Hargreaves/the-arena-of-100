// ============================================================
// Health Module - System Health Check
// ============================================================

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { CpuSamplerService } from "./services/cpu-sampler.service";

@Module({
  controllers: [HealthController],
  providers: [CpuSamplerService],
  exports: [CpuSamplerService],
})
export class HealthModule {}
