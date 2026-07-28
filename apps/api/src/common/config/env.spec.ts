import { describe, it, expect } from "vitest";
import { positiveIntEnv } from "./env";

describe("positiveIntEnv", () => {
  it("returns fallback when raw is undefined", () => {
    expect(positiveIntEnv(undefined, 10)).toBe(10);
  });

  it("returns parsed integer when raw is a valid positive integer string", () => {
    expect(positiveIntEnv("42", 10)).toBe(42);
    expect(positiveIntEnv(" 100 ", 10)).toBe(100);
  });

  it("returns fallback for non-digit strings, signs, decimals, or mixed text", () => {
    expect(positiveIntEnv("abc", 10)).toBe(10);
    expect(positiveIntEnv("100abc", 10)).toBe(10);
    expect(positiveIntEnv("abc100", 10)).toBe(10);
    expect(positiveIntEnv("12.34", 10)).toBe(10);
    expect(positiveIntEnv("-5", 10)).toBe(10);
    expect(positiveIntEnv("+10", 10)).toBe(10);
    expect(positiveIntEnv("", 10)).toBe(10);
  });

  it("returns fallback when parsed integer is zero or not a safe positive integer", () => {
    expect(positiveIntEnv("0", 10)).toBe(10);
    expect(positiveIntEnv(String(Number.MAX_SAFE_INTEGER), 10)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(positiveIntEnv(String(Number.MAX_SAFE_INTEGER + 1), 10)).toBe(10);
    expect(positiveIntEnv("99999999999999999999999", 10)).toBe(10);
  });
});
