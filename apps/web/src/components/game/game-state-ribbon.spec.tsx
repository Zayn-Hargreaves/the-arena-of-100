// Unit tests for GameStateRibbon (extracted from game page.tsx).
// Validates: round number + remaining/total player count rendering.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { GameStateRibbon } from "./game-state-ribbon";

describe("GameStateRibbon", () => {
  it("renders the round number and remaining/total counts", () => {
    render(
      <GameStateRibbon
        roundNo={3}
        timeLeft={12}
        livePlayerCount={7}
        maxPlayers={100}
      />,
    );
    // roundLabel key + number render in the same span ("roundLabel 3").
    expect(screen.getByText(/roundLabel\s+3/)).toBeInTheDocument();
    expect(screen.getByText("7 / 100")).toBeInTheDocument();
  });
});
