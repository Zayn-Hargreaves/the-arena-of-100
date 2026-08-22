// ============================================================
// CardAnimation completion-path tests
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task E (animation contract).
//
// Covers the TEMPORARY branch's setTimeout completion path
// (added in the minimal-scope fix for the missing completion
// timer). Uses vi.useFakeTimers so the test is deterministic
// and finishes in ms, not in real wall-clock seconds.
// ============================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { CardAnimation } from "./card-animation";
import type { CardEffectEvent } from "@arena/shared";

function makeTempEvent(remainingMs: number): CardEffectEvent {
  return {
    matchId: "m1",
    roundNo: 1,
    cardId: "TN-1",
    offerSeqNo: 1,
    playedByPlayerId: "p1",
    targetPlayerIds: ["p2"],
    effect: {
      kind: "OPTION_DISABLE",
      indexes: [0, 2],
      count: 2,
      availableAtResolution: 3,
      durationMs: 20000,
    },
    resolution: "TEMPORARY",
    serverTimestamp: 1000,
    expiresAtServer: 1000 + remainingMs,
    remainingMs,
  };
}

describe("CardAnimation — TEMPORARY completion timer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onComplete when the event's remainingMs elapses", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(
      <CardAnimation event={makeTempEvent(2000)} onComplete={onComplete} />,
    );

    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("clears the completion timer when the component unmounts", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const { unmount } = render(
      <CardAnimation event={makeTempEvent(5000)} onComplete={onComplete} />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
