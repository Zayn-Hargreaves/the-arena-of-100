import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const joinRoomSchema = z.object({
  roomCode: z.string().length(6),
});

export type JoinRoomInput = z.infer<typeof joinRoomSchema>;

export class JoinRoomDto implements JoinRoomInput {
  @ApiProperty({
    example: "ABCDEF",
    description: "The unique 6-character alphanumeric room code",
    minLength: 6,
    maxLength: 6,
  })
  roomCode!: string;
}
