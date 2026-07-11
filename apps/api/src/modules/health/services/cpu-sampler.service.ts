// ============================================================
// CPU Sampler Service
// Owns the previous-usage baseline used to compute a delta CPU%
// across calls. Extracted from HealthController so the baseline
// lives on a dedicated provider instead of the singleton
// controller (where concurrent /health/monitoring requests could
// overwrite each other).
//
// Convention (Plan A k6 acceptance):
//   `cpu` is reported as a percentage of ONE core. A value of
//   `200` means two cores are fully utilised. The previous
//   implementation capped the result at `100` ("% of total
//   cores"), which made the load-test thresholds (≤ 80% peak,
//   ≤ 70% p95) effectively unobservable on multi-core hosts.
// ============================================================

import { Injectable } from "@nestjs/common";
import os from "os";

@Injectable()
export class CpuSamplerService {
  private previousCpuUsage: NodeJS.CpuUsage | null = null;
  private previousTime: number | null = null;

  /**
   * Record a new CPU sample and return the delta CPU usage as a
   * percentage of ONE core. Returns null on the first call
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
        // `% of 1 core`; cap at `100 * numCpus` so a 4-core host
        // can report up to 400% (= 4 fully loaded cores).
        cpuUsage = Math.min(
          100 * numCpus,
          (deltaCpuMicros / 1000 / elapsedMs) * 100,
        );
      }
    }

    this.previousCpuUsage = currentCpuUsage;
    this.previousTime = Date.now();

    return cpuUsage;
  }
}
