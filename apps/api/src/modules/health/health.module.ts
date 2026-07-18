// ============================================================
// Health Module - System Health Check
// ============================================================

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { CpuSamplerService } from "./services/cpu-sampler.service";
import { EventLoopLagService } from "./services/event-loop-lag.service";
import { MatchModule } from "../match/match.module";

@Module({
  // B2b: MatchModule exports MatchOwnershipService, which HealthController
  // injects to report ownedMatches on /health/cluster.
  imports: [MatchModule],
  controllers: [HealthController],
  providers: [CpuSamplerService, EventLoopLagService],
  exports: [CpuSamplerService, EventLoopLagService],
})
export class HealthModule {}
