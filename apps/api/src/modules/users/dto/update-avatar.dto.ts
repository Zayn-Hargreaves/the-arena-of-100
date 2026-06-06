import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { AVATAR_SEEDS } from "@arena/shared";

export const updateAvatarSchema = z.object({
  avatar: z.enum(AVATAR_SEEDS),
});

export type UpdateAvatarInput = z.infer<typeof updateAvatarSchema>;

export class UpdateAvatarDto implements UpdateAvatarInput {
  @ApiProperty({
    enum: AVATAR_SEEDS,
    example: "tux",
    description: "Avatar seed (must be one of AVATAR_SEEDS)",
  })
  avatar!: (typeof AVATAR_SEEDS)[number];
}
