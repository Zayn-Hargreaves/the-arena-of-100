import { z } from "zod";
import { ApiPropertyOptional } from "@nestjs/swagger";

export const getAuditEventsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  roomId: z.string().cuid().optional(),
  eventType: z.string().min(1).max(100).optional(),
  adminUserId: z.string().cuid().optional(),
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
}
