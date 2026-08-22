"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeState: {
  accessToken: string | null;
  username: string | null;
  authenticate: (nickname: string) => Promise<void>;
} = {
  accessToken: null,
  username: null,
  authenticate: vi.fn(),
};

function mockUseSocketStore<T>(
  selector?: (s: typeof storeState) => T,
): T | typeof storeState {
  return selector ? selector(storeState) : storeState;
}
mockUseSocketStore.getState = () => storeState;

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: mockUseSocketStore,
}));

const getDailyToday = vi.fn();
const submitDaily = vi.fn();
const getDailyLeaderboard = vi.fn();

vi.mock("@/lib/api/daily", () => ({
  getDailyToday: (...args: unknown[]) => getDailyToday(...args),
  submitDaily: (...args: unknown[]) => submitDaily(...args),
  getDailyLeaderboard: (...args: unknown[]) => getDailyLeaderboard(...args),
}));

// Heavy shell components pulled in by the page aren't relevant here;
// render the page body directly.
vi.mock("@/components/ui/app-shell-layout", () => ({
  AppShellLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "shell" }, children),
}));

vi.mock("@arena/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@arena/shared")>("@arena/shared");
  return {
    ...actual,
    getCardDefinition: vi.fn((id: string) => ({
      id,
      name: `Card ${id}`,
      classId: "ATTACK",
      tier: "COMMON",
      backfireRate: 0.1,
      effectType: "DAMAGE",
      basePower: 10,
    })),
  };
});

import DailyPage from "./page";
import { ApiError } from "@/lib/api-client";

const sampleQuestions = [
  {
    content: "Q1?",
    options: ["a", "b", "c", "d"],
    difficulty: "EASY",
    category: "SCIENCE",
  },
  {
    content: "Q2?",
    options: ["a", "b", "c", "d"],
    difficulty: "MEDIUM",
    category: "HISTORY",
  },
  {
    content: "Q3?",
    options: ["a", "b", "c", "d"],
    difficulty: "HARD",
    category: "TECHNOLOGY",
  },
  {
    content: "Q4?",
    options: ["a", "b", "c", "d"],
    difficulty: "EASY",
    category: "CULTURE",
  },
  {
    content: "Q5?",
    options: ["a", "b", "c", "d"],
    difficulty: "MEDIUM",
    category: "SCIENCE",
  },
];

// Drive the quiz UI through every sample question: pick the first
// option, click Next until the last question, then click Submit on
// the final screen. Mirrors the answer-selection + Next/Submit
// sequence repeated across the error-path tests below.
function completeQuiz() {
  for (let i = 0; i < sampleQuestions.length; i++) {
    fireEvent.click(screen.getByText(sampleQuestions[i].options[0]));
    if (i < sampleQuestions.length - 1) {
      fireEvent.click(screen.getByText(/^next$/i));
    } else {
      fireEvent.click(screen.getByText(/^submit$/i));
    }
  }
}

