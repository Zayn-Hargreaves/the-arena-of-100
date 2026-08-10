// ============================================================
// Deterministic PRNG helpers — Game Đấu Trường 100
//
// Pure, dependency-free hashing + RNG used by the fair tie-break
// (see ./tie-break.ts) and the Phase 2 card sampling engine
// (see ./card-engine.ts). Extracted from MatchStateMachine so the
// primitives can be unit-tested in isolation and reused without
// pulling in the whole state machine.
//
// Source of truth: memory-bank/spec/class-cards-phase.md §3.3
// "Byte-level RNG consumption" + "mulberry32" reference.
// ============================================================

/**
 * FNV-1a 32-bit hash. Returns an unsigned 32-bit integer suitable
 * for seeding a small PRNG. We use FNV-1a instead of
 * crypto.createHash so this is a pure function with zero
 * dependencies and the same output on every platform.
 *
 * Used by tie-break (legacy) — the canonical card-sampling seed
 * derivation uses `seedFromString` (sha256 first-4-bytes LE)
 * below, per spec §3.3.
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
 * SHA-256 first 4 bytes (little-endian uint32) → mulberry32 seed.
 * Matches the seed-derivation contract used by the Gauntlet
 * RNG (see docs/plans/gauntlet-design.md §"Seed-derivation
 * contract" §1-2) but is reproduced here so @arena/game-core
 * stays infrastructure-free (no node:crypto import).
 *
 * The implementation is a pure SHA-256 encoder that runs in
 * O(messageBytes) and produces the canonical first-4-bytes
 * little-endian uint32 seed. Same input → same output across
 * processes, platforms, and Node majors. This is the seed
 * derivation the card-sampling engine consumes and the seed
 * derivation every sampling vector pins.
 */
export function seedFromString(s: string): number {
  const bytes = sha256Bytes(utf8Encode(s));
  // Little-endian uint32 from the first 4 bytes. The inner `>>> 0`
  // already normalizes the value; the outer one was redundant.
  return (
    ((bytes[0] ?? 0) |
      ((bytes[1] ?? 0) << 8) |
      ((bytes[2] ?? 0) << 16) |
      ((bytes[3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * Derive a substream seed from a parent seed + a domain label.
 * The canonical contract (spec §3.3): the substream seed is
 * `seedFromString(`${parentSeed}|${label}`)` — appending a
 * domain label guarantees `card` and `class` substreams never
 * collide with each other or with the parent substream.
 *
 * Used by the card-sampling engine so the per-class, per-round
 * card offer is reproducible across processes without sharing
 * the parent RNG state.
 */
export function deriveSubstream(parentSeed: string, label: string): number {
  return seedFromString(`${parentSeed}|${label}`);
}

/**
 * mulberry32: a tiny, fast, statistically-good 32-bit PRNG.
 * Returns a function that produces floats in [0, 1). The same
 * seed always produces the same sequence, which is what makes
 * tie-break + card sampling reproducible across process restarts.
 *
 * Identity: 32-bit unsigned arithmetic, wrap-around at every
 * step. This matches the spec's "mulberry32" algorithm
 * verbatim. Used by every consumer that requires deterministic
 * byte-level RNG output (spec §3.3 "Byte-level RNG
 * consumption").
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

// ---------------------------------------------------------------------------
// Pure SHA-256 implementation (UTF-8 bytes → 32-byte digest)
// ---------------------------------------------------------------------------
//
// The algorithm is the FIPS 180-4 reference (constants K[64]), with
// bitwise ops + 32-bit wrap-around. Output is a 32-byte array; only
// the first 4 bytes are consumed by `seedFromString`, but the helper
// returns the full digest so callers can adopt it for other uses
// without re-implementing SHA-256.
//
// Performance note: this is intentionally simple (no Wasm, no
// native crypto). For the seed derivation we only need the first
// 4 bytes of the digest, so O(message) is fine for the tiny
// inputs (parent seed + short label).

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  // U+FFFD in UTF-8: 0xEF 0xBF 0xBD.
  const REPLACEMENT = [0xef, 0xbf, 0xbd];
  const isHighSurrogate = (c: number) => c >= 0xd800 && c < 0xdc00;
  const isLowSurrogate = (c: number) => c >= 0xdc00 && c < 0xe000;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (isHighSurrogate(c)) {
      const c2 = s.charCodeAt(i + 1);
      if (i + 1 < s.length && isLowSurrogate(c2)) {
        c = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        i++;
        out.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        );
      } else {
        // Unpaired or invalid high surrogate — encode as U+FFFD
        // (matches the WHATWG Encoding Standard used by TextEncoder).
        out.push(...REPLACEMENT);
      }
    } else if (isLowSurrogate(c)) {
      // Unpaired low surrogate — encode as U+FFFD.
      out.push(...REPLACEMENT);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Bytes(bytes: readonly number[]): Uint8Array {
  const len = bytes.length;
  // Total padded length MUST be a multiple of 64. Layout:
  //   [message | 0x80 | zeros (>=0) | 64-bit big-endian bit-length]
  // = len + 1 + padLen + 8 bytes → padLen = (-(len + 9)) mod 64.
  const padLen = (64 - ((len + 9) % 64)) % 64;
  const total = len + 9 + padLen;
  const buf = new Uint8Array(total);
  for (let i = 0; i < len; i++) buf[i] = bytes[i] ?? 0;
  buf[len] = 0x80;
  // Append 64-bit big-endian length-in-bits. We compute the
  // high/low 32-bit words from a single BigInt shift so very large
  // inputs (>2^32 bits) do NOT silently overflow a JS `>>> 32`.
  const bitLen = BigInt(len) * 8n;
  buf[total - 8] = Number((bitLen >> 56n) & 0xffn);
  buf[total - 7] = Number((bitLen >> 48n) & 0xffn);
  buf[total - 6] = Number((bitLen >> 40n) & 0xffn);
  buf[total - 5] = Number((bitLen >> 32n) & 0xffn);
  buf[total - 4] = Number((bitLen >> 24n) & 0xffn);
  buf[total - 3] = Number((bitLen >> 16n) & 0xffn);
  buf[total - 2] = Number((bitLen >> 8n) & 0xffn);
  buf[total - 1] = Number(bitLen & 0xffn);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);

  for (let block = 0; block < total; block += 64) {
    for (let i = 0; i < 16; i++) {
      const j = block + i * 4;
      W[i] =
        ((buf[j] ?? 0) << 24) |
        ((buf[j + 1] ?? 0) << 16) |
        ((buf[j + 2] ?? 0) << 8) |
        (buf[j + 3] ?? 0);
      W[i] = (W[i] ?? 0) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(W[i - 15] ?? 0, 7) ^
        rotr(W[i - 15] ?? 0, 18) ^
        ((W[i - 15] ?? 0) >>> 3);
      const s1 =
        rotr(W[i - 2] ?? 0, 17) ^
        rotr(W[i - 2] ?? 0, 19) ^
        ((W[i - 2] ?? 0) >>> 10);
      W[i] = ((W[i - 16] ?? 0) + (s0 ?? 0) + (W[i - 7] ?? 0) + (s1 ?? 0)) >>> 0;
    }

    let a = H[0] ?? 0,
      b = H[1] ?? 0,
      c = H[2] ?? 0,
      d = H[3] ?? 0,
      e = H[4] ?? 0,
      f = H[5] ?? 0,
      g = H[6] ?? 0,
      h = H[7] ?? 0;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (W[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i]! >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i]! >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i]! >>> 8) & 0xff;
    out[i * 4 + 3] = H[i]! & 0xff;
  }
  return out;
}
