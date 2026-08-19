import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import HomePage from "./page";

const mockPush = vi.fn();
const mockToast = vi.fn();
const mockConnect = vi.fn();
const mockAuthenticate = vi.fn();
const mockJoinMatchmaking = vi.fn();

let mockSocketStore = {
  username: null as string | null,
  connect: mockConnect,
  authenticate: mockAuthenticate,
  joinMatchmaking: mockJoinMatchmaking,
};

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
  usePathname: () => "/",
  Link: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: () => mockSocketStore,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/components/ui/mini-glyph", () => ({
  MiniGlyph: () => <span data-testid="mini-glyph" />,
}));

vi.mock("@/components/matchmaking/matchmaking-modal", () => ({
  MatchmakingModal: () => <div data-testid="matchmaking-modal" />,
}));

const mockConfettiFn = Object.assign(vi.fn(), { reset: vi.fn() });
vi.mock("canvas-confetti", () => ({
  default: mockConfettiFn,
  create: () => mockConfettiFn,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

describe("HomePage - runAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSocketStore = {
      username: null,
      connect: mockConnect.mockResolvedValue(undefined),
      authenticate: mockAuthenticate.mockResolvedValue(undefined),
      joinMatchmaking: mockJoinMatchmaking,
    };
  });

  it("auto-connects socket on mount", () => {
    render(<HomePage />);
    expect(mockConnect).toHaveBeenCalled();
  });

  it("awaits connect() before calling authenticate() on form submission", async () => {
    const callOrder: string[] = [];
    mockConnect.mockImplementation(async () => {
      callOrder.push("connect");
    });
    mockAuthenticate.mockImplementation(async () => {
      callOrder.push("authenticate");
    });

    render(<HomePage />);

    const nicknameInput = screen.getByPlaceholderText(/nicknamePlaceholder/i);
    fireEvent.change(nicknameInput, { target: { value: "Warrior99" } });

    const form = nicknameInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledWith("Warrior99");
    });

    expect(callOrder).toEqual(["connect", "connect", "authenticate"]);
    expect(mockJoinMatchmaking).toHaveBeenCalled();
  });

  it("waits for delayed connect() before attempting authenticate()", async () => {
    let resolveConnect: () => void = () => {};
    const delayedConnectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    // Initial mount connect resolves immediately
    mockConnect.mockResolvedValueOnce(undefined);
    // runAuthFlow connect is delayed
    mockConnect.mockReturnValueOnce(delayedConnectPromise);

    render(<HomePage />);

    const nicknameInput = screen.getByPlaceholderText(/nicknamePlaceholder/i);
    fireEvent.change(nicknameInput, { target: { value: "AsyncPlayer" } });

    const form = nicknameInput.closest("form")!;
    fireEvent.submit(form);

    // While connect is pending, authenticate should not be called yet
    expect(mockAuthenticate).not.toHaveBeenCalled();

    // Resolve connect
    resolveConnect();

    await waitFor(() => {
      expect(mockAuthenticate).toHaveBeenCalledWith("AsyncPlayer");
      expect(mockJoinMatchmaking).toHaveBeenCalled();
    });
  });

  it("shows error toast if authenticate fails and does not proceed with action", async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error("ROOM_FULL"));

    render(<HomePage />);

    const nicknameInput = screen.getByPlaceholderText(/nicknamePlaceholder/i);
    fireEvent.change(nicknameInput, { target: { value: "PlayerFail" } });

    const form = nicknameInput.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
        }),
      );
    });

    expect(mockJoinMatchmaking).not.toHaveBeenCalled();
  });

  it("prompts to enter nickname if submitted empty", () => {
    render(<HomePage />);

    const nicknameInput = screen.getByPlaceholderText(/nicknamePlaceholder/i);
    const form = nicknameInput.closest("form")!;
    fireEvent.submit(form);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "alerts.enterNickname",
      }),
    );
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
