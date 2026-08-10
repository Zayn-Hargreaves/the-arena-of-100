import { sampleOffer } from './packages/game-core/dist/card-engine.js';
import { CARD_CATALOG, compareCardId } from './packages/shared/dist/index.js';

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
  const { cards, steps } = sampleOffer(c.classId, c.seed);
  const pool = CARD_CATALOG.filter((x) => x.classId === c.classId).map((x) => x.id).sort(compareCardId);
  out += `export const VECTOR_${c.label.toUpperCase().replaceAll('-', "_")}: SamplingVector = {\n`;
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
  out += `  VECTOR_${c.label.toUpperCase().replaceAll('-', "_")},\n`;
}
out += "] as const;\n\n";

out += "export function loadSamplingVector(label: string): SamplingVector {\n";
out += "  switch (label) {\n";
for (const c of cases) {
  out += `    case ${JSON.stringify(c.label)}: return VECTOR_${c.label.toUpperCase().replaceAll('-', "_")};\n`;
}
out += "  }\n";
out += "  throw new Error(`Unknown sampling vector: ${label}`);\n";
out += "}\n\n";

out += "export { deepFreeze, getImmutableSamplingVector, canonicalSerialize } from \"./cards.sampling-vector-helpers\";\n";

console.log(out);
