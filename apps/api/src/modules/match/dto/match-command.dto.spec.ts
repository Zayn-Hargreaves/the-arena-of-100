import { COMMAND_ID_MAX_LENGTH } from "@arena/shared";
import { describe, it, expect } from "vitest";
import {
  cardPlayBodySchema,
  voteBanTopicBodySchema,
} from "./match-command.dto";

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

describe("voteBanTopicBodySchema", () => {
  it("accepts a valid vote_ban_topic body without commandId", () => {
    const parsed = voteBanTopicBodySchema.safeParse({
      type: "vote_ban_topic",
      userId: "u1",
      topic: "SCIENCE",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid vote_ban_topic body with commandId up to COMMAND_ID_MAX_LENGTH", () => {
    const parsed = voteBanTopicBodySchema.safeParse({
      type: "vote_ban_topic",
      userId: "u1",
      topic: "SCIENCE",
      commandId: "x".repeat(COMMAND_ID_MAX_LENGTH),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a vote_ban_topic body with commandId exceeding COMMAND_ID_MAX_LENGTH", () => {
    const parsed = voteBanTopicBodySchema.safeParse({
      type: "vote_ban_topic",
      userId: "u1",
      topic: "SCIENCE",
      commandId: "x".repeat(COMMAND_ID_MAX_LENGTH + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a vote_ban_topic body with empty commandId", () => {
    const parsed = voteBanTopicBodySchema.safeParse({
      type: "vote_ban_topic",
      userId: "u1",
      topic: "SCIENCE",
      commandId: "",
    });
    expect(parsed.success).toBe(false);
  });
});
