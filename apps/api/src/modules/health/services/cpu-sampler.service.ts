// ============================================================
// CPU Sampler Service
// Owns the previous-usage baseline used to compute a delta CPU%
// across calls. Extracted from HealthController so the baseline
// lives on a dedicated provider instead of the singleton
// controller (where concurrent /health/monitoring requests could
// overwrite each other).
// ============================================================

import { Injectable } from "@nestjs/common";
import os from "os";

@Injectable()
export class CpuSamplerService {
  private previousCpuUsage: NodeJS.CpuUsage | null = null;
  private previousTime: number | null = null;

  /**
   * Record a new CPU sample and return the delta CPU usage as a
   * percentage of total cores. Returns null on the first call
   * (no baseline yet).
   */
  sample(): number | null {
    const currentCpuUsage = process.cpuUsage();
    let cpuUsage: number | null = null;

    if (this.previousCpuUsage !== null && this.previousTime !== null) {
      const deltaCpuMicros =
        currentCpuUsage.user +
        currentCpuUsage.system -
        (this.previousCpuUsage.user + this.previousCpuUsage.system);
      const elapsedMs = Date.now() - this.previousTime;
      const numCpus = os.cpus().length;

      if (elapsedMs > 0 && numCpus > 0) {
        cpuUsage = Math.min(
          100,
          (deltaCpuMicros / 1000 / (elapsedMs * numCpus)) * 100,
        );
      }
    }

    this.previousCpuUsage = currentCpuUsage;
    this.previousTime = Date.now();

    return cpuUsage;
  }
}
