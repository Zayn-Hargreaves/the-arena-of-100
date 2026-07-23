import { afterEach, describe, expect, it, vi } from "vitest";
import { generateId } from "./id";

describe("generateId", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  });

  it("uses randomUUID when available (Tier 1)", () => {
    const mockUUID = "123e4567-e89b-12d3-a456-426614174000";
    Object.defineProperty(globalThis, "crypto", {
      value: {
        randomUUID: vi.fn().mockReturnValue(mockUUID),
      },
      configurable: true,
      writable: true,
    });

    expect(generateId()).toBe(mockUUID);
  });

  it("falls back to getRandomValues when randomUUID is unavailable (Tier 2)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        getRandomValues: vi.fn((array: Uint32Array) => {
          array[0] = 12345;
          array[1] = 67890;
          return array;
        }),
      },
      configurable: true,
      writable: true,
    });

    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("falls back to counter when crypto APIs are unavailable (Tier 3)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});
