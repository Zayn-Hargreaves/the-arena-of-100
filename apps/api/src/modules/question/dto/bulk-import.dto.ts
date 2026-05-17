import { IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";
import { CreateQuestionDto } from "./create-question.dto";
import { ApiProperty } from "@nestjs/swagger";

export const MAX_BULK_IMPORT_SIZE = 100;

export class BulkImportDto {
  @ApiProperty({
    type: [CreateQuestionDto],
    description: "List of questions to import",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_IMPORT_SIZE) // Avoid excessively large payloads in a single request
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];
}
