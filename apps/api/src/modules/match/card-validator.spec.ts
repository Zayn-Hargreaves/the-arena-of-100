// ============================================================
// Card validator tests — Phase 2 (Class + Card Hybrid)
// Source of truth: memory-bank/spec/class-cards-phase.md §5.2
// sub-task D + §4.5 (command-level idempotency) + §3.3 (AOE cap).
// ============================================================

import { describe, it, expect } from "vitest";
import {
  assertValidCommandId,
  assertCardId,
  validateCardCommand,
  validateAoeBudget,
  validateTarget,
  validatePickedCard,
  isMilestoneRound,
  catalogHasCard,
  AOE_CAP_PER_ROUND,
  COMMAND_ID_MAX_LENGTH,
} from "./card-validator";
import { ErrorCode, RoomError, CardId } from "@arena/shared";

describe("assertValidCommandId", () => {
  it("accepts a non-empty string within length cap", () => {
    expect(() => assertValidCommandId("cmd-1")).not.toThrow();
  });

  it("rejects missing/empty", () => {
    expect(() => assertValidCommandId("")).toThrow(RoomError);
  });

  it("rejects non-string", () => {
    expect(() => assertValidCommandId(123)).toThrow(RoomError);
    expect(() => assertValidCommandId(null)).toThrow(RoomError);
    expect(() => assertValidCommandId(undefined)).toThrow(RoomError);
  });

  it("rejects strings longer than COMMAND_ID_MAX_LENGTH", () => {
    const tooLong = "x".repeat(COMMAND_ID_MAX_LENGTH + 1);
    try {
      assertValidCommandId(tooLong);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RoomError);
      expect((err as RoomError).code).toBe(ErrorCode.INVALID_COMMAND_ID);
    }
  });

  it("accepts exactly COMMAND_ID_MAX_LENGTH chars", () => {
    const exactly = "x".repeat(COMMAND_ID_MAX_LENGTH);
    expect(() => assertValidCommandId(exactly)).not.toThrow();
  });
});

describe("assertCardId (CARD_NOT_FOUND)", () => {
  it("accepts a cardId in the v1 catalog", () => {
    expect(() => assertCardId("CB-1")).not.toThrow();
    expect(() => assertCardId("TN-10")).not.toThrow();
  });

  it("rejects unknown cardId", () => {
    try {
      assertCardId("XX-99");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RoomError);
      expect((err as RoomError).code).toBe(ErrorCode.CARD_NOT_FOUND);
    }
  });

  it("rejects non-string", () => {
    expect(() => assertCardId(123)).toThrow(RoomError);
  });
});

describe("validateTarget", () => {
  const roster = new Set(["p1", "p2", "p3"]);

  it("Offensive/CONG card with targetPlayerId in roster — accepted", () => {
    expect(() => validateTarget("CB-1", "p2", roster)).not.toThrow();
  });

  it("Offensive/CONG card with targetPlayerId NOT in roster — PLAYER_NOT_IN_ROOM", () => {
    try {
      validateTarget("CB-1", "ghost", roster);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.PLAYER_NOT_IN_ROOM);
    }
  });

  it("Offensive/CONG non-AOE card with no target — INVALID_PAYLOAD", () => {
    try {
      validateTarget("CB-1", undefined, roster);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.INVALID_PAYLOAD);
    }
  });

  it("Offensive/CONG card targeting self — INVALID_PAYLOAD", () => {
    try {
      validateTarget("CB-1", "p1", roster, "p1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.INVALID_PAYLOAD);
    }
  });

  it("Defensive/THU card with targetPlayerId — INVALID_PAYLOAD (self-only)", () => {
    try {
      validateTarget("TN-1", "p2", roster);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.INVALID_PAYLOAD);
    }
  });

  it("Defensive/THU card with no target — accepted", () => {
    expect(() => validateTarget("TN-1", undefined, roster)).not.toThrow();
  });
});

describe("validatePickedCard", () => {
  it("accepts a cardId whose pick is still pending", () => {
    // The picked card is intentionally NOT in the post-pick
    // hand (pickCard has removed it). The validator must check
    // the picked set, not the remaining hand.
    expect(() => validatePickedCard("CB-1", ["CB-1"])).not.toThrow();
  });

  it("rejects a cardId that was never picked — CARD_NOT_IN_HAND", () => {
    try {
      validatePickedCard("CB-1", ["CB-2"]);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.CARD_NOT_IN_HAND);
    }
  });
});

