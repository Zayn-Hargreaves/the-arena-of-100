import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const originalWindow = globalThis.window;

// Capture the initial presence + value of NEXT_PUBLIC_API_URL so the
// suite can restore it after the suite ends instead of unconditionally
// deleting it. Without this, a host that sets the env var (CI, dev
// shell, etc.) loses the value after the first test in the file.
const API_URL_ENV_KEY = "NEXT_PUBLIC_API_URL";
const originalApiUrlHadKey = Object.prototype.hasOwnProperty.call(
  process.env,
  API_URL_ENV_KEY,
);
const originalApiUrlValue = originalApiUrlHadKey
  ? process.env[API_URL_ENV_KEY]
  : undefined;

describe("api URL resolution", () => {
  beforeEach(() => {
    // Start each test from a clean no-override state so the
    // "no env override exists" case is deterministic.
    delete process.env[API_URL_ENV_KEY];
  });

  afterEach(() => {
    vi.resetModules();

    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("falls back to localhost when no env override exists", async () => {
    // Sanity: with no env override and no host-derivation logic, the
    // module resolves to the dev fallback. (Host-derivation from
    // window.location is no longer implemented; if a future change
    // re-introduces it, add a dedicated assertion in a new test.)
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          protocol: "http:",
          hostname: "192.168.1.106",
        },
      },
      configurable: true,
    });

    const apiModule = await import("./api");

    expect(apiModule.API_URL).toBe("http://localhost:3001");
  });

  it("respects NEXT_PUBLIC_API_URL when configured", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    const apiModule = await import("./api");

    expect(apiModule.API_URL).toBe("https://api.example.com");
  });
});

// Restoration of NEXT_PUBLIC_API_URL must run AFTER the entire suite,
// not inside an `it` block (where beforeEach would already have deleted
// the env var). Putting it in afterAll guarantees the post-suite state
// is checked once, with no interference from per-test setup.
afterAll(() => {
  if (originalApiUrlHadKey) {
    process.env[API_URL_ENV_KEY] = originalApiUrlValue;
  } else {
    delete process.env[API_URL_ENV_KEY];
  }

  expect(
    Object.prototype.hasOwnProperty.call(process.env, API_URL_ENV_KEY),
  ).toBe(originalApiUrlHadKey);
  if (originalApiUrlHadKey) {
    expect(process.env[API_URL_ENV_KEY]).toBe(originalApiUrlValue);
  }
});
