// ============================================================
// ClusterModule — node identity + cluster runtime view.
//
// @Global so ClusterService is injectable from the gateway (to wire the
// socket server) and the health controller (to expose /health/cluster)
// without import churn. RedisService comes from the @Global RedisModule.
// ============================================================

import { Global, Module } from "@nestjs/common";
import { ClusterService } from "./cluster.service";

@Global()
@Module({
  providers: [ClusterService],
  exports: [ClusterService],
})
export class ClusterModule {}
