import { ApiProperty } from "@nestjs/swagger";

export class QuestionAdminResponseDto {
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

  @ApiProperty({ example: "Paris", description: "The correct answer" })
  correctAnswer!: string;

  @ApiProperty({
    example: "EASY",
    description: "The difficulty level",
    enum: ["EASY", "MEDIUM", "HARD"],
  })
  difficulty!: string;

  @ApiProperty({ example: true, description: "Whether the question is active" })
  active!: boolean;

  @ApiProperty({
    example: "2024-05-12T07:00:00Z",
    description: "The creation date",
  })
  createdAt!: Date;
}
