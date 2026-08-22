import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";
import { ProfessorAvatar } from "./professor-avatar";
import { ProfessorDialogueBox } from "./professor-dialogue-box";
import { ProfessorHudWidget } from "./professor-hud-widget";
import {
  getRandomProfessorDialogue,
  useSafeLocale,
} from "./professor-roast-engine";

describe("ProfessorAvatar", () => {
  it("renders SVG with aria-hidden and focusable attributes", () => {
    const { container } = render(<ProfessorAvatar mood="idle" size="md" />);
    const svg = container.querySelector("svg.overflow-visible");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("renders nameplate when showNameplate is true", () => {
    render(<ProfessorAvatar showNameplate={true} />);
    expect(screen.getByText("name")).toBeInTheDocument();
  });
});

describe("ProfessorDialogueBox", () => {
  it("renders dialogue text and variant correctly without hardcoded text-candy-ink on paragraph", () => {
    render(
      <ProfessorDialogueBox
        text="Hello Student!"
        variant="chalkboard"
        tailPosition="top"
      />,
    );
    expect(screen.getByText(/Hello Student!/)).toBeInTheDocument();
    const p = screen.getByText(/Hello Student!/);
    expect(p).not.toHaveClass("text-candy-ink");
  });

  it("calls onDismiss when close button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ProfessorDialogueBox text="Test" onDismiss={onDismiss} />);
    const closeBtn = screen.getByRole("button", { name: "closeDialogue" });
    closeBtn.click();
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("professor-roast-engine", () => {
  it("returns a valid DialogueData with key and mood", () => {
    const result = getRandomProfessorDialogue("home_greeting");
    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("mood");
    expect(result.key).toMatch(/^dialogues\.home_greeting\.\d+$/);
  });

  it("returns a valid locale from useSafeLocale", () => {
    // Under vitest setup, useLocale returns "en"
    const { result } = renderHook(() => useSafeLocale());
    expect(result.current).toBe("en");
  });
});

describe("ProfessorHudWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders widget with simplified aria-label", () => {
    render(<ProfessorHudWidget timeLeft={10} />);
    const aside = screen.getByRole("complementary", {
      name: "professorSupervisorLabel",
    });
    expect(aside).toBeInTheDocument();
    expect(screen.getByText("supervisorTitle")).toBeInTheDocument();
  });

  it("does not overwrite manual poke immediately on timeLeft tick", async () => {
    const { rerender } = render(
      <ProfessorHudWidget timeLeft={10} hasAnswered={false} />,
    );

    // Poke the professor
    const pokeButton = screen.getByRole("button", { name: "pokeGameTitle" });
    act(() => {
      pokeButton.click();
    });

    const pokedDialogue = screen.getByText(/dialogues\.game_round_start/);
    expect(pokedDialogue).toBeInTheDocument();

    // Advance 1 second and rerender with timeLeft=9
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<ProfessorHudWidget timeLeft={9} hasAnswered={false} />);

    // Dialogue should still be the poked dialogue, not overwritten by defaultRoundHint
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();
  });

  it("does not overwrite manual poke during last seconds until poke cooldown passes, then triggers panic", () => {
    const { rerender } = render(
      <ProfessorHudWidget timeLeft={10} hasAnswered={false} />,
    );

    // Poke the professor
    const pokeButton = screen.getByRole("button", { name: "pokeGameTitle" });
    act(() => {
      pokeButton.click();
    });
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Rerender with timeLeft=4 (isLastSeconds=true) after 1s (cooldown still active)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<ProfessorHudWidget timeLeft={4} hasAnswered={false} />);
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Advance beyond 4000ms poke cooldown and rerender with timeLeft=3
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    rerender(<ProfessorHudWidget timeLeft={3} hasAnswered={false} />);
    expect(
      screen.getByText(/dialogues\.game_last_seconds/),
    ).toBeInTheDocument();
  });

  it("restores default dialogue when transitioning out of countdown state", () => {
    const { rerender } = render(
      <ProfessorHudWidget timeLeft={3} hasAnswered={false} />,
    );
    expect(
      screen.getByText(/dialogues\.game_last_seconds/),
    ).toBeInTheDocument();

    // Transition to next round (timeLeft=10, isLastSeconds becomes false)
    rerender(<ProfessorHudWidget timeLeft={10} hasAnswered={false} />);
    expect(screen.getByText(/defaultRoundHint/)).toBeInTheDocument();
  });
});
