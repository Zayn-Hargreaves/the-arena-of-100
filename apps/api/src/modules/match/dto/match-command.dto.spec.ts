import { describe, it, expect } from "vitest";
import { cardPlayBodySchema } from "./match-command.dto";

describe("cardPlayBodySchema", () => {
  it("accepts a well-formed card_play body", () => {
    const parsed = cardPlayBodySchema.safeParse({
      type: "card_play",
      userId: "u1",
      commandId: "cmd-1",
      cardId: "CB-1",
      offerSeqNo: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("throws on empty cardId", () => {
    const parsed = cardPlayBodySchema.safeParse({
      type: "card_play",
      userId: "u1",
      commandId: "cmd-1",
      cardId: "",
      offerSeqNo: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("throws on empty targetPlayerId when present", () => {
    const parsed = cardPlayBodySchema.safeParse({
      type: "card_play",
      userId: "u1",
      commandId: "cmd-1",
      cardId: "CB-1",
      offerSeqNo: 1,
      targetPlayerId: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("ok when targetPlayerId is missing", () => {
    const parsed = cardPlayBodySchema.safeParse({
      type: "card_play",
      userId: "u1",
      commandId: "cmd-1",
      cardId: "CB-1",
      offerSeqNo: 1,
    });
    expect(parsed.success).toBe(true);
  });
});
