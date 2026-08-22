// Smoke tests for the presentational overlay/banner/note organisms
// extracted from game page.tsx. They have no logic beyond rendering
// translated copy, so a render + key assertion is sufficient.
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { EliminatedOverlay } from "./eliminated-overlay";
import { SpectatorBanner } from "./spectator-banner";
import { AntiHackNote } from "./anti-hack-note";
import { MatchFinishedOverlay } from "./match-finished-overlay";

describe("EliminatedOverlay", () => {
  it("renders title and subtitle", () => {
    render(<EliminatedOverlay />);
    expect(screen.getByText("eliminatedOverlay.title")).toBeInTheDocument();
    expect(screen.getByText("eliminatedOverlay.subtitle")).toBeInTheDocument();
  });

  it("omits the reason line when no reason is provided", () => {
    render(<EliminatedOverlay />);
    expect(screen.queryByTestId("elimination-reason")).not.toBeInTheDocument();
  });

  it("shows the wrong-answer reason", () => {
    render(<EliminatedOverlay reason="WRONG_ANSWER" />);
    expect(screen.getByTestId("elimination-reason")).toHaveTextContent(
      "eliminatedOverlay.reasonWrong",
    );
  });

  it("shows the timeout reason", () => {
    render(<EliminatedOverlay reason="TIMEOUT" />);
    expect(screen.getByTestId("elimination-reason")).toHaveTextContent(
      "eliminatedOverlay.reasonTimeout",
    );
  });

  it("shows the AFK reason", () => {
    render(<EliminatedOverlay reason="AFK" />);
    expect(screen.getByTestId("elimination-reason")).toHaveTextContent(
      "eliminatedOverlay.reasonAfk",
    );
  });
  it("falls back to no reason line when reason is null (reconnect snapshot)", () => {
    render(<EliminatedOverlay reason={null} />);
    expect(screen.queryByTestId("elimination-reason")).not.toBeInTheDocument();
    // Generic subtitle still present so the watch-only context is clear.
    expect(screen.getByText("eliminatedOverlay.subtitle")).toBeInTheDocument();
  });

  it("dismisses via onSpectate when Escape key is pressed", () => {
    const onSpectate = vi.fn();
    render(<EliminatedOverlay onSpectate={onSpectate} />);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onSpectate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("invokes only onSpectate when both onSpectate and onLeave are provided and Escape is pressed", () => {
    const onSpectate = vi.fn();
    const onLeave = vi.fn();
    render(<EliminatedOverlay onSpectate={onSpectate} onLeave={onLeave} />);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onSpectate).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("dismisses via onLeave when Escape key is pressed and onSpectate is absent", () => {
    const onLeave = vi.fn();
    render(<EliminatedOverlay onLeave={onLeave} />);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("invokes the latest callback after rerendering with a replacement callback on Escape", () => {
    const onSpectate1 = vi.fn();
    const onSpectate2 = vi.fn();
    const { rerender } = render(<EliminatedOverlay onSpectate={onSpectate1} />);

    rerender(<EliminatedOverlay onSpectate={onSpectate2} />);

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onSpectate1).not.toHaveBeenCalled();
    expect(onSpectate2).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not prevent Tab when no focusable elements exist", () => {
    // Without onLeave/onSpectate callbacks, no buttons are rendered
    render(<EliminatedOverlay />);
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("SpectatorBanner", () => {
  it("renders the banner with its testid and title", () => {
    render(<SpectatorBanner />);
    expect(screen.getByTestId("game-spectator-banner")).toBeInTheDocument();
    expect(screen.getByText("bannerTitle")).toBeInTheDocument();
  });
});

describe("AntiHackNote", () => {
  it("renders the anti-cheat description", () => {
    render(<AntiHackNote />);
    expect(screen.getByText(/antiHackDescription/)).toBeInTheDocument();
  });
});

describe("MatchFinishedOverlay", () => {
  it("renders the match-finished title", () => {
    render(<MatchFinishedOverlay />);
    expect(screen.getByText("matchFinishedOverlay.title")).toBeInTheDocument();
  });
});
