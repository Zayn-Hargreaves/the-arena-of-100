// Render + interaction tests for the audit filter bar. Covers the
// four behaviors that matter for the panel: it renders the three
// filter inputs the backend DTO supports, Apply forwards trimmed
// values, Reset clears everything, and the local draft stays in
// sync with the externally-applied filter set.

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditFilters } from "./audit-filters";
import type { AuditFilters as AuditFiltersState } from "@/hooks/use-audit-events";

const emptyFilters: AuditFiltersState = {
  eventType: "",
  roomId: "",
  adminUserId: "",
};

describe("AuditFilters", () => {
  it("renders the three supported filter inputs with their i18n labels", () => {
    render(
      <AuditFilters value={emptyFilters} onApply={vi.fn()} onReset={vi.fn()} />,
    );

    // Labels resolve to key paths because the test mock for
    // next-intl returns the key untouched.
    expect(screen.getByText("filters.title")).toBeInTheDocument();
    expect(screen.getByText("filters.eventType")).toBeInTheDocument();
    expect(screen.getByText("filters.roomId")).toBeInTheDocument();
    expect(screen.getByText("filters.adminUserId")).toBeInTheDocument();
    expect(screen.getByText("filters.apply")).toBeInTheDocument();
    expect(screen.getByText("filters.reset")).toBeInTheDocument();

    // The event-type select offers a "no filter" option plus the
    // three known backend event types.
    const select = screen.getByLabelText(
      "filters.eventType",
    ) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "",
      "ADMIN_TERMINATE_ROOM",
      "ADMIN_RESET_SYSTEM",
      "ADMIN_SYNC_QUESTIONS",
    ]);
  });

  it("forwards trimmed values to onApply when the form is submitted", () => {
    const onApply = vi.fn();
    render(
      <AuditFilters value={emptyFilters} onApply={onApply} onReset={vi.fn()} />,
    );

    // The user types into two text inputs and picks an event type.
    // Whitespace is intentional — Apply must trim it before forwarding.
    fireEvent.change(screen.getByLabelText("filters.roomId"), {
      target: { value: "  room-42  " },
    });
    fireEvent.change(screen.getByLabelText("filters.adminUserId"), {
      target: { value: "  admin-7  " },
    });
    fireEvent.change(screen.getByLabelText("filters.eventType"), {
      target: { value: "ADMIN_RESET_SYSTEM" },
    });

    fireEvent.click(screen.getByText("filters.apply"));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      eventType: "ADMIN_RESET_SYSTEM",
      roomId: "room-42",
      adminUserId: "admin-7",
    });
  });

  it("calls onReset when the reset button is pressed", () => {
    const onReset = vi.fn();
    render(
      <AuditFilters value={emptyFilters} onApply={vi.fn()} onReset={onReset} />,
    );

    fireEvent.click(screen.getByText("filters.reset"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("syncs the local draft when the externally-applied value changes", () => {
    const { rerender } = render(
      <AuditFilters value={emptyFilters} onApply={vi.fn()} onReset={vi.fn()} />,
    );

    // The hook would push a new applied filter set (e.g. after the
    // operator resets from somewhere else). The draft input must
    // mirror it without a re-mount.
    const applied: AuditFiltersState = {
      eventType: "ADMIN_SYNC_QUESTIONS",
      roomId: "room-99",
      adminUserId: "",
    };
    rerender(
      <AuditFilters value={applied} onApply={vi.fn()} onReset={vi.fn()} />,
    );

    const roomInput = screen.getByLabelText(
      "filters.roomId",
    ) as HTMLInputElement;
    expect(roomInput.value).toBe("room-99");

    const select = screen.getByLabelText(
      "filters.eventType",
    ) as HTMLSelectElement;
    expect(select.value).toBe("ADMIN_SYNC_QUESTIONS");
  });

  it("disables every input and both buttons when disabled is true", () => {
    render(
      <AuditFilters
        value={emptyFilters}
        onApply={vi.fn()}
        onReset={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByLabelText("filters.eventType")).toBeDisabled();
    expect(screen.getByLabelText("filters.roomId")).toBeDisabled();
    expect(screen.getByLabelText("filters.adminUserId")).toBeDisabled();
    expect(screen.getByText("filters.apply").closest("button")).toBeDisabled();
    expect(screen.getByText("filters.reset").closest("button")).toBeDisabled();
  });
});
