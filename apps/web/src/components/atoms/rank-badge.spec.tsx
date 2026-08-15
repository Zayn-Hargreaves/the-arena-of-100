import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { RankBadge } from "./rank-badge";
import type { RankTier } from "@arena/shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      elo: "ELO",
      title: "Rank Tier",
      "tiers.bronze": "Bronze",
      "tiers.silver": "Silver",
      "tiers.gold": "Gold",
      "tiers.platinum": "Platinum",
      "tiers.diamond": "Diamond",
      "tiers.master": "Master",
      "tiers.grandmaster": "Grandmaster",
    };
    return translations[key] ?? key;
  },
}));

describe("RankBadge", () => {
  const tiers: RankTier[] = [
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    "DIAMOND",
    "MASTER",
    "GRANDMASTER",
  ];

  it.each(tiers)("renders correct tier name for %s", (tier) => {
    render(<RankBadge tier={tier} />);
    const expectedNames: Record<RankTier, string> = {
      BRONZE: "Bronze",
      SILVER: "Silver",
      GOLD: "Gold",
      PLATINUM: "Platinum",
      DIAMOND: "Diamond",
      MASTER: "Master",
      GRANDMASTER: "Grandmaster",
    };
    expect(screen.getByText(expectedNames[tier])).toBeInTheDocument();
  });

  it("renders elo score when showElo is true", () => {
    render(<RankBadge tier="DIAMOND" elo={1850} showElo={true} />);
    expect(screen.getByText("Diamond")).toBeInTheDocument();
    expect(screen.getByText("(1850 ELO)")).toBeInTheDocument();
  });

  it("hides tier name when showName is false", () => {
    render(
      <RankBadge tier="GOLD" elo={1450} showElo={true} showName={false} />,
    );
    expect(screen.queryByText("Gold")).not.toBeInTheDocument();
    expect(screen.getByText("(1450 ELO)")).toBeInTheDocument();
  });
});
