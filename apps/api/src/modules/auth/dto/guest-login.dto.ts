import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { AVATAR_SEEDS, type AvatarSeed } from "@arena/shared";
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
  guestSecret: z.string().max(128).optional(),
  avatar: z.enum(AVATAR_SEEDS).optional(),
});

export type GuestLoginInput = z.infer<typeof guestLoginSchema>;

export class GuestLoginDto implements GuestLoginInput {
  @ApiProperty({
    example: "guest_player",
    description: "The unique guest username chosen by the user",
    minLength: 3,
    maxLength: 256,
  })
  username!: string;

  @ApiProperty({
    example: "c7e8f9a0b1c2d3e4f5a6b7c8",
    description:
      "Optional persistent guest secret to claim ownership of existing guest user",
    required: false,
  })
  guestSecret?: string;

  @ApiProperty({
    enum: AVATAR_SEEDS,
    example: "jellyfrog",
    description: "Optional avatar seed chosen by the user",
    required: false,
  })
  avatar?: AvatarSeed;
}
