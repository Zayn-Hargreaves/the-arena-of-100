// ============================================================
// Admin Audit API client — consumes GET /admin/audit-events.
//
// Type definitions live in @arena/shared (single source of truth);
// this module only provides the HTTP wrapper. Do NOT add mutating
// calls here — the endpoint is admin-only (Role.ADMIN) and read-only.
// ============================================================

import { apiGetJson } from "@/lib/api-client";
import type { AuditEventsResponse, GetAuditEventsParams } from "@arena/shared";

/**
 * Build the querystring, omitting empty/undefined values so we
 * never send `roomId=` (which would fail the DTO's `.cuid()`
 * check). Numbers are always sent when provided.
 */
function buildAuditQuery(params: GetAuditEventsParams): string {
  const search = new URLSearchParams();

  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));

  const roomId = params.roomId?.trim();
  if (roomId) search.set("roomId", roomId);

  const eventType = params.eventType?.trim();
  if (eventType) search.set("eventType", eventType);

  const adminUserId = params.adminUserId?.trim();
  if (adminUserId) search.set("adminUserId", adminUserId);

  const createdAfter = params.createdAfter?.trim();
  if (createdAfter) search.set("createdAfter", createdAfter);

  const createdBefore = params.createdBefore?.trim();
  if (createdBefore) search.set("createdBefore", createdBefore);

  return search.toString();
}

/**
 * Fetch a page of admin audit events. Throws `ApiError` on non-2xx
 * (e.g. 401/403 for a non-admin, 400 for an invalid filter, 429 for
 * the endpoint throttle) so callers can branch on `error.status`.
 */
export async function getAuditEvents(
  params: GetAuditEventsParams,
  token?: string,
): Promise<AuditEventsResponse> {
  const query = buildAuditQuery(params);
  const path = query
    ? `/api/v1/admin/audit-events?${query}`
    : "/api/v1/admin/audit-events";
  return apiGetJson<AuditEventsResponse>(path, token);
}
