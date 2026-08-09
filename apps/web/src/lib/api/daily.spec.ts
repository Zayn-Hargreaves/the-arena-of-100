// Unit tests for the Daily Challenge API wrapper.
//
// The wrapper itself is just a thin pass-through to `apiGetJson` /
// `apiSendJson`. The valuable behavior to lock down is path /
// query construction, auth token propagation, and the JSON body
// shape passed to POST — that is, all the bits a future contributor
// could quietly break.

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGetJson = vi.hoisted(() => vi.fn());
const apiSendJson = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
}));

import { getDailyLeaderboard, getDailyToday, submitDaily } from "./daily";

describe("getDailyToday", () => {
  beforeEach(() => {
    apiGetJson.mockReset();
    apiGetJson.mockResolvedValue({ dateKey: "2026-08-09" });
  });

  it("hits /daily/today without an auth header when anonymous", async () => {
    await getDailyToday();
    expect(apiGetJson).toHaveBeenCalledWith("/daily/today", undefined);
  });

  it("forwards the auth token when provided", async () => {
    await getDailyToday("tok-123");
    expect(apiGetJson).toHaveBeenCalledWith("/daily/today", "tok-123");
  });
});

describe("submitDaily", () => {
  beforeEach(() => {
    apiSendJson.mockReset();
    apiSendJson.mockResolvedValue({ score: 600 });
  });

  it("POSTs the body and token to /daily/submit", async () => {
    const body = {
      sessionToken: "sess-abc",
      answers: [{ answer: "Mercury", responseTimeMs: 1500 }],
    };
    const result = await submitDaily(body, "tok-xyz");

    expect(apiSendJson).toHaveBeenCalledWith(
      "/daily/submit",
      "POST",
      body,
      "tok-xyz",
    );
    expect(result).toEqual({ score: 600 });
  });

  it("passes through empty answers unchanged", async () => {
    const body = { sessionToken: "sess", answers: [] };
    await submitDaily(body, "tok-xyz");
    expect(apiSendJson).toHaveBeenCalledWith(
      "/daily/submit",
      "POST",
      body,
      "tok-xyz",
    );
  });
});

describe("getDailyLeaderboard", () => {
  beforeEach(() => {
    apiGetJson.mockReset();
    apiGetJson.mockResolvedValue({ items: [] });
  });

  it("uses the bare /daily/leaderboard path when no filters are provided", async () => {
    await getDailyLeaderboard();
    expect(apiGetJson).toHaveBeenCalledWith("/daily/leaderboard");
  });

  it("appends only the provided dateKey to the querystring", async () => {
    await getDailyLeaderboard({ dateKey: "2026-08-08" });
    expect(apiGetJson).toHaveBeenCalledWith(
      "/daily/leaderboard?dateKey=2026-08-08",
    );
  });

  it("appends only the provided limit when dateKey is omitted", async () => {
    await getDailyLeaderboard({ limit: 25 });
    expect(apiGetJson).toHaveBeenCalledWith("/daily/leaderboard?limit=25");
  });

  it("preserves the order dateKey then limit in the querystring", async () => {
    await getDailyLeaderboard({ dateKey: "2026-08-08", limit: 10 });
    expect(apiGetJson).toHaveBeenCalledWith(
      "/daily/leaderboard?dateKey=2026-08-08&limit=10",
    );
  });

  it("treats empty / whitespace dateKey as absent", async () => {
    await getDailyLeaderboard({ dateKey: "   ", limit: 5 });
    expect(apiGetJson).toHaveBeenCalledWith("/daily/leaderboard?limit=5");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a fraction", 2.5],
    ["zero", 0],
    ["a negative", -10],
    ["above the backend maximum", 101],
  ])("omits a limit that is %s", async (_label, limit) => {
    // The backend schema accepts an integer in 1..100. Anything else is
    // dropped client-side so the server falls back to its own default
    // instead of rejecting the whole request.
    await getDailyLeaderboard({ limit });
    expect(apiGetJson).toHaveBeenCalledWith("/daily/leaderboard");
  });

  it.each([
    ["the minimum", 1],
    ["the maximum", 100],
  ])("keeps a limit at %s", async (_label, limit) => {
    await getDailyLeaderboard({ limit });
    expect(apiGetJson).toHaveBeenCalledWith(
      `/daily/leaderboard?limit=${limit}`,
    );
  });
});
