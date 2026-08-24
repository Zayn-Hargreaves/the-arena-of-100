"use client";

import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyQuestionCard } from "./daily-question-card";
import type { DailyQuestionPublic } from "../../types/daily";

const question: DailyQuestionPublic = {
  content: "Which planet is closest to the Sun?",
  options: ["Mercury", "Venus", "Earth", "Mars"],
  difficulty: "EASY",
  category: "SCIENCE",
};

describe("DailyQuestionCard", () => {
  it("renders the question and all options", () => {
    render(
      <DailyQuestionCard
        question={question}
        questionNumber={1}
        totalQuestions={5}
        selected={null}
        locked={false}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText(question.content)).toBeInTheDocument();
    for (const option of question.options) {
      expect(
        screen.getByRole("button", { name: new RegExp(option) }),
      ).toBeInTheDocument();
    }
  });

  it("invokes onSelect with the chosen option", () => {
    const handleSelect = vi.fn();
    render(
      <DailyQuestionCard
        question={question}
        questionNumber={1}
        totalQuestions={5}
        selected={null}
        locked={false}
        onSelect={handleSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Venus/ }));
    expect(handleSelect).toHaveBeenCalledWith("Venus");
  });

  it("disables all options when locked", () => {
    const handleSelect = vi.fn();
    render(
      <DailyQuestionCard
        question={question}
        questionNumber={1}
        totalQuestions={5}
        selected="Mercury"
        locked
        revealCorrectAnswer="Mercury"
        onSelect={handleSelect}
      />,
    );

    for (const option of question.options) {
      expect(
        screen.getByRole("button", { name: new RegExp(option) }),
      ).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: /Mars/ }));
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it("applies selected state styling when an option is selected and not locked", () => {
    render(
      <DailyQuestionCard
        question={question}
        questionNumber={2}
        totalQuestions={5}
        selected="Venus"
        locked={false}
        onSelect={() => undefined}
      />,
    );

    const venusButton = screen.getByRole("button", { name: /Venus/ });
    expect(venusButton).toHaveAttribute("aria-pressed", "true");
    expect(venusButton.className).toContain("bg-candy-yellow");
  });

  it("applies wrong selected state styling when locked and selected is incorrect", () => {
    render(
      <DailyQuestionCard
        question={question}
        questionNumber={3}
        totalQuestions={5}
        selected="Earth"
        locked={true}
        revealCorrectAnswer="Mercury"
        onSelect={() => undefined}
      />,
    );

    const earthButton = screen.getByRole("button", { name: /Earth/ });
    const mercuryButton = screen.getByRole("button", { name: /Mercury/ });
    expect(earthButton.className).toContain("bg-candy-pink/30");
    expect(mercuryButton.className).toContain("bg-candy-mint");
  });

  it("supports more than 4 options using numeric fallback and handles MEDIUM/HARD difficulty", () => {
    const hardQuestion: DailyQuestionPublic = {
      content: "Hard question with 5 options?",
      options: ["Opt 1", "Opt 2", "Opt 3", "Opt 4", "Opt 5"],
      difficulty: "HARD",
      category: "TECHNOLOGY",
    };

    render(
      <DailyQuestionCard
        question={hardQuestion}
        questionNumber={4}
        totalQuestions={5}
        selected={null}
        locked={false}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("difficulty.HARD")).toBeInTheDocument();
  });

  it("handles MEDIUM difficulty", () => {
    const mediumQuestion: DailyQuestionPublic = {
      content: "Medium question?",
      options: ["Opt 1", "Opt 2"],
      difficulty: "MEDIUM",
      category: "SCIENCE",
    };

    render(
      <DailyQuestionCard
        question={mediumQuestion}
        questionNumber={1}
        totalQuestions={2}
        selected={null}
        locked={false}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText("difficulty.MEDIUM")).toBeInTheDocument();
  });
});
