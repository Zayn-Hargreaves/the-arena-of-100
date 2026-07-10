// Unit tests for AnswerPanel (extracted from game page.tsx).
// Validates: read-only spectator/eliminated branch vs interactive tiles,
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

  it("renders the read-only spectator block (no tiles) for a spectator", () => {
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
    // Spectator copy (dropInSpectator namespace keys) is shown...
    expect(screen.getByText("bannerTitle")).toBeInTheDocument();
    // ...and the answer options are NOT rendered.
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
  });

  it("renders the eliminated read-only block with spectatorMode copy", () => {
    render(
      <AnswerPanel
        isEliminated={true}
        isSpectator={false}
        options={OPTIONS}
        getTileVariant={() => "default"}
        onSelect={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText("spectatorMode.title")).toBeInTheDocument();
    expect(screen.queryByText("Blue")).not.toBeInTheDocument();
  });
});
