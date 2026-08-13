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

export const VECTOR_ATTACK_CLASS_HAPPY: SamplingVector = {
  classId: "ATTACK",
  seed: "match-1|ATTACK-player-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: ["CB-1", "CB-2", "CB-3", "CB-4", "CB-5", "CB-6", "CB-7", "CB-8"],
  steps: [
    { float: 0.7999080908484757, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.2420050031505525,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "CB-4",
    },
    {
      float: 0.28035216545686126,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.21088944585062563,
      purpose: "CARD",
      retry: false,
      cardIndex: 1,
      drawnCardId: "CB-2",
    },
    {
      float: 0.45453126821666956,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.9860148571897298,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "CB-7",
    },
  ],
  offeredCardIds: ["CB-4", "CB-2", "CB-7"],
} as const;

export const VECTOR_DEFENSE_CLASS_HAPPY: SamplingVector = {
  classId: "DEFENSE",
  seed: "match-1|DEFENSE-player-1",
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
      float: 0.27121737878769636,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.40260959579609334,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "TN-3",
    },
    {
      float: 0.2202025989536196,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.7773561500944197,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "TN-6",
    },
    { float: 0.8675547456368804, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.9955143094994128,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "TN-9",
    },
  ],
  offeredCardIds: ["TN-3", "TN-6", "TN-9"],
} as const;

export const VECTOR_SHARED_SEED_ATTACK: SamplingVector = {
  classId: "ATTACK",
  seed: "shared-seed-1",
  prngVersion: PRNG_CONTRACT_VERSION,
  pool: ["CB-1", "CB-2", "CB-3", "CB-4", "CB-5", "CB-6", "CB-7", "CB-8"],
  steps: [
    { float: 0.6622988730669022, purpose: "TIER", retry: false, tier: "RARE" },
    {
      float: 0.2698002790566534,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "CB-4",
    },
    { float: 0.9095154637470841, purpose: "TIER", retry: false, tier: "EPIC" },
    {
      float: 0.9176650370936841,
      purpose: "CARD",
      retry: false,
      cardIndex: 0,
      drawnCardId: "CB-8",
    },
    {
      float: 0.1361268328037113,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.30713995452970266,
      purpose: "CARD",
      retry: false,
      cardIndex: 1,
      drawnCardId: "CB-2",
    },
  ],
  offeredCardIds: ["CB-4", "CB-8", "CB-2"],
} as const;

export const VECTOR_SHARED_SEED_DEFENSE: SamplingVector = {
  classId: "DEFENSE",
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
      float: 0.09039362985640764,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.41077345330268145,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "TN-3",
    },
    {
      float: 0.19746926031075418,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.6689903363585472,
      purpose: "CARD",
      retry: false,
      cardIndex: 3,
      drawnCardId: "TN-6",
    },
    {
      float: 0.42102572857402265,
      purpose: "TIER",
      retry: false,
      tier: "COMMON",
    },
    {
      float: 0.6441179781686515,
      purpose: "CARD",
      retry: false,
      cardIndex: 2,
      drawnCardId: "TN-5",
    },
  ],
  offeredCardIds: ["TN-3", "TN-6", "TN-5"],
} as const;

export const ALL_SAMPLING_VECTORS: readonly SamplingVector[] = [
  VECTOR_ATTACK_CLASS_HAPPY,
  VECTOR_DEFENSE_CLASS_HAPPY,
  VECTOR_SHARED_SEED_ATTACK,
  VECTOR_SHARED_SEED_DEFENSE,
] as const;

export function loadSamplingVector(label: string): SamplingVector {
  switch (label) {
    case "attack-class-happy":
      return VECTOR_ATTACK_CLASS_HAPPY;
    case "defense-class-happy":
      return VECTOR_DEFENSE_CLASS_HAPPY;
    case "shared-seed-attack":
      return VECTOR_SHARED_SEED_ATTACK;
    case "shared-seed-defense":
      return VECTOR_SHARED_SEED_DEFENSE;
  }
  throw new Error(`Unknown sampling vector: ${label}`);
}

export {
  deepFreeze,
  getImmutableSamplingVector,
  canonicalSerialize,
} from "./cards.sampling-vector-helpers";
