let counter = 0;

/**
 * Generates a unique identifier using a 3-tier fallback strategy:
 * 1. crypto.randomUUID (cryptographically secure UUID v4)
 * 2. crypto.getRandomValues (cryptographically secure random fallback)
 * 3. Date.now() + sequential counter fallback (environments without crypto API)
 */
export function generateId(): string {
  const crypto = globalThis.crypto;

  if (crypto !== undefined && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (crypto !== undefined && typeof crypto.getRandomValues === "function") {
    const array = new Uint32Array(2);
    crypto.getRandomValues(array);
    return `${Date.now().toString(36)}-${array[0].toString(36)}${array[1].toString(36)}`;
  }

  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}
