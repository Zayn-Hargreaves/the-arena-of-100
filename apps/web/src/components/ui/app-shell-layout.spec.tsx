// Unit tests for AppShellLayout shell wrapper.
// Validates: gradient removal, layout/skip-link/connect-on-mount preserved, content rendering.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// Mock the socket store before importing the component under test.
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockUseSocketStore = vi.fn();

vi.mock("@/stores/socket-store", () => ({
  useSocketStore: () => mockUseSocketStore(),
}));

import { AppShellLayout } from "./app-shell-layout";

beforeEach(() => {
  mockConnect.mockClear();
  mockUseSocketStore.mockReset();
});

describe("AppShellLayout", () => {
  it("renders children inside the main content region", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout>
        <p>page body</p>
      </AppShellLayout>,
    );

    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("page body"),
    );
  });

  it("exposes a skip-link pointing to #main-content", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    const skipLink = screen.getByRole("link", { name: "skipToMainContent" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("does NOT render the stale shell gradient classes", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    const { container } = render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    const root = container.firstElementChild as HTMLElement;
    // The redundant Tailwind gradient was removed in this PR.
    expect(root.className).not.toMatch(/bg-gradient-to-br/);
    expect(root.className).not.toMatch(/from-pink-50/);
    expect(root.className).not.toMatch(/via-blue-50/);
    expect(root.className).not.toMatch(/to-indigo-50/);
  });

  it("preserves layout structural classes (min-h-screen, split shell)", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    const { container } = render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("flex");
    expect(root).toHaveClass("flex-col");
    expect(root).toHaveClass("md:flex-row");
    expect(root).toHaveClass("min-h-screen");
    expect(root).toHaveClass("md:h-screen");
    expect(root).toHaveClass("md:max-h-screen");
    expect(root).toHaveClass("text-candy-ink");
    expect(root).toHaveClass("overflow-hidden");
    expect(root).toHaveClass("relative");
  });

  it("preserves main-content padding + scroll containment", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveClass("overflow-y-auto");
    expect(main).toHaveClass("p-4");
    expect(main).toHaveClass("md:p-8");
    expect(main).toHaveClass("md:pt-6");
  });

  it("proactively connects websocket on mount when not connected", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: false,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-connect websocket when already connected", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("logs a console error if websocket connect rejects", async () => {
    const error = new Error("socket unavailable");
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failingConnect = vi.fn().mockRejectedValue(error);
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: failingConnect,
      isConnected: false,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    // The promise rejection is fire-and-forget; let the microtask flush.
    await act(async () => {
      await Promise.resolve();
    });

    expect(failingConnect).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to connect websocket from AppShellLayout:",
      error,
    );

    errorSpy.mockRestore();
  });

  it("merges custom className on the main content area", () => {
    mockUseSocketStore.mockReturnValue({
      username: "Alice",
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout className="custom-page-class">
        <span>child</span>
      </AppShellLayout>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveClass("custom-page-class");
  });

  it("passes Sidebar a fallback nickname when username is null", () => {
    mockUseSocketStore.mockReturnValue({
      username: null,
      connect: mockConnect,
      isConnected: true,
    });

    render(
      <AppShellLayout>
        <span>child</span>
      </AppShellLayout>,
    );

    // No crash, child still renders, shell still mounts Sidebar.
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
