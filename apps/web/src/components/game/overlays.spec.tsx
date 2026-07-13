// Smoke tests for the presentational overlay/banner/note organisms
// extracted from game page.tsx. They have no logic beyond rendering
// translated copy, so a render + key assertion is sufficient.
import { describe, it, expect } from "vitest";
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
