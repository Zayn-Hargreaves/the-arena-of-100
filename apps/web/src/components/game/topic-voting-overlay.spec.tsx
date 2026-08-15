import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { TopicVotingOverlay } from "./topic-voting-overlay";
import { useSocketStore } from "../../stores/socket-store";

describe("TopicVotingOverlay", () => {
  const voteBanTopicMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSocketStore.setState({
      voteBanTopic: voteBanTopicMock,
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: Date.now() + 10000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: { SCIENCE: 2, HISTORY: 1, TECH: 0 },
        totalVotes: 3,
        bannedTopics: [],
        activeTopics: [],
        isFinished: false,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders candidates and voting header", () => {
    render(<TopicVotingOverlay />);
    expect(screen.getByText("SCIENCE")).toBeInTheDocument();
    expect(screen.getByText("HISTORY")).toBeInTheDocument();
    expect(screen.getByText("TECH")).toBeInTheDocument();
  });

  it("calls voteBanTopic when a topic card is clicked", () => {
    render(<TopicVotingOverlay />);
    const scienceCard = screen.getByText("SCIENCE");
    fireEvent.click(scienceCard);
    expect(voteBanTopicMock).toHaveBeenCalledWith("m1", "SCIENCE");
  });

  it("renders banned state when isFinished is true", () => {
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: Date.now() - 1000,
        durationMs: 10000,
        myVotedTopic: "SCIENCE",
        voteCounts: { SCIENCE: 5, HISTORY: 3, TECH: 1 },
        totalVotes: 9,
        bannedTopics: ["SCIENCE", "HISTORY"],
        activeTopics: ["TECH"],
        isFinished: true,
      },
    });

    render(<TopicVotingOverlay />);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("disables topic buttons when isFinished is true", () => {
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: Date.now() - 1000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: { SCIENCE: 5, HISTORY: 3, TECH: 1 },
        totalVotes: 9,
        bannedTopics: ["SCIENCE", "HISTORY"],
        activeTopics: ["TECH"],
        isFinished: true,
      },
    });

    render(<TopicVotingOverlay />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it("does not call voteBanTopic when handleVote is invoked while isFinished is true", () => {
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
        endsAt: Date.now() - 1000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: { SCIENCE: 5, HISTORY: 3, TECH: 1 },
        totalVotes: 9,
        bannedTopics: ["SCIENCE", "HISTORY"],
        activeTopics: ["TECH"],
        isFinished: true,
      },
    });

    render(<TopicVotingOverlay />);
    const scienceCard = screen.getByText("SCIENCE");
    const button = scienceCard.closest("button") as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    button.disabled = false;
    fireEvent.click(button);
    expect(voteBanTopicMock).not.toHaveBeenCalled();
  });

  it("traps focus and focuses the first interactive element when hydrated after initial empty render", () => {
    useSocketStore.setState({ topicVoting: null });
    const { rerender } = render(<TopicVotingOverlay />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => {
      useSocketStore.setState({
        topicVoting: {
          matchId: "m1",
          candidateTopics: ["SCIENCE", "HISTORY", "TECH"],
          endsAt: Date.now() + 10000,
          durationMs: 10000,
          myVotedTopic: null,
          voteCounts: { SCIENCE: 0, HISTORY: 0, TECH: 0 },
          totalVotes: 0,
          bannedTopics: [],
          activeTopics: [],
          isFinished: false,
        },
      });
    });

    rerender(<TopicVotingOverlay />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("handles unknown topic fallback and all standard topic metadata", () => {
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: [
          "GENERAL",
          "GEOGRAPHY",
          "ENTERTAINMENT",
          "SPORTS",
          "LOGIC",
          "CUSTOM_UNKNOWN_TOPIC",
        ],
        endsAt: Date.now() + 10000,
        durationMs: 10000,
        myVotedTopic: "GENERAL",
        voteCounts: { GENERAL: 4, CUSTOM_UNKNOWN_TOPIC: 1 },
        totalVotes: 5,
        bannedTopics: [],
        activeTopics: [],
        isFinished: false,
      },
    });

    render(<TopicVotingOverlay />);
    expect(screen.getByText("GENERAL")).toBeInTheDocument();
    expect(screen.getByText("GEOGRAPHY")).toBeInTheDocument();
    expect(screen.getByText("ENTERTAINMENT")).toBeInTheDocument();
    expect(screen.getByText("SPORTS")).toBeInTheDocument();
    expect(screen.getByText("LOGIC")).toBeInTheDocument();
    expect(screen.getByText("CUSTOM_UNKNOWN_TOPIC")).toBeInTheDocument();
  });

  it("handles timer tick, zero clamp, and keyboard escape", () => {
    vi.useFakeTimers();
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE"],
        endsAt: Date.now() + 2000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: { SCIENCE: 0 },
        totalVotes: 0,
        bannedTopics: [],
        activeTopics: [],
        isFinished: false,
      },
    });

    render(<TopicVotingOverlay />);
    expect(screen.getByText("2s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("0s")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    // Mandatory voting overlay remains open and non-dismissible on Escape
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(useSocketStore.getState().topicVoting).not.toBeNull();
  });

  it("handles tab navigation wrapping within focus trap", () => {
    useSocketStore.setState({
      topicVoting: {
        matchId: "m1",
        candidateTopics: ["SCIENCE", "HISTORY"],
        endsAt: Date.now() + 10000,
        durationMs: 10000,
        myVotedTopic: null,
        voteCounts: {},
        totalVotes: 0,
        bannedTopics: [],
        activeTopics: [],
        isFinished: false,
      },
    });

    render(<TopicVotingOverlay />);
    const buttons = screen.getAllByRole("button");
    buttons[buttons.length - 1].focus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});
