// Unit tests for GameStateRibbon (extracted from game page.tsx).
// Validates: round number + remaining/total player count rendering,
// including the {number} interpolation of the roundLabel message.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import * as nextIntl from "next-intl";

// Spec-level override: the global vitest.setup.ts mock returns the key
// path itself, which bypasses interpolation. Here we override for this
// spec to provide a real translator that mirrors the en.json
// `Game.roundLabel` message ("ROUND {number}") so the test can assert
// the rendered interpolation result AND inspect the call args.
vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useTranslations: vi.fn((_namespace?: string) =>
      vi.fn((key: string, params?: Record<string, string | number>): string => {
        if (key === "roundLabel") {
          return `ROUND ${params?.number ?? ""}`;
        }
        return key;
      }),
    ),
    useLocale: () => "en",
  };
});

import { GameStateRibbon } from "./game-state-ribbon";

describe("GameStateRibbon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the round number with {number} interpolation", () => {
    render(
      <GameStateRibbon
        roundNo={3}
        timeLeft={12}
        roundDuration={15}
        livePlayerCount={7}
        maxPlayers={100}
      />,
    );
    // next-intl message "ROUND {number}" with number=3 → "ROUND 3".
    // Asserting the literal "ROUND 3" (not just "roundLabel") proves
    // both that the translator was called with the roundNo value and
    // that the {number} placeholder was substituted.
    expect(screen.getByText("ROUND 3")).toBeInTheDocument();
    expect(screen.getByText("7 / 100")).toBeInTheDocument();
    // Spy assertion: pick the translator returned by the useTranslations
    // call for namespace "Game" (Timer may also call useTranslations).
    const useTMock = vi.mocked(nextIntl.useTranslations);
    expect(useTMock).toHaveBeenCalledWith("Game");
    const gameCallIdx = useTMock.mock.calls.findLastIndex(
      (args) => args[0] === "Game",
    );
    expect(gameCallIdx).toBeGreaterThanOrEqual(0);
    const tFn = useTMock.mock.results[gameCallIdx]!.value as ReturnType<
      typeof vi.fn
    >;
    expect(tFn).toHaveBeenCalledWith("roundLabel", { number: 3 });
  });

  it("renders positive and negative time delta badges", () => {
    const { rerender } = render(
      <GameStateRibbon
        roundNo={3}
        timeLeft={12}
        roundDuration={15}
        livePlayerCount={7}
        maxPlayers={100}
        timeDelta={{ deltaSeconds: 5, key: 1 }}
      />,
    );

    expect(screen.getByText("+5s")).toBeInTheDocument();

    rerender(
      <GameStateRibbon
        roundNo={3}
        timeLeft={7}
        roundDuration={15}
        livePlayerCount={7}
        maxPlayers={100}
        timeDelta={{ deltaSeconds: -5, key: 2 }}
      />,
    );

    expect(screen.getByText("-5s")).toBeInTheDocument();
  });
});