describe("validateAoeBudget", () => {
  it("passes when an AOE card is used < AOE_CAP_PER_ROUND", () => {
    expect(() => validateAoeBudget("CB-8", 0)).not.toThrow();
    expect(() =>
      validateAoeBudget("CB-8", AOE_CAP_PER_ROUND - 1),
    ).not.toThrow();
  });

  it("rejects when AOE budget exhausted — AOE_CAP_EXHAUSTED", () => {
    try {
      validateAoeBudget("CB-8", AOE_CAP_PER_ROUND);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as RoomError).code).toBe(ErrorCode.AOE_CAP_EXHAUSTED);
    }
  });

  it("single-target Offensive/CONG cards (CB-1, CB-2) do not consume AOE budget", () => {
    // CB-1 / CB-2 have `targetCount: 1` — they target a single
    // opponent, not a roster, so the AOE cap must NOT apply.
    // Previously these were classified as AOE solely on the
    // basis of `classId === "CONG"` (single-target AOE bug).
    expect(() => validateAoeBudget("CB-1", AOE_CAP_PER_ROUND)).not.toThrow();
    expect(() => validateAoeBudget("CB-2", 1000)).not.toThrow();
  });

  it("Defensive/THU cards never consume AOE budget", () => {
    expect(() => validateAoeBudget("TN-1", AOE_CAP_PER_ROUND)).not.toThrow();
    expect(() => validateAoeBudget("TN-10", 1000)).not.toThrow();
  });
});

describe("validateCardCommand — top-level", () => {
  const roster = new Set(["p1", "p2", "p3"]);
  const baseArgs = {
    cardId: "CB-1" as CardId,
    offeredCardIds: ["CB-1", "CB-2", "CB-3"] as CardId[],
    targetPlayerId: "p2" as string | undefined,
    rosterPlayerIds: roster,
    currentAoeCount: 0,
    playedCardIds: new Set<CardId>(),
    // The post-pick hand is intentionally NOT used here — the
    // validator checks the PICKED set so a legitimate
    // pickCard→playCard sequence does not get rejected because
    // pickCard removed the picked cardId from the hand.
    pickedCards: ["CB-1"] as CardId[],
  };

  it("accepts a valid Offensive/CONG play", () => {
    const result = validateCardCommand(baseArgs);
    expect(result.cardId).toBe("CB-1");
    expect(result.template.kind).toBe("TIMER_MODIFY");
  });

  it("rejects unknown cardId", () => {
    expect(() => validateCardCommand({ ...baseArgs, cardId: "XX-99" })).toThrow(
      RoomError,
    );
  });

  it("rejects cardId NOT in the picked set", () => {
    expect(() =>
      validateCardCommand({
        ...baseArgs,
        cardId: "CB-7",
        offeredCardIds: ["CB-1", "CB-2", "CB-3"] as CardId[],
        pickedCards: ["CB-1"] as CardId[],
      }),
    ).toThrow(RoomError);
  });

  it("rejects already-played cardId", () => {
    expect(() =>
      validateCardCommand({
        ...baseArgs,
        playedCardIds: new Set<CardId>(["CB-1"]),
      }),
    ).toThrow(RoomError);
  });

  it("rejects AOE exhaustion", () => {
    expect(() =>
      validateCardCommand({
        ...baseArgs,
        cardId: "CB-8",
        pickedCards: ["CB-8"] as CardId[],
        currentAoeCount: AOE_CAP_PER_ROUND,
      }),
    ).toThrow(RoomError);
  });

  it("accepts a self-only Defensive/THU play with no target", () => {
    const result = validateCardCommand({
      ...baseArgs,
      cardId: "TN-1",
      targetPlayerId: undefined,
      pickedCards: ["TN-1"] as CardId[],
      offeredCardIds: ["TN-1", "TN-2", "TN-3"] as CardId[],
    });
    expect(result.cardId).toBe("TN-1");
  });

  it("rejects a cardId that is offered but not picked", () => {
    // The card MAY be in the offer envelope, but if the player
    // never picked it (no CARD_PICKED for this offer), the play
    // must be rejected — the post-pick hand is irrelevant.
    expect(() =>
      validateCardCommand({
        ...baseArgs,
        cardId: "CB-2",
        offeredCardIds: ["CB-1", "CB-2", "CB-3"] as CardId[],
        pickedCards: ["CB-1"] as CardId[],
      }),
    ).toThrow(RoomError);
  });
});

describe("isMilestoneRound", () => {
  it("rounds 5/12/20 are milestones (CARD_OFFER trigger)", () => {
    expect(isMilestoneRound(5)).toBe(true);
    expect(isMilestoneRound(12)).toBe(true);
    expect(isMilestoneRound(20)).toBe(true);
  });

  it("non-milestone rounds return false", () => {
    expect(isMilestoneRound(1)).toBe(false);
    expect(isMilestoneRound(10)).toBe(false);
    expect(isMilestoneRound(50)).toBe(false);
  });
});

describe("catalogHasCard", () => {
  it("returns true for known cardIds", () => {
    expect(catalogHasCard("CB-1")).toBe(true);
    expect(catalogHasCard("TN-10")).toBe(true);
  });

  it("returns false for unknown cardIds", () => {
    expect(catalogHasCard("XX-99")).toBe(false);
    expect(catalogHasCard(123)).toBe(false);
  });
});

describe("AOE_CAP_PER_ROUND constant", () => {
  it("equals 2 per spec §3.3", () => {
    expect(AOE_CAP_PER_ROUND).toBe(2);
  });
});
