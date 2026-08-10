import { mulberry32, deriveSubstream, seedFromString } from './packages/game-core/dist/prng.js';
import { CARD_CATALOG, compareCardId, getCardDefinition } from './packages/shared/dist/index.js';

function selectTier(u) {
  if (u < 0.6) return "COMMON";
  if (u < 0.9) return "RARE";
  return "EPIC";
}

function sampleWithSteps(classId, seed) {
  const substreamSeed = deriveSubstream(seed, `card|${classId}`);
  const rng = mulberry32(substreamSeed);
  const classPool = CARD_CATALOG.filter((c) => c.classId === classId);
  const remaining = new Map();
  for (const tier of ["COMMON", "RARE", "EPIC"]) {
    remaining.set(tier, classPool.filter((c) => c.tier === tier).map((c) => c.id).sort(compareCardId));
  }
  const cards = [];
  const steps = [];
  for (let draw = 0; draw < 3; draw++) {
    // Track the total remaining across every tier so the tier
    // loop terminates when the class pool is exhausted (spec §3.3
    // "If the entire class pool is exhausted, stop and return
    // fewer than 3 cards").
    let totalRemaining = 0;
    for (const list of remaining.values()) totalRemaining += list.length;
    if (totalRemaining === 0) break;

    let tier;
    while (true) {
      const u = rng();
      tier = selectTier(u);
      const list = remaining.get(tier) || [];
      if (list.length > 0) {
        steps.push({ float: u, purpose: "TIER", tier, retry: false });
        break;
      }
      steps.push({ float: u, purpose: "TIER", tier, retry: true });
    }
    const tierList = remaining.get(tier) || [];
    const u2 = rng();
    const idx = Math.floor(u2 * tierList.length);
    const drawnCardId = tierList[idx];
    steps.push({ float: u2, purpose: "CARD", cardIndex: idx, retry: false, drawnCardId });
    cards.push(drawnCardId);
    remaining.set(tier, tierList.filter((_, i) => i !== idx));
  }
  return { cards, steps };
}

const cases = [
  { label: "cong-class-happy", classId: "CONG", seed: "match-1|CONG-player-1" },
  { label: "thu-class-happy", classId: "THU", seed: "match-1|THU-player-1" },
  { label: "shared-seed-cong", classId: "CONG", seed: "shared-seed-1" },
  { label: "shared-seed-thu", classId: "THU", seed: "shared-seed-1" },
];

let out = "// AUTO-GENERATED from spec §3.3 sampling algorithm — see\n";
out += "// packages/game-core/src/card-engine.ts. Baked via\n";
out += "// `pnpm gen:sampling-vectors` (root) and pinned to\n";
out += "// PRNG_CONTRACT_VERSION. The script first builds\n";
out += "// `@arena/shared` and `@arena/game-core` so PRNG + catalog\n";
out += "// artifacts are imported from `dist/`. Do NOT edit by hand.\n\n";
out += "import { PRNG_CONTRACT_VERSION, type CardId } from \"./cards\";\n";
out += "import type { ClassId } from \"./classes\";\n\n";
out += "export interface SamplingVector {\n";
out += "  readonly classId: ClassId;\n";
out += "  readonly seed: string;\n";
out += "  readonly prngVersion: string;\n";
out += "  readonly pool: readonly CardId[];\n";
out += "  readonly steps: ReadonlyArray<{\n";
out += "    readonly float: number;\n";
out += "    readonly purpose: \"TIER\" | \"CARD\";\n";
out += "    readonly tier?: \"COMMON\" | \"RARE\" | \"EPIC\";\n";
out += "    readonly cardIndex?: number;\n";
out += "    readonly retry: boolean;\n";
out += "    readonly drawnCardId?: CardId;\n";
out += "  }>;\n";
out += "  readonly offeredCardIds: readonly CardId[];\n";
out += "}\n\n";

for (const c of cases) {
  const { cards, steps } = sampleWithSteps(c.classId, c.seed);
  const pool = CARD_CATALOG.filter((x) => x.classId === c.classId).map((x) => x.id).sort(compareCardId);
  out += `export const VECTOR_${c.label.toUpperCase().replace(/-/g, "_")}: SamplingVector = {\n`;
  out += `  classId: ${JSON.stringify(c.classId)},\n`;
  out += `  seed: ${JSON.stringify(c.seed)},\n`;
  out += `  prngVersion: PRNG_CONTRACT_VERSION,\n`;
  out += `  pool: ${JSON.stringify(pool)},\n`;
  out += `  steps: [\n`;
  for (const s of steps) {
    const parts = [`float: ${s.float}`, `purpose: ${JSON.stringify(s.purpose)}`, `retry: ${s.retry}`];
    if (s.tier) parts.push(`tier: ${JSON.stringify(s.tier)}`);
    if (s.cardIndex !== undefined) parts.push(`cardIndex: ${s.cardIndex}`);
    if (s.drawnCardId) parts.push(`drawnCardId: ${JSON.stringify(s.drawnCardId)}`);
    out += `    { ${parts.join(", ")} },\n`;
  }
  out += `  ],\n`;
  out += `  offeredCardIds: ${JSON.stringify(cards)},\n`;
  out += `} as const;\n\n`;
}

out += "export const ALL_SAMPLING_VECTORS: readonly SamplingVector[] = [\n";
for (const c of cases) {
  out += `  VECTOR_${c.label.toUpperCase().replace(/-/g, "_")},\n`;
}
out += "] as const;\n\n";

