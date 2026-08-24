import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MatchmakingModal } from "./matchmaking-modal";

const mockPush = vi.fn();
const mockLeaveMatchmaking = vi.fn();
const mockClearMatchmakingMatched = vi.fn();
const mockJoinRoom = vi.fn().mockResolvedValue(undefined);
const mockLeaveRoom = vi.fn();

let mockSocketStore = {
  matchmaking: {
    isQueued: false,
    queuedAt: null as number | null,
    elapsedSeconds: 0,
    estimatedWaitSeconds: 30,
    playersInQueue: 0,
    matchedRoomCode: null as string | null,
    matchedRoomId: null as string | null,
  },
  room: null as { id?: string; currentMatchId?: string } | null,
  match: null as { id: string } | null,
  leaveMatchmaking: mockLeaveMatchmaking,
  clearMatchmakingMatched: mockClearMatchmakingMatched,
  joinRoom: mockJoinRoom,
  leaveRoom: mockLeaveRoom,
};

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/stores/socket-store", () => {
  const hook = () => mockSocketStore;
  hook.getState = () => mockSocketStore;
  return {
    useSocketStore: hook,
  };
});

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
    retry: "Thử lại",
    ROOM_FULL: "Phòng đã đầy người chơi!",
    UNKNOWN_ERROR: "Đã xảy ra lỗi không xác định. Vui lòng thử lại!",
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
      },
      room: null,
      match: null,
      leaveMatchmaking: mockLeaveMatchmaking,
      clearMatchmakingMatched: mockClearMatchmakingMatched,
      joinRoom: mockJoinRoom,
      leaveRoom: mockLeaveRoom,
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

    render(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/lobby/ROOM999");
  });

  it("auto redirects directly to /game when match is present", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM999";
    mockSocketStore.match = null;
    mockJoinRoom.mockImplementationOnce(async () => {
      mockSocketStore.match = { id: "match_123" };
    });

    render(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/game/match_123");
  });

  it("cancels auto redirect if leaveMatchmaking is called while retry is pending", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM999";
    let resolveRetry: () => void = () => {};
    mockJoinRoom.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        }),
    );

    const { unmount } = render(<MatchmakingModal />);

    // Advance retry timer to ensure join attempt is initiated
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mockJoinRoom).toHaveBeenCalledTimes(1);

    // Unmount (leave matchmaking) while join is pending
    unmount();

    // Now resolve retry and advance timers
    resolveRetry();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockClearMatchmakingMatched).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
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

  it("handles join room failure, displays translated error, and allows retry", async () => {
    vi.useFakeTimers();
    mockJoinRoom.mockRejectedValueOnce(new Error("ROOM_FULL"));
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_FAIL";

    render(<MatchmakingModal />);

    // Advance past delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(screen.getByText("Phòng đã đầy người chơi!")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Thử lại" });
    expect(retryButton).toBeInTheDocument();

    // Setup pending retry join promise to test concurrent guard
    let resolveRetry!: (value?: unknown) => void;
    const pendingRetryPromise = new Promise((resolve) => {
      resolveRetry = resolve;
    });
    mockJoinRoom.mockReturnValueOnce(pendingRetryPromise);

    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(mockJoinRoom).toHaveBeenCalledTimes(2);

    resolveRetry();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/lobby/ROOM_FAIL");
  });

  it("clears join error and calls leaveMatchmaking when canceling after join failure", async () => {
    vi.useFakeTimers();
    mockJoinRoom.mockRejectedValueOnce(new Error("ROOM_FULL"));
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_FAIL";

    render(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(screen.getByText("Phòng đã đầy người chơi!")).toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: "Hủy tìm trận" });
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);

    expect(mockLeaveMatchmaking).toHaveBeenCalledTimes(1);
  });

  it("does not leave newly joined room when a cancelled matchmaking join completes", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_OLD";
    mockSocketStore.matchmaking.matchedRoomId = "room_old_id";

    let resolveJoin: () => void = () => {};
    mockJoinRoom.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        }),
    );

    const { unmount } = render(<MatchmakingModal />);

    // Trigger auto join for ROOM_OLD
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockJoinRoom).toHaveBeenCalledWith("ROOM_OLD");

    // User cancels / unmounts modal (invalidating attempt)
    unmount();

    // User joins a new room in the background
    mockSocketStore.room = { id: "room_new_id", code: "ROOM_NEW" } as {
      id?: string;
      currentMatchId?: string;
      code?: string;
    };
    mockSocketStore.matchmaking.matchedRoomCode = null;
    mockSocketStore.matchmaking.matchedRoomId = null;

    // The old join now resolves
    resolveJoin();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    // Cleanup should leave room_old_id, NOT room_new_id
    expect(mockLeaveRoom).not.toHaveBeenCalledWith("room_new_id");
    expect(mockLeaveRoom).toHaveBeenCalledWith("room_old_id");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("handles leaveRoom returning a rejecting promise during cleanup without throwing", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_OLD";
    mockSocketStore.matchmaking.matchedRoomId = "room_old_id";
    mockLeaveRoom.mockRejectedValueOnce(new Error("Leave failed"));

    let resolveJoin: () => void = () => {};
    mockJoinRoom.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        }),
    );

    const { unmount } = render(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    unmount();

    resolveJoin();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockLeaveRoom).toHaveBeenCalledWith("room_old_id");
  });

  it("serializes joins by room code when matched room changes from room A to room B during an active attempt", async () => {
    vi.useFakeTimers();
    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_A";
    mockSocketStore.matchmaking.matchedRoomId = "room_a_id";

    let resolveJoinA: () => void = () => {};
    let resolveJoinB: () => void = () => {};

    mockJoinRoom.mockImplementation((roomCode: string) => {
      if (roomCode === "ROOM_A") {
        return new Promise<void>((resolve) => {
          resolveJoinA = resolve;
        });
      }
      if (roomCode === "ROOM_B") {
        return new Promise<void>((resolve) => {
          resolveJoinB = resolve;
        });
      }
      return Promise.resolve();
    });

    const { rerender } = render(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockJoinRoom).toHaveBeenCalledWith("ROOM_A");

    mockSocketStore.matchmaking.matchedRoomCode = "ROOM_B";
    mockSocketStore.matchmaking.matchedRoomId = "room_b_id";
    rerender(<MatchmakingModal />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockJoinRoom).toHaveBeenCalledWith("ROOM_B");

    resolveJoinA();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockLeaveRoom).toHaveBeenCalledWith("room_a_id");
    expect(mockClearMatchmakingMatched).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    resolveJoinB();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(mockClearMatchmakingMatched).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/lobby/ROOM_B");
  });
});
