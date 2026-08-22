// Render tests for the game page's own logic (effects/handlers). The
// presentational organisms are stubbed (they have their own specs in
// components/game/*) so these tests focus on: snapshot hydration,
// answer-submit gating, spectator/eliminated derivation, the
// finished-match redirect, and the admin-termination toast + redirect.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import React, { Suspense } from "react";

const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  setState: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: Object.assign(() => h.state, {
    getState: () => h.state,
    setState: (...args: unknown[]) => h.setState(...args),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: h.toast }),
}));

vi.mock("@/components/ui/app-shell-layout", () => ({
  AppShellLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/",
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({
    push: h.push,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Stub the presentational organisms — surface just the props these
// tests assert on, plus click hooks for the interactive ones.
vi.mock("@/components/game", () => ({
  EliminatedOverlay: (p: { reason?: string | null }) => (
    <div
      data-testid="eliminated-overlay"
      data-reason={p.reason == null ? "" : p.reason}
    />
  ),
  SpectatorBanner: () => <div data-testid="spectator-banner" />,
  MatchFinishedOverlay: () => <div data-testid="finished-overlay" />,
  AntiHackNote: () => <div data-testid="anti-hack" />,
  GameStateRibbon: (p: {
    roundNo: number;
    livePlayerCount: number;
    maxPlayers: number;
  }) => (
    <div
      data-testid="ribbon"
      data-round={p.roundNo}
      data-live={p.livePlayerCount}
      data-max={p.maxPlayers}
    />
  ),
  QuestionCard: (p: { hasCurrentQuestion: boolean }) => (
    <div data-testid="question-card" data-has={String(p.hasCurrentQuestion)} />
  ),
  AnswerPanel: (p: {
    isSpectator: boolean;
    isEliminated: boolean;
    disabled: boolean;
    fakeFlaggedIndexes?: number[];
    onSelect: (o: string) => void;
  }) => (
    <button
      data-testid="answer-select"
      data-spectator={String(p.isSpectator)}
      data-eliminated={String(p.isEliminated)}
      data-disabled={String(p.disabled)}
      data-fake-flags={JSON.stringify(p.fakeFlaggedIndexes ?? [])}
      onClick={() => p.onSelect("B")}
    />
  ),
  OpponentsSidebar: (p: { players: unknown[]; userId: string | null }) => (
    <div
      data-testid="opponents"
      data-count={p.players.length}
      data-userid={String(p.userId)}
    />
  ),
  LeaveMatchButton: (p: { onClick: () => void; disabled?: boolean }) => (
    <button data-testid="leave-btn" disabled={p.disabled} onClick={p.onClick} />
  ),
  LeaveMatchModal: (p: { onConfirm: () => void }) => (
    <button data-testid="confirm-leave" onClick={p.onConfirm} />
  ),
  TopicVotingOverlay: () => <div data-testid="topic-voting-overlay" />,
  CardAnimation: () => <div data-testid="card-animation" />,
  CardGlyph: () => <span data-testid="card-glyph" />,
  ClassBadge: () => <div data-testid="class-badge" />,
  CardHand: () => <div data-testid="card-hand" />,
  CardOfferOverlay: () => <div data-testid="card-offer-overlay" />,
  CardTargetPicker: () => <div data-testid="card-target-picker" />,
}));

import GamePage from "./page";

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    match: null,
    submitAnswer: vi.fn(() => "sub-1"),
    userId: "me",
    lastAnswerResult: null,
    pendingAnswer: null,
    remainingCount: null,
    lastSeenSeqNo: 0,
    leaveRoom: vi.fn(),
    isEliminated: false,
    eliminationReason: null,
    roomTerminated: false,
    roomTerminationMessage: null,
    room: null,
    requestSnapshot: vi.fn(),
    consumeSecondChance: vi.fn(),
    ...overrides,
  };
}

async function renderPage(
  matchId = "m1",
  params = Promise.resolve({ matchId, locale: "en" }),
) {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <Suspense fallback={<div data-testid="fallback" />}>
        <GamePage params={params} />
      </Suspense>,
    );
    await params;
  });
  // second flush to let the resolved-params render commit its effects
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

const matchFixture = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  status: "IN_GAME",
  currentRoundNo: 2,
  players: [],
  currentQuestion: { id: "q1", content: "Q?", options: ["a", "b", "c", "d"] },
  roundEndTime: null,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  h.state = baseState();
  h.setState.mockClear();
  h.toast.mockClear();
  h.push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("GamePage — snapshot hydration", () => {
  it("requests a full snapshot (cursor 0) once on mount when there is no state yet", async () => {
    // Fresh load / late-joiner: no delta cursor, so the server must
    // full-hydrate us.
    h.state = baseState({ match: null, lastSeenSeqNo: 0 });
    await renderPage("m1");
    expect(h.state.requestSnapshot).toHaveBeenCalledTimes(1);
    expect(h.state.requestSnapshot).toHaveBeenCalledWith("m1", 0);
  });

  it("Plan D: requests a delta resync with the current cursor when match state already exists", async () => {
    // The store survived a client-side navigation, so we hold a cursor.
    // We still resync on mount, but sending the cursor lets the server
    // reply with a lightweight EVENT_BATCH delta instead of a full
    // roster — and applying a delta is non-destructive.
    h.state = baseState({ match: matchFixture(), lastSeenSeqNo: 7 });
    await renderPage("m1");
    expect(h.state.requestSnapshot).toHaveBeenCalledTimes(1);
    expect(h.state.requestSnapshot).toHaveBeenCalledWith("m1", 7);
  });
});

describe("GamePage — answer submission gating", () => {
  it("submits the answer for an active player", async () => {
    h.state = baseState({ match: matchFixture({ currentRoundNo: 2 }) });
    await renderPage("m1");
    fireEvent.click(screen.getByTestId("answer-select"));
    expect(h.state.submitAnswer).toHaveBeenCalledWith("m1", 2, "B");
  });

  it("allows retry submission when second chance is active", async () => {
    const scEffect = {
      matchId: "m1",
      roundNo: 2,
      targetRoundNo: 2,
      cardId: "TN-6",
      offerSeqNo: 1,
      playedByPlayerId: "me",
      targetPlayerIds: ["me"],
      effect: { kind: "SECOND_CHANCE" },
      resolution: "MUTATION",
      serverTimestamp: 1000,
      expiresAtServer: null,
      remainingMs: null,
    };
    h.state = baseState({
      match: matchFixture({ currentRoundNo: 2 }),
      pendingAnswer: {
        matchId: "m1",
        roundNo: 2,
        answer: "A",
        submissionId: "sub-prior",
      },
      cardState: {
        classId: "SUPPORT",
        hand: [],
        playedCardIds: ["TN-6"],
        offerSeqNoByCardId: {},
        currentOffer: null,
        lastResolvedEffect: scEffect,
        pendingNextRoundEffects: [],
        activeRoundEffects: [scEffect],
      },
    });
    await renderPage("m1");
    fireEvent.click(screen.getByTestId("answer-select"));
    expect(h.state.submitAnswer).toHaveBeenCalledWith("m1", 2, "B");
  });

  it("does not submit when the local user is a spectator", async () => {
    h.state = baseState({
      match: matchFixture(),
      room: { id: "r1", joinMode: "SPECTATOR" },
    });
    await renderPage("m1");
    expect(screen.getByTestId("answer-select").dataset.spectator).toBe("true");
    fireEvent.click(screen.getByTestId("answer-select"));
    expect(h.state.submitAnswer).not.toHaveBeenCalled();
  });

  it("does not submit while the round number is still 0", async () => {
    h.state = baseState({ match: matchFixture({ currentRoundNo: 0 }) });
    await renderPage("m1");
    fireEvent.click(screen.getByTestId("answer-select"));
    expect(h.state.submitAnswer).not.toHaveBeenCalled();
  });
});

describe("GamePage — derived UI flags", () => {
  it("shows fake flagged indexes until server expiry, then clears them", async () => {
    const fakeEffect = {
      matchId: "m1",
      roundNo: 2,
      targetRoundNo: 2,
      cardId: "TN-5",
      offerSeqNo: 1,
      playedByPlayerId: "other",
      targetPlayerIds: ["me"],
      effect: { kind: "OPTION_FAKE", indexes: [1, 2], durationMs: 3000 },
      resolution: "TEMPORARY",
      serverTimestamp: 1000,
      expiresAtServer: Date.now() + 3000,
      remainingMs: 3000,
    };
    h.state = baseState({
      match: matchFixture({ currentRoundNo: 2 }),
      cardState: {
        classId: "ATTACK",
        hand: [],
        playedCardIds: [],
        offerSeqNoByCardId: {},
        currentOffer: null,
        lastResolvedEffect: null,
        pendingNextRoundEffects: [],
        activeRoundEffects: [fakeEffect],
      },
    });
    await renderPage("m1");
    expect(screen.getByTestId("answer-select").dataset.fakeFlags).toBe(
      JSON.stringify([1, 2]),
    );

    // Advance timer past expiry
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });

    expect(screen.getByTestId("answer-select").dataset.fakeFlags).toBe(
      JSON.stringify([]),
    );
  });

  it("shows the eliminated overlay when isEliminated is set", async () => {
    h.state = baseState({ match: matchFixture(), isEliminated: true });
    await renderPage("m1");
    expect(screen.getByTestId("eliminated-overlay")).toBeInTheDocument();
  });

  it("forwards the eliminationReason from the store to EliminatedOverlay", async () => {
    h.state = baseState({
      match: matchFixture(),
      isEliminated: true,
      eliminationReason: "WRONG_ANSWER",
    });
    await renderPage("m1");
    expect(screen.getByTestId("eliminated-overlay")).toHaveAttribute(
      "data-reason",
      "WRONG_ANSWER",
    );
  });

  it("passes a null eliminationReason through to EliminatedOverlay (no reason line)", async () => {
    h.state = baseState({
      match: matchFixture(),
      isEliminated: true,
      eliminationReason: null,
    });
    await renderPage("m1");
    expect(screen.getByTestId("eliminated-overlay")).toHaveAttribute(
      "data-reason",
      "",
    );
  });

  it("shows the spectator banner for a non-eliminated spectator", async () => {
    h.state = baseState({
      match: matchFixture(),
      room: { id: "r1", joinMode: "SPECTATOR" },
    });
    await renderPage("m1");
    expect(screen.getByTestId("spectator-banner")).toBeInTheDocument();
  });

  it("passes remaining/total counts to the ribbon", async () => {
    h.state = baseState({
      match: matchFixture({ currentRoundNo: 3 }),
      remainingCount: 7,
      room: { id: "r1", joinMode: "PLAYER", maxPlayers: 50 },
    });
    await renderPage("m1");
    const ribbon = screen.getByTestId("ribbon");
    expect(ribbon.dataset.round).toBe("3");
    expect(ribbon.dataset.live).toBe("7");
    expect(ribbon.dataset.max).toBe("50");
  });
});

