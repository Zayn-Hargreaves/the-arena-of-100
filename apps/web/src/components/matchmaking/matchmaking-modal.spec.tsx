import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatchmakingModal } from "./matchmaking-modal";

const mockPush = vi.fn();
const mockLeaveMatchmaking = vi.fn();
const mockClearMatchmakingMatched = vi.fn();
const mockJoinRoom = vi.fn().mockResolvedValue(undefined);

let mockSocketStore = {
  matchmaking: {
    isQueued: false,
    queuedAt: null as number | null,
    elapsedSeconds: 0,
    estimatedWaitSeconds: 30,
    playersInQueue: 0,
    matchedRoomCode: null as string | null,
    matchedRoomId: null as string | null,
    matchedMatchId: null as string | null,
  },
  leaveMatchmaking: mockLeaveMatchmaking,
  clearMatchmakingMatched: mockClearMatchmakingMatched,
  joinRoom: mockJoinRoom,
};

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: () => mockSocketStore,
}));

vi.mock("@/components/ui/mini-glyph", () => ({
  MiniGlyph: () => <div data-testid="mini-glyph" />,
}));

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const viMessages: Record<string, string> = {
    matchFoundTitle: "TRẬN ĐẤU ĐÃ TÌM THẤY!",
    searchingTitle: "ĐANG TÌM TRẬN ĐẤU...",
    cancelButton: "Hủy tìm trận",
    readyToBattle: "SẴN SÀNG VÀO TRẬN!",
    redirecting: "Phòng: {roomCode} • Đang chuyển hướng...",
    estimatedWait: "Ước tính: ~{time}",
    playersInQueue: "Người đang tìm trận:",
    playerCount: "{count} người",
    cancelSearch: "HỦY TÌM TRẬN",
  };
  return {
    ...actual,
    useLocale: vi.fn(() => "vi"),
    useTranslations: vi.fn((_ns?: string) =>
      vi.fn((key: string, params?: Record<string, string | number>): string => {
        let msg = viMessages[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            msg = msg.replace(`{${k}}`, String(v));
          }
        }
        return msg;
      }),
    ),
  };
});

const activeElementDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "activeElement",
);

