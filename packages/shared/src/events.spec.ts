import { describe, it, expect } from "vitest";
import { createEvent } from "./events";

describe("createEvent — boundary immutability", () => {
  it("deep-freezes the payload so nested fields cannot be mutated", () => {
    const event = createEvent<{ readonly targetPlayerIds: readonly number[] }>(
      "TEST",
      { targetPlayerIds: [1, 2, 3] },
      1,
    );
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.targetPlayerIds)).toBe(true);
    expect(() => {
      (event.payload.targetPlayerIds as number[]).push(4);
    }).toThrow(TypeError);
  });

  it("clones the payload so mutating the caller's input does not leak into the event", () => {
    const callerOwned = { targetPlayerIds: [1, 2, 3] };
    const event = createEvent<typeof callerOwned>("TEST", callerOwned, 1);

    callerOwned.targetPlayerIds.push(99);

    expect(event.payload.targetPlayerIds).toEqual([1, 2, 3]);
    expect(event.payload.targetPlayerIds).not.toBe(callerOwned.targetPlayerIds);
  });

  it("clones even when the caller's payload is shallow-frozen (mutable nested children)", () => {
    // A caller may hand us a `Object.freeze`d parent whose nested
    // objects are still mutable. The event boundary must still
    // own a deep-cloned, deeply-frozen copy — never alias the
    // caller's references.
    const inner = { hidden: "secret" };
    const shallow = Object.freeze({
      targetPlayerIds: [1, 2, 3],
      effect: inner,
    });
    const event = createEvent<typeof shallow>("TEST", shallow, 1);

    expect(event.payload).not.toBe(shallow);
    expect(event.payload.targetPlayerIds).not.toBe(shallow.targetPlayerIds);
    expect(event.payload.effect).not.toBe(inner);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.targetPlayerIds)).toBe(true);
    expect(Object.isFrozen(event.payload.effect)).toBe(true);

    inner.hidden = "tampered";
    expect((event.payload.effect as { hidden: string }).hidden).toBe("secret");
  });

  it("preserves primitives and null without cloning", () => {
    const nullEvent = createEvent<null>("NULL_TEST", null, 1);
    expect(nullEvent.payload).toBeNull();
    const numEvent = createEvent<number>("NUM_TEST", 42, 1);
    expect(numEvent.payload).toBe(42);
  });

  it("rejects a shallow-frozen Date instance instead of silently converting it to {}", () => {
    // Without a plain-object guard, `Object.entries(new Date())`
    // is empty and a frozen Date would round-trip as a frozen
    // `{}`, losing the timestamp. The shared boundary must reject
    // non-plain payload objects so the bug surfaces immediately
    // instead of corrupting downstream consumers.
    const date = Object.freeze(new Date("2026-01-01T00:00:00.000Z"));
    expect(() => createEvent<Date>("TEST", date, 1)).toThrow(TypeError);
    expect(() => createEvent<Date>("TEST", date, 1)).toThrow(
      /plain object payload/,
    );
  });

  it("rejects an unfrozen Date instance too — the guard is on prototype, not on Object.isFrozen", () => {
    const date = new Date("2026-02-02T00:00:00.000Z");
    expect(() => createEvent<Date>("TEST", date, 1)).toThrow(TypeError);
  });

  it("rejects bigint, function, and symbol primitives", () => {
    expect(() => createEvent<unknown>("TEST", 10n, 1)).toThrow(TypeError);
    expect(() => createEvent<unknown>("TEST", () => {}, 1)).toThrow(TypeError);
    expect(() => createEvent<unknown>("TEST", Symbol("test"), 1)).toThrow(
      TypeError,
    );
    expect(() => createEvent<unknown>("TEST", { a: 10n }, 1)).toThrow(
      TypeError,
    );
  });

  it("rejects undefined at the root and inside nested payloads", () => {
    expect(() => createEvent<unknown>("TEST", undefined, 1)).toThrow(TypeError);
    expect(() => createEvent<unknown>("TEST", undefined, 1)).toThrow(
      /undefined/,
    );
    expect(() => createEvent<unknown>("TEST", { value: undefined }, 1)).toThrow(
      TypeError,
    );
    expect(() => createEvent<unknown>("TEST", { value: undefined }, 1)).toThrow(
      /undefined/,
    );
    expect(() =>
      createEvent<unknown>("TEST", { items: [1, undefined, 3] }, 1),
    ).toThrow(TypeError);
  });

  it("detects and rejects circular object references", () => {
    type CircularFixture = { a: number; self?: CircularFixture };
    const circular: CircularFixture = { a: 1 };
    circular.self = circular;
    expect(() => createEvent<unknown>("TEST", circular, 1)).toThrow(TypeError);
    expect(() => createEvent<unknown>("TEST", circular, 1)).toThrow(
      /circular object reference/,
    );
  });

  it("clones acyclic shared references independently (two properties, same object)", () => {
    const shared = { value: 1 };
    const payload = { left: shared, right: shared };
    const event = createEvent<{
      left: { value: number };
      right: { value: number };
    }>("TEST", payload, 1);

    expect(event.payload.left).not.toBe(shared);
    expect(event.payload.right).not.toBe(shared);
    // Each branch owns its own fresh reference; mutating the original
    // does not leak into either.
    shared.value = 999;
    expect(event.payload.left).toMatchObject({ value: 1 });
    expect(event.payload.right).toMatchObject({ value: 1 });
    // The two branches are independent — the references are distinct.
    expect(event.payload.left).not.toBe(event.payload.right);
    expect(Object.isFrozen(event.payload.left)).toBe(true);
    expect(Object.isFrozen(event.payload.right)).toBe(true);
  });
});
