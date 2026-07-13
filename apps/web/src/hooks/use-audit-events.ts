"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAuditEvents } from "@/lib/api/audit";
import type { AuditEvent, AuditEventsResponse } from "@arena/shared";
import { useSocketStore } from "@/stores/socket-store";

/**
 * Server-supported filters only. The backend DTO
 * (get-audit-events.dto.ts) exposes exactly these three; there is
 * deliberately NO date-range filter because the endpoint does not
 * support one — offering it would silently filter only the current
 * page and mislead the operator.
 */
export interface AuditFilters {
  eventType: string;
  roomId: string;
  adminUserId: string;
}

const EMPTY_FILTERS: AuditFilters = {
  eventType: "",
  roomId: "",
  adminUserId: "",
};

interface UseAuditEventsOptions {
  /** Rows per page. Clamped to the backend max (100) by the DTO. */
  pageSize?: number;
  /**
   * Caller-controlled gate. Combined with the internal access-token
   * check, so the query only fires when both this flag is true AND a
   * token is available. Defaults to true so existing callers that
   * don't care about role/permission gating get the previous behavior.
   */
  enabled?: boolean;
}

export interface UseAuditEventsResult {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  filters: AuditFilters;
  /**
   * True until the first response arrives, even while the query is
   * disabled (no access token). Backed by TanStack Query v5's
   * `isPending`, NOT `query.isLoading` — `isLoading` is `isPending &&
   * isFetching` and would be false while disabled, which would let the
   * audit table flash the empty state before the first request is
   * permitted. Field name stays `isLoading` for the public API.
   */
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setFilters: (filters: AuditFilters) => void;
  resetFilters: () => void;
  refetch: () => void;
}

/**
 * Data hook for the admin audit panel. Owns page + filter state so
 * the page/table/filter components stay presentational. Uses
 * offset pagination (the endpoint's model) with `keepPreviousData`
 * so paging doesn't flash an empty table between fetches.
 */
export function useAuditEvents({
  pageSize = 50,
  enabled = true,
}: UseAuditEventsOptions = {}): UseAuditEventsResult {
  const accessToken = useSocketStore((state) => state.accessToken);

  const [page, setPageState] = useState(0);
  const [filters, setFiltersState] = useState<AuditFilters>(EMPTY_FILTERS);

  const offset = page * pageSize;

  const query = useQuery<AuditEventsResponse>({
    // accessToken is part of the key so switching admin identity
    // refetches rather than serving another admin's cached page.
    queryKey: ["admin", "audit-events", accessToken, pageSize, offset, filters],
    queryFn: () =>
      getAuditEvents(
        {
          limit: pageSize,
          offset,
          eventType: filters.eventType || undefined,
          roomId: filters.roomId || undefined,
          adminUserId: filters.adminUserId || undefined,
        },
        accessToken ?? undefined,
      ),
    enabled: enabled && Boolean(accessToken),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Changing a filter resets to the first page — otherwise the
  // current offset could point past the end of the filtered set.
  const setFilters = useCallback((next: AuditFilters) => {
    setFiltersState(next);
    setPageState(0);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
    setPageState(0);
  }, []);

  const setPage = useCallback(
    (next: number) => {
      // Clamp against the known page count so buttons can't scroll
      // into an empty offset. `total` may be stale mid-fetch, so we
      // still allow 0.
      const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
      setPageState(Math.min(Math.max(0, next), Math.max(maxPage, 0)));
    },
    [total, pageSize],
  );

  const nextPage = useCallback(() => setPage(page + 1), [setPage, page]);
  const prevPage = useCallback(() => setPage(page - 1), [setPage, page]);

  // Guarded manual refetch. The initial query is gated on
  // `enabled && Boolean(accessToken)` (see `useQuery` above), so
  // TanStack Query already no-ops `refetch()` while the caller is
  // disabled — the `enabled` half is enforced upstream. We only
  // need to short-circuit on the `accessToken` half here so a
  // signed-out operator can never provoke an in-flight URL build
  // for the admin API.
  const queryRefetch = query.refetch;
  const refetch = useCallback(() => {
    if (!accessToken) return;
    void queryRefetch();
  }, [accessToken, queryRefetch]);

  return useMemo(
    () => ({
      events: query.data?.events ?? [],
      total,
      page,
      pageSize,
      pageCount,
      hasPrev: page > 0,
      hasNext: (page + 1) * pageSize < total,
      filters,
      isLoading: query.isPending,
      isFetching: query.isFetching,
      isError: query.isError,
      error: query.error,
      setPage,
      nextPage,
      prevPage,
      setFilters,
      resetFilters,
      refetch,
    }),
    [
      query.data,
      query.isPending,
      query.isFetching,
      query.isError,
      query.error,
      refetch,
      total,
      page,
      pageSize,
      pageCount,
      filters,
      setPage,
      nextPage,
      prevPage,
      setFilters,
      resetFilters,
    ],
  );
}
