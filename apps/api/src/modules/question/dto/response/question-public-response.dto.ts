import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { QuestionDifficulty } from "../get-questions.dto";

export class QuestionPublicResponseDto {
  @Expose()
  @ApiProperty({
    example: "clx123abc",
    description: "The unique identifier of the question",
  })
  id!: string;

  @Expose()
  @ApiProperty({
    example: "What is the capital of France?",
    description: "The question text",
  })
  content!: string;

  @Expose()
  @ApiProperty({
    example: ["Paris", "London", "Berlin", "Madrid"],
    description: "The possible answers",
  })
  options!: string[];

  @Expose()
  @ApiProperty({
    example: "EASY",
    description: "The difficulty level",
    enum: QuestionDifficulty,
  })
  difficulty!: QuestionDifficulty;

  @Expose()
  @ApiProperty({ example: true, description: "Whether the question is active" })
  active!: boolean;

  @Expose()
  @Type(() => Date)
  @ApiProperty({
    example: "2024-05-12T07:00:00Z",
    description: "The creation date",
  })
  createdAt!: Date;
}
