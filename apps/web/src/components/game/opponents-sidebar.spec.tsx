// Unit tests for OpponentsSidebar (extracted from game page.tsx).
// Validates: empty-roster fallback, alive-before-eliminated sort,
// alive/eliminated badges, and that names come from the server roster
// (never mock data). Avatar UI components are stubbed so the test
// focuses on the sidebar's own list/sort/badge logic.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ fallback }: { fallback: string }) =>
    React.createElement("div", {
      "data-testid": "avatar",
      "data-seed": fallback,
    }),
}));
vi.mock("@/components/ui/avatar-frame", () => ({
  AvatarFrame: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "avatar-frame" }, children),
}));
vi.mock("@/components/ui/animated-sprite", () => ({
  AnimatedSprite: () => React.createElement("div", { "data-testid": "sprite" }),
}));

import { OpponentsSidebar, type OpponentPlayer } from "./opponents-sidebar";

const player = (id: string, name: string, status: string): OpponentPlayer => ({
  id,
  name,
  status,
});

describe("OpponentsSidebar", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renders the neutral empty hint when the roster is empty", () => {
    render(<OpponentsSidebar players={[]} userId={null} />);
    expect(screen.getByTestId("opponents-empty")).toBeInTheDocument();
    expect(screen.getByText("opponentsEmpty")).toBeInTheDocument();
  });

  it("renders server-provided player names (not mock opponents)", () => {
    render(
      <OpponentsSidebar
        players={[player("p1", "Alice", "ACTIVE")]}
        userId="me"
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Legacy hardcoded mock names must never appear.
    expect(screen.queryByText("Zero_Cool")).not.toBeInTheDocument();
    expect(screen.queryByText("Acid_Burn")).not.toBeInTheDocument();
  });

  it("sorts alive players before eliminated ones", () => {
    render(
      <OpponentsSidebar
        players={[
          player("p1", "DeadFirst", "ELIMINATED"),
          player("p2", "AliveSecond", "ACTIVE"),
        ]}
        userId="me"
      />,
    );
    const rows = screen.getAllByTestId(/^opponent-/);
    expect(rows).toHaveLength(2);
    // Alive should be rendered first despite being second in the input.
    expect(within(rows[0]).getByText("AliveSecond")).toBeInTheDocument();
    expect(within(rows[1]).getByText("DeadFirst")).toBeInTheDocument();
  });

  it("shows the alive badge for non-eliminated and eliminated badge otherwise", () => {
    render(
      <OpponentsSidebar
        players={[
          player("p1", "Alive", "ACTIVE"),
          player("p2", "Gone", "ELIMINATED"),
        ]}
        userId="me"
      />,
    );
    expect(screen.getByText("aliveStatus")).toBeInTheDocument();
    expect(screen.getByText("eliminatedStatus")).toBeInTheDocument();
  });

  it("treats DISCONNECTED players as alive (sorted with the living)", () => {
    render(
      <OpponentsSidebar
        players={[
          player("p1", "Eliminated", "ELIMINATED"),
          player("p2", "Disconnected", "DISCONNECTED"),
        ]}
        userId="me"
      />,
    );
    const rows = screen.getAllByTestId(/^opponent-/);
    expect(within(rows[0]).getByText("Disconnected")).toBeInTheDocument();
  });

  it("uses the locally stored avatar seed for the row matching userId", () => {
    localStorage.setItem("avatarSeed", "stored-seed");
    localStorage.setItem("avatarIsAnimated", "false");
    render(
      <OpponentsSidebar
        players={[
          player("me", "Me", "ACTIVE"),
          player("p2", "Other", "ACTIVE"),
        ]}
        userId="me"
      />,
    );
    const selfRow = screen.getByTestId("opponent-me");
    expect(within(selfRow).getByTestId("avatar")).toHaveAttribute(
      "data-seed",
      "stored-seed",
    );
  });
});
