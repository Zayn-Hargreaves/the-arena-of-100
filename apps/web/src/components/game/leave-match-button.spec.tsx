// Unit tests for LeaveMatchButton (extracted from game page.tsx).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { LeaveMatchButton } from "./leave-match-button";

describe("LeaveMatchButton", () => {
  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<LeaveMatchButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /leaveMatchButton/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when the disabled prop is set", () => {
    const onClick = vi.fn();
    render(<LeaveMatchButton onClick={onClick} disabled />);
    expect(
      screen.getByRole("button", { name: /leaveMatchButton/ }),
    ).toBeDisabled();
  });
});
