import { ApiProperty } from "@nestjs/swagger";
import { QuestionDifficulty, QuestionCategory } from "../dto/get-questions.dto";

export class Question {
  @ApiProperty({
    example: "clx123abc",
    description: "The unique identifier of the question",
  })
  id!: string;

  @ApiProperty({
    example: "What is the capital of France?",
    description: "The question text",
  })
  content!: string;

  @ApiProperty({
    example: ["Paris", "London", "Berlin", "Madrid"],
    description: "The possible answers",
  })
  options!: string[];

  correctAnswer!: string;

  difficulty!: QuestionDifficulty;

  @ApiProperty({
    example: "GEOGRAPHY",
    description: "The category of the question",
    enum: QuestionCategory,
  })
  category!: QuestionCategory;

  @ApiProperty({ example: true, description: "Whether the question is active" })
  active!: boolean;

  @ApiProperty({
    example: "2024-05-12T07:00:00Z",
    description: "The creation date",
  })
  createdAt!: Date;

  @ApiProperty({
    example: "2024-05-12T07:00:00Z",
    description: "The last update date",
  })
  updatedAt!: Date;
}
