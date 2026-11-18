import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  let originalClipboard: PropertyDescriptor | undefined;
  let originalIsSecureContext: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    originalIsSecureContext = Object.getOwnPropertyDescriptor(
      window,
      "isSecureContext",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      try {
        delete (navigator as unknown as { clipboard?: unknown }).clipboard;
      } catch {}
    }

    if (originalIsSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalIsSecureContext);
    } else {
      try {
        delete (window as unknown as { isSecureContext?: unknown })
          .isSecureContext;
      } catch {}
    }
  });

  it("uses navigator.clipboard.writeText when available in secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("test text");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("test text");
  });

  it("falls back to document.execCommand when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyToClipboard("fallback text");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to document.execCommand when not in secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
      writable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const result = await copyToClipboard("insecure text");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("returns false if both clipboard and execCommand fail", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error("execCommand failed");
    });

    const result = await copyToClipboard("fail text");
    expect(result).toBe(false);
  });
});
