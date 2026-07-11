import { describe, expect, it } from "vitest";
import { resolveCorsOrigins } from "./cors";

describe("resolveCorsOrigins", () => {
  it("returns dev origins when env is missing", () => {
    const origins = resolveCorsOrigins(undefined);

    expect(origins).toHaveLength(3);
    expect(origins[0]).toBe("http://localhost:3000");
    expect(origins[1]).toBe("http://127.0.0.1:3000");
    expect(origins[2]).toBeInstanceOf(RegExp);
  });

  it("treats the default localhost env as dev fallback", () => {
    const origins = resolveCorsOrigins("http://localhost:3000");

    expect(origins).toHaveLength(3);
    expect(origins[0]).toBe("http://localhost:3000");
    expect(origins[1]).toBe("http://127.0.0.1:3000");
    expect(origins[2]).toBeInstanceOf(RegExp);
  });

  it("treats an empty env value as dev fallback", () => {
    const origins = resolveCorsOrigins("");

    expect(origins).toHaveLength(3);
    expect(origins[0]).toBe("http://localhost:3000");
    expect(origins[1]).toBe("http://127.0.0.1:3000");
    expect(origins[2]).toBeInstanceOf(RegExp);
  });

  it("treats a whitespace-only env value as dev fallback", () => {
    const origins = resolveCorsOrigins("   ");

    expect(origins).toHaveLength(3);
    expect(origins[0]).toBe("http://localhost:3000");
    expect(origins[1]).toBe("http://127.0.0.1:3000");
    expect(origins[2]).toBeInstanceOf(RegExp);
  });

  it("fallback regex matches valid LAN origins on port 3000", () => {
    const origins = resolveCorsOrigins(undefined);
    const regex = origins[2] as RegExp;

    expect(regex.test("http://192.168.1.106:3000")).toBe(true);
    expect(regex.test("http://10.0.0.5:3000")).toBe(true);
    expect(regex.test("http://172.16.0.8:3000")).toBe(true);
    expect(regex.test("http://172.31.255.255:3000")).toBe(true);
  });

  it("fallback regex rejects origins with the wrong port", () => {
    const origins = resolveCorsOrigins(undefined);
    const regex = origins[2] as RegExp;

    expect(regex.test("http://192.168.1.106:3001")).toBe(false);
    expect(regex.test("http://10.0.0.5:80")).toBe(false);
    expect(regex.test("http://172.16.0.8:8080")).toBe(false);
  });

  it("fallback regex rejects public (non-LAN) origins", () => {
    const origins = resolveCorsOrigins(undefined);
    const regex = origins[2] as RegExp;

    // Public IPs are not in any of the LAN ranges the regex matches.
    expect(regex.test("http://8.8.8.8:3000")).toBe(false);
    expect(regex.test("http://172.32.0.1:3000")).toBe(false);
    // 172.15.x.x is outside the private 172.16.0.0/12 range.
    expect(regex.test("http://172.15.0.1:3000")).toBe(false);
  });

  it("supports comma-separated explicit origins", () => {
    expect(
      resolveCorsOrigins("http://localhost:3000, http://192.168.1.106:3000"),
    ).toEqual(["http://localhost:3000", "http://192.168.1.106:3000"]);
  });
});