const todayResponse = {
  dateKey: "2026-08-09",
  version: 1,
  questions: sampleQuestions,
  sessionToken: "sess-1",
  serverTime: "2026-08-09T12:00:00.000Z",
  nextResetAt: "2026-08-10T00:00:00.000Z",
  alreadyAttempted: false,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{}}>
        <DailyPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DailyPage", () => {
  beforeEach(() => {
    storeState.accessToken = null;
    storeState.username = null;
    storeState.authenticate = vi.fn();
    getDailyToday.mockReset();
    submitDaily.mockReset();
    getDailyLeaderboard.mockReset();
    getDailyToday.mockResolvedValue(todayResponse);
    getDailyLeaderboard.mockResolvedValue({
      dateKey: "2026-08-09",
      generatedAt: "2026-08-09T12:00:00.000Z",
      cached: false,
      items: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks the user to sign in before the quiz when there is no token", async () => {
    renderPage();

    // next-intl's vitest mock returns the key path, so we assert
    // against the keys the page binds to its translated strings.
    await waitFor(() => expect(screen.getByText("intro")).toBeInTheDocument());
    expect(screen.getByText("start")).toBeInTheDocument();
  });

  it("walks through all five questions and submits when authenticated", async () => {
    storeState.accessToken = "tok-abc";
    submitDaily.mockResolvedValue({
      dateKey: "2026-08-09",
      version: 1,
      score: 600,
      correctCount: 4,
      totalQuestions: 5,
      elapsedMs: 25_000,
      streakBefore: 0,
      streakAfter: 0,
      results: [],
      completedAt: "2026-08-09T12:01:00.000Z",
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Q1?")).toBeInTheDocument());

    for (let i = 0; i < sampleQuestions.length; i++) {
      const q = sampleQuestions[i];
      const button = screen.getByText(q.options[0]);
      fireEvent.click(button);
      if (i < sampleQuestions.length - 1) {
        fireEvent.click(screen.getByText(/^next$/i));
      } else {
        fireEvent.click(screen.getByText(/^submit$/i));
      }
    }

    await waitFor(() => expect(submitDaily).toHaveBeenCalledTimes(1));

    // Pull the exact body the page POSTed and validate it against the
    // submitDaily contract: 5 answers, in question order, each carrying
    // the chosen option + a responseTimeMs number.
    const calledWith = submitDaily.mock.calls[0][0] as {
      sessionToken: string;
      answers: Array<{ answer: string; responseTimeMs: number }>;
    };
    const calledToken = submitDaily.mock.calls[0][1];
    expect(calledWith.sessionToken).toBe("sess-1");
    expect(calledToken).toBe("tok-abc");
    expect(calledWith.answers).toHaveLength(sampleQuestions.length);

    calledWith.answers.forEach((submitted, index) => {
      const expectedQuestion = sampleQuestions[index];
      expect(expectedQuestion).toBeDefined();
      expect(submitted).toEqual({
        answer: expectedQuestion.options[0],
        responseTimeMs: expect.any(Number),
      });
      // responseTimeMs is advisory only — must be >= 0 and finite.
      expect(submitted.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(submitted.responseTimeMs)).toBe(true);
    });

    expect(submitDaily).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: "sess-1",
        answers: expect.any(Array),
      }),
      "tok-abc",
    );

    // After a successful submit the quiz UI must be torn down: the
    // result panel replaces it, but the question card + back/next/
    // submit buttons must no longer be in the DOM (regression for the
    // post-submit double-render).
    await waitFor(() =>
      expect(screen.getByText("result.score")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^back$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^next$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^submit$/i)).not.toBeInTheDocument();
    // Question content must be gone too.
    expect(screen.queryByText("Q1?")).not.toBeInTheDocument();
  });

  it("renders an already-done message when alreadyAttempted is true", async () => {
    storeState.accessToken = "tok-abc";
    getDailyToday.mockResolvedValue({
      ...todayResponse,
      alreadyAttempted: true,
      currentStreak: 5,
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("alreadyDone")).toBeInTheDocument(),
    );
    expect(screen.getByText("rewards.title")).toBeInTheDocument();
  });

  it("shows 409 error message when submit returns conflict", async () => {
    storeState.accessToken = "tok-abc";
    submitDaily.mockRejectedValue(new ApiError("Conflict", 409));

    renderPage();

    await waitFor(() => expect(screen.getByText("Q1?")).toBeInTheDocument());

    completeQuiz();

    await waitFor(() =>
      expect(screen.getByText("error.alreadySubmitted")).toBeInTheDocument(),
    );
  });

  it("shows 429 error message when submit returns rate limited", async () => {
    storeState.accessToken = "tok-abc";
    submitDaily.mockRejectedValue(new ApiError("Too Many", 429));

    renderPage();

    await waitFor(() => expect(screen.getByText("Q1?")).toBeInTheDocument());

    completeQuiz();

    await waitFor(() =>
      expect(screen.getByText("error.rateLimited")).toBeInTheDocument(),
    );
  });

  it("shows generic error message when submit fails with unknown error", async () => {
    storeState.accessToken = "tok-abc";
    submitDaily.mockRejectedValue(new ApiError("Server error", 500));

    renderPage();

    await waitFor(() => expect(screen.getByText("Q1?")).toBeInTheDocument());

    completeQuiz();

    await waitFor(() => {
      const el = screen.getByText(/submitFailed/);
      expect(el).toBeInTheDocument();
    });
  });

  it("shows leaderboard error when leaderboard fetch fails", async () => {
    getDailyLeaderboard.mockRejectedValue(new Error("Network error"));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("leaderboard.error")).toBeInTheDocument(),
    );
  });

  it("shows CardVariantUnlockModal when submit response has unlockedVariant", async () => {
    storeState.accessToken = "tok-abc";
    submitDaily.mockResolvedValue({
      dateKey: "2026-08-09",
      version: 1,
      score: 600,
      correctCount: 4,
      totalQuestions: 5,
      elapsedMs: 25_000,
      streakBefore: 6,
      streakAfter: 7,
      results: [],
      completedAt: "2026-08-09T12:01:00.000Z",
      unlockedVariant: { cardId: "ATK-1", variantKey: "GOLD" },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Q1?")).toBeInTheDocument());

    completeQuiz();

    await waitFor(() =>
      expect(
        screen.getByTestId("card-variant-unlock-modal"),
      ).toBeInTheDocument(),
    );
  });
});
