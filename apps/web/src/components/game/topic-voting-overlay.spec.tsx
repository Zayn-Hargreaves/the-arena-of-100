import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("renders candidates and voting header", () => {
    render(<TopicVotingOverlay />);
    expect(screen.getByText("Khoa Học & Tự Nhiên")).toBeInTheDocument();
    expect(screen.getByText("Lịch Sử & Thế Giới")).toBeInTheDocument();
    expect(screen.getByText("Công Nghệ & IT")).toBeInTheDocument();
  });

  it("calls voteBanTopic when a topic card is clicked", () => {
    render(<TopicVotingOverlay />);
    const scienceCard = screen.getByText("Khoa Học & Tự Nhiên");
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
    const scienceCard = screen.getByText("Khoa Học & Tự Nhiên");
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
});
