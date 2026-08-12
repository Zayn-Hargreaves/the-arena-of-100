import { describe, expect, it } from "vitest";
import { PlayerStatus } from "@arena/shared";
import type { MatchStateMachine } from "@arena/game-core";
import { expandCardTargets } from "./match-card-targeting";

type PseudoPlayer = { status: PlayerStatus };

function player(status: PlayerStatus): PseudoPlayer {
  return { status };
}

function buildStubStateMachine(
  roster: Record<string, PseudoPlayer>,
): MatchStateMachine {
  return {
    getState: () => ({
      players: new Map(
        Object.entries(roster).map(([id, p]) => [id, p as unknown]),
      ),
    }),
  } as unknown as MatchStateMachine;
}

describe("expandCardTargets", () => {
  it("returns [] when an explicit single-target is ineligible (DISCONNECTED)", () => {
    const sm = buildStubStateMachine({
      p1: player(PlayerStatus.ACTIVE),
      p2: player(PlayerStatus.DISCONNECTED),
    });
    const result = expandCardTargets(
      "m1",
      "CB-1" as never,
      "p1",
      "p2",
      1,
      1,
      sm,
    );
    expect(result).toEqual([]);
  });

  it("AOE path applies the shared eligibility predicate (ELIMINATED/WINNER excluded, playedBy excluded)", () => {
    const sm = buildStubStateMachine({
      p1: player(PlayerStatus.ACTIVE),
      p2: player(PlayerStatus.ELIMINATED),
      p3: player(PlayerStatus.ACTIVE),
      p4: player(PlayerStatus.WINNER),
    });
    const result = expandCardTargets(
      "m1",
      "CB-8" as never,
      "p1",
      undefined,
      1,
      1,
      sm,
    );
    expect(result.every((id) => id !== "p1")).toBe(true);
    expect(result).toContain("p3");
    expect(result).not.toContain("p2");
    expect(result).not.toContain("p4");
  });
});
