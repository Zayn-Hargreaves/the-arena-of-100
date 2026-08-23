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
});
