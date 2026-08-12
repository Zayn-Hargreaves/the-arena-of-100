// ============================================================
// Card UI tests — Phase 2 (Class + Card Hybrid)
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task E.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useTranslations: vi.fn((_namespace?: string) => {
      const translations: Record<string, string> = {
        hand: "Card Hand",
        noCards: "No cards in hand",
        milestones: "Milestone round",
        play: "Play",
        EPIC: "Epic",
        RARE: "Rare",
        COMMON: "Common",
        CONG: "Offensive",
        THU: "Defensive",
        "classes.CONG": "Offensive",
        "classes.THU": "Defensive",
        "tiers.COMMON": "Common",
        "tiers.RARE": "Rare",
        "tiers.EPIC": "Epic",
        aoeExhausted: "AOE cap reached for this round",
        // Phase 3 — card i18n keys. Tests assert the canonical English
        // names render verbatim; the catalog mirrors these.
        "byId.CB-1.name": "Time Freeze",
        "byId.CB-1.description": "Reduce a target's answer window by 5s.",
        "byId.CB-2.name": "Sabotage Q",
        "byId.CB-2.description": "Delay a target's question render by 3s.",
        "byId.TN-1.name": "50:50",
        "byId.TN-1.description":
          "Disable 2 random wrong options for the round.",
        "byId.TN-4.name": "Shield",
        "byId.TN-4.description": "Block 1 incoming card for the next round.",
      };
      const t = (
        key: string,
        params?: Record<string, string | number>,
      ): string => {
        if (key === "aoeCapHint") {
          return `AOE cap: ${params?.used ?? "?"}/${params?.cap ?? "?"} for this round`;
        }
        return translations[key] ?? key;
      };
      // Phase 3 — companion `has()` predicate so CardTile's i18n
      // fallback can short-circuit on missing keys without throwing.
      (t as { has: (key: string) => boolean }).has = (key: string) =>
        key in translations;
      return t;
    }),
    useLocale: () => "en",
  };
});

import { CardTile } from "./card-tile";
import { CardHand } from "./card-hand";
import { ClassBadge } from "./class-badge";
import { AoeCapIndicator } from "./aoe-cap-indicator";

describe("CardTile", () => {
  it("renders the card name + tier label", () => {
    render(<CardTile cardId="CB-1" />);
    expect(screen.getByText("Time Freeze")).toBeDefined();
    expect(screen.getByText("Common")).toBeDefined();
  });

  it("sets data-card-id and data-tier for analytics", () => {
    const { container } = render(<CardTile cardId="TN-4" />);
    const btn = container.querySelector('button[data-card-id="TN-4"]');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("data-tier")).toBe("RARE");
  });

  it("renders spent variant with grayscale", () => {
    const { container } = render(<CardTile cardId="CB-1" variant="spent" />);
    const btn = container.querySelector('button[data-card-id="CB-1"]');
    expect(btn?.className).toContain("grayscale");
  });
});

describe("CardHand", () => {
  it("renders only cards in the player's class", () => {
    render(
      <CardHand
        hand={["CB-1", "CB-2", "TN-1"]}
        playedCardIds={[]}
        classId="CONG"
        onPickCard={() => {}}
      />,
    );
    expect(screen.getByText("Time Freeze")).toBeDefined();
    expect(screen.queryByText("50:50")).toBeNull();
  });

  it("shows the empty-state copy when no cards", () => {
    render(
      <CardHand
        hand={[]}
        playedCardIds={[]}
        classId={null}
        onPickCard={() => {}}
      />,
    );
    expect(screen.getByText("No cards in hand")).toBeDefined();
  });

  it("marks spent cards as disabled", () => {
    const { container } = render(
      <CardHand
        hand={["CB-1"]}
        playedCardIds={["CB-1"]}
        classId="CONG"
        onPickCard={() => {}}
      />,
    );
    const btn = container.querySelector('button[data-card-id="CB-1"]');
    expect(btn?.hasAttribute("disabled")).toBe(true);
  });
});

describe("ClassBadge", () => {
  it("renders the Offensive class badge", () => {
    const { container } = render(<ClassBadge classId="CONG" />);
    const badge = container.querySelector("[data-class='CONG']");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Offensive");
  });

  it("renders the Defensive class badge", () => {
    const { container } = render(<ClassBadge classId="THU" />);
    const badge = container.querySelector("[data-class='THU']");
    expect(badge).not.toBeNull();
  });
});

describe("AoeCapIndicator", () => {
  it("renders the used/cap counter", () => {
    const { container } = render(<AoeCapIndicator used={1} />);
    const span = container.querySelector("[data-aoe-cap]");
    expect(span?.textContent).toContain("1/2");
  });

  it("flips to the exhausted style at the cap", () => {
    const { container } = render(<AoeCapIndicator used={2} />);
    const span = container.querySelector("[data-aoe-cap]");
    expect(span?.className).toContain("candy-red");
  });
});
