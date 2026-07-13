// ============================================================
// Admin Audit API client — consumes GET /admin/audit-events.
//
// Types here MUST mirror the backend contract to avoid drift:
//   - query params  → apps/api/.../dto/get-audit-events.dto.ts
//   - response shape → apps/api/.../ops/admin-audit.ops.ts
//                      (getAuditEvents returns `{ events, total }`,
//                       events being raw Prisma EventLog rows)
//   - row shape      → apps/api/prisma/schema.prisma model EventLog
//
// The endpoint is admin-only (Role.ADMIN) and read-only, so this
// module only exposes a GET. Do NOT add mutating calls here.
// ============================================================

import { apiGetJson } from "@/lib/api-client";

/**
 * Event types the admin kill-switch / maintenance actions emit.
 * Kept in sync with the backend `eventType` string literals
 * (admin.service.ts). Modeled as a union of the known values plus
 * `string` so an unseen event type from the server still renders
 * instead of being dropped by an over-strict type.
 */
export type KnownAuditEventType =
  | "ADMIN_TERMINATE_ROOM"
  | "ADMIN_RESET_SYSTEM"
  | "ADMIN_SYNC_QUESTIONS";

export type AuditEventType = KnownAuditEventType | (string & {});

/** The known event types, for building the filter dropdown. */
export const KNOWN_AUDIT_EVENT_TYPES: KnownAuditEventType[] = [
  "ADMIN_TERMINATE_ROOM",
  "ADMIN_RESET_SYSTEM",
  "ADMIN_SYNC_QUESTIONS",
];

/**
 * One audit row — a raw Prisma `EventLog` serialized over JSON.
 * `matchId` / `roomId` / `adminUserId` are all nullable; admin
 * actions always set `adminUserId` (the server filters on
 * `adminUserId != null`), while scope columns may be null.
 * `createdAt` arrives as an ISO-8601 string, not a Date.
 */
export interface AuditEvent {
  id: string;
  matchId: string | null;
  roomId: string | null;
  adminUserId: string | null;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Query params accepted by GET /admin/audit-events. Mirrors
 * `getAuditEventsSchema`. NOTE: the backend DTO supports no
 * time-range filter — only these fields — so the UI must not
 * offer date filtering that the server cannot honor.
 */
export interface GetAuditEventsParams {
  limit?: number;
  offset?: number;
  roomId?: string;
  eventType?: string;
  adminUserId?: string;
}

/** Response envelope: rows plus the unfiltered-by-page total. */
export interface AuditEventsResponse {
  events: AuditEvent[];
  total: number;
}

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
  const path = query ? `/admin/audit-events?${query}` : "/admin/audit-events";
  return apiGetJson<AuditEventsResponse>(path, token);
}
