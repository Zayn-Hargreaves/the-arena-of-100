// AUTO-GENERATED from spec §3.3 sampling algorithm — see
// packages/game-core/src/card-engine.ts. Baked via
// `pnpm gen:sampling-vectors` (root) and pinned to
// PRNG_CONTRACT_VERSION. The script first builds
// `@arena/shared` and `@arena/game-core` so PRNG + catalog
// artifacts are imported from `dist/`. Do NOT edit by hand.

import { PRNG_CONTRACT_VERSION, type CardId } from "./cards";
import type { ClassId } from "./classes";

export interface SamplingVector {
  readonly classId: ClassId;
  readonly seed: string;
  readonly prngVersion: string;
  readonly pool: readonly CardId[];
  readonly steps: ReadonlyArray<{
    readonly float: number;
    readonly purpose: "TIER" | "CARD";
    readonly tier?: "COMMON" | "RARE" | "EPIC";
    readonly cardIndex?: number;
    readonly retry: boolean;
    readonly drawnCardId?: CardId;
  }>;
  readonly offeredCardIds: readonly CardId[];
}

export const VECTOR_CONG_CLASS_HAPPY: SamplingVector = {
  classId: "CONG",
  seed: "match-1|CONG-player-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: ["CB-1", "CB-2", "CB-3", "CB-4", "CB-5", "CB-6", "CB-7", "CB-8"],
  steps: [
    { float: 0.7850035228766501, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.31643332121893764,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "CB-4",
    },
    {
      float: 0.20335578848607838,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.5861659238580614,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "CB-3",
    },
    {
      float: 0.13818945782259107,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.48672376829199493,
      purpose: "CARD",
      retry: false,
      cardIndex: 1,
      drawnCardId: "CB-2",
    },
  ],
  offeredCardIds: ["CB-4", "CB-3", "CB-2"],
} as const;

export const VECTOR_THU_CLASS_HAPPY: SamplingVector = {
  classId: "THU",
  seed: "match-1|THU-player-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: [
    "TN-1",
    "TN-2",
    "TN-3",
    "TN-4",
    "TN-5",
    "TN-6",
    "TN-7",
    "TN-8",
    "TN-9",
    "TN-10",
  ],
  steps: [
    {
      float: 0.14207896473817527,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.35720975045114756,
      purpose: "CARD",
      retry: false,
      cardIndex: 1,
      drawnCardId: "TN-2",
    },
    { float: 0.7420756528154016, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.19060465041548014,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "TN-4",
    },
    { float: 0.7787872166372836, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.7070694454014301,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "TN-9",
    },
  ],
  offeredCardIds: ["TN-2", "TN-4", "TN-9"],
} as const;

export const VECTOR_SHARED_SEED_CONG: SamplingVector = {
  classId: "CONG",
  seed: "shared-seed-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: ["CB-1", "CB-2", "CB-3", "CB-4", "CB-5", "CB-6", "CB-7", "CB-8"],
  steps: [
    {
      float: 0.5508925563190132,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.6854414825793356,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "CB-6",
    },
    {
      float: 0.10476188664324582,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.8840647146571428,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "CB-7",
    },
    {
      float: 0.034209711477160454,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.7238316438160837,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "CB-3",
    },
  ],
  offeredCardIds: ["CB-6", "CB-7", "CB-3"],
} as const;

export const VECTOR_SHARED_SEED_THU: SamplingVector = {
  classId: "THU",
  seed: "shared-seed-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: [
    "TN-1",
    "TN-2",
    "TN-3",
    "TN-4",
    "TN-5",
    "TN-6",
    "TN-7",
    "TN-8",
    "TN-9",
    "TN-10",
  ],
  steps: [
    {
      float: 0.3119782966095954,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.23534569423645735,
      purpose: "CARD",
      retry: false,
      cardIndex: 1,
      drawnCardId: "TN-2",
    },
    { float: 0.6644067305605859, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.8973990571685135,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "TN-9",
    },
    { float: 0.8916048582177609, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.008692982606589794,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "TN-4",
    },
  ],
  offeredCardIds: ["TN-2", "TN-9", "TN-4"],
} as const;

export const ALL_SAMPLING_VECTORS: readonly SamplingVector[] = [
  VECTOR_CONG_CLASS_HAPPY,
  VECTOR_THU_CLASS_HAPPY,
  VECTOR_SHARED_SEED_CONG,
  VECTOR_SHARED_SEED_THU,
] as const;

export function loadSamplingVector(label: string): SamplingVector {
  switch (label) {
    case "cong-class-happy":
      return VECTOR_CONG_CLASS_HAPPY;
    case "thu-class-happy":
      return VECTOR_THU_CLASS_HAPPY;
    case "shared-seed-cong":
      return VECTOR_SHARED_SEED_CONG;
    case "shared-seed-thu":
      return VECTOR_SHARED_SEED_THU;
  }
  throw new Error(`Unknown sampling vector: ${label}`);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const k of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[k]);
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
  // Reject values that JSON.stringify cannot (or will not)
  // produce a non-empty string for. JSON.stringify returns
  // `undefined` for these inputs — propagating that would
  // violate the "every accepted value returns a string"
  // contract this function exposes.
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
  // Cycle detection: a value that is already an ancestor of the
  // current branch would cause a `RangeError: Maximum call stack
  // size exceeded` recursion. Surface that as an explicit
  // `TypeError` instead — canonical serializers must never blow
  // the call stack. The `WeakSet` is per-call (the outer helper
  // creates a fresh one) so a value that legitimately appears
  // multiple times in non-cyclic positions still serializes.
  if (ancestors.has(value as object)) {
    throw new TypeError("canonicalSerialize: cyclic value is not serializable");
  }
  ancestors.add(value as object);
  if (Array.isArray(value)) {
    const parts = new Array<string>(value.length);
    for (let i = 0; i < value.length; i++) {
      // Reject sparse arrays before serializing any element.
      // `Array.prototype.map` silently skips holes, which would let a
      // sparse array sneak through as a shorter array of indices — a
      // silent contract violation for canonical serializers. Use
      // `Object.prototype.hasOwnProperty.call` so inherited
      // array indices (e.g. inherited `.0` from a manual prototype
      // chain) are NOT treated as present elements — only own
      // indices are serialized.
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new TypeError(
          `canonicalSerialize: array contains a hole at index ${i}`,
        );
      }
      const v = value[i];
      const s = canonicalSerializeInner(v, ancestors);
      // Defense in depth: any nested rejection (e.g. a
      // stray function inside an otherwise-valid array)
      // surfaces here rather than as an empty slot.
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
  const keys = Object.keys(value)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
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