out += "export function loadSamplingVector(label: string): SamplingVector {\n";
out += "  switch (label) {\n";
for (const c of cases) {
  out += `    case ${JSON.stringify(c.label)}: return VECTOR_${c.label.toUpperCase().replace(/-/g, "_")};\n`;
}
out += "  }\n";
out += "  throw new Error(`Unknown sampling vector: ${label}`);\n";
out += "}\n\n";

// Deep-freeze helper
out += "function deepFreeze<T>(value: T): T {\n";
out += "  if (value === null || typeof value !== \"object\") return value;\n";
out += "  Object.freeze(value);\n";
out += "  for (const k of Object.keys(value)) {\n";
out += "    deepFreeze((value as Record<string, unknown>)[k]);\n";
out += "  }\n";
out += "  return value;\n";
out += "}\n\n";

out += "export function getImmutableSamplingVector(label: string): SamplingVector {\n";
out += "  // Clone first so we don't freeze the module-level VECTOR_*\n";
out += "  // singleton returned by loadSamplingVector — deep-freezing the\n";
out += "  // shared vector would corrupt a subsequent direct\n";
out += "  // loadSamplingVector() call that expects a mutable (but\n";
out += "  // readonly) reference.\n";
out += "  return deepFreeze(structuredClone(loadSamplingVector(label))) as SamplingVector;\n";
out += "}\n\n";

out += "export function canonicalSerialize(value: unknown): string {\n";
out += "  return canonicalSerializeInner(value, new WeakSet<object>());\n";
out += "}\n\n";
out += "function canonicalSerializeInner(\n";
out += "  value: unknown,\n";
out += "  ancestors: WeakSet<object>,\n";
out += "): string {\n";
out += "  // Reject values that JSON.stringify cannot (or will not)\n";
out += "  // produce a non-empty string for. JSON.stringify returns\n";
out += "  // `undefined` for these inputs — propagating that would\n";
out += "  // violate the \"every accepted value returns a string\"\n";
out += "  // contract this function exposes.\n";
out += "  if (value === undefined) {\n";
out += "    throw new TypeError(\"canonicalSerialize: undefined is not a serializable value\");\n";
out += "  }\n";
out += "  if (typeof value === \"function\" || typeof value === \"symbol\") {\n";
out += "    throw new TypeError(\n";
out += "      `canonicalSerialize: ${typeof value} is not a serializable value`,\n";
out += "    );\n";
out += "  }\n";
out += "  if (value === null || typeof value !== \"object\") {\n";
out += "    return JSON.stringify(value) as string;\n";
out += "  }\n";
out += "  // Cycle detection: a value that is already an ancestor of the\n";
out += "  // current branch would cause a `RangeError: Maximum call stack\n";
out += "  // size exceeded` recursion. Surface that as an explicit\n";
out += "  // `TypeError` instead — canonical serializers must never blow\n";
out += "  // the call stack. The `WeakSet` is per-call (the outer helper\n";
out += "  // creates a fresh one) so a value that legitimately appears\n";
out += "  // multiple times in non-cyclic positions still serializes.\n";
out += "  if (ancestors.has(value as object)) {\n";
out += "    throw new TypeError(\n";
out += "      \"canonicalSerialize: cyclic value is not serializable\",\n";
out += "    );\n";
out += "  }\n";
out += "  ancestors.add(value as object);\n";
out += "  if (Array.isArray(value)) {\n";
out += "    const parts = new Array<string>(value.length);\n";
out += "    for (let i = 0; i < value.length; i++) {\n";
out += "      // Reject sparse arrays before serializing any element.\n";
out += "      // `Array.prototype.map` silently skips holes, which would let a\n";
out += "      // sparse array sneak through as a shorter array of indices — a\n";
out += "      // silent contract violation for canonical serializers. Use\n";
out += "      // `Object.prototype.hasOwnProperty.call` so inherited\n";
out += "      // array indices (e.g. inherited `.0` from a manual prototype\n";
out += "      // chain) are NOT treated as present elements — only own\n";
out += "      // indices are serialized.\n";
out += "      if (!Object.prototype.hasOwnProperty.call(value, i)) {\n";
out += "        throw new TypeError(\n";
out += "          `canonicalSerialize: array contains a hole at index ${i}`,\n";
out += "        );\n";
out += "      }\n";
out += "      const v = value[i];\n";
out += "      const s = canonicalSerializeInner(v, ancestors);\n";
out += "      // Defense in depth: any nested rejection (e.g. a\n";
out += "      // stray function inside an otherwise-valid array)\n";
out += "      // surfaces here rather than as an empty slot.\n";
out += "      if (typeof s !== \"string\" || s.length === 0) {\n";
out += "        throw new TypeError(\n";
out += "          `canonicalSerialize: array element is not a non-empty string (${String(v)})`,\n";
out += "        );\n";
out += "      }\n";
out += "      parts[i] = s;\n";
out += "    }\n";
out += "    ancestors.delete(value as object);\n";
out += "    return \"[\" + parts.join(\",\") + \"]\";\n";
out += "  }\n";
out += "  const keys = Object.keys(value)\n";
out += "    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)\n";
out += "    .sort();\n";
out += "  const out =\n";
out += "    \"{\" +\n";
out += "    keys\n";
out += "      .map((k) => {\n";
out += "        const s = canonicalSerializeInner(\n";
out += "          (value as Record<string, unknown>)[k],\n";
out += "          ancestors,\n";
out += "        );\n";
out += "        return JSON.stringify(k) + \":\" + s;\n";
out += "      })\n";
out += "      .join(\",\") +\n";
out += "    \"}\";\n";
out += "  ancestors.delete(value as object);\n";
out += "  return out;\n";
out += "}\n";

console.log(out);
