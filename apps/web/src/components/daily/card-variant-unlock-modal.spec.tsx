import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CardVariantUnlockModal } from "./card-variant-unlock-modal";
import type { DailySubmitResponse } from "../../types/daily";

vi.mock("@arena/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@arena/shared")>();
  return {
    ...actual,
    getCardDefinition: vi.fn((id: string) => ({
      id,
      name: `Card ${id}`,
      classId: "ATTACK" as const,
      tier: "COMMON" as const,
      backfireRate: 0.1,
      effectType: "DAMAGE" as const,
      basePower: 10,
    })),
  };
});

const mockResult: DailySubmitResponse = {
  dateKey: "2026-01-01",
  version: 1,
  score: 850,
  correctCount: 8,
  totalQuestions: 10,
  elapsedMs: 45000,
  streakBefore: 6,
  streakAfter: 7,
  results: [],
  completedAt: "2026-01-01T12:00:00Z",
  unlockedVariant: {
    cardId: "ATK-1",
    variantKey: "GOLD",
  },
};

function makeProps(overrides?: Record<string, unknown>) {
  return {
    result: mockResult,
    onClose: vi.fn(),
    title: "Unlock Title",
    subtitle: "Unlock Subtitle",
    shareLabel: "Share",
    copyLabel: "Copy",
    copiedLabel: "Copied!",
    closeLabel: "Close",
    unlockHeadlineTemplate: "Unlocked {variant} {cardName}!",
    shareHeadline: "I unlocked a card!",
    shareScoreLine: (score: number, correct: number, total: number) =>
      `Score: ${score} (${correct}/${total})`,
    shareStreakLine: (streak: number) => `Streak: ${streak}`,
    ...overrides,
  };
}

// Snapshot of the browser globals these tests mutate
// (`navigator.share`, `navigator.clipboard`, `window.isSecureContext`)
// so each test can `Object.defineProperty` to a stub and the
// `afterEach` restores the real JSDOM originals. Without this,
// earlier tests leak their fake `share` / `clipboard` mocks into
// later tests and produce order-dependent failures.
const browserGlobalsSnapshot = {
  navigatorShare: Object.getOwnPropertyDescriptor(navigator, "share"),
  navigatorClipboard: Object.getOwnPropertyDescriptor(navigator, "clipboard"),
  windowIsSecureContext: Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext",
  ),
};

function restoreBrowserGlobals() {
  if (browserGlobalsSnapshot.navigatorShare) {
    Object.defineProperty(
      navigator,
      "share",
      browserGlobalsSnapshot.navigatorShare,
    );
  } else {
    delete (navigator as { share?: unknown }).share;
  }
  if (browserGlobalsSnapshot.navigatorClipboard) {
    Object.defineProperty(
      navigator,
      "clipboard",
      browserGlobalsSnapshot.navigatorClipboard,
    );
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
  if (browserGlobalsSnapshot.windowIsSecureContext) {
    Object.defineProperty(
      window,
      "isSecureContext",
      browserGlobalsSnapshot.windowIsSecureContext,
    );
  } else {
    // Cleanup: drop a stub the test installed so it cannot leak
    // into later tests when the original descriptor was absent.
    delete (window as { isSecureContext?: unknown }).isSecureContext;
  }
}

describe("CardVariantUnlockModal", () => {
  beforeEach(() => {
    restoreBrowserGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreBrowserGlobals();
  });

  it("renders dialog with correct aria-label and content", () => {
    render(<CardVariantUnlockModal {...makeProps()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Unlock Title");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Unlock Title")).toBeInTheDocument();
    expect(screen.getByText("Unlock Subtitle")).toBeInTheDocument();
    expect(screen.getByText("Unlocked GOLD Card ATK-1!")).toBeInTheDocument();
  });

  it("renders all action buttons", () => {
    render(<CardVariantUnlockModal {...makeProps()} />);

    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows GOLD variant badge with amber styling", () => {
    render(<CardVariantUnlockModal {...makeProps()} />);
    expect(screen.getByText("GOLD")).toHaveClass(
      "bg-amber-100",
      "text-amber-700",
    );
  });

  it("shows NEON variant badge with cyan styling", () => {
    render(
      <CardVariantUnlockModal
        {...makeProps({
          result: {
            ...mockResult,
            unlockedVariant: { cardId: "ATK-1", variantKey: "NEON" },
          },
        })}
      />,
    );
    expect(screen.getByText("NEON")).toHaveClass(
      "bg-cyan-100",
      "text-cyan-700",
    );
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CardVariantUnlockModal {...makeProps({ onClose })} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls navigator.share with correct payload", async () => {
    const user = userEvent.setup();
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: shareMock,
      writable: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(shareMock).toHaveBeenCalledWith({
      title: "Card ATK-1 GOLD",
      text: expect.stringContaining("I unlocked a card!"),
      url: expect.stringContaining("://"),
    });
  });

  it("no-ops share when navigator.share is not a function", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("handles share cancellation gracefully", async () => {
    const user = userEvent.setup();
    const shareMock = vi.fn().mockRejectedValue(new Error("cancelled"));
    Object.defineProperty(navigator, "share", {
      value: shareMock,
      writable: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(shareMock).toHaveBeenCalled();
  });

  it("copies share text to clipboard and shows copied label", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("I unlocked a card!"),
    );
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("resets copied state after 2000ms", async () => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("no-ops copy when clipboard is unavailable", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("no-ops copy when not in secure context", () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("handles missing unlockedVariant gracefully", () => {
    render(
      <CardVariantUnlockModal
        {...makeProps({
          result: { ...mockResult, unlockedVariant: undefined },
        })}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("DEFAULT")).toBeInTheDocument();
  });

  it("cleans up keydown listener on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<CardVariantUnlockModal {...makeProps()} />);

    const keydownCall = addSpy.mock.calls.find(([type]) => type === "keydown");
    expect(keydownCall).toBeDefined();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", keydownCall![1]);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("traps focus inside the dialog with Tab / Shift+Tab", () => {
    render(<CardVariantUnlockModal {...makeProps()} />);

    const buttons = screen.getAllByRole("button");
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;

    // Tab from the last button wraps to the first.
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first button wraps to the last.
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("ignores non-Tab keydowns inside the focus trap", () => {
    render(<CardVariantUnlockModal {...makeProps()} />);

    const buttons = screen.getAllByRole("button");
    const first = buttons[0]!;

    first.focus();
    fireEvent.keyDown(document, { key: "Enter" });
    // Focus is left untouched when the key isn't Tab.
    expect(document.activeElement).toBe(first);
  });

  it("silently no-ops copy when clipboard.writeText rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    render(<CardVariantUnlockModal {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    // Let the rejected promise's catch handler run; the dialog must
    // stay open and the button label must remain "Copy" (no "Copied!"
    // flash). The catch path is the only thing under test here —
    // swallowing the rejection is the intended behavior.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
