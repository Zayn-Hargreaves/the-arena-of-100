// ============================================================
// EventLoopLagService unit tests
//
// `monitorEventLoopDelay` is a native Node.js API that cannot be
// meaningfully controlled in unit tests.  We test the service's
// behaviour by replacing the private `histogram` property with a
// controlled stub after construction, mirroring the same pattern
// used for other native-backed services in this codebase
// (e.g. CpuSamplerService tests stub `process.cpuUsage`).
//
// Strategy:
//   - onModuleInit: call it, then assert the histogram is
//     non-null and `.enable()` was invoked.
//   - onModuleDestroy: replace histogram with stub that has
//     a `disable` spy; assert it is called.
//   - sample() paths: set `count` and data on the stub to
//     exercise every branch without spinning real timers.
// ============================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import { EventLoopLagService } from "./event-loop-lag.service";
import { monitorEventLoopDelay } from "node:perf_hooks";

vi.mock("node:perf_hooks", () => {
  return {
    monitorEventLoopDelay: vi.fn(),
  };
});

// Minimal IntervalHistogram stub — only the fields/methods
// exercised by EventLoopLagService.
function makeHistogramStub({
  count = 0,
  max = 0,
  mean = 0,
  p99 = 0,
}: {
  count?: number;
  max?: number;
  mean?: number;
  p99?: number;
} = {}) {
  return {
    count,
    max,
    mean,
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
    percentile: vi.fn().mockReturnValue(p99),
  };
}

describe("EventLoopLagService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("onModuleInit", () => {
    it("creates a histogram and enables it", () => {
      const enableSpy = vi.fn();
      const disableSpy = vi.fn();
      const mockHistogram = {
        enable: enableSpy,
        disable: disableSpy,
      };
      vi.mocked(monitorEventLoopDelay).mockReturnValue(mockHistogram as any);

      const svc = new EventLoopLagService();

      // histogram must be null before init
      expect((svc as any).histogram).toBeNull();

      svc.onModuleInit();

      // After init the private histogram is non-null
      const hist = (svc as any).histogram;
      expect(hist).not.toBeNull();
      expect(hist).toBe(mockHistogram);
      expect(monitorEventLoopDelay).toHaveBeenCalledWith({ resolution: 10 });
      expect(enableSpy).toHaveBeenCalledTimes(1);

      // Clean up so Node stops the background sampler.
      svc.onModuleDestroy();
      expect(disableSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("onModuleDestroy", () => {
    it("disables the histogram when one has been started", () => {
      const stub = makeHistogramStub();
      const svc = new EventLoopLagService();
      (svc as any).histogram = stub;

      svc.onModuleDestroy();

      expect(stub.disable).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when onModuleInit was never called (histogram is null)", () => {
      const svc = new EventLoopLagService();
      // histogram is already null — must not throw
      expect(() => svc.onModuleDestroy()).not.toThrow();
    });
  });

  describe("sample()", () => {
    it("returns null before onModuleInit (histogram is null)", () => {
      const svc = new EventLoopLagService();
      expect(svc.sample()).toBeNull();
    });

    it("returns null when histogram has no observations yet (count === 0)", () => {
      const svc = new EventLoopLagService();
      (svc as any).histogram = makeHistogramStub({ count: 0 });

      expect(svc.sample()).toBeNull();
    });

    it("returns maxMs/meanMs/p99Ms and calls reset() when count > 0", () => {
      const svc = new EventLoopLagService();
      const stub = makeHistogramStub({
        count: 5,
        max: 10_000_000, // 10 ms in nanoseconds
        mean: 2_500_000, // 2.5 ms
        p99: 9_000_000, // 9 ms
      });
      (svc as any).histogram = stub;

      const result = svc.sample();

      expect(result).not.toBeNull();
      expect(result!.maxMs).toBeCloseTo(10);
      expect(result!.meanMs).toBeCloseTo(2.5);
      expect(result!.p99Ms).toBeCloseTo(9);
      // reset() must be called so the next sample is a fresh delta
      expect(stub.reset).toHaveBeenCalledTimes(1);
    });

    it("converts nanosecond values to milliseconds correctly (toMs = ns / 1e6)", () => {
      const svc = new EventLoopLagService();
      // 1_000_000 ns == 1 ms
      const stub = makeHistogramStub({
        count: 1,
        max: 1_000_000,
        mean: 1_000_000,
        p99: 1_000_000,
      });
      (svc as any).histogram = stub;

      const result = svc.sample()!;
      expect(result.maxMs).toBe(1);
      expect(result.meanMs).toBe(1);
      expect(result.p99Ms).toBe(1);
    });

    it("returns null on the second call after reset clears the histogram (count back to 0)", () => {
      const svc = new EventLoopLagService();
      // First call: count > 0 → returns a sample and calls reset()
      const stub = makeHistogramStub({
        count: 3,
        max: 5_000_000,
        mean: 1_000_000,
        p99: 4_500_000,
      });
      (svc as any).histogram = stub;

      const first = svc.sample();
      expect(first).not.toBeNull();
      expect(stub.reset).toHaveBeenCalledTimes(1);

      // Simulate the histogram being reset: count drops back to 0
      stub.count = 0;

      const second = svc.sample();
      expect(second).toBeNull();
    });
  });
});
