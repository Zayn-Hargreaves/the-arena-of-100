// ============================================================
// Event Loop Lag Service
//
// Wraps Node's perf_hooks.monitorEventLoopDelay — a real histogram of
// how long the event loop's timer fires late, sampled continuously
// in the background (not just at request time). `sample()` reads
// max/mean since the last call and resets the histogram, mirroring
// CpuSamplerService's delta-per-call convention.
//
// Built for the multi-room load-test investigation: CPU% alone can't
// tell you whether a single-threaded Node process is actually
// stalling requests, only that it's busy. This measures the stall
// directly.
// ============================================================

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export interface EventLoopLagSample {
  maxMs: number;
  meanMs: number;
  p99Ms: number;
}

@Injectable()
export class EventLoopLagService implements OnModuleInit, OnModuleDestroy {
  private histogram: IntervalHistogram | null = null;

  onModuleInit() {
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
  }

  onModuleDestroy() {
    this.histogram?.disable();
  }

  sample(): EventLoopLagSample | null {
    if (!this.histogram) return null;

    // After startup or reset, the histogram has no observations yet —
    // mean is NaN/null and max/p99 are 0, which would look like a real
    // "zero lag" sample. Report null until at least one delay is recorded.
    if (this.histogram.count === 0) return null;

    const toMs = (ns: number) => ns / 1e6;
    const result: EventLoopLagSample = {
      maxMs: toMs(this.histogram.max),
      meanMs: toMs(this.histogram.mean),
      p99Ms: toMs(this.histogram.percentile(99)),
    };

    this.histogram.reset();
    return result;
  }
}
