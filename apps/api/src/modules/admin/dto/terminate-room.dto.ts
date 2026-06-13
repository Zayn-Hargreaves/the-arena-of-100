import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const terminateRoomSchema = z.object({
  message: z.string().max(200).optional(),
});

export type TerminateRoomInput = z.input<typeof terminateRoomSchema>;

export class TerminateRoomDto implements TerminateRoomInput {
  @ApiProperty({
    example: "Abandoned by host — terminating for triage",
    description: "Optional human-readable reason shown to affected players",
    required: false,
    maxLength: 200,
  })
  message?: string;
}