describe("MatchmakingModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockSocketStore = {
      matchmaking: {
        isQueued: false,
        queuedAt: null,
        elapsedSeconds: 0,
        estimatedWaitSeconds: 30,
        playersInQueue: 0,
        matchedRoomCode: null,
        matchedRoomId: null,
        matchedMatchId: null,
      },
      leaveMatchmaking: mockLeaveMatchmaking,
      clearMatchmakingMatched: mockClearMatchmakingMatched,
      joinRoom: mockJoinRoom,
    };
  });

  afterEach(() => {
    if (activeElementDescriptor) {
      Object.defineProperty(document, "activeElement", activeElementDescriptor);
    } else {
      // @ts-expect-error - restoring property
      delete document.activeElement;
    }
  });

  it("renders nothing when matchmaking is inactive", () => {
    const { container } = render(<MatchmakingModal />);
    expect(container.firstChild).toBeNull();
  });

  it("attaches role='dialog', aria-modal, aria-labelledby, and tabIndex to dialogRef element", () => {
    mockSocketStore.matchmaking.isQueued = true;
    mockSocketStore.matchmaking.playersInQueue = 5;

    render(<MatchmakingModal />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "matchmaking-modal-title",
    );
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(dialog).toHaveClass("relative", "w-full", "max-w-md");
  });

  it("focuses the first focusable element when queued and not matched", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.isQueued = true;

    render(<MatchmakingModal />);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const buttons = screen.getAllByRole("button");
    const closeButton = buttons[0];
    expect(document.activeElement).toBe(closeButton);
  });

  it("focuses the dialog element directly when match is found", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM123";

    render(<MatchmakingModal />);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
  });

  it("saves previous active element without typecasting and restores focus on unmount", () => {
    const previousButton = document.createElement("button");
    document.body.appendChild(previousButton);
    previousButton.focus();
    expect(document.activeElement).toBe(previousButton);

    mockSocketStore.matchmaking.isQueued = true;

    const { unmount } = render(<MatchmakingModal />);

    // Unmount should restore focus
    unmount();
    expect(document.activeElement).toBe(previousButton);

    document.body.removeChild(previousButton);
  });

  it("safely ignores non-focusable active element without crashing", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    Object.defineProperty(document, "activeElement", {
      value: div,
      configurable: true,
      writable: true,
    });

    mockSocketStore.matchmaking.isQueued = true;

    const { unmount } = render(<MatchmakingModal />);
    expect(() => unmount()).not.toThrow();

    document.body.removeChild(div);
  });

  it("handles Escape key to cancel matchmaking when not matched", () => {
    mockSocketStore.matchmaking.isQueued = true;

    render(<MatchmakingModal />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockLeaveMatchmaking).toHaveBeenCalledTimes(1);
  });

  it("does not allow Escape key to cancel when matched", () => {
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM123";

    render(<MatchmakingModal />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockLeaveMatchmaking).not.toHaveBeenCalled();
  });

  it("traps Tab key focus inside modal", () => {
    mockSocketStore.matchmaking.isQueued = true;

    render(<MatchmakingModal />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];

    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);

    // Shift+Tab on first button wraps to last
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastButton);

    // Tab on last button wraps to first
    lastButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(firstButton);

    // Tab on non-edge button allows normal behavior
    fireEvent.keyDown(window, { key: "Tab" });
  });

  it("updates timer ticks when queuedAt is set", () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.isQueued = true;
    mockSocketStore.matchmaking.queuedAt = Date.now();
    mockSocketStore.matchmaking.elapsedSeconds = 10;
    mockSocketStore.matchmaking.estimatedWaitSeconds = 45;

    render(<MatchmakingModal />);

    expect(screen.getByText("00:10")).toBeInTheDocument();
    expect(screen.getByText(/Ước tính: ~00:45/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("00:12")).toBeInTheDocument();
  });

  it("auto redirects on match found after timer", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM999";
    mockSocketStore.matchmaking.matchedMatchId = null;

    render(<MatchmakingModal />);

    act(() => {
      vi.advanceTimersByTime(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/lobby/ROOM999");
  });

  it("auto redirects directly to /game when matchedMatchId is present", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM999";
    mockSocketStore.matchmaking.matchedMatchId = "match_123";

    render(<MatchmakingModal />);

    act(() => {
      vi.advanceTimersByTime(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/game/match_123");
  });

  it("triggers leaveMatchmaking when close button and bottom cancel button are clicked", () => {
    mockSocketStore.matchmaking.isQueued = true;

    render(<MatchmakingModal />);

    const buttons = screen.getAllByRole("button", { name: "Hủy tìm trận" });
    expect(buttons.length).toBe(2);

    fireEvent.click(buttons[0]);
    expect(mockLeaveMatchmaking).toHaveBeenCalledTimes(1);

    fireEvent.click(buttons[1]);
    expect(mockLeaveMatchmaking).toHaveBeenCalledTimes(2);
  });

  it("falls back to focusing dialog element when no focusable elements are found", () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.isQueued = true;

    const querySpy = vi
      .spyOn(HTMLDivElement.prototype, "querySelector")
      .mockReturnValue(null);

    render(<MatchmakingModal />);

    act(() => {
      vi.advanceTimersByTime(60);
    });

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    querySpy.mockRestore();
  });

  it("handles Tab key fallback when focusableElements is empty", () => {
    mockSocketStore.matchmaking.isQueued = true;

    const queryAllSpy = vi
      .spyOn(HTMLDivElement.prototype, "querySelectorAll")
      .mockReturnValue([] as unknown as NodeListOf<HTMLElement>);

    render(<MatchmakingModal />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(window, { key: "Tab" });

    expect(document.activeElement).toBe(dialog);

    queryAllSpy.mockRestore();
  });

  it("renders fallback estimated wait seconds when 0", () => {
    mockSocketStore.matchmaking.isQueued = true;
    mockSocketStore.matchmaking.estimatedWaitSeconds = 0;

    render(<MatchmakingModal />);
    expect(screen.getByText(/Ước tính: ~00:30/)).toBeInTheDocument();
  });

  it("formats estimated wait seconds exceeding 60 properly as mm:ss", () => {
    mockSocketStore.matchmaking.isQueued = true;
    mockSocketStore.matchmaking.estimatedWaitSeconds = 75;

    render(<MatchmakingModal />);
    expect(screen.getByText(/Ước tính: ~01:15/)).toBeInTheDocument();
  });

  it("handles null activeElement when opening", () => {
    Object.defineProperty(document, "activeElement", {
      value: null,
      configurable: true,
      writable: true,
    });

    mockSocketStore.matchmaking.isQueued = true;

    const { unmount } = render(<MatchmakingModal />);
    expect(() => unmount()).not.toThrow();
  });

  it("renders custom playersInQueue count", () => {
    mockSocketStore.matchmaking.isQueued = true;
    mockSocketStore.matchmaking.playersInQueue = 12;

    render(<MatchmakingModal />);
    expect(screen.getByText("12 người")).toBeInTheDocument();
  });
});
