import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const createRoomSchema = z.object({
  roomType: z.enum(["PUBLIC", "PRIVATE"]),
  maxPlayers: z.number().int().min(2).max(100).optional(),
  timeLimit: z.number().int().min(5).max(60).optional(),
  category: z.string().optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export class CreateRoomDto implements CreateRoomInput {
  @ApiProperty({
    example: "PUBLIC",
    description: "Type of the room: PUBLIC or PRIVATE",
    enum: ["PUBLIC", "PRIVATE"],
  })
  roomType!: "PUBLIC" | "PRIVATE";

  @ApiProperty({
    example: 100,
    description: "Maximum number of players in the room (2-100)",
    required: false,
    minimum: 2,
    maximum: 100,
  })
  maxPlayers?: number;

  @ApiProperty({
    example: 15,
    description: "Time limit per round in seconds (5-60)",
    required: false,
    minimum: 5,
    maximum: 60,
  })
  timeLimit?: number;

  @ApiProperty({
    example: "ALL",
    description: "Question category filter: ALL or specific category name",
    required: false,
  })
  category?: string;
}
