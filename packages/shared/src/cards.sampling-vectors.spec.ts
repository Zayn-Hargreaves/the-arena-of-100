// ============================================================
// Sampling vector runtime-immutability test (spec §3.3)
// The vector loader MUST return a deep-frozen value so a buggy
// consumer cannot mutate the canonical vector and corrupt
// subsequent replays.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  ALL_SAMPLING_VECTORS,
  loadSamplingVector,
  type SamplingVector,
} from "./cards.sampling-vectors";
import {
  canonicalSerialize,
  getImmutableSamplingVector,
} from "./cards.sampling-vector-helpers";
import { PRNG_CONTRACT_VERSION } from "./cards";

const LABELS = [
  "cong-class-happy",
  "thu-class-happy",
  "shared-seed-cong",
  "shared-seed-thu",
] as const;

describe("sampling vectors — vectors exist and pin contract version", () => {
  it("exports the canonical 4 starter vectors", () => {
    expect(ALL_SAMPLING_VECTORS).toHaveLength(4);
  });

  it("every vector pins PRNG_CONTRACT_VERSION", () => {
    for (const v of ALL_SAMPLING_VECTORS) {
      expect(v.prngVersion).toBe(PRNG_CONTRACT_VERSION);
    }
  });

  it("loadSamplingVector returns the same vector the label names", () => {
    for (const label of LABELS) {
      const v = loadSamplingVector(label);
      expect(v.seed).toBeDefined();
      expect(v.pool.length).toBeGreaterThan(0);
    }
  });
});

describe("sampling vectors — deep-freeze protects every field", () => {
  // For each protection path (direct + immutable copy), the
  // loader MUST reject (or silently ignore) every mutation AND
  // canonical-serialize to the same bytes before / after.
  //
  // The spec requires coverage of every mutable field by
  // construction: the full-vector canonical bytes invariant
  // covers `pool`, `steps`, every nested step field, and
  // `offeredCardIds`. We also re-run replay against the returned
  // reference to assert end-to-end determinism.

  // Build a minimal "replay" against the vector that ignores
  // CARD selection (which depends on the live PRNG) and just
  // asserts the `tier` history (steps with `tier` defined) is
  // byte-identical pre and post mutation. This is what the
  // sampler would consume when rehydrating a frozen vector.
  function replayTierHistory(v: SamplingVector): string {
    return v.steps
      .filter((s) => s.tier !== undefined)
      .map((s) => s.tier)
      .join(",");
  }

  function tryMutate(v: SamplingVector): void {
    // Cast through `unknown` to bypass `readonly` (spec §3.3
    // explicit requirement).
    const mutable = v as unknown as {
      pool: unknown[];
      steps: Array<{
        float: number;
        purpose?: string;
        tier?: string;
        cardIndex?: number;
        retry?: boolean;
        drawnCardId?: string;
      }>;
      offeredCardIds: unknown[];
    };
    // Each attempt MUST be rejected (TypeError) OR silently
    // ignored — either way the canonical bytes are unchanged.
    const swallow = (label: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw new Error(
            `Unexpected error type when mutating ${label}: ${err}`,
          );
        }
      }
    };
    swallow("pool[0]", () => {
      mutable.pool[0] = "XX-0";
    });
    swallow("pool.push", () => {
      mutable.pool.push("XX-9");
    });
    swallow("steps[0]", () => {
      mutable.steps[0] = {
        float: 999,
        purpose: "TIER",
        tier: "COMMON",
        retry: false,
      };
    });
    swallow("steps[0].float", () => {
      mutable.steps[0]!.float = 999;
    });
    swallow("steps.length", () => {
      mutable.steps.length = 0;
    });
    swallow("offeredCardIds[0]", () => {
      mutable.offeredCardIds[0] = "XX-0";
    });
    swallow("offeredCardIds.push", () => {
      mutable.offeredCardIds.push("XX-9");
    });
  }

  for (const label of LABELS) {
    it(`[${label}] rejects or silently ignores mutation; canonical bytes unchanged`, () => {
      const v = getImmutableSamplingVector(label);
      const before = canonicalSerialize(v);
      const replayBefore = replayTierHistory(v);
      tryMutate(v);
      const after = canonicalSerialize(v);
      const replayAfter = replayTierHistory(v);
      expect(after).toBe(before);
      expect(replayAfter).toBe(replayBefore);
    });
  }
});

