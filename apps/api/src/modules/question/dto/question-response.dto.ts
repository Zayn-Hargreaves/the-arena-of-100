import { ApiProperty } from "@nestjs/swagger";
import { Question } from "../entities/question.entity";
import { PaginationMetaDto } from "./pagination-meta.dto";

export class QuestionResponseDto {
  @ApiProperty({
    type: [Question],
    description: "Array of questions",
  })
  data!: Question[];

  @ApiProperty({
    type: () => PaginationMetaDto,
    description: "Pagination metadata",
  })
  meta!: PaginationMetaDto;

  constructor(partial: Partial<QuestionResponseDto>) {
    Object.assign(this, partial);
  }
}