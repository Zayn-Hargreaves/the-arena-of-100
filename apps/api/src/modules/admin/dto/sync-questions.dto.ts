import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const syncQuestionsSchema = z.object({
  clearExisting: z.boolean().optional().default(true),
});

export type SyncQuestionsInput = z.input<typeof syncQuestionsSchema>;

export class SyncQuestionsDto implements SyncQuestionsInput {
  @ApiProperty({
    example: true,
    description: "Whether to clear all existing questions before seeding",
    required: false,
    default: true,
  })
  clearExisting?: boolean;
}
