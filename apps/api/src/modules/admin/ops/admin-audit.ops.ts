// ============================================================
// Admin Audit ops — best-effort event-log append + paginated query.
// Cross-cutting concern shared by question-sync, system-reset, and
// room-termination. Extracted from admin.service.ts as pure functions
// taking an explicit deps bag so each is independently unit-testable.
// ============================================================

import { Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";

export interface AdminAuditDeps {
  prisma: PrismaService;
  logger: Logger;
}

/**
 * Best-effort audit row append. The append NEVER throws — a failure
 * here would block the kill-switch / sync / reset from returning
 * the action result to the admin UI, which is worse than a missing
 * audit row. Operators observe the warning in the logs and can
 * replay manually if needed.
 *
 * Callers should pass at least one of { matchId, roomId,
 * adminUserId } so the audit row is queryable by at least one
 * filter. Production code always supplies adminUserId; the matchId
 * and roomId fields carry the action's scope.
 */
export async function appendAudit(
  deps: AdminAuditDeps,
  params: {
    matchId?: string | null;
    roomId?: string | null;
    adminUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await deps.prisma.eventLog.create({
      data: {
        matchId: params.matchId ?? null,
        roomId: params.roomId ?? null,
        adminUserId: params.adminUserId,
        eventType: params.eventType,
        payload: params.payload as object,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    deps.logger.warn(
      `appendAudit: failed to write ${params.eventType} audit row (adminUserId=${params.adminUserId}, roomId=${params.roomId ?? "n/a"}, matchId=${params.matchId ?? "n/a"}): ${errMsg}`,
      errStack,
    );
  }
}

/**
 * PR 3: paginated, filterable query of admin audit rows. Backs the
 * GET /admin/audit-events endpoint. Always ordered by `createdAt
 * DESC` so the most recent action shows first.
 *
 * Validates limit/offset bounds at the call site (the Zod schema
 * in get-audit-events.dto.ts is the single source of truth — the
 * service trusts the caller). Returns `{ events, total }` so the
 * caller can render pagination controls without a second request.
 */
export async function getAuditEvents(
  deps: AdminAuditDeps,
  params: {
    limit: number;
    offset: number;
    roomId?: string;
    eventType?: string;
    adminUserId?: string;
    createdAfter?: Date;
    createdBefore?: Date;
  },
): Promise<{ events: unknown[]; total: number }> {
  const where: Prisma.EventLogWhereInput = {
    adminUserId: params.adminUserId,
    roomId: params.roomId,
    eventType: params.eventType,
    ...(params.createdAfter || params.createdBefore
      ? {
          createdAt: {
            ...(params.createdAfter ? { gte: params.createdAfter } : {}),
            ...(params.createdBefore ? { lte: params.createdBefore } : {}),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    deps.prisma.eventLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: params.offset,
      take: params.limit,
    }),
    deps.prisma.eventLog.count({ where }),
  ]);

  return { events, total };
}
