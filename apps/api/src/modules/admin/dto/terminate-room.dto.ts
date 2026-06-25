import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { sanitizeAdminMessage } from "../../../common/moderation";

export const terminateRoomSchema = z.object({
  message: z.string().max(200).optional().transform(sanitizeAdminMessage),
});

export type TerminateRoomInput = z.input<typeof terminateRoomSchema>;

export class TerminateRoomDto implements TerminateRoomInput {
  @ApiProperty({
    example: "Abandoned by host — terminating for triage",
    description:
      "Optional human-readable reason. Sanitized at the boundary before it is delivered to affected players via ROOM_TERMINATED.",
    required: false,
    maxLength: 200,
  })
  message?: string;
}
