import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyShareButton } from "./daily-share-button";
import type { DailySubmitResponse } from "@/types/daily";

const result: DailySubmitResponse = {
  dateKey: "2026-08-09",
  version: 1,
  score: 850,
  correctCount: 4,
  totalQuestions: 5,
  elapsedMs: 25_000,
  streakBefore: 3,
  streakAfter: 4,
  results: [
    {
      answer: "Mercury",
      isCorrect: true,
      correctAnswer: "Mercury",
      responseTimeMs: 1500,
    },
    {
      answer: "Jupiter",
      isCorrect: false,
      correctAnswer: "Venus",
      responseTimeMs: 2200,
    },
    {
      answer: "Earth",
      isCorrect: true,
      correctAnswer: "Earth",
      responseTimeMs: 1700,
    },
    {
      answer: "Mars",
      isCorrect: true,
      correctAnswer: "Mars",
      responseTimeMs: 1900,
    },
    {
      answer: "Saturn",
      isCorrect: true,
      correctAnswer: "Saturn",
      responseTimeMs: 2100,
    },
  ],
  completedAt: "2026-08-09T10:15:00.000Z",
};

describe("DailyShareButton", () => {
  // Snapshot the originals up front so we can restore every override in
  // afterEach — otherwise a previous spec can leak state into this one.
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;
  const originalIsSecureContext = window.isSecureContext;

  beforeEach(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: originalIsSecureContext,
    });
  });

  it("uses navigator.share when available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    const callArg = shareMock.mock.calls[0][0] as {
      url: string;
      text: string;
    };
    expect(callArg.url).toMatch(/\/api\/daily\/share\?/);
    expect(callArg.url).toContain("score=850");
    expect(callArg.url).toContain("correct=4");
    expect(callArg.text).toContain("Score 850");
  });

  it("falls back to clipboard and toggles label to Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // waitFor for the label flip too — setCopied(true) resolves in a
    // microtask after writeText, and the re-render must commit before
    // the assertion. Without this, the test races the React scheduler
    // and flakes intermittently.
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("returns silently when user cancels share with an AbortError", async () => {
    const shareMock = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    // Cancellation must not fall through to clipboard.
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("falls back to clipboard when share rejects with a non-Abort error", async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error("boom"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("falls back to clipboard when share rejects with an 'aborted' message but Error name is not AbortError", async () => {
    // Regression: a plain Error whose message contains "aborted"
    // (e.g. "network aborted") is a real failure, not a user
    // cancellation — it must reach the clipboard fallback instead of
    // being silently swallowed.
    const shareMock = vi.fn().mockRejectedValue(new Error("network aborted"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("surfaces errorLabel when both share and clipboard fail", async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error("boom"));
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <DailyShareButton
        result={result}
        shareLabel="Share"
        copyLabel="Copy"
        copiedLabel="Copied!"
        errorLabel="Failed"
        shareTextTitle="Arena of 100 — Daily"
        shareTextScoreLabel="Score"
        shareTextStreakLabel="Streak"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });
});
