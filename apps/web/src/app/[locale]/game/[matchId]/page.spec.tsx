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
  EliminatedOverlay: () => <div data-testid="eliminated-overlay" />,
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
    onSelect: (o: string) => void;
  }) => (
    <button
      data-testid="answer-select"
      data-spectator={String(p.isSpectator)}
      data-eliminated={String(p.isEliminated)}
      data-disabled={String(p.disabled)}
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
    leaveRoom: vi.fn(),
    isEliminated: false,
    eliminationReason: null,
    roomTerminated: false,
    roomTerminationMessage: null,
    room: null,
    requestSnapshot: vi.fn(),
    ...overrides,
  };
}

async function renderPage(matchId = "m1") {
  const params = Promise.resolve({ matchId, locale: "en" });
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
  it("requests a snapshot exactly once on mount when match is null", async () => {
    h.state = baseState({ match: null });
    await renderPage("m1");
    expect(h.state.requestSnapshot).toHaveBeenCalledTimes(1);
    expect(h.state.requestSnapshot).toHaveBeenCalledWith("m1", 0);
  });

  it("does NOT request a snapshot when match state already exists", async () => {
    h.state = baseState({ match: matchFixture() });
    await renderPage("m1");
    expect(h.state.requestSnapshot).not.toHaveBeenCalled();
  });
});

describe("GamePage — answer submission gating", () => {
  it("submits the answer for an active player", async () => {
    h.state = baseState({ match: matchFixture({ currentRoundNo: 2 }) });
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
  it("shows the eliminated overlay when isEliminated is set", async () => {
    h.state = baseState({ match: matchFixture(), isEliminated: true });
    await renderPage("m1");
    expect(screen.getByTestId("eliminated-overlay")).toBeInTheDocument();
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
