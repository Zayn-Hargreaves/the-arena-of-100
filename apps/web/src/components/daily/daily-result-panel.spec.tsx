"use client";

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyResultPanel } from "./daily-result-panel";
import type { DailySubmitResponse } from "@/types/daily";

const baseResult: DailySubmitResponse = {
  dateKey: "2026-08-09",
  version: 1,
  score: 1000,
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
      explanation: "Venus is the second planet from the Sun.",
    },
    {
      answer: "Earth",
      isCorrect: true,
      correctAnswer: "Earth",
      responseTimeMs: 1700,
    },
    {
      answer: "",
      isCorrect: false,
      correctAnswer: "Mars",
      responseTimeMs: 0,
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

function renderPanel(props: {
  result: DailySubmitResponse;
  speedBonusLabel: string;
}) {
  return render(<DailyResultPanel {...props} />);
}

describe("DailyResultPanel", () => {
  it("renders score, correct count, streak, and speed bonus label", () => {
    renderPanel({
      result: baseResult,
      speedBonusLabel: "Completed in 25000ms",
    });

    // next-intl mock returns the key path; assert against i18n keys.
    expect(screen.getByText("result.score")).toBeInTheDocument();
    expect(screen.getByText("result.correct")).toBeInTheDocument();
    expect(screen.getByText("result.streak")).toBeInTheDocument();
    expect(screen.getByText("result.speed")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("Completed in 25000ms")).toBeInTheDocument();
  });

  it("renders the perfect-run banner when all answers are correct", () => {
    const perfect = {
      ...baseResult,
      correctCount: 5,
      score: 5000,
      results: baseResult.results.map((r) => ({ ...r, isCorrect: true })),
    };
    renderPanel({ result: perfect, speedBonusLabel: "Completed in 20000ms" });
    expect(screen.getByText("result.perfectRun")).toBeInTheDocument();
  });

  it("does not render the perfect-run banner when any answer is wrong", () => {
    renderPanel({
      result: baseResult,
      speedBonusLabel: "Completed in 25000ms",
    });
    expect(screen.queryByText("result.perfectRun")).not.toBeInTheDocument();
  });

  it("renders one row per question with the correct / wrong visual treatment", () => {
    renderPanel({
      result: baseResult,
      speedBonusLabel: "Completed in 25000ms",
    });

    // 5 questions => 5 rows. Match by substring because the JSX wraps
    // each question label with the answer text, so the rendered text
    // is "result.questionLabel: Mercury", not an exact match.
    expect(
      screen.getAllByText((content) =>
        content.includes("result.questionLabel"),
      ),
    ).toHaveLength(5);

    // Correct rows use the mint background, wrong ones use the pink.
    expect(
      screen.getAllByText((content) => content.includes("result.skipped"))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText((content) => content.includes("result.correctAnswer"))
        .length,
    ).toBeGreaterThan(0);

    // The icons are aria-hidden, so the sr-only labels are the only
    // pass/fail signal assistive tech gets. baseResult is
    // [correct, wrong, correct, wrong, correct] => 3 correct, 2 wrong.
    expect(screen.getAllByText("result.srCorrect")).toHaveLength(3);
    expect(screen.getAllByText("result.srIncorrect")).toHaveLength(2);
  });

  it("renders the 'skipped' label for an empty answer", () => {
    renderPanel({
      result: baseResult,
      speedBonusLabel: "Completed in 25000ms",
    });
    // The 4th question (index 3) has an empty answer — the "skipped"
    // translation key path is rendered. Match by substring because the
    // JSX embeds the skipped label inside a larger text node.
    expect(
      screen.getAllByText((content) => content.includes("result.skipped"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("renders the explanation when the API provides one for a wrong answer", () => {
    renderPanel({
      result: baseResult,
      speedBonusLabel: "Completed in 25000ms",
    });
    // The explanation is rendered as plain text (no i18n wrapping), so
    // it shows up verbatim in the DOM.
    expect(
      screen.getByText("Venus is the second planet from the Sun."),
    ).toBeInTheDocument();
  });
});
