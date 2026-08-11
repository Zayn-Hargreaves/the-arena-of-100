import {
  loadSamplingVector,
  type SamplingVector,
} from "./cards.sampling-vectors";

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  Object.freeze(value);
  for (const k of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[k], seen);
  }
  return value;
}

export function getImmutableSamplingVector(label: string): SamplingVector {
  // Clone first so we don't freeze the module-level VECTOR_*
  // singleton returned by loadSamplingVector — deep-freezing the
  // shared vector would corrupt a subsequent direct
  // loadSamplingVector() call that expects a mutable (but
  // readonly) reference.
  return deepFreeze(
    structuredClone(loadSamplingVector(label)),
  ) as SamplingVector;
}

export function canonicalSerialize(value: unknown): string {
  return canonicalSerializeInner(value, new WeakSet<object>());
}

function canonicalSerializeInner(
  value: unknown,
  ancestors: WeakSet<object>,
): string {
  if (value === undefined) {
    throw new TypeError(
      "canonicalSerialize: undefined is not a serializable value",
    );
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(
      `canonicalSerialize: ${typeof value} is not a serializable value`,
    );
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) as string;
  }
  if (ancestors.has(value as object)) {
    throw new TypeError("canonicalSerialize: cyclic value is not serializable");
  }
  ancestors.add(value as object);
  if (Array.isArray(value)) {
    const parts = new Array<string>(value.length);
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) {
        throw new TypeError(
          `canonicalSerialize: array contains a hole at index ${i}`,
        );
      }
      const v = value[i];
      const s = canonicalSerializeInner(v, ancestors);
      if (typeof s !== "string" || s.length === 0) {
        throw new TypeError(
          `canonicalSerialize: array element is not a non-empty string (${String(v)})`,
        );
      }
      parts[i] = s;
    }
    ancestors.delete(value as object);
    return "[" + parts.join(",") + "]";
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const ctor =
      proto && typeof proto === "object" && "constructor" in proto
        ? (proto as { constructor?: { name?: string } }).constructor?.name
        : undefined;
    throw new TypeError(
      `canonicalSerialize: ${ctor ?? "class"} instance is not a serializable plain object`,
    );
  }
  const keys = Object.keys(value)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out =
    "{" +
    keys
      .map((k) => {
        const s = canonicalSerializeInner(
          (value as Record<string, unknown>)[k],
          ancestors,
        );
        return JSON.stringify(k) + ":" + s;
      })
      .join(",") +
    "}";
  ancestors.delete(value as object);
  return out;
}
