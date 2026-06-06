import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const historyQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Page size (1-50, default 20)"),
  cursor: z
    .string()
    .cuid()
    .optional()
    .describe("MatchPlayer id of the last item from the previous page"),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export class HistoryQueryDto implements HistoryQuery {
  @ApiProperty({
    required: false,
    default: 20,
    minimum: 1,
    maximum: 50,
    description: "Page size (1-50, default 20)",
  })
  limit!: number;

  @ApiProperty({
    required: false,
    description: "MatchPlayer id of the last item from the previous page",
  })
  cursor?: string;
}
