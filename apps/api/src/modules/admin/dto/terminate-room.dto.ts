import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

// Trust decision: the `message` field is delivered verbatim to every
// player in the affected room via the ROOM_TERMINATED socket event.
// The endpoint is guarded by `@Roles(Role.ADMIN)` on AdminController
// (see admin.controller.ts) — only authenticated admin users can call
// it. A shared profanity/content-sanitizer pipeline (used for
// nicknames and chat) is the second line of defense but is **not yet
// implemented** in this repo; see `plan.md` §501 ("profanity
// moderation pipeline") for the tracked follow-up.
//
// Until that pipeline lands, `message` is rejected at the schema
// boundary (fail-fast) so the kill-switch cannot accidentally ship
// unmoderated text to players. When the sanitizer lands, replace
// the `superRefine` with a `.transform()` that pipes the value
// through the shared module.
export const terminateRoomSchema = z
  .object({
    message: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.message !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Admin message disabled: shared sanitizer pipeline not yet available (see plan.md §501)",
        path: ["message"],
      });
    }
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
