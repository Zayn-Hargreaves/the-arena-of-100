// ============================================================
// Admin Audit API contract — wire shape of GET /admin/audit-events.
//
// Defined here (and not in `apps/web/src/lib/api/audit.ts`) so both
// the API and the web app import the same source of truth. Names
// and shapes are preserved verbatim from the previous web-side
// mirror; only the readonly modifier was added on `AuditEvent` to
// keep fetched rows immutable in callers.
//
//   - response shape → apps/api/.../ops/admin-audit.ops.ts
//                      (returns `{ events, total }`, events being
//                       raw Prisma EventLog rows serialized over JSON)
//   - query params   → apps/api/.../dto/get-audit-events.dto.ts
//   - row shape      → apps/api/prisma/schema.prisma `EventLog`
// ============================================================

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

/**
 * String-literal union of audit event types accepted by the API.
 * The trailing `(string & {})` keeps it assignable from arbitrary
 * server strings while preserving autocompletion on the known values.
 * Use `KNOWN_AUDIT_EVENT_TYPES` when you need the list of values.
 */
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
 *
 * All fields are `readonly` so a fetched audit record can never be
 * mutated by the consumer. The `readonly` on the reference-typed
 * `payload` only blocks reassignment — the object's own properties
 * remain mutable (a stricter `Readonly<Record<...>>` would force the
 * web UI to deep-clone before formatting).
 */
export interface AuditEvent {
  readonly id: string;
  readonly matchId: string | null;
  readonly roomId: string | null;
  readonly adminUserId: string | null;
  readonly eventType: AuditEventType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
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