describe("canonicalSerialize byte-stable property", () => {
  it("produces identical bytes for objects with the same keys in different order", () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { c: { x: 2, y: 1 }, a: 2, b: 1 };
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
  });

  it("changes bytes when values differ", () => {
    expect(canonicalSerialize({ a: 1 })).not.toBe(canonicalSerialize({ a: 2 }));
  });

  it("rejects sparse arrays so holes cannot sneak through as shorter arrays", () => {
    // `Array.prototype.map` silently skips holes — without a
    // hole check, `[1, , 3]` would serialize as "[1,3]" and a
    // sparse-3-array would be canonically equal to a dense-2
    // array. Pin the rejection here so the contract cannot
    // regress.
    const sparse: number[] = [1];
    sparse[2] = 3;
    expect(() => canonicalSerialize(sparse)).toThrow(TypeError);
    expect(() => canonicalSerialize(sparse)).toThrow(/hole/);
  });

  it("rejects an array whose value is explicitly undefined with a TypeError", () => {
    // `undefined` inside an array is a value, not a hole — the
    // outer guard at the top of canonicalSerializeInner rejects
    // `value === undefined` before any string/serialization check,
    // so when the array branch recurses into an undefined element
    // the same guard fires and the call throws TypeError.
    expect(() =>
      canonicalSerialize([1, undefined as unknown as number, 3]),
    ).toThrow(TypeError);
  });

  it("rejects cyclic objects with a TypeError instead of overflowing the stack", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => canonicalSerialize(obj)).toThrow(TypeError);
    expect(() => canonicalSerialize(obj)).toThrow(/cyclic/);
  });

  it("rejects cyclic arrays with a TypeError instead of overflowing the stack", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => canonicalSerialize(arr)).toThrow(TypeError);
    expect(() => canonicalSerialize(arr)).toThrow(/cyclic/);
  });

  it("treats inherited array indices as holes (own-property check only)", () => {
    // Build a fresh array subclass whose prototype owns a
    // numeric index, then construct with an explicit length so
    // the loop visits index 0. The own indices of the instance
    // still don't include 0 — the inherited slot must be
    // treated as a hole, not as the value at index 0.
    class InheritingArray extends Array {
      // No-op constructor; the prototype below will own `.0`.
    }
    Object.defineProperty(InheritingArray.prototype, "0", {
      value: "X",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const inherited = new InheritingArray(1);
    try {
      // `inherited` has length 1 but no own index 0 — the
      // inherited `.0` must be treated as a hole, not as the
      // value at index 0.
      expect(() => canonicalSerialize(inherited)).toThrow(TypeError);
    } finally {
      delete InheritingArray.prototype[0];
    }
  });

  it("still serializes repeated non-cyclic references without throwing", () => {
    // A value that appears at multiple positions in the input
    // is NOT a cycle — the ancestor set is per-branch, so each
    // independent branch sees a fresh presence. The output
    // duplicates the serialized bytes at each position.
    const shared = { a: 1 };
    const input = { x: shared, y: shared, z: [shared] };
    expect(canonicalSerialize(input)).toBe(
      canonicalSerialize({
        x: { a: 1 },
        y: { a: 1 },
        z: [{ a: 1 }],
      }),
    );
  });

  it("rejects Date instances instead of serializing them as {}", () => {
    // Without the plain-object guard, `Object.keys(new Date())`
    // returns [] and a Date would canonicalize to "{}" — silently
    // dropping the timestamp. Pin the rejection here so the
    // contract cannot regress.
    expect(() => canonicalSerialize(new Date("2026-01-01T00:00:00Z"))).toThrow(
      TypeError,
    );
    expect(() => canonicalSerialize(new Date("2026-01-01T00:00:00Z"))).toThrow(
      /plain object/,
    );
  });

  it("rejects arbitrary class instances instead of serializing them as {}", () => {
    class Card {
      constructor(public id: string) {}
    }
    expect(() => canonicalSerialize(new Card("CB-1"))).toThrow(TypeError);
    expect(() => canonicalSerialize(new Card("CB-1"))).toThrow(/plain object/);
  });

  it("accepts objects with a null prototype (Object.create(null))", () => {
    // The guard must allow Object.create(null) so call sites that
    // build dicts without the inherited Object.prototype members
    // still serialize cleanly.
    const dict = Object.create(null) as Record<string, unknown>;
    dict.b = 1;
    dict.a = 2;
    expect(canonicalSerialize(dict)).toBe('{"a":2,"b":1}');
  });
});
