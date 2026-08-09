"use client";

import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeState: {
  accessToken: string | null;
} = { accessToken: "tok-xyz" };

function mockUseSocketStore<T>(
  selector?: (s: typeof storeState) => T,
): T | typeof storeState {
  return selector ? selector(storeState) : storeState;
}
mockUseSocketStore.getState = () => storeState;

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: mockUseSocketStore,
}));

const getDailyToday = vi.fn();
const submitDaily = vi.fn();
const getDailyLeaderboard = vi.fn();

vi.mock("@/lib/api/daily", () => ({
  getDailyToday: (...args: unknown[]) => getDailyToday(...args),
  submitDaily: (...args: unknown[]) => submitDaily(...args),
  getDailyLeaderboard: (...args: unknown[]) => getDailyLeaderboard(...args),
}));

import {
  useDailyLeaderboard,
  useDailyToday,
  useSubmitDaily,
} from "./use-daily-challenge";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useDailyToday", () => {
  beforeEach(() => {
    storeState.accessToken = "tok-xyz";
    getDailyToday.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches /daily/today with the current access token", async () => {
    getDailyToday.mockResolvedValue({
      dateKey: "2026-08-09",
      version: 1,
      questions: [],
      sessionToken: "sess",
      serverTime: "2026-08-09T00:00:00.000Z",
      nextResetAt: "2026-08-10T00:00:00.000Z",
      alreadyAttempted: false,
    });

    const { result } = renderHook(() => useDailyToday(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(getDailyToday).toHaveBeenCalledTimes(1));
    expect(getDailyToday).toHaveBeenCalledWith("tok-xyz");
    await waitFor(() =>
      expect(result.current.data?.dateKey).toBe("2026-08-09"),
    );
  });

  it("passes undefined token through to the API when not authenticated", async () => {
    storeState.accessToken = null;
    getDailyToday.mockResolvedValue({ questions: [] });

    renderHook(() => useDailyToday(), { wrapper: makeWrapper() });

    await waitFor(() => expect(getDailyToday).toHaveBeenCalledTimes(1));
    expect(getDailyToday).toHaveBeenCalledWith(undefined);
  });
});

describe("useSubmitDaily", () => {
  beforeEach(() => {
    submitDaily.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes body and token to the API and reports success", async () => {
    submitDaily.mockResolvedValue({
      dateKey: "2026-08-09",
      version: 1,
      score: 600,
      correctCount: 4,
      totalQuestions: 5,
      elapsedMs: 25_000,
      streakBefore: 0,
      streakAfter: 0,
      results: [],
      completedAt: "2026-08-09T10:15:00.000Z",
    });

    const invalidateSpy = vi.fn();

    const { result } = renderHook(
      () => {
        const qc = useQueryClient();
        qc.invalidateQueries = invalidateSpy.mockImplementation(
          () => {},
        ) as typeof qc.invalidateQueries;
        return useSubmitDaily();
      },
      { wrapper: makeWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        token: "tok-xyz",
        body: { sessionToken: "sess", answers: [] },
      });
    });

    expect(submitDaily).toHaveBeenCalledWith(
      { sessionToken: "sess", answers: [] },
      "tok-xyz",
    );
    // onSuccess must invalidate both the today cache and the
    // leaderboard cache so the post-submit UI sees fresh state.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["daily", "today"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["daily", "leaderboard"],
    });
    // `mutateAsync` awaits the resolution, but the React state
    // (`isSuccess`) updates in a microtask after — so wait for it.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useDailyLeaderboard", () => {
  beforeEach(() => {
    getDailyLeaderboard.mockReset();
    getDailyLeaderboard.mockResolvedValue({
      dateKey: "2026-08-09",
      generatedAt: "2026-08-09T10:16:00.000Z",
      cached: true,
      items: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through dateKey and limit", async () => {
    renderHook(
      () => useDailyLeaderboard({ dateKey: "2026-08-08", limit: 25 }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(getDailyLeaderboard).toHaveBeenCalledTimes(1));
    expect(getDailyLeaderboard).toHaveBeenCalledWith({
      dateKey: "2026-08-08",
      limit: 25,
    });
  });
});
