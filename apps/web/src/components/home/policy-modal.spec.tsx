import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyModal } from "./policy-modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("PolicyModal", () => {
  const onClose = vi.fn();
  const onSelectType = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <PolicyModal
        isOpen={false}
        type="terms"
        onClose={onClose}
        onSelectType={onSelectType}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("exposes selection state via aria-pressed when onSelectType is provided", () => {
    const { rerender } = render(
      <PolicyModal
        isOpen={true}
        type="terms"
        onClose={onClose}
        onSelectType={onSelectType}
      />,
    );

    const termsButton = screen.getByRole("button", { name: /termsTitle/i });
    const antiCheatButton = screen.getByRole("button", {
      name: /antiCheatTitle/i,
    });

    expect(termsButton).toHaveAttribute("aria-pressed", "true");
    expect(antiCheatButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(antiCheatButton);
    expect(onSelectType).toHaveBeenCalledWith("antiCheat");

    rerender(
      <PolicyModal
        isOpen={true}
        type="antiCheat"
        onClose={onClose}
        onSelectType={onSelectType}
      />,
    );

    expect(termsButton).toHaveAttribute("aria-pressed", "false");
    expect(antiCheatButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(termsButton);
    expect(onSelectType).toHaveBeenCalledWith("terms");
  });

  it("calls onClose when close button is clicked", () => {
    render(<PolicyModal isOpen={true} type="terms" onClose={onClose} />);

    expect(
      screen.queryByRole("button", { name: /termsTitle/i, hidden: true }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /antiCheatTitle/i, hidden: true }),
    ).toBeNull();

    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
