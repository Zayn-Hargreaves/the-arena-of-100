import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyModeCard } from "./daily-mode-card";

vi.mock("@/i18n/routing", () => ({
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, params?: Record<string, string | number>) => {
      if (params) {
        let str = key;
        for (const [k, v] of Object.entries(params)) {
          str = `${str} ${k}:${v}`;
        }
        return str;
      }
      return key;
    },
}));

describe("DailyModeCard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders basic daily mode card without streak when localStorage is empty", () => {
    render(<DailyModeCard />);
    expect(screen.getByText("dailyCardTitle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /playDaily/i })).toHaveAttribute(
      "href",
      "/daily",
    );
  });

  it("loads and displays valid positive safe integer streak from localStorage", () => {
    localStorage.setItem("dailyStreak", "7");
    render(<DailyModeCard />);
    expect(screen.getByText(/7 dailyStreakLabel/i)).toBeInTheDocument();
  });

  it("ignores non-numeric or float or invalid streak strings", () => {
    localStorage.setItem("dailyStreak", "5abc");
    const { unmount } = render(<DailyModeCard />);
    expect(screen.queryByText(/dailyStreakLabel/i)).toBeNull();
    unmount();

    localStorage.setItem("dailyStreak", "3.14");
    render(<DailyModeCard />);
    expect(screen.queryByText(/dailyStreakLabel/i)).toBeNull();
  });

  it("ignores non-positive integers", () => {
    localStorage.setItem("dailyStreak", "0");
    const { unmount } = render(<DailyModeCard />);
    expect(screen.queryByText(/dailyStreakLabel/i)).toBeNull();
    unmount();

    localStorage.setItem("dailyStreak", "-5");
    render(<DailyModeCard />);
    expect(screen.queryByText(/dailyStreakLabel/i)).toBeNull();
  });
});
