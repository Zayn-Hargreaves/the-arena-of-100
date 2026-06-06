import { describe, it, expect, vi, beforeEach } from "vitest";
import { RankingsController } from "./rankings.controller";
import { RankingsService } from "./rankings.service";

describe("RankingsController", () => {
  let controller: RankingsController;
  let service: { getLeaderboard: any };

  beforeEach(() => {
    service = { getLeaderboard: vi.fn() };
    controller = new RankingsController(service as unknown as RankingsService);
  });

  it("forwards period and limit to the service", async () => {
    const expected = {
      period: "weekly" as const,
      generatedAt: "2026-06-06T10:00:00.000Z",
      cached: false,
      items: [],
    };
    vi.mocked(service.getLeaderboard).mockResolvedValue(expected);

    const result = await controller.getLeaderboard({
      period: "weekly",
      limit: 25,
    });

    expect(service.getLeaderboard).toHaveBeenCalledWith({
      period: "weekly",
      limit: 25,
    });
    expect(result).toEqual(expected);
  });

  it("forwards period=all with limit=100", async () => {
    const expected = {
      period: "all" as const,
      generatedAt: "2026-06-06T10:00:00.000Z",
      cached: true,
      items: [],
    };
    vi.mocked(service.getLeaderboard).mockResolvedValue(expected);

    await controller.getLeaderboard({ period: "all", limit: 100 });

    expect(service.getLeaderboard).toHaveBeenCalledWith({
      period: "all",
      limit: 100,
    });
  });

  it("returns the exact response from service (including cached flag)", async () => {
    const expected = {
      period: "weekly" as const,
      generatedAt: "2026-06-06T10:00:00.000Z",
      cached: true,
      items: [
        {
          rank: 1,
          userId: "u1",
          username: "Alice",
          avatar: "jellyfrog",
          wins: 5,
          matchesPlayed: 10,
          accuracy: 0.8,
          avgResponseMs: 500,
          totalScore: 1000,
        },
      ],
    };
    vi.mocked(service.getLeaderboard).mockResolvedValue(expected);

    const result = await controller.getLeaderboard({
      period: "weekly",
      limit: 50,
    });

    expect(result).toEqual(expected);
    expect(result.cached).toBe(true);
  });
});
