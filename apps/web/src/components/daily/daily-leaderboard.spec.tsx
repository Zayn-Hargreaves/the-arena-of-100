import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyLeaderboard } from "./daily-leaderboard";
import type { DailyLeaderboardItem } from "../../types/daily";

const items: DailyLeaderboardItem[] = [
  {
    rank: 1,
    userId: "u1",
    username: "Alice",
    avatar: "jellyfrog",
    score: 1000,
    correctCount: 5,
    streakAfter: 7,
    completedAt: "2026-08-09T10:15:00.000Z",
    cardsPlayedThisWeek: 12,
  },
  {
    rank: 2,
    userId: "u2",
    username: "Bob",
    avatar: "tux",
    score: 800,
    correctCount: 4,
    streakAfter: 2,
    completedAt: "2026-08-09T10:14:00.000Z",
    cardsPlayedThisWeek: 4,
  },
  {
    rank: 3,
    userId: "u3",
    username: "Eve",
    avatar: "azure",
    score: 600,
    correctCount: 3,
    streakAfter: 0,
    completedAt: "2026-08-09T10:13:00.000Z",
    cardsPlayedThisWeek: 20,
  },
];

describe("DailyLeaderboard", () => {
  it("renders the empty-state copy when there are no items", () => {
    render(<DailyLeaderboard items={[]} />);
    // next-intl mock returns the key path; assert against the key.
    expect(screen.getByText("leaderboard.empty")).toBeInTheDocument();
  });

  it("renders each player's username and formatted score", () => {
    render(<DailyLeaderboard items={items} />);

    for (const item of items) {
      expect(screen.getByText(item.username)).toBeInTheDocument();
      expect(screen.getByText(`#${item.rank}`)).toBeInTheDocument();
    }
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("600")).toBeInTheDocument();
  });

  it("falls back to the first avatar when an avatar seed is invalid", () => {
    render(
      <DailyLeaderboard
        items={[
          {
            rank: 1,
            userId: "u1",
            username: "NoAvatar",
            avatar: "not-a-real-seed",
            score: 100,
            correctCount: 1,
            streakAfter: 0,
            completedAt: "2026-08-09T10:15:00.000Z",
            cardsPlayedThisWeek: 0,
          },
        ]}
      />,
    );
    // No crash, the row is rendered.
    expect(screen.getByText("NoAvatar")).toBeInTheDocument();
  });
});
