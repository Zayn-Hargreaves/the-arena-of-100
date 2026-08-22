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
import { type CardEffectEvent } from "@arena/shared";
import { CardAnimation } from "./card-animation";

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const translations: Record<string, string> = {
    "classes.ATTACK": "Offensive",
    "classes.DEFENSE": "Defensive",
    "animation.opponent": "Opponent",
    "animation.you": "You",
    "animation.round": "ROUND {round}",
    "animation.youActivatedOn": "You activated on: {targets}",
    "animation.youActivated": "You activated card effect",
    "animation.opponentTargetedYou": "⚠️ {name} targeted You!",
    "animation.opponentActivatedOn": "{name} activated on {targets}",
    "animation.opponentActivated": "{name} activated card effect",
  };
  return {
    ...actual,
    useTranslations: vi.fn((_namespace?: string) => {
      const t = (key: string, params?: Record<string, string | number>) => {
        let text = translations[key] ?? key;
        if (params) {
          text = text.replace(/\{(\w+)\}/g, (_, name: string) =>
            String(params[name] ?? ""),
          );
        }
        return text;
      };
      t.has = (key: string) => Boolean(translations[key]);
      return t;
    }),
  };
});

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

  it("renders card name, target info, and pop-art glyph without emoji", () => {
    const { container } = render(
      <CardAnimation
        event={makeTempEvent(5000)}
        userId="p1"
        players={[
          { id: "p1", name: "Alice" },
          { id: "p2", name: "Bob" },
        ]}
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.textContent).toContain("50:50");
    expect(container.textContent).toContain("Bob");
  });

  it("does not render banner for uninvolved user p3", () => {
    const { container } = render(
      <CardAnimation
        event={makeTempEvent(5000)}
        userId="p3"
        players={[
          { id: "p1", name: "Alice" },
          { id: "p2", name: "Bob" },
          { id: "p3", name: "Charlie" },
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders notification for targeted user p2", () => {
    const { container } = render(
      <CardAnimation
        event={makeTempEvent(5000)}
        userId="p2"
        players={[
          { id: "p1", name: "Alice" },
          { id: "p2", name: "Bob" },
        ]}
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("⚠️ Alice targeted You!");
  });
});
