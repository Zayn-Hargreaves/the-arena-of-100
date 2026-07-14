// Unit tests for the audit-panel data hook. The valuable logic here
// is param-building, offset pagination, and the "reset to page 0 when
// filters change" invariant — none of which should regress silently.

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable auth state so a test can simulate a signed-out admin.
const storeState: { accessToken: string | null } = { accessToken: "tok-123" };
vi.mock("@/stores/socket-store", () => ({
  // The hook subscribes via a selector — honor it so we return just
  // the slice it asked for, mirroring zustand's real behavior.
  useSocketStore: (selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

const getAuditEvents = vi.fn();
vi.mock("@/lib/api/audit", () => ({
  getAuditEvents: (...args: unknown[]) => getAuditEvents(...args),
}));

import { useAuditEvents } from "./use-audit-events";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useAuditEvents", () => {
  beforeEach(() => {
    storeState.accessToken = "tok-123";
    getAuditEvents.mockReset();
    getAuditEvents.mockResolvedValue({ events: [], total: 100 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requests the first page with the configured page size and the auth token", async () => {
    const { result } = renderHook(() => useAuditEvents({ pageSize: 25 }), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(getAuditEvents).toHaveBeenCalledTimes(1));

    expect(getAuditEvents).toHaveBeenCalledWith(
      {
        limit: 25,
        offset: 0,
        eventType: undefined,
        roomId: undefined,
        adminUserId: undefined,
        createdAfter: undefined,
        createdBefore: undefined,
      },
      "tok-123",
    );
    expect(result.current.page).toBe(0);
    await waitFor(() => expect(result.current.total).toBe(100));
  });

  it("advances the offset when paging forward", async () => {
    const { result } = renderHook(() => useAuditEvents({ pageSize: 25 }), {
      wrapper: makeWrapper(),
    });
    // Wait for the first page to resolve so `total` is known — the
    // hook clamps paging against it (as it would for a real user).
    await waitFor(() => expect(result.current.total).toBe(100));

    act(() => result.current.nextPage());

    await waitFor(() =>
      expect(getAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 25, offset: 25 }),
        "tok-123",
      ),
    );
    expect(result.current.page).toBe(1);
    expect(result.current.hasPrev).toBe(true);
  });

  it("resets to the first page and forwards the filter when filters change", async () => {
    const { result } = renderHook(() => useAuditEvents({ pageSize: 25 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.total).toBe(100));

    // Move off page 0 first...
    act(() => result.current.nextPage());
    await waitFor(() => expect(result.current.page).toBe(1));

    // ...then apply a filter: page must snap back to 0 and offset to 0.
    // Use realistic datetime-local strings for createdAfter/createdBefore
    // so we exercise the toIsoBound / buildAuditQuery path — the hook
    // must forward them as ISO-8601 to the API. The expected ISO
    // timestamps are computed from the same Date constructor as the
    // hook so the assertion stays timezone-independent.
    const createdAfterIso = new Date("2026-07-01T00:00").toISOString();
    const createdBeforeIso = new Date("2026-07-14T23:59").toISOString();
    act(() =>
      result.current.setFilters({
        eventType: "ADMIN_RESET_SYSTEM",
        roomId: "",
        adminUserId: "",
        createdAfter: "2026-07-01T00:00",
        createdBefore: "2026-07-14T23:59",
      }),
    );

    await waitFor(() =>
      expect(getAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          offset: 0,
          eventType: "ADMIN_RESET_SYSTEM",
          createdAfter: createdAfterIso,
          createdBefore: createdBeforeIso,
        }),
        "tok-123",
      ),
    );
    expect(result.current.page).toBe(0);
  });

  it("does not fetch when there is no auth token", async () => {
    storeState.accessToken = null;

    renderHook(() => useAuditEvents({ pageSize: 25 }), {
      wrapper: makeWrapper(),
    });

    // Give react-query a tick; the disabled query must never run.
    await new Promise((r) => setTimeout(r, 20));
    expect(getAuditEvents).not.toHaveBeenCalled();
  });
});
