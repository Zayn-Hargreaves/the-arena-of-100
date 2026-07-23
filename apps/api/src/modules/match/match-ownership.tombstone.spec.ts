import { describe, it, expect } from "vitest";
import {
  isValidFinalizedFence,
  parseTombstone,
  tombstoneKey,
  DEAD_LETTER_SET,
  TOMBSTONE_TTL_SEC,
} from "./match-ownership.store";

// ============================================================
// B3b — canonical tombstone value grammar. These vectors drive the
// TypeScript parser; the Lua requeue gate embeds the SAME grammar
// (^[1-9][0-9]*$ + [1, MAX_SAFE_INTEGER]) so both accept/reject the
// exact same strings.
// ============================================================

describe("isValidFinalizedFence (B3b fence grammar)", () => {
  const ACCEPTED = ["1", "42", "9007199254740991"]; // incl. MAX_SAFE_INTEGER
  const REJECTED = [
    "0",
    "+1",
    "-1",
    " 1",
    "1 ",
    "1.0",
    "1e3",
    "01",
    "9007199254740992", // MAX_SAFE_INTEGER + 1
    "9223372036854775808", // int64 overflow
    "",
    "NaN",
    "abc",
  ];

  it.each(ACCEPTED)("accepts %s", (v) => {
    expect(isValidFinalizedFence(v)).toBe(true);
  });

  it.each(REJECTED)("rejects %s", (v) => {
    expect(isValidFinalizedFence(v)).toBe(false);
  });
});

describe("parseTombstone (B3b)", () => {
  it("parses each valid reason with its fence", () => {
    expect(parseTombstone("finished:1")).toEqual({
      reason: "finished",
      fence: 1,
    });
    expect(parseTombstone("dead-letter:42")).toEqual({
      reason: "dead-letter",
      fence: 42,
    });
    expect(parseTombstone("cleaned:9007199254740991")).toEqual({
      reason: "cleaned",
      fence: 9007199254740991,
    });
  });

  it("rejects malformed / unknown-reason / bad-fence values", () => {
    for (const bad of [
      "garbage",
      "dead-letter:",
      "dead-letter:NaN",
      "dead-letter:0",
      "dead-letter:01",
      "dead-letter:9007199254740992",
      ":1",
      "paused:12", // unknown reason
      "finished: 1",
    ]) {
      expect(parseTombstone(bad)).toBeNull();
    }
  });
});

describe("B3b key/constant surface", () => {
  it("builds the tombstone key and pins retention", () => {
    expect(tombstoneKey("m1")).toBe("match:tombstone:m1");
    expect(DEAD_LETTER_SET).toBe("match:recovery:dead-letter");
    expect(TOMBSTONE_TTL_SEC).toBe(604_800);
  });
});
