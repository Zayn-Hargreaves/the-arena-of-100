"use client";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDailyCountdown } from "./use-daily-countdown";

describe("useDailyCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin fake clock to a known moment so server-vs-client drift tests
    // are reproducible.
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders HH:MM:SS toward the server-supplied reset moment", () => {
    const target = new Date(
      new Date("2026-08-09T12:00:00.000Z").getTime() + 3661 * 1000,
    ).toISOString();

    const { result } = renderHook(() =>
      useDailyCountdown(target, "2026-08-09T12:00:00.000Z", 1000),
    );

    expect(result.current.display).toBe("01:01:01");
    expect(result.current.isExpired).toBe(false);
  });

  it("clamps to 0 once the deadline has passed", () => {
    const target = new Date(
      new Date("2026-08-09T12:00:00.000Z").getTime() + 1000,
    ).toISOString();

    const { result } = renderHook(() =>
      useDailyCountdown(target, "2026-08-09T12:00:00.000Z", 1000),
    );

    // Cross the deadline and let the interval fire; advanceTimersByTime
    // must run inside act() so React state updates flush before assertions.
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.display).toBe("00:00:00");
  });

  it("compensates for a client clock that is fast by 10 minutes", () => {
    const serverNow = new Date("2026-08-09T12:00:00.000Z");
    const target = new Date(serverNow.getTime() + 60 * 1000).toISOString();

    // Simulate a client whose Date.now() is 10 minutes ahead of the
    // server's reported clock. Without serverNow compensation the
    // hook would say 59 minutes left; with it, exactly one minute.
    vi.setSystemTime(new Date("2026-08-09T12:10:00.000Z"));

    const { result } = renderHook(() =>
      useDailyCountdown(target, serverNow.toISOString(), 1000),
    );

    expect(result.current.display).toBe("00:01:00");
  });
});
