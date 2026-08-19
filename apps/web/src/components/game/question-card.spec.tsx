// Unit tests for QuestionCard (extracted from game page.tsx).
// Validates: question text vs loading skeleton, and locked/waiting status.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QuestionCard } from "./question-card";

describe("QuestionCard", () => {
  it("renders the question text when a question is available", () => {
    render(
      <QuestionCard
        hasCurrentQuestion={true}
        questionText="What is 2 + 2?"
        roundCompleted={false}
      />,
    );
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-question")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when no question is available", () => {
    render(
      <QuestionCard
        hasCurrentQuestion={false}
        questionText=""
        roundCompleted={false}
      />,
    );
    expect(screen.getByTestId("loading-question")).toBeInTheDocument();
  });

  it("shows the waiting status while the round is live", () => {
    render(
      <QuestionCard
        hasCurrentQuestion={true}
        questionText="Q"
        roundCompleted={false}
      />,
    );
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.queryByText("lockedAnswer")).not.toBeInTheDocument();
  });

  it("shows the locked status once the round is completed", () => {
    render(
      <QuestionCard
        hasCurrentQuestion={true}
        questionText="Q"
        roundCompleted={true}
      />,
    );
    expect(screen.getByText("lockedAnswer")).toBeInTheDocument();
  });

  it("applies 180° flip styles when isSemanticFlipped is active", () => {
    const { container } = render(
      <QuestionCard
        hasCurrentQuestion={true}
        questionText="Flipped Question Text"
        roundCompleted={false}
        isSemanticFlipped={true}
      />,
    );
    const heading = screen.getByText("Flipped Question Text");
    expect(heading.className).toContain("scale-y-[-1]");
    expect(container.textContent).toContain("LẬT NGỮ NGHĨA (CB-7)");
  });
});
