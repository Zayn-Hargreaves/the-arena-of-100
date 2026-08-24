import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ProfessorAvatar } from "./professor-avatar";
import { ProfessorDialogueBox } from "./professor-dialogue-box";
import { ProfessorHudWidget } from "./professor-hud-widget";
import {
  getRandomProfessorDialogue,
  PROFESSOR_DIALOGUES,
} from "./professor-roast-engine";
import * as roastEngine from "./professor-roast-engine";
import enMessages from "../../../messages/en.json";
import viMessages from "../../../messages/vi.json";

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
    fireEvent.click(closeBtn);
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

  it("ensures all dialogue keys in PROFESSOR_DIALOGUES exist in both message catalogs", () => {
    const allDialogueKeys = Object.values(PROFESSOR_DIALOGUES)
      .flat()
      .map((d) => d.key);

    for (const key of allDialogueKeys) {
      const parts = key.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("dialogues");
      const context = parts[1] as keyof typeof enMessages.Professor.dialogues;
      const index = parts[2];

      expect(index).toBeDefined();
      expect(index).toMatch(/^\d+$/);

      // Check en.json
      expect(enMessages.Professor.dialogues).toHaveProperty(context);
      expect(
        (enMessages.Professor.dialogues[context] as Record<string, string>)[
          index
        ],
      ).toBeDefined();

      // Check vi.json
      expect(viMessages.Professor.dialogues).toHaveProperty(context);
      expect(
        (viMessages.Professor.dialogues[context] as Record<string, string>)[
          index
        ],
      ).toBeDefined();
    }
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

  it("displays game_eliminated dialogue when isEliminated is true", () => {
    render(<ProfessorHudWidget timeLeft={10} isEliminated={true} />);
    expect(screen.getByText(/dialogues\.game_eliminated/)).toBeInTheDocument();
  });

  it("displays game_correct_answer dialogue when hasAnswered is true and isCorrect is true", () => {
    render(
      <ProfessorHudWidget timeLeft={10} hasAnswered={true} isCorrect={true} />,
    );
    expect(
      screen.getByText(/dialogues\.game_correct_answer/),
    ).toBeInTheDocument();
  });

  it("displays game_wrong_answer dialogue when hasAnswered is true and isCorrect is false", () => {
    render(
      <ProfessorHudWidget timeLeft={10} hasAnswered={true} isCorrect={false} />,
    );
    expect(
      screen.getByText(/dialogues\.game_wrong_answer/),
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

  it("selects game_last_seconds dialogue once during countdown 4 -> 3 -> 2 and allows reselection in new cycle", () => {
    const spy = vi.spyOn(roastEngine, "getRandomProfessorDialogue");

    // Countdown starts at timeLeft = 4
    const { rerender } = render(
      <ProfessorHudWidget timeLeft={4} hasAnswered={false} />,
    );

    const initialCalls = spy.mock.calls.filter(
      (call) => call[0] === "game_last_seconds",
    ).length;
    expect(initialCalls).toBe(1);
    expect(
      screen.getByText(/dialogues\.game_last_seconds/),
    ).toBeInTheDocument();
    const firstDialogueText = screen.getByText(
      /dialogues\.game_last_seconds/,
    ).textContent;

    // Countdown advances to 3
    rerender(<ProfessorHudWidget timeLeft={3} hasAnswered={false} />);
    const callsAt3 = spy.mock.calls.filter(
      (call) => call[0] === "game_last_seconds",
    ).length;
    expect(callsAt3).toBe(1);
    expect(screen.getByText(/dialogues\.game_last_seconds/).textContent).toBe(
      firstDialogueText,
    );

    // Countdown advances to 2
    rerender(<ProfessorHudWidget timeLeft={2} hasAnswered={false} />);
    const callsAt2 = spy.mock.calls.filter(
      (call) => call[0] === "game_last_seconds",
    ).length;
    expect(callsAt2).toBe(1);
    expect(screen.getByText(/dialogues\.game_last_seconds/).textContent).toBe(
      firstDialogueText,
    );

    // Countdown ends and new cycle starts (timeLeft = 10)
    rerender(<ProfessorHudWidget timeLeft={10} hasAnswered={false} />);
    expect(screen.getByText(/defaultRoundHint/)).toBeInTheDocument();

    // New countdown cycle reaches <= 4 (timeLeft = 4)
    rerender(<ProfessorHudWidget timeLeft={4} hasAnswered={false} />);
    const callsInNewCycle = spy.mock.calls.filter(
      (call) => call[0] === "game_last_seconds",
    ).length;
    expect(callsInNewCycle).toBe(2);

    spy.mockRestore();
  });

  it("re-triggers poke timer when poked while timeLeft is at most 4", () => {
    render(<ProfessorHudWidget timeLeft={3} hasAnswered={false} />);

    // Initially in panic state because timeLeft=3 (<= 4)
    expect(
      screen.getByText(/dialogues\.game_last_seconds/),
    ).toBeInTheDocument();

    // Poke the professor while already in last seconds
    const pokeButton = screen.getByRole("button", { name: "pokeGameTitle" });
    act(() => {
      pokeButton.click();
    });

    // Dialogue immediately updates to poked round start dialogue
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Advance 2000ms - poke dialogue persists and is not prematurely overwritten
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Advance remaining 2000ms (total 4000ms) - timer fires and transitions back to last seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByText(/dialogues\.game_last_seconds/),
    ).toBeInTheDocument();
  });

  it("restores default dialogue when transitioning from timeLeft=3 to timeLeft=10 during active poke cooldown", () => {
    const { rerender } = render(
      <ProfessorHudWidget timeLeft={3} hasAnswered={false} />,
    );

    // Poke professor at timeLeft=3
    const pokeButton = screen.getByRole("button", { name: "pokeGameTitle" });
    act(() => {
      pokeButton.click();
    });
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Advance 1000ms (3000ms remaining in cooldown)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Next round starts (timeLeft=10)
    rerender(<ProfessorHudWidget timeLeft={10} hasAnswered={false} />);

    // Poked dialogue is still maintained during the remaining cooldown
    expect(screen.getByText(/dialogues\.game_round_start/)).toBeInTheDocument();

    // Advance remaining 3000ms cooldown
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Default round hint dialogue is restored
    expect(screen.getByText(/defaultRoundHint/)).toBeInTheDocument();
  });
});
