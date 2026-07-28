import { describe, it, expect } from "vitest";
import { parseK6Metrics } from "../scripts/validate-results.mjs";

describe("validate-results — parseK6Metrics", () => {
  it("parses direct metric fields correctly", () => {
    const metrics = {
      app_error_rate: { value: 0.005 },
      answer_result_latency_ms: { "p(95)": 150.5, "p(99)": 280.2 },
      ws_unexpected_disconnect: { count: 2 },
      ws_connect_success: { count: 100 },
    };

    const res = parseK6Metrics(metrics);
    expect(res.errorRate).toBe(0.005);
    expect(res.p95).toBe(150.5);
    expect(res.p99).toBe(280.2);
    expect(res.disconnectRate).toBe(0.02);
  });

  it("parses metrics nested under values correctly", () => {
    const metrics = {
      app_error_rate: { values: { rate: 0.004 } },
      answer_result_latency_ms: { values: { "p(95)": 201, "p(99)": 350 } },
      ws_unexpected_disconnect: { values: { count: 5 } },
      ws_connect_success: { values: { count: 500 } },
    };

    const res = parseK6Metrics(metrics);
    expect(res.errorRate).toBe(0.004);
    expect(res.p95).toBe(201);
    expect(res.p99).toBe(350);
    expect(res.disconnectRate).toBe(0.01);
  });

  it("retains zero values (count = 0, rate = 0, value = 0) without silent nulls or fallbacks", () => {
    const metrics = {
      app_error_rate: { value: 0 },
      answer_result_latency_ms: { "p(95)": 0, "p(99)": 0 },
      ws_unexpected_disconnect: { count: 0 },
      ws_connect_success: { count: 800 },
    };

    const res = parseK6Metrics(metrics);
    expect(res.errorRate).toBe(0);
    expect(res.p95).toBe(0);
    expect(res.p99).toBe(0);
    expect(res.disconnectRate).toBe(0);
  });

  it("returns null for missing metrics without throwing errors", () => {
    const res = parseK6Metrics({});
    expect(res.errorRate).toBeNull();
    expect(res.p95).toBeNull();
    expect(res.p99).toBeNull();
    expect(res.disconnectRate).toBeNull();
  });

  it("handles empty / undefined metrics object gracefully", () => {
    const res = parseK6Metrics(undefined);
    expect(res.errorRate).toBeNull();
    expect(res.p95).toBeNull();
    expect(res.p99).toBeNull();
    expect(res.disconnectRate).toBeNull();
  });

  it("returns Infinity when connect success is 0 but disconnect count > 0", () => {
    const metrics = {
      ws_unexpected_disconnect: { count: 3 },
      ws_connect_success: { count: 0 },
    };
    const res = parseK6Metrics(metrics);
    expect(res.disconnectRate).toBe(Infinity);
  });
});
