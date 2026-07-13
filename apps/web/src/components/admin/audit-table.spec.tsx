// Render tests for the audit table's four states: loading skeleton,
// error, empty, and populated rows. next-intl + i18n/routing are
// mocked globally in vitest.setup.ts (t returns the key path).

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditTable } from "./audit-table";
import type { AuditEvent } from "@/lib/api/audit";

const baseProps = {
  isLoading: false,
  isFetching: false,
  isError: false,
  onRetry: vi.fn(),
  pageSize: 25,
};

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "evt-1",
    matchId: null,
    roomId: "room-abc",
    adminUserId: "admin-1",
    eventType: "ADMIN_TERMINATE_ROOM",
    payload: { reason: "policy violation" },
    createdAt: "2026-07-11T10:20:30.000Z",
    ...overrides,
  };
}

describe("AuditTable", () => {
  it("renders the empty state when there are no events and not loading", () => {
    render(<AuditTable {...baseProps} events={[]} />);
    expect(screen.getByText("empty.title")).toBeInTheDocument();
    expect(screen.getByText("empty.description")).toBeInTheDocument();
  });

  it("renders the error state with a retry button, overriding empty/rows", () => {
    const onRetry = vi.fn();
    render(<AuditTable {...baseProps} events={[]} isError onRetry={onRetry} />);
    expect(screen.getByText("error.title")).toBeInTheDocument();
    expect(screen.getByText("error.retry")).toBeInTheDocument();
    // Empty state must NOT also show.
    expect(screen.queryByText("empty.title")).not.toBeInTheDocument();
  });

  it("renders a row with actor, translated action, target and payload", () => {
    render(<AuditTable {...baseProps} events={[makeEvent()]} />);

    // Actor id and known action label (mock t returns the key path).
    expect(screen.getByText("admin-1")).toBeInTheDocument();
    expect(
      screen.getByText("eventTypes.ADMIN_TERMINATE_ROOM"),
    ).toBeInTheDocument();
    // Target room id and payload JSON are rendered.
    expect(screen.getByText("room-abc")).toBeInTheDocument();
    expect(screen.getByText(/policy violation/)).toBeInTheDocument();
    // Empty/error states absent.
    expect(screen.queryByText("empty.title")).not.toBeInTheDocument();
  });

  it("falls back to the raw event type for unknown actions", () => {
    render(
      <AuditTable
        {...baseProps}
        events={[makeEvent({ eventType: "SOME_FUTURE_EVENT" })]}
      />,
    );
    // No translation key mapping — shows the raw type verbatim.
    expect(screen.getByText("SOME_FUTURE_EVENT")).toBeInTheDocument();
  });

  it("renders the loading skeleton with pageSize rows when isLoading and events is empty", () => {
    const { container } = render(
      <AuditTable {...baseProps} events={[]} isLoading pageSize={8} />,
    );
    // Empty state must NOT also show.
    expect(screen.queryByText("empty.title")).not.toBeInTheDocument();
    // 8 rows × 5 columns = 40 .animate-pulse placeholders.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(40);
  });
});
