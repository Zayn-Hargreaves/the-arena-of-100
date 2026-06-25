import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { sanitizeNickname } from "../../../common/moderation";

export const guestLoginSchema = z.object({
  username: z
    .string()
    .max(256)
    .transform((value, ctx) => {
      const sanitized = sanitizeNickname(value);
      if (sanitized === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid username",
        });
        return z.NEVER;
      }
      return sanitized;
    }),
});

export type GuestLoginInput = z.infer<typeof guestLoginSchema>;

export class GuestLoginDto implements GuestLoginInput {
  @ApiProperty({
    example: "guest_player",
    description: "The unique guest username chosen by the user",
    minLength: 3,
    maxLength: 20,
  })
  username!: string;
}
