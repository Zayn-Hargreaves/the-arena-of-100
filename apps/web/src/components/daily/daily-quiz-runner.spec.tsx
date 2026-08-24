import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyQuizRunner } from "./daily-quiz-runner";
import type { DailyAnswerInput, DailyQuestionPublic } from "../../types/daily";

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useTranslations: vi.fn((_namespace?: string) =>
      vi.fn((key: string) => key),
    ),
  };
});

const sampleQuestion: DailyQuestionPublic = {
  content: "What is the speed of light?",
  options: ["300,000 km/s", "150,000 km/s", "1,000 km/s", "Infinite"],
  difficulty: "MEDIUM",
  category: "SCIENCE",
};

describe("DailyQuizRunner", () => {
  it("renders progress and current question card when question is provided", () => {
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(sampleQuestion.content)).toBeInTheDocument();
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "5");
  });

  it("renders correctly when currentQuestion is undefined", () => {
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={undefined}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByText(sampleQuestion.content)).not.toBeInTheDocument();
    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "1");
    expect(progress).toHaveAttribute("aria-valuemax", "5");
  });

  it("triggers onSelectAnswer when an option is chosen", () => {
    const handleSelect = vi.fn();
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={handleSelect}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /300,000 km\/s/ }));
    expect(handleSelect).toHaveBeenCalledWith("300,000 km/s");
  });

  it("handles back button interactions", () => {
    const handleBack = vi.fn();
    const { rerender } = render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={[{ answer: "300,000 km/s", responseTimeMs: 1000 }]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={handleBack}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const backButton = screen.getByRole("button", { name: "back" });
    expect(backButton).toBeDisabled();

    rerender(
      <DailyQuizRunner
        questionIndex={1}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={[{ answer: "300,000 km/s", responseTimeMs: 1000 }]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={handleBack}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(backButton).not.toBeDisabled();
    fireEvent.click(backButton);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("handles next button interactions and validation", () => {
    const handleNext = vi.fn();
    const answers: DailyAnswerInput[] = [];

    const { rerender } = render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={answers}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={handleNext}
        onSubmit={vi.fn()}
      />,
    );

    const nextButton = screen.getByRole("button", { name: "next" });
    expect(nextButton).toBeDisabled();

    rerender(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={5}
        currentQuestion={sampleQuestion}
        answers={[{ answer: "300,000 km/s", responseTimeMs: 1000 }]}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={handleNext}
        onSubmit={vi.fn()}
      />,
    );

    expect(nextButton).not.toBeDisabled();
    fireEvent.click(nextButton);
    expect(handleNext).toHaveBeenCalledTimes(1);
  });

  it("handles submit button interactions on final question", () => {
    const handleSubmit = vi.fn();
    const answers: DailyAnswerInput[] = [
      { answer: "A", responseTimeMs: 500 },
      { answer: "B", responseTimeMs: 500 },
    ];

    const { rerender } = render(
      <DailyQuizRunner
        questionIndex={1}
        questionCount={2}
        currentQuestion={sampleQuestion}
        answers={answers}
        allAnswered={false}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    const submitButton = screen.getByRole("button", { name: "submit" });
    expect(submitButton).toBeDisabled();

    // All answered but submitting
    rerender(
      <DailyQuizRunner
        questionIndex={1}
        questionCount={2}
        currentQuestion={sampleQuestion}
        answers={answers}
        allAnswered={true}
        submitting={true}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );
    expect(submitButton).toBeDisabled();

    // All answered and not submitting
    rerender(
      <DailyQuizRunner
        questionIndex={1}
        questionCount={2}
        currentQuestion={sampleQuestion}
        answers={answers}
        allAnswered={true}
        submitting={false}
        submitError={null}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders 409 error message when submitError status is 409", () => {
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={1}
        currentQuestion={sampleQuestion}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={{ status: 409, message: "Already submitted" }}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("error.alreadySubmitted")).toBeInTheDocument();
  });

  it("renders 429 error message when submitError status is 429", () => {
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={1}
        currentQuestion={sampleQuestion}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={{ status: 429, message: "Rate limit exceeded" }}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("error.rateLimited")).toBeInTheDocument();
  });

  it("renders generic error message when submitError is other status", () => {
    render(
      <DailyQuizRunner
        questionIndex={0}
        questionCount={1}
        currentQuestion={sampleQuestion}
        answers={[]}
        allAnswered={false}
        submitting={false}
        submitError={{ status: 500, message: "Internal server error" }}
        onSelectAnswer={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("error.submitFailed: Internal server error"),
    ).toBeInTheDocument();
  });
});
