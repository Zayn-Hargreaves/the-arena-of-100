// Unit tests for AnswerPanel (extracted from game page.tsx).
// Validates: practice indicator badge for spectator/eliminated mode,
// option→letter (A/B/C/D) mapping, onSelect wiring, and disabled state.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AnswerPanel } from "./answer-panel";

const OPTIONS = ["Red", "Green", "Blue", "Yellow"];

describe("AnswerPanel", () => {
  it("renders interactive tiles for an active player", () => {
    const onSelect = vi.fn();
    render(
      <AnswerPanel
        isEliminated={false}
        isSpectator={false}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={onSelect}
        disabled={false}
      />,
    );
    OPTIONS.forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
    // Letters A–D are rendered as the tile badges.
    ["A", "B", "C", "D"].forEach((l) =>
      expect(screen.getByText(l)).toBeInTheDocument(),
    );
    // Practice badge is not rendered for active player
    expect(
      screen.queryByTestId("spectator-practice-badge"),
    ).not.toBeInTheDocument();
  });

  it("calls onSelect with the letter code when a tile is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AnswerPanel
        isEliminated={false}
        isSpectator={false}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={onSelect}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByText("Green"));
    expect(onSelect).toHaveBeenCalledWith("B");
  });

  it("does not call onSelect when disabled", () => {
    const onSelect = vi.fn();
    render(
      <AnswerPanel
        isEliminated={false}
        isSpectator={false}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={onSelect}
        disabled={true}
      />,
    );
    fireEvent.click(screen.getByText("Red"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders practice badge and answer tiles for a drop-in spectator", () => {
    const onSelect = vi.fn();
    render(
      <AnswerPanel
        isEliminated={false}
        isSpectator={true}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={onSelect}
        disabled={false}
      />,
    );
    // Practice badge is shown
    expect(screen.getByTestId("spectator-practice-badge")).toBeInTheDocument();
    expect(screen.getByText("spectatorMode.practiceHint")).toBeInTheDocument();
    // Answer options ARE rendered
    OPTIONS.forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
    // Clicking tile triggers onSelect for local practice prediction
    fireEvent.click(screen.getByText("Blue"));
    expect(onSelect).toHaveBeenCalledWith("C");
  });

  it("renders practice badge and answer tiles for an eliminated player", () => {
    const onSelect = vi.fn();
    render(
      <AnswerPanel
        isEliminated={true}
        isSpectator={false}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={onSelect}
        disabled={false}
      />,
    );
    expect(screen.getByTestId("spectator-practice-badge")).toBeInTheDocument();
    expect(screen.getByText("spectatorMode.practiceHint")).toBeInTheDocument();
    OPTIONS.forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
  });
});
