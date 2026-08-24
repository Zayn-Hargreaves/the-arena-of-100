import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { RoomCodeCard } from "./room-code-card";

describe("RoomCodeCard", () => {
  let originalClipboard: PropertyDescriptor | undefined;
  let originalIsSecureContext: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    originalIsSecureContext = Object.getOwnPropertyDescriptor(
      window,
      "isSecureContext",
    );

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("renders the room code and translated labels", () => {
    render(<RoomCodeCard roomCode="ABCD" />);
    expect(screen.getByText("ABCD")).toBeInTheDocument();
    expect(screen.getByText("label")).toBeInTheDocument();
    expect(screen.getByText("pinAndLink")).toBeInTheDocument();
  });

  it("handles copy code and resets copied state after 2 seconds", async () => {
    render(<RoomCodeCard roomCode="ABCD" />);
    const copyButton = screen.getByRole("button", { name: "copyCode" });

    await act(async () => {
      copyButton.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD");
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      screen.getByRole("button", { name: "copyCode" }),
    ).toBeInTheDocument();
  });

  it("resets timer upon consecutive clicks on copy code", async () => {
    render(<RoomCodeCard roomCode="ABCD" />);
    const copyButton = screen.getByRole("button", { name: "copyCode" });

    // First click
    await act(async () => {
      copyButton.click();
    });
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    // Advance 1 second
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    // Second click
    await act(async () => {
      copyButton.click();
    });
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    // Advance 1.5 seconds (2.5s from first click, 1.5s from second click)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Should still be copied because 2 seconds haven't passed since second click
    expect(
      screen.getByRole("button", { name: "copiedCode" }),
    ).toBeInTheDocument();

    // Advance remaining 500ms
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(
      screen.getByRole("button", { name: "copyCode" }),
    ).toBeInTheDocument();
  });

  it("handles copy link and resets after 2 seconds", async () => {
    render(<RoomCodeCard roomCode="ABCD" />);
    const copyLinkButton = screen.getByRole("button", { name: "copyLink" });

    await act(async () => {
      copyLinkButton.click();
    });

    expect(screen.getByText("copiedLink")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText("copiedLink")).not.toBeInTheDocument();
    expect(screen.getByText("copyLink")).toBeInTheDocument();
  });

  it("cleans up timeout on unmount without errors", async () => {
    const { unmount } = render(<RoomCodeCard roomCode="ABCD" />);
    const copyButton = screen.getByRole("button", { name: "copyCode" });

    await act(async () => {
      copyButton.click();
    });

    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(3000);
      });
    }).not.toThrow();
  });

  it("exits post-await path in copyToClipboard without scheduling a timeout or updating state when unmounted before writeText resolves", async () => {
    let resolveWriteText!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveWriteText = resolve;
    });
    vi.mocked(navigator.clipboard.writeText).mockReturnValue(pendingPromise);

    const { unmount } = render(<RoomCodeCard roomCode="ABCD" />);
    const copyButton = screen.getByRole("button", { name: "copyCode" });

    act(() => {
      copyButton.click();
    });

    // Unmount before resolving writeText promise
    unmount();

    await act(async () => {
      resolveWriteText();
    });

    // Assert that no timeout is scheduled
    expect(vi.getTimerCount()).toBe(0);
  });
});
