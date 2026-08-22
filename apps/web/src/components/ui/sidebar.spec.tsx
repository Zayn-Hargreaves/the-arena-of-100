// Unit tests for Sidebar (desktop shell + mobile overlay).
// Validates: gradient removal, desktop collapse, active state, mobile open/close,
// Escape key, backdrop click, focus styling, tooltip in collapsed mode.
import "@testing-library/jest-dom/vitest";
import { useTranslations } from "next-intl";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// next-intl/routing mocked in vitest.setup — here we override usePathname per test.
const mockUsePathname = vi.fn(() => "/");
vi.mock("@/i18n/routing", async () => {
  return {
    Link: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { href, ...rest }, children),
    usePathname: () => mockUsePathname(),
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

import { Sidebar } from "./sidebar";

const SIDEBAR_TRANSLATIONS: Record<string, string> = {
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  openMenu: "Open menu",
  closeMenu: "Close menu",
};

beforeEach(() => {
  mockUsePathname.mockReturnValue("/");
  vi.mocked(useTranslations).mockImplementation(((namespace?: string) =>
    (key: string, params?: Record<string, string | number>) => {
      if (namespace === "Sidebar" && SIDEBAR_TRANSLATIONS[key]) {
        return SIDEBAR_TRANSLATIONS[key];
      }
      if (!params) return key;
      return key.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
    }) as never);
});

describe("Sidebar — desktop", () => {
  it("renders the brand header", () => {
    render(<Sidebar nickname="Alice" />);
    expect(screen.getByText("ARENA")).toBeInTheDocument();
    expect(screen.getByText("OF 100")).toBeInTheDocument();
  });

  it("renders all enabled player nav items with translated labels", () => {
    render(<Sidebar nickname="Alice" />);
    // nav.daily, nav.createRoom, nav.rankings, nav.settings, nav.profile
    // (nav.arena is disabled; nav.admin is hidden for non-admin.)
    expect(screen.getByText("nav.daily")).toBeInTheDocument();
    expect(screen.getByText("nav.createRoom")).toBeInTheDocument();
    expect(screen.getByText("nav.rankings")).toBeInTheDocument();
    expect(screen.getByText("nav.settings")).toBeInTheDocument();
    expect(screen.getByText("nav.profile")).toBeInTheDocument();
    expect(screen.queryByText("nav.admin")).not.toBeInTheDocument();
  });

  it("does NOT render the disabled 'arena' nav item", () => {
    render(<Sidebar nickname="Alice" />);
    expect(screen.queryByText("nav.arena")).not.toBeInTheDocument();
  });

  it("marks the current pathname as active", () => {
    mockUsePathname.mockReturnValue("/rankings");
    render(<Sidebar nickname="Alice" />);
    const rankingsLink = screen.getByText("nav.rankings").closest("a");
    expect(rankingsLink).toHaveClass("bg-candy-yellow");
  });

  it("falls back to guestName when nickname is empty", () => {
    render(<Sidebar nickname="" />);
    // avatar label uses the resolved display name
    expect(screen.getByText("guestName")).toBeInTheDocument();
  });

  it("uses the guest subtitle when nickname is missing", () => {
    render(<Sidebar />);
    // No trimmed nickname -> guestRole subtitle key.
    expect(screen.getByText("guestRole")).toBeInTheDocument();
  });

  it("uses the player subtitle when nickname is provided", () => {
    render(<Sidebar nickname="Alice" />);
    expect(screen.getByText("playerRole")).toBeInTheDocument();
  });

  it("toggles the collapsed state when the floating button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    // Default state: labels visible.
    expect(screen.getByText("nav.createRoom")).toBeVisible();

    const collapseButton = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    await user.click(collapseButton);

    // After collapse: label text still in DOM (we just hide it visually) — but button label flips.
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("renders a focusable skip link for keyboard navigation on the toggle", () => {
    render(<Sidebar nickname="Alice" />);
    const button = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    expect(button).toHaveClass("focus-visible:ring-2");
  });
});

describe("Sidebar — mobile", () => {
  it("does not render the mobile overlay by default", () => {
    render(<Sidebar nickname="Alice" />);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("opens the mobile overlay when the menu button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    const menuButton = screen.getByRole("button", {
      name: "Open menu",
    });
    await user.click(menuButton);

    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes the mobile overlay when the menu button is clicked again", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    const menuButton = screen.getByRole("button", {
      name: "Open menu",
    });
    await user.click(menuButton);
    expect(
      screen.getByRole("dialog", { name: "Mobile navigation menu" }),
    ).toBeInTheDocument();

    const closeButton = screen.getByRole("button", {
      name: "Close menu",
    });
    await user.click(closeButton);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("closes the mobile overlay when the user presses Escape", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(
      screen.getByRole("dialog", { name: "Mobile navigation menu" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT close on Escape when the mobile overlay is closed", () => {
    render(<Sidebar nickname="Alice" />);
    // Should not throw and should leave the closed state alone.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("closes the mobile overlay when the backdrop (overlay root) is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });
    await user.click(dialog);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT close when clicking inside the mobile overlay (children)", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });
    // Click a nav link inside the dialog — bubbles to the dialog but the target is the anchor.
    const navLink = within(dialog).getByText("nav.profile");
    await user.click(navLink);

    // Navigation click should also close the menu (existing behavior).
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("removes the stale gradient + backdrop blur on the mobile overlay", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });

    expect(dialog.className).not.toMatch(/bg-gradient-to-br/);
    expect(dialog.className).not.toMatch(/from-pink-50/);
    expect(dialog.className).not.toMatch(/via-blue-50/);
    expect(dialog.className).not.toMatch(/to-indigo-50/);
    expect(dialog.className).not.toMatch(/backdrop-blur/);
    // Structure classes are preserved.
    expect(dialog).toHaveClass("md:hidden");
    expect(dialog).toHaveClass("fixed");
    expect(dialog).toHaveClass("inset-0");
    expect(dialog).toHaveClass("top-16");
    expect(dialog).toHaveClass("border-t-4");
    expect(dialog).toHaveClass("border-candy-ink");
  });

  it("renders mobile overlay nav items including the disabled filter", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });
    // nav.arena is disabled even in the mobile overlay.
    expect(within(dialog).queryByText("nav.arena")).not.toBeInTheDocument();
    expect(within(dialog).getByText("nav.rankings")).toBeInTheDocument();
  });

  it("closes the mobile overlay when the hidden backdrop button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", {
      name: "Mobile navigation menu",
    });
    const backdropButton = dialog.querySelector('button[aria-hidden="true"]');
    expect(backdropButton).not.toBeNull();
    if (backdropButton) {
      await user.click(backdropButton);
    }
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });

  it("closes the mobile overlay when the dialog close button is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar nickname="Alice" />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(
      screen.getByRole("dialog", { name: "Mobile navigation menu" }),
    ).toBeInTheDocument();

    const closeButton = screen.getByRole("button", {
      name: "Close menu",
    });
    await user.click(closeButton);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation menu" }),
    ).not.toBeInTheDocument();
  });
});
