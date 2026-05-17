import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const guestLoginSchema = z.object({
  username: z.string().trim().min(3).max(20),
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