describe("GamePage — redirects", () => {
  it("redirects to the results page 3s after the match finishes", async () => {
    h.state = baseState({ match: matchFixture({ status: "FINISHED" }) });
    await renderPage("m1");
    expect(screen.getByTestId("finished-overlay")).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(h.push).toHaveBeenCalledWith("/result/m1");
  });

  it("toasts and bounces home when the room is terminated by admin", async () => {
    h.state = baseState({
      match: matchFixture(),
      roomTerminated: true,
      roomTerminationMessage: "boom",
    });
    await renderPage("m1");
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", description: "boom" }),
    );
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(h.push).toHaveBeenCalledWith("/");
  });

  it("cancels a pending result redirect when room termination wins", async () => {
    const params = Promise.resolve({ matchId: "m1", locale: "en" });
    h.state = baseState({ match: matchFixture({ status: "FINISHED" }) });
    const utils = await renderPage("m1", params);

    h.state = baseState({
      match: matchFixture({ status: "FINISHED" }),
      roomTerminated: true,
      roomTerminationMessage: "closed",
    });
    await act(async () => {
      utils.rerender(
        <Suspense fallback={<div data-testid="fallback" />}>
          <GamePage params={params} />
        </Suspense>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(h.push).toHaveBeenCalledWith("/");
    expect(h.push).not.toHaveBeenCalledWith("/result/m1");
  });
});

describe("GamePage — leave flow", () => {
  it("leaves the room and routes to create on confirm", async () => {
    h.state = baseState({
      match: matchFixture(),
      room: { id: "r1", joinMode: "PLAYER" },
    });
    await renderPage("m1");
    fireEvent.click(screen.getByTestId("confirm-leave"));
    expect(h.state.leaveRoom).toHaveBeenCalledWith("r1");
    expect(h.push).toHaveBeenCalledWith("/room/create");
  });
});
