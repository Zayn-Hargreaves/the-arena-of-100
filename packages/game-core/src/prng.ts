// ============================================================
// Deterministic PRNG helpers — Game Đấu Trường 100
//
// Pure, dependency-free hashing + RNG used by the fair tie-break
// (see ./tie-break.ts). Extracted from MatchStateMachine so the
// primitives can be unit-tested in isolation and reused without
// pulling in the whole state machine. Behaviour is unchanged.
// ============================================================

/**
 * FNV-1a 32-bit hash. Returns an unsigned 32-bit integer suitable
 * for seeding a small PRNG. We use FNV-1a instead of
 * crypto.createHash so this is a pure function with zero
 * dependencies and the same output on every platform.
 */
export function hashStringToSeed(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a tiny, fast, statistically-good 32-bit PRNG.
 * Returns a function that produces floats in [0, 1). The same
 * seed always produces the same sequence, which is what makes
 * the tie-break reproducible across process restarts.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
