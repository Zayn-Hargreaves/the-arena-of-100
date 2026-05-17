import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";
import { createQuestionSchema, CreateQuestionDto } from "./create-question.dto";

export const MAX_BULK_IMPORT_SIZE = 100;

export const bulkImportSchema = z.object({
  questions: z.array(createQuestionSchema).min(1).max(MAX_BULK_IMPORT_SIZE),
});

export type BulkImportInput = z.infer<typeof bulkImportSchema>;

export class BulkImportDto implements BulkImportInput {
  @ApiProperty({
    type: [CreateQuestionDto],
    description: "List of questions to import",
  })
  questions!: CreateQuestionDto[];
}
