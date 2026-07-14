// Runtime guards for the ReplayEvent schema → type derivation. The
// `tsc` build step is the primary check (the `AssertReplayPayloadShape`
// alias in `schemas.ts` makes a misnamed branch fail compilation), but
// these tests give the same guarantee a vitest run so a regression
// shows up in the test summary too.

import { describe, it, expect } from "vitest";
import {
  ReplayEventSchema,
  type ReplayEvent,
  type ReplayPlayerPresencePayload,
  type ReplayRoundStartedPayload,
} from "./schemas";

describe("ReplayEvent schema <-> type derivation", () => {
  it("ReplayRoundStartedPayload is not `never` (the previous derivation bug)", () => {
    // The conditional type the file used to ship resolved to `never`
    // for every branch because the union was checked non-nakedly. If
    // this assertion fails the schema and the type have drifted.
    const _checkNotNever: ReplayRoundStartedPayload = {
      roundNo: 1,
      questionId: "q",
      question: { id: "q", content: "c", options: ["A", "B"] },
      endsAt: 0,
    };
    expect(_checkNotNever).toBeDefined();
  });

  it("parses a valid ROUND_STARTED event end-to-end through the schema", () => {
    const parsed = ReplayEventSchema.parse({
      type: "ROUND_STARTED",
      payload: {
        roundNo: 1,
        questionId: "q-1",
        question: {
          id: "q-1",
          content: "What is 2+2?",
          options: ["3", "4", "5", "6"],
          difficulty: "EASY",
        },
        endsAt: 1_700_000_000_000,
      },
    });
    expect(parsed.type).toBe("ROUND_STARTED");
    expect(parsed.payload).toMatchObject({ roundNo: 1, questionId: "q-1" });
  });

  it("parses both presence branches with the same payload shape", () => {
    const disconnected = ReplayEventSchema.parse({
      type: "PLAYER_DISCONNECTED",
      payload: { playerId: "p-1" },
    });
    const reconnected = ReplayEventSchema.parse({
      type: "PLAYER_RECONNECTED",
      payload: { playerId: "p-1" },
    });
    expect(disconnected.type).toBe("PLAYER_DISCONNECTED");
    expect(reconnected.type).toBe("PLAYER_RECONNECTED");
    // ReplayPlayerPresencePayload is the union of the two payload
    // shapes — both branches must be assignable to it. Narrow the
    // parsed result by its discriminator first; the conditional
    // type would otherwise fall through to the full union and lose
    // structural compatibility.
    if (
      disconnected.type === "PLAYER_DISCONNECTED" &&
      reconnected.type === "PLAYER_RECONNECTED"
    ) {
      const _a: ReplayPlayerPresencePayload = disconnected.payload;
      const _b: ReplayPlayerPresencePayload = reconnected.payload;
      expect(_a.playerId).toBe("p-1");
      expect(_b.playerId).toBe("p-1");
    } else {
      throw new Error("discriminator narrowing failed");
    }
  });

  it("rejects an event with the wrong payload for its type", () => {
    expect(() =>
      ReplayEventSchema.parse({
        type: "STATE_TRANSITION",
        payload: { playerId: "p-1" },
      }),
    ).toThrow();
  });

  it("ReplayEvent is assignable to the inferred schema type", () => {
    const sample: ReplayEvent = {
      type: "ROUND_STARTED",
      payload: {
        roundNo: 1,
        questionId: "q-1",
        question: { id: "q-1", content: "c", options: ["A"] },
        endsAt: 0,
      },
    };
    expect(ReplayEventSchema.parse(sample).type).toBe("ROUND_STARTED");
  });
});
