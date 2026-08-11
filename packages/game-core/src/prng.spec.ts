// ============================================================
// PRNG helpers — unit tests for UTF-8 encoding edge cases.
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "Byte-level RNG consumption". The hash + mulberry32 happy paths
// are exercised end-to-end by `card-engine.spec.ts` (sampling
// vectors pin the output bit-for-bit). This file covers the
// UTF-8 encoder branch matrix and the cross-language
// reproducibility of `seedFromString` on non-ASCII inputs.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  seedFromString,
  sha256Bytes,
  deriveSubstream,
  hashStringToSeed,
  mulberry32,
} from "./prng";

describe("seedFromString — UTF-8 encoding of non-ASCII inputs", () => {
  it.each([
    ["2-byte UTF-8 (U+0080..U+07FF)", "é", 2119539018],
    ["3-byte UTF-8 (U+0800..U+FFFF)", "中", 2864539557],
    ["4-byte UTF-8 surrogate pair", "𝄞", 3555662308],
    ["unpaired high surrogate", "\uD800", 3427063171],
    ["unpaired low surrogate", "\uDC00", 3427063171],
  ])("encodes %s via seedFromString", (_, input, expected) => {
    const seed = seedFromString(input);
    expect(seed).toBe(expected);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it("returns a 32-bit unsigned integer for ASCII", () => {
    const seed = seedFromString("hello");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it("returns a different seed for different ASCII strings", () => {
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
  });

  it("is deterministic across calls (same input → same seed)", () => {
    expect(seedFromString("match-1|CONG-player-1")).toBe(
      seedFromString("match-1|CONG-player-1"),
    );
  });
});

describe("sha256Bytes — accepts input bytes directly", () => {
  it("returns a 32-byte digest for an empty input", () => {
    const bytes = sha256Bytes([]);
    expect(bytes).toHaveLength(32);
  });

  it("returns a 32-byte digest for ASCII bytes", () => {
    const bytes = sha256Bytes([0x68, 0x69]);
    expect(bytes).toHaveLength(32);
  });

  it("matches reference SHA-256 test vectors for various input lengths and emoji", () => {
    const toHex = (buf: Uint8Array) =>
      Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const encodeUtf8 = (str: string): number[] =>
      Array.from(new TextEncoder().encode(str));

    const vectors: Array<{ input: number[]; expectedHex: string }> = [
      {
        input: [],
        expectedHex:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      {
        input: encodeUtf8("a".repeat(55)),
        expectedHex:
          "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
      },
      {
        input: encodeUtf8("a".repeat(56)),
        expectedHex:
          "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
      },
      {
        input: encodeUtf8("a".repeat(63)),
        expectedHex:
          "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34",
      },
      {
        input: encodeUtf8("a".repeat(64)),
        expectedHex:
          "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
      },
      {
        input: encodeUtf8("a".repeat(119)),
        expectedHex:
          "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb",
      },
      {
        input: encodeUtf8("a".repeat(120)),
        expectedHex:
          "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c",
      },
      {
        input: encodeUtf8("😀"),
        expectedHex:
          "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9",
      },
    ];

    for (const v of vectors) {
      expect(toHex(sha256Bytes(v.input))).toBe(v.expectedHex);
    }
  });
});

describe("deriveSubstream — parent + label composition", () => {
  it("produces a different seed for different labels", () => {
    const parent = "m1|offer-1";
    expect(deriveSubstream(parent, "card")).not.toBe(
      deriveSubstream(parent, "class"),
    );
  });

  it("matches the explicit seedFromString(parent|label) composition", () => {
    expect(deriveSubstream("m1", "card")).toBe(seedFromString("m1|card"));
  });
});

describe("hashStringToSeed — FNV-1a 32-bit", () => {
  it("returns the FNV-1a offset basis (0x811c9dc5) for the empty string", () => {
    // The FNV-1a algorithm starts from a fixed offset basis, so
    // the empty string digests to that constant — NOT to 0.
    expect(hashStringToSeed("")).toBe(0x811c9dc5);
  });

  it("is deterministic across calls", () => {
    expect(hashStringToSeed("u1")).toBe(hashStringToSeed("u1"));
  });

  it("differs across distinct inputs", () => {
    expect(hashStringToSeed("u1")).not.toBe(hashStringToSeed("u2"));
  });
});

describe("mulberry32 — basic discipline", () => {
  it("returns floats in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });
});
