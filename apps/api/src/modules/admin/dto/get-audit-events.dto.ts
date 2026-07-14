import { z } from "zod";
import { ApiPropertyOptional } from "@nestjs/swagger";

// ISO-8601 string that still validates when the value carries a
// timezone offset (e.g. "2026-07-01T00:00:00Z" or
// "2026-07-01T07:00:00.000+07:00"). The shared contract documents
// these bounds as ISO-8601, and the server stays authoritative on
// timezone interpretation (the resulting Date is converted with the
// runtime's local time-zone handling for the WHERE clause).
const isoDateString = z
  .string()
  .datetime({ offset: true, message: "must be an ISO-8601 datetime" });

export const getAuditEventsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    roomId: z.string().cuid().optional(),
    eventType: z.string().min(1).max(100).optional(),
    adminUserId: z.string().cuid().optional(),
    createdAfter: isoDateString
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
    createdBefore: isoDateString
      .optional()
      .transform((v) => (v ? new Date(v) : undefined)),
  })
  .superRefine((val, ctx) => {
    if (
      val.createdAfter &&
      val.createdBefore &&
      val.createdAfter.getTime() > val.createdBefore.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "createdAfter must be <= createdBefore",
        path: ["createdAfter"],
      });
    }
  });

export type GetAuditEventsInput = z.output<typeof getAuditEventsSchema>;

export class GetAuditEventsDto implements GetAuditEventsInput {
  @ApiPropertyOptional({
    example: 50,
    description: "Maximum number of audit rows to return (1-100)",
    default: 50,
  })
  limit!: number;

  @ApiPropertyOptional({
    example: 0,
    description: "Number of rows to skip for pagination",
    default: 0,
  })
  offset!: number;

  @ApiPropertyOptional({
    example: "clx123examplecuid",
    description: "Filter audit events by room ID",
  })
  roomId?: string;

  @ApiPropertyOptional({
    example: "ADMIN_TERMINATE_ROOM",
    description: "Filter audit events by event type",
  })
  eventType?: string;

  @ApiPropertyOptional({
    example: "clx456examplecuid",
    description: "Filter audit events by admin user ID",
  })
  adminUserId?: string;

  @ApiPropertyOptional({
    example: "2026-07-01T00:00:00.000Z",
    description:
      "Inclusive lower bound on createdAt (ISO-8601 datetime with offset, e.g. 2026-07-01T00:00:00Z or 2026-07-01T07:00:00.000+07:00)",
  })
  createdAfter?: Date;

  @ApiPropertyOptional({
    example: "2026-07-14T23:59:59.999Z",
    description:
      "Inclusive upper bound on createdAt (ISO-8601 datetime with offset)",
  })
  createdBefore?: Date;
}
